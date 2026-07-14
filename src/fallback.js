// Built-in advice used when no Anthropic API key is configured.
// Everything here is derived from Riot's own Data Dragon data (champion tags,
// difficulty ratings, official ally/enemy tips) plus a small amount of
// curated, patch-stable knowledge. It is intentionally labeled "basic mode"
// in the UI — the AI coach is much more specific.
import * as ddragon from './ddragon.js';

const TAG_EXPLAIN = {
  Fighter: 'a durable brawler who wants extended fights at close range',
  Tank: 'a frontliner who soaks damage and locks enemies down',
  Mage: 'a spell-caster who deals burst or sustained magic damage from range',
  Assassin: 'a mobile killer who tries to delete one target quickly',
  Marksman: 'a ranged attacker who deals steady physical damage, but is fragile',
  Support: 'an enabler who protects allies or sets up kills with crowd control',
};

const TAG_COUNTERPLAY = {
  Assassin: 'Stay near teammates and don\'t wander alone — assassins feed on isolated targets. Consider defensive items early if they kill you twice.',
  Mage: 'Their damage comes in bursts around ability cooldowns. After they miss or use their main spell, you have a short safe window to act.',
  Marksman: 'They get stronger as the game goes on but are fragile. Forcing early fights and jumping on them in teamfights shuts them down.',
  Tank: 'Don\'t waste your damage on them if their fragile teammates are reachable. Tanks win when you hit the wrong target.',
  Fighter: 'Avoid long 1v1 trades — they usually win extended fights. Poke them down or fight with a numbers advantage.',
  Support: 'Track their key ability (hook, shield, or stun). When it\'s on cooldown, their whole lane is weaker.',
};

// Champions with meaningful healing — signals the "buy antiheal" lesson.
const HEALING_CHAMPS = new Set([
  'Aatrox', 'DrMundo', 'Soraka', 'Yuumi', 'Vladimir', 'Sylas', 'Swain', 'Fiora',
  'Illaoi', 'Maokai', 'Mundo', 'Nami', 'Senna', 'Seraphine', 'Sona', 'Warwick',
  'Zac', 'Briar', 'KSante', 'Rhaast', 'Kayn', 'Olaf', 'Trundle', 'Volibear', 'Yone',
]);

function damageLean(champ) {
  if (!champ?.info) return 'unknown';
  const { attack = 0, magic = 0 } = champ.info;
  if (attack - magic >= 3) return 'physical';
  if (magic - attack >= 3) return 'magic';
  return 'mixed';
}

