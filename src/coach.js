// AI coach — generates beginner-friendly, matchup-specific coaching via the
// Claude API. Uses structured outputs (output_config.format) so the UI can
// render advice as cards instead of parsing prose.
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { getConfig, dataRoot } from './config.js';
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
  // 1h TTL rather than the default 5 minutes: a session is "generate a plan at
  // game start, then ask questions across a 30-minute game". At 5 minutes most
  // follow-ups land after expiry and re-pay the write premium; at 1h we pay one
  // 2x write and read cheap for the rest of the game.
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
  return blocks;
}

// ---- Model capabilities ------------------------------------------------------
// Haiku 4.5 predates the 4.6-era API surface: it supports neither `effort` nor
// adaptive thinking, and rejects both with a 400 rather than ignoring them.
// Opus 4.8 and Sonnet 5 — the other two options in Settings — support both.
function isLegacyModel(model) {
  return model.startsWith('claude-haiku');
}

// Spreadable fragments so call sites stay declarative on every model.
// `effortFor` merges into an existing output_config; `outputConfigFor` is for
// calls that would otherwise have none (and must not send an empty object).
function effortFor(model, level) {
  return isLegacyModel(model) ? {} : { effort: level };
}

function outputConfigFor(model, level) {
  return isLegacyModel(model) ? {} : { output_config: { effort: level } };
}

function thinkingFor(model) {
  return isLegacyModel(model) ? {} : { thinking: { type: 'adaptive' } };
}

// ---- Live meta lookup --------------------------------------------------------
// The model's build knowledge is frozen at its training cutoff, so before
// generating a game plan we let it search the web for the champion's
// current-patch meta build. Best-effort: any failure just means the plan is
// generated from static patch data alone.

// "champ:role:patch" -> notes text. Persisted under data/cache so a restart
// doesn't re-pay a web search plus a model call for champions already looked up
// this patch — the app is meant to be left running across sessions, and the
// keys are patch-scoped so entries stay correct until Riot ships a new patch.
const META_CACHE_FILE = path.join(dataRoot, 'cache', 'meta-notes.json');
let metaNotes = null; // Map, loaded from disk on first use

function metaCache() {
  if (metaNotes) return metaNotes;
  metaNotes = new Map();
  try {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(META_CACHE_FILE, 'utf8')))) {
      metaNotes.set(k, v);
    }
  } catch {
    // No cache yet, or it's unreadable — regenerating costs one Haiku call.
  }
  return metaNotes;
}

function persistMetaNotes() {
  const patch = ddragon.getVersion();
  const keep = [...metaCache()].filter(
    // Old-patch entries are dead weight. Empty values mean "the search failed
    // or found nothing" — fine to memoize for this process, but writing them
    // to disk would poison that champion for the rest of the patch.
    ([key, notes]) => notes && key.endsWith(`:${patch}`)
  );
  try {
    fs.mkdirSync(path.dirname(META_CACHE_FILE), { recursive: true });
    fs.writeFileSync(META_CACHE_FILE, JSON.stringify(Object.fromEntries(keep)));
  } catch (err) {
    console.error('could not persist meta build cache (continuing):', err.message);
  }
}

// Search-and-summarize is an extraction task with a 2k-token cap, not a
// reasoning task, so it runs on Haiku regardless of the configured coaching
// model — no reason to pay Opus rates for bullet points that the game-plan
// model re-checks against the item catalog anyway. Haiku predates the
// dynamic-filtering search tool, hence the basic variant.
const META_MODEL = 'claude-haiku-4-5';
const META_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 4 };

