// Level-1 lane comparison — pure arithmetic over Data Dragon base stats.
//
// Deliberately NOT model output (unlike the Game Plan): this view exists so the
// player gets a level-1 read they can verify by hand, instantly and keylessly,
// before any coaching is generated. Scope is equally deliberate: the stat sheet
// only. Riot's public patch data carries no ability damage numbers for most
// champions (modern kits resolve their tooltip values inside the game engine,
// not Data Dragon), so anything beyond rank-1 cooldowns and costs would be
// guesswork — the one thing a "trust these numbers" view must never contain.
import * as ddragon from './ddragon.js';

// Role labels exactly as gamestate emits them, in map order (top to bottom).
const LANE_ORDER = ['Top', 'Jungle', 'Mid', 'ADC (Bot)', 'Support'];

// One entry per row of the stat table. Rows with weight > 0 also feed the
// verdict score; raw stats already folded into a derived row (AD and attack
// speed into DPS, armor/MR into effective HP) stay at 0 so a single advantage
// is never counted twice. `driver` renders a signed diff into the short
// "why this verdict" phrasing.
const METRICS = [
  { id: 'hp', label: 'Health', weight: 0, dp: 0, get: (s) => s.hp },
  { id: 'hpregen', label: 'Health regen (per 5s)', weight: 0.10, dp: 1, get: (s) => s.hpregen, driver: (d) => `${d} HP/5s regen` },
  { id: 'ad', label: 'Attack damage', weight: 0, dp: 1, get: (s) => s.attackdamage },
  { id: 'as', label: 'Attack speed', weight: 0, dp: 3, get: (s) => s.attackspeed },
  { id: 'dps', label: 'Auto-attack DPS (AD × AS)', weight: 0.30, dp: 1, get: (s) => s.attackdamage * s.attackspeed, driver: (d) => `${d} auto-attack DPS` },
  { id: 'range', label: 'Attack range', weight: 0.20, dp: 0, get: (s) => s.attackrange, driver: (d) => `${d} attack range` },
  { id: 'armor', label: 'Armor', weight: 0, dp: 1, get: (s) => s.armor },
  { id: 'mr', label: 'Magic resist', weight: 0, dp: 1, get: (s) => s.spellblock },
  { id: 'ehpphys', label: 'Effective HP vs physical', weight: 0.175, dp: 0, get: (s) => s.hp * (1 + s.armor / 100), driver: (d) => `${d} effective HP vs physical` },
  { id: 'ehpmag', label: 'Effective HP vs magic', weight: 0.125, dp: 0, get: (s) => s.hp * (1 + s.spellblock / 100), driver: (d) => `${d} effective HP vs magic` },
  { id: 'ms', label: 'Move speed', weight: 0, dp: 0, get: (s) => s.movespeed, driver: (d) => `${d} move speed` },
];
// Move speed matters level 1 (walking to lane, dodging, chasing) but diffs are
// tiny relative to the base — score it on a flat-diff scale instead of the
// relative one the other metrics use.
const MS_WEIGHT = 0.10;

// A relative diff of a whole stat pool (e.g. one side has ~60% more effective
// HP) should saturate rather than let one freak stat decide everything.
const RELDIFF_CLAMP = 0.6;
// Below this relative diff a metric is background noise, not a driver.
const DRIVER_MIN_RELDIFF = 0.04;
// Verdict thresholds on the weighted score.
const EVEN_BELOW = 0.02;
const CLEAR_FROM = 0.10;

// Signed, ally-positive: (a − b) scaled by the midpoint so 100 HP means a lot
// at level 1 and nothing at a hypothetical 10k.
function relDiff(a, b) {
  const mid = (a + b) / 2;
  if (!mid) return 0;
  return (a - b) / mid;
}

function clamp(v) {
  return Math.max(-RELDIFF_CLAMP, Math.min(RELDIFF_CLAMP, v));
}