export async function generateBasicGamePlan(game) {
  const me = game.me;
  const myDetail = me?.champion ? await ddragon.champDetails(me.champion.id) : null;

  const enemyThreats = [];
  let physical = 0;
  let magic = 0;
  let healers = [];
  for (const enemy of game.enemies) {
    if (!enemy.champion) continue;
    const d = await ddragon.champDetails(enemy.champion.id);
    if (!d) continue;
    const lean = damageLean(d);
    if (lean === 'physical') physical += 1;
    else if (lean === 'magic') magic += 1;
    else { physical += 0.5; magic += 0.5; }
    if (HEALING_CHAMPS.has(d.id)) healers.push(d.name);

    const primaryTag = d.tags?.[0];
    enemyThreats.push({
      champion: d.name,
      role: enemy.role || '',
      threatLevel: d.info?.difficulty >= 8 ? 'High' : 'Moderate',
      summary: `${d.name}, ${d.title} — ${primaryTag ? TAG_EXPLAIN[primaryTag] || primaryTag : 'flexible role'}. Deals ${damageLean(d)} damage.`,
      keyAbilities: d.spells.slice(0, 4).map((s) => ({
        key: s.key,
        name: s.name,
        whatItDoes: s.description,
        howToReact: '',
      })),
      howToPlayAgainst: [
        ...(d.enemytips.slice(0, 3)),
        primaryTag && TAG_COUNTERPLAY[primaryTag] ? TAG_COUNTERPLAY[primaryTag] : null,
      ].filter(Boolean).join(' '),
    });
  }

  const profile = physical > magic * 1.7 ? 'Mostly Physical' : magic > physical * 1.7 ? 'Mostly Magic' : 'Mixed';
  const defensiveAdvice = [
    profile === 'Mostly Physical'
      ? 'Most enemy damage is physical — armor items (like Plated Steelcaps, or armor components) give you the best defensive value.'
      : profile === 'Mostly Magic'
        ? 'Most enemy damage is magic — magic resist items (like Mercury\'s Treads, or MR components) give you the best defensive value.'
        : 'The enemy team deals both physical and magic damage — buy defense against whoever is actually killing you.',
    healers.length
      ? `Heads up: ${healers.join(', ')} heal${healers.length === 1 ? 's' : ''} a lot. Items with "Grievous Wounds" (anti-heal) cut healing by 40% — worth a buy if they snowball.`
      : null,
  ].filter(Boolean).join(' ');

  return {
    basicMode: true,
    overview: {
      summary: myDetail
        ? `You're playing ${myDetail.name}, ${myDetail.title} — ${(myDetail.tags || []).map((t) => TAG_EXPLAIN[t] || t).join(', and ')}. Below is what Riot's own data says about your champion and each enemy. Add an Anthropic API key in Settings for a fully personalized game plan.`
        : 'Add an Anthropic API key in Settings for a fully personalized game plan.',
      matchupDifficulty: 'Moderate',
      keyPrinciple: 'Focus on the basics: last-hit minions, watch the minimap every few seconds, and don\'t fight when you\'re outnumbered.',
      winCondition: 'Basic mode can\'t analyze win conditions — the AI coach can.',
    },
    laneMatchup: null,
    enemyThreats,
    gamePlan: {
      earlyGame: {
        goal: 'Farm safely and learn your matchup.',
        tips: (myDetail?.allytips || []).slice(0, 4),
      },
      midGame: { goal: 'Group with your team and take objectives when the enemy is dead or far away.', tips: [] },
      lateGame: { goal: 'Stay together — one bad death can lose the game after 30 minutes.', tips: [] },
      teamfightRole: '',
    },
    itemization: {
      startingItems: null,
      coreBuild: [],
      boots: null,
      situational: [],
      enemyDamageProfile: profile,
      defensiveAdvice,
    },
    glossary: [
      { term: 'Grievous Wounds', definition: 'A debuff (usually from items) that reduces all healing the target receives by 40%.' },
      { term: 'Last-hitting', definition: 'Landing the killing blow on a minion — the only way it grants gold.' },
      { term: 'Crowd control (CC)', definition: 'Effects that restrict enemy movement or actions: stuns, roots, slows, knock-ups.' },
    ],
  };
}

export async function generateBasicChampSelect(champSelect) {
  const my = champSelect.me?.champion;
  if (!my) return null;
  const d = await ddragon.champDetails(my.id);
  const enemies = [];
  for (const m of champSelect.theirTeam) {
    if (!m.champion) continue;
    const ed = await ddragon.champDetails(m.champion.id);
    if (ed) {
      enemies.push({
        champion: ed.name,
        whatToExpect: ed.enemytips[0] || `${ed.title} — ${(ed.tags || []).join('/')}`,
      });
    }
  }
  return {
    basicMode: true,
    yourChampion: {
      playstyleSummary: `${d.name}, ${d.title}. ${(d.tags || []).map((t) => TAG_EXPLAIN[t] || t).join('; ')}.${d.partype && d.partype !== 'None' ? ` Uses ${d.partype}.` : ''} ${d.lore}`,
      strengths: [],
      weaknesses: [],
      abilities: [
        { key: 'Passive', name: d.passive.name, howToUseIt: d.passive.description },
        ...d.spells.map((s) => ({ key: s.key, name: s.name, howToUseIt: s.description })),
      ],
    },
    earlyGamePlan: (d.allytips || []).slice(0, 3).join(' ') || 'Farm safely and learn your abilities.',
    knownEnemies: enemies,
    quickTips: d.allytips || [],
    glossary: [],
  };
}
