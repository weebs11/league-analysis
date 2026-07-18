// AI coach — generates beginner-friendly, matchup-specific coaching via the
// Claude API. Uses structured outputs (output_config.format) so the UI can
// render advice as cards instead of parsing prose.
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from './config.js';
import * as ddragon from './ddragon.js';

function client() {
  const key = getConfig().anthropicApiKey;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

export function aiAvailable() {
  return Boolean(getConfig().anthropicApiKey);
}

const SYSTEM_PROMPT = `You are a friendly League of Legends coach for a player who is still learning the game. They know the basics (lanes, minions, items exist) but NOT the deep vocabulary or matchup knowledge, and they should never feel dumb for not knowing something.

Rules for every piece of advice you write:
- Be concrete and actionable. "Stand behind your minions when Caitlyn's traps are down" beats "play safe".
- Briefly explain WHY, so the player learns transferable principles, not just instructions.
- When you use a League term of art (e.g. "wave management", "power spike", "peel", "kite", "tempo"), use it — that's how they learn — but make sure it appears in the glossary you return.
- Ability descriptions must match the CURRENT patch data provided. If provided data conflicts with your memory, trust the provided data.
- Item advice must come from the CURRENT-PATCH ITEM CATALOG provided in this conversation. Your training data's item knowledge is outdated — items are added, removed, and reworked every patch. Recommend only items that appear in the catalog, using their exact names. If the player mentions an item you don't recognize, check the catalog before ever claiming it doesn't exist.
- Never invent items or abilities.
- Keep individual strings tight: 1-3 sentences unless the field clearly calls for more.
- Difficulty and threat ratings should be honest — don't inflate everything to "High".`;

// System prompt + current-patch item catalog. The catalog is a stable ~7k-token
// block (changes only on patch day), so the cache breakpoint goes on it — one
// cache write per patch, then every generation and chat message reads it cheap.
function systemBlocks() {
  const blocks = [{ type: 'text', text: SYSTEM_PROMPT }];
  const catalog = ddragon.itemCatalogText();
  if (catalog) {
    blocks.push({
      type: 'text',
      text: `CURRENT-PATCH ITEM CATALOG (patch ${ddragon.getVersion()}, authoritative — every purchasable Summoner's Rift item):\n${catalog}`,
    });
  }
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
  return blocks;
}

// ---- Live meta lookup --------------------------------------------------------
// The model's build knowledge is frozen at its training cutoff, so before
// generating a game plan we let it search the web for the champion's
// current-patch meta build. Best-effort: any failure just means the plan is
// generated from static patch data alone.

const metaNotesCache = new Map(); // "champ:role:patch" -> notes text

function webSearchTool(model) {
  // Haiku predates the dynamic-filtering search tool; everything else in the
  // settings list (Opus 4.8, Sonnet 5) supports it.
  const type = model.startsWith('claude-haiku') ? 'web_search_20250305' : 'web_search_20260209';
  return { type, name: 'web_search', max_uses: 4 };
}

async function fetchMetaNotes(championName, role) {
  const key = `${championName}:${role || 'any'}:${ddragon.getVersion()}`;
  if (metaNotesCache.has(key)) return metaNotesCache.get(key);
  const anthropic = client();
  if (!anthropic) return '';
  const cfg = getConfig();
  try {
    const response = await anthropic.messages.create({
      model: cfg.model,
      max_tokens: 2000,
      tools: [webSearchTool(cfg.model)],
      messages: [{
        role: 'user',
        content: [
          `Search the web for the current best League of Legends build for ${championName}${role ? ` ${role}` : ''} on patch ${ddragon.getVersion()} (or the closest recent patch you can find).`,
          `Then summarize as terse bullet points: starting items, core build order, boots, common situational items, and any notable recent patch changes to this champion or their core items.`,
          `Plain text only, no preamble. If you can't find current information, reply with exactly: NO_DATA`,
        ].join('\n'),
      }],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const notes = !text || text.includes('NO_DATA') ? '' : text;
    metaNotesCache.set(key, notes);
    return notes;
  } catch (err) {
    console.error('meta build search failed (continuing without it):', err.message);
    return '';
  }
}

// ---- Structured output schemas ---------------------------------------------

const str = { type: 'string' };
const strArr = { type: 'array', items: { type: 'string' } };
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items) => ({ type: 'array', items });

const GLOSSARY = arr(obj({ term: str, definition: str }));

const GAME_PLAN_SCHEMA = obj({
  overview: obj({
    summary: str, // 2-4 sentences: the shape of this game for the player
    matchupDifficulty: { type: 'string', enum: ['Easy', 'Moderate', 'Hard', 'Very Hard'] },
    keyPrinciple: str, // the ONE thing to remember this game
    winCondition: str, // how the player's team wins this game
  }),
  laneMatchup: obj({
    analysis: str, // how the direct lane matchup plays out
    whoIsStrongerEarly: { type: 'string', enum: ['You', 'Enemy', 'Even'] },
    tradingPattern: str, // when/how to trade damage
    dangerWindows: str, // levels/moments where the enemy can kill you
    tips: strArr,
  }),
  enemyThreats: arr(
    obj({
      champion: str, // exact champion name
      role: str,
      threatLevel: { type: 'string', enum: ['Low', 'Moderate', 'High', 'Extreme'] },
      summary: str, // what this champion does, in plain language
      keyAbilities: arr(
        obj({
          key: { type: 'string', enum: ['Passive', 'Q', 'W', 'E', 'R'] },
          name: str,
          whatItDoes: str,
          howToReact: str,
        })
      ),
      howToPlayAgainst: str,
    })
  ),
  gamePlan: obj({
    earlyGame: obj({ goal: str, tips: strArr }),
    midGame: obj({ goal: str, tips: strArr }),
    lateGame: obj({ goal: str, tips: strArr }),
    teamfightRole: str, // what the player should be doing in fights
  }),
  itemization: obj({
    startingItems: obj({ items: strArr, why: str }),
    coreBuild: arr(obj({ item: str, why: str })), // in purchase order
    boots: obj({ item: str, why: str }),
    situational: arr(obj({ item: str, buyWhen: str })),
    enemyDamageProfile: { type: 'string', enum: ['Mostly Physical', 'Mostly Magic', 'Mixed'] },
    defensiveAdvice: str, // how to adapt defensively vs this comp
  }),
  glossary: GLOSSARY,
});

const CHAMP_SELECT_SCHEMA = obj({
  yourChampion: obj({
    playstyleSummary: str, // what playing this champ feels like, for a newer player
    strengths: strArr,
    weaknesses: strArr,
    abilities: arr(
      obj({
        key: { type: 'string', enum: ['Passive', 'Q', 'W', 'E', 'R'] },
        name: str,
        howToUseIt: str,
      })
    ),
  }),
  earlyGamePlan: str, // what to do in the first few minutes
  knownEnemies: arr(
    obj({
      champion: str,
      whatToExpect: str,
    })
  ),
  quickTips: strArr,
  glossary: GLOSSARY,
});

// ---- Context building --------------------------------------------------------

async function abilityContext(champRefs) {
  const out = [];
  for (const ref of champRefs) {
    if (!ref?.id) continue;
    try {
      const d = await ddragon.champDetails(ref.id);
      if (!d) continue;
      out.push({
        name: d.name,
        title: d.title,
        tags: d.tags,
        resource: d.partype,
        passive: d.passive,
        abilities: d.spells,
        officialTipsAgainst: d.enemytips.slice(0, 4),
        officialTipsPlayingAs: d.allytips.slice(0, 4),
      });
    } catch {
      // Missing detail for one champ shouldn't sink the generation.
    }
  }
  return out;
}

function playerLine(p) {
  const bits = [p.champion?.name || 'Unknown'];
  if (p.role) bits.push(`role: ${p.role}`);
  if (p.level) bits.push(`level ${p.level}`);
  if (p.items?.length) bits.push(`items: ${p.items.map((i) => i.name).join(', ')}`);
  if (p.scores) bits.push(`KDA ${p.scores.kills}/${p.scores.deaths}/${p.scores.assists}, ${p.scores.cs} CS`);
  return bits.join(' — ');
}

async function buildGameContext(game) {
  const me = game.me;
  const enemyRefs = game.enemies.map((e) => e.champion).filter(Boolean);
  const champData = await abilityContext([me?.champion, ...enemyRefs].filter(Boolean));
  const minutes = Math.floor((game.gameTime || 0) / 60);

  return [
    `PATCH: ${ddragon.getVersion()}`,
    `GAME MODE: ${game.gameMode}, game time: ${minutes} minutes`,
    ``,
    `THE PLAYER (the person you are coaching):`,
    `  ${playerLine(me)}`,
    ``,
    `PLAYER'S TEAM:`,
    ...game.allies.filter((a) => !a.isMe).map((a) => `  ${playerLine(a)}`),
    ``,
    `ENEMY TEAM:`,
    ...game.enemies.map((e) => `  ${playerLine(e)}`),
    ``,
    `CURRENT-PATCH CHAMPION DATA (authoritative):`,
    JSON.stringify(champData, null, 1),
  ].join('\n');
}

// ---- Generation ---------------------------------------------------------------

async function generateStructured(schema, userPrompt, maxTokens = 16000) {
  const anthropic = client();
  if (!anthropic) throw new CoachError('no_api_key', 'No Anthropic API key configured.');
  const cfg = getConfig();

  const stream = anthropic.messages.stream({
    model: cfg.model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system: systemBlocks(),
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new CoachError('refusal', 'The model declined to answer this request.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new CoachError('truncated', 'The response was cut off. Try again.');
  }
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new CoachError('empty', 'The model returned no content.');
  return JSON.parse(text);
}

export class CoachError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function describeApiError(err) {
  if (err instanceof CoachError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Your Anthropic API key was rejected. Double-check it in Settings.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the Anthropic API. Wait a moment and try again.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your internet connection.';
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (${err.status}): ${err.message}`;
  }
  return `Unexpected error: ${err.message}`;
}

// Full in-game breakdown: matchup, threats, strategy, items.
export async function generateGamePlan(game) {
  const [context, metaNotes] = await Promise.all([
    buildGameContext(game),
    fetchMetaNotes(game.me?.champion?.name, game.me?.role),
  ]);
  const role = game.me?.role ? `Their role this game is ${game.me.role}.` : 'Infer their likely role from the team layout.';
  const prompt = [
    `Coach me through this League of Legends game. I'm playing ${game.me?.champion?.name}. ${role}`,
    ``,
    context,
    ``,
    ...(metaNotes
      ? [
          `LIVE META NOTES (gathered just now via web search — cross-check against the item catalog; catalog names are authoritative):`,
          metaNotes,
          ``,
        ]
      : []),
    `Produce the full coaching breakdown:`,
    `- "laneMatchup" should focus on the enemy laner(s) directly opposing my role (for bot lane, cover both the enemy ADC and support as a duo).`,
    `- "enemyThreats" must cover ALL five enemy champions, ordered from most to least dangerous to me specifically. Only include abilities worth knowing about (2-4 per champion).`,
    `- "itemization" must react to the actual enemy team (their damage types, healing, tanks) and to items they already have. Recommend current-patch items only.`,
    `- "glossary" should define every jargon term you used (aim for 5-12 terms).`,
  ].join('\n');
  return generateStructured(GAME_PLAN_SCHEMA, prompt);
}

// Lighter champ-select briefing (enemy picks may be partially known).
export async function generateChampSelectAdvice(champSelect) {
  const myChamp = champSelect.me?.champion;
  if (!myChamp) throw new CoachError('no_champion', 'Lock in (or hover) a champion first.');
  const knownEnemies = champSelect.theirTeam.map((m) => m.champion).filter(Boolean);
  const allies = champSelect.myTeam.filter((m) => !m.isMe).map((m) => m.champion).filter(Boolean);
  const champData = await abilityContext([myChamp, ...knownEnemies]);
  const role = champSelect.me.role ? `My assigned role is ${champSelect.me.role}.` : '';

  const prompt = [
    `I'm in champion select, playing ${myChamp.name}. ${role}`,
    knownEnemies.length
      ? `Known enemy picks so far: ${knownEnemies.map((c) => c.name).join(', ')}.`
      : `No enemy picks are visible yet.`,
    allies.length ? `My teammates picked: ${allies.map((c) => c.name).join(', ')}.` : '',
    ``,
    `PATCH: ${ddragon.getVersion()}`,
    `CURRENT-PATCH CHAMPION DATA (authoritative):`,
    JSON.stringify(champData, null, 1),
    ``,
    `Give me a pre-game briefing I can absorb in ~90 seconds: how my champion works, a plan for the first minutes, and what to expect from any known enemies.`,
  ].join('\n');
  return generateStructured(CHAMP_SELECT_SCHEMA, prompt, 8000);
}

// Follow-up Q&A about the current game. `history` is [{role, content}] from
// the browser; the game context rides in the system prompt.
export async function chat(history, game, gamePlan) {
  const anthropic = client();
  if (!anthropic) throw new CoachError('no_api_key', 'No Anthropic API key configured.');
  const cfg = getConfig();

  let contextBlock = 'No game is currently active.';
  if (game) {
    contextBlock = await buildGameContext(game);
  }
  const planBlock = gamePlan
    ? `\n\nYou already gave the player this game plan (JSON): ${JSON.stringify(gamePlan)}`
    : '';

  const response = await anthropic.messages.create({
    model: cfg.model,
    max_tokens: 1500,
    system: [
      ...systemBlocks(),
      {
        type: 'text',
        text: `The player is asking follow-up questions. Answer conversationally in Markdown. Keep answers short (under ~200 words) unless they ask for depth. Current game context:\n\n${contextBlock}${planBlock}`,
      },
    ],
    messages: history.slice(-20).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 4000),
    })),
  });
  if (response.stop_reason === 'refusal') {
    throw new CoachError('refusal', 'The model declined to answer this request.');
  }
  return response.content.find((b) => b.type === 'text')?.text || '';
}