async function fetchMetaNotes(championName, role) {
  const key = `${championName}:${role || 'any'}:${ddragon.getVersion()}`;
  const cache = metaCache();
  if (cache.has(key)) return cache.get(key);
  const anthropic = client();
  if (!anthropic) return '';
  try {
    const response = await anthropic.messages.create({
      model: META_MODEL,
      max_tokens: 2000,
      tools: [META_SEARCH_TOOL],
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
    cache.set(key, notes);
    if (notes) persistMetaNotes();
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

// Returns the context split by how often it changes. `champions` is fixed for
// the whole game (~10k tokens of ability data) and can sit behind a cache
// breakpoint; `live` changes every tick and must stay after one. Callers that
// make a single request can just join the two.
async function buildGameContext(game) {
  const me = game.me;
  const enemyRefs = game.enemies.map((e) => e.champion).filter(Boolean);
  const champData = await abilityContext([me?.champion, ...enemyRefs].filter(Boolean));
  const minutes = Math.floor((game.gameTime || 0) / 60);

  return {
    champions: [
      `PATCH: ${ddragon.getVersion()}`,
      `GAME MODE: ${game.gameMode}`,
      ``,
      `CURRENT-PATCH CHAMPION DATA (authoritative):`,
      // Minified: the model reads indented and minified JSON identically, so
      // the whitespace is pure token cost on the largest block in the prompt.
      JSON.stringify(champData),
    ].join('\n'),
    live: [
      `GAME TIME: ${minutes} minutes`,
      ``,
      `THE PLAYER (the person you are coaching):`,
      `  ${playerLine(me)}`,
      ``,
      `PLAYER'S TEAM:`,
      ...game.allies.filter((a) => !a.isMe).map((a) => `  ${playerLine(a)}`),
      ``,
      `ENEMY TEAM:`,
      ...game.enemies.map((e) => `  ${playerLine(e)}`),
    ].join('\n'),
  };
}

// ---- Generation ---------------------------------------------------------------

// Progress model for the UI: 'preparing' (context + meta search) -> 'thinking'
// (the model reasoning, pct 8-30) -> 'writing' (JSON streaming in, pct 30-95).
// The server adds 'done'/'error'. Percentages are estimates — thinking length is
// unknowable up front and plan length varies — so the writing phase is scaled
// against the previous plan's size and both phases are capped short of 100.
const THINKING_CHARS_TYPICAL = 6000;

async function generateStructured(schema, userPrompt, {
  maxTokens = 16000,
  effort = 'high',
  onProgress = null,
  expectedChars = 9000,
} = {}) {
  const anthropic = client();
  if (!anthropic) throw new CoachError('no_api_key', 'No Anthropic API key configured.');
  const cfg = getConfig();

  const stream = anthropic.messages.stream({
    model: cfg.model,
    max_tokens: maxTokens,
    ...thinkingFor(cfg.model),
    system: systemBlocks(),
    output_config: {
      format: { type: 'json_schema', schema },
      ...effortFor(cfg.model, effort),
    },
    messages: [{ role: 'user', content: userPrompt }],
  });

  if (onProgress) {
    let thinkingChars = 0;
    let textChars = 0;
    let lastEmit = 0;
    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_delta') return;
      if (event.delta?.type === 'thinking_delta') thinkingChars += event.delta.thinking.length;
      else if (event.delta?.type === 'text_delta') textChars += event.delta.text.length;
      else return;
      // Throttle: deltas arrive many times per second, the bar doesn't need to.
      const now = Date.now();
      if (now - lastEmit < 400) return;
      lastEmit = now;
      onProgress(textChars > 0
        ? { phase: 'writing', pct: 30 + Math.round(65 * Math.min(1, textChars / expectedChars)) }
        : { phase: 'thinking', pct: 8 + Math.round(22 * Math.min(1, thinkingChars / THINKING_CHARS_TYPICAL)) });
    });
  }

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

// Writing-phase progress is scaled against the last plan's actual JSON size,
// which beats any fixed guess after the first generation of a session.
let lastPlanChars = 9000;

// Full in-game breakdown: matchup, threats, strategy, items.
// `onProgress` receives { phase, pct } updates for the UI's progress bar.
export async function generateGamePlan(game, onProgress = () => {}) {
  onProgress({ phase: 'preparing', pct: 3 });
  const [context, metaNotes] = await Promise.all([
    buildGameContext(game),
    fetchMetaNotes(game.me?.champion?.name, game.me?.role),
  ]);
  const role = game.me?.role ? `Their role this game is ${game.me.role}.` : 'Infer their likely role from the team layout.';
  const prompt = [
    `Coach me through this League of Legends game. I'm playing ${game.me?.champion?.name}. ${role}`,
    ``,
    context.champions,
    ``,
    context.live,
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
  // The game plan is the deliverable — full effort here.
  const plan = await generateStructured(GAME_PLAN_SCHEMA, prompt, {
    effort: 'high',
    onProgress,
    expectedChars: lastPlanChars,
  });
  lastPlanChars = Math.max(4000, JSON.stringify(plan).length);
  return plan;
}

// Follow-up Q&A about the current game. `history` is [{role, content}] from
// the browser; the game context rides in the system prompt.
export async function chat(history, game, gamePlan) {
  const anthropic = client();
  if (!anthropic) throw new CoachError('no_api_key', 'No Anthropic API key configured.');
  const cfg = getConfig();

  const system = systemBlocks();
  system.push({
    type: 'text',
    text: `The player is asking follow-up questions. Answer conversationally in Markdown. Keep answers short (under ~200 words) unless they ask for depth.`,
  });

  if (game) {
    const context = await buildGameContext(game);
    const planBlock = gamePlan
      ? `\n\nYou already gave the player this game plan (JSON): ${JSON.stringify(gamePlan)}`
      : '';
    // Champion data and the already-delivered plan are fixed for the whole
    // game, so they get their own breakpoint: every follow-up after the first
    // reads them from cache instead of re-paying full price for ~10k tokens.
    system.push({
      type: 'text',
      text: `Current game context:\n\n${context.champions}${planBlock}`,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
    system.push({
      type: 'text',
      text: `LIVE GAME STATE (changes as the game goes on):\n${context.live}`,
    });
  } else {
    system.push({ type: 'text', text: 'No game is currently active.' });
  }

  const messages = history.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 4000),
  }));
  // Breakpoint on the newest turn so the *next* question reads the whole
  // conversation so far from cache. Default 5-minute TTL — chat turns cluster,
  // and the history is small enough that a 2x write premium wouldn't pay off.
  const newest = messages[messages.length - 1];
  if (newest) {
    newest.content = [
      { type: 'text', text: newest.content, cache_control: { type: 'ephemeral' } },
    ];
  }

  const response = await anthropic.messages.create({
    model: cfg.model,
    max_tokens: 1500,
    system,
    ...outputConfigFor(cfg.model, 'low'),
    messages,
  });
  if (response.stop_reason === 'refusal') {
    throw new CoachError('refusal', 'The model declined to answer this request.');
  }
  return response.content.find((b) => b.type === 'text')?.text || '';
}