function fmtNum(v, dp) {
  const s = v.toFixed(dp);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

function champOf(player) {
  const ref = player.champion;
  if (!ref) return null;
  const champ = ddragon.champByName(ref.id) || ddragon.champByName(ref.name);
  return champ?.stats ? champ : null;
}

function resourceText(champ) {
  const mp = champ.stats.mp || 0;
  if (champ.partype && mp > 0) return `${Math.round(mp)} ${champ.partype}`;
  return champ.partype && champ.partype !== 'None' ? champ.partype : 'No resource';
}

function sideView(player, champ) {
  return {
    champion: { id: champ.id, name: champ.name, image: ddragon.imageUrls(champ.id).square },
    isMe: Boolean(player.isMe),
    resource: resourceText(champ),
  };
}

// Display rows for the full table. `better` uses a small epsilon so a rounding
// hair never lights one side green.
function compareRows(a, b) {
  return METRICS.map((m) => {
    const av = m.get(a);
    const bv = m.get(b);
    const rel = relDiff(av, bv);
    return {
      id: m.id,
      label: m.label,
      ally: fmtNum(av, m.dp),
      enemy: fmtNum(bv, m.dp),
      better: Math.abs(rel) < 0.005 ? null : rel > 0 ? 'ally' : 'enemy',
    };
  });
}

function verdictOf(a, b) {
  let score = 0;
  const contributions = [];
  for (const m of METRICS) {
    const av = m.get(a);
    const bv = m.get(b);
    const rel = clamp(relDiff(av, bv));
    // Move speed: a flat 10 MS is a real level-1 edge even though it's ~3%
    // relative — score flat diffs against the biggest base-stat spread (~40).
    const weight = m.id === 'ms' ? MS_WEIGHT : m.weight;
    const scored = m.id === 'ms' ? clamp((av - bv) / 40) : rel;
    if (!weight) continue;
    score += weight * scored;
    if (m.driver && Math.abs(scored) >= DRIVER_MIN_RELDIFF) {
      contributions.push({
        side: rel > 0 ? 'ally' : 'enemy',
        size: Math.abs(weight * scored),
        text: m.driver(`+${fmtNum(Math.abs(av - bv), m.dp)}`),
      });
    }
  }
  const abs = Math.abs(score);
  return {
    side: abs < EVEN_BELOW ? 'even' : score > 0 ? 'ally' : 'enemy',
    label: abs < EVEN_BELOW ? 'Even' : abs >= CLEAR_FROM ? 'Clear edge' : 'Slight edge',
    score: Math.round(score * 1000) / 1000,
    drivers: contributions.sort((x, y) => y.size - x.size).slice(0, 3).map(({ side, text }) => ({ side, text })),
  };
}

// Rank-1 ability cooldowns/costs — the one piece of ability data Data Dragon
// does publish reliably. Best-effort decoration: champDetails may need a fetch
// (offline with a cold cache), and its absence must never cost the stat table.
async function rank1Spells(champId) {
  try {
    const d = await ddragon.champDetails(champId);
    if (!d) return null;
    return d.spells.map((s) => ({
      key: s.key,
      name: s.name,
      cooldown: s.cooldowns[0] ?? null,
      cost: s.costs[0] ?? null,
    }));
  } catch {
    return null;
  }
}

// Pair each ally with their opposite number by role. Whatever role data didn't
// cover (blank or duplicated roles — missing position data, off-meta modes) is
// matched up by list order so no champion silently vanishes from the view.
function pairLanes(allies, enemies) {
  const a = allies.filter((p) => p.champion);
  const e = enemies.filter((p) => p.champion);
  const used = new Set();
  const lanes = [];
  for (const role of LANE_ORDER) {
    const ally = a.find((p) => !used.has(p) && p.role === role);
    const enemy = e.find((p) => !used.has(p) && p.role === role);
    if (!ally || !enemy) continue;
    used.add(ally);
    used.add(enemy);
    lanes.push({ role, ally, enemy });
  }
  const restA = a.filter((p) => !used.has(p));
  const restE = e.filter((p) => !used.has(p));
  for (let i = 0; i < Math.min(restA.length, restE.length); i++) {
    lanes.push({ role: restA[i].role || restE[i].role || '', ally: restA[i], enemy: restE[i] });
  }
  return lanes;
}

export async function compareGame(game) {
  const lanes = [];
  for (const pair of pairLanes(game.allies || [], game.enemies || [])) {
    const allyChamp = champOf(pair.ally);
    const enemyChamp = champOf(pair.enemy);
    if (!allyChamp || !enemyChamp) continue;
    lanes.push({
      role: pair.role,
      isMyLane: Boolean(pair.ally.isMe),
      ally: sideView(pair.ally, allyChamp),
      enemy: sideView(pair.enemy, enemyChamp),
      rows: compareRows(allyChamp.stats, enemyChamp.stats),
      verdict: verdictOf(allyChamp.stats, enemyChamp.stats),
    });
  }
  await Promise.all(lanes.flatMap((lane) => ['ally', 'enemy'].map(async (side) => {
    lane[side].spells = await rank1Spells(lane[side].champion.id);
  })));
  return { patch: ddragon.getVersion(), lanes };
}
