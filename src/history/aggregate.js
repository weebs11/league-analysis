// Rollups for the summary strip.
//
// Two comparisons, because they answer different questions and fail in opposite
// directions: the Benchmark says "is this good?" (and stays unflattering for
// months while you improve), the Personal Baseline says "am I improving?" (and
// never notices a weakness you have always had).
import { benchmarkFor } from './benchmarks.js';

// The stats the Personal Baseline tracks, each mapped to the decimal places it
// reads naturally at: a participation rate needs three, CS/min two, and vision
// score is close enough to a whole number.
const BASELINE_STATS = { csPerMin: 2, killParticipation: 3, visionScore: 1 };
// Below this, a trend is noise. Better to show nothing than a confident arrow
// drawn from three games.
const MIN_GAMES_FOR_TREND = 10;

function mean(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function round(v, dp = 2) {
  return v === null ? null : +v.toFixed(dp);
}

// Remakes are excluded from every aggregate. A 90-second game with a win flag
// would otherwise drag CS/min and winrate around for no reason.
export function playableRows(rows) {
  return (rows || []).filter((r) => !r.isRemake);
}

function primaryRole(rows) {
  const counts = new Map();
  for (const r of rows) {
    if (!r.role) continue;
    counts.set(r.role, (counts.get(r.role) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [role, n] of counts) if (n > bestN) { best = role; bestN = n; }
  return best;
}

export function summarize(rows, { window = 20 } = {}) {
  const playable = playableRows(rows); // already sorted newest-first by the store
  const current = playable.slice(0, window);
  const previous = playable.slice(window, window * 2);

  const wins = current.filter((r) => r.win).length;
  const losses = current.length - wins;

  const champs = new Map();
  for (const r of current) {
    const key = r.championId || r.championName || String(r.championKey ?? 'unknown');
    if (!champs.has(key)) {
      champs.set(key, { championId: r.championId, championName: r.championName, championKey: r.championKey, games: 0, wins: 0 });
    }
    const c = champs.get(key);
    c.games++;
    if (r.win) c.wins++;
  }
  const topChampions = [...champs.values()]
    .sort((a, b) => b.games - a.games || b.wins - a.wins)
    .slice(0, 3)
    .map((c) => ({ ...c, winrate: c.games ? +(c.wins / c.games).toFixed(3) : null }));

  // One benchmark set for the strip, chosen by the role played most in the
  // window. Per-match rows still compare against their own role's targets.
  const role = primaryRole(current);
  const bm = benchmarkFor(role);

  const baseline = {};
  for (const [stat, dp] of Object.entries(BASELINE_STATS)) {
    const cur = mean(current, stat);
    const prev = mean(previous, stat);
    if (cur === null) continue;
    baseline[stat] = {
      current: round(cur, dp),
      previous: round(prev, dp),
      delta: prev === null ? null : round(cur - prev, dp),
      benchmark: bm?.[stat] ?? null,
    };
  }

  return {
    window,
    role,
    record: {
      wins,
      losses,
      winrate: current.length ? +(wins / current.length).toFixed(3) : null,
    },
    topChampions,
    baseline,
    totalMatches: rows?.length ?? 0,
    playableMatches: playable.length,
    insufficientData: playable.length < MIN_GAMES_FOR_TREND,
  };
}

// Filters for the list route. Champion matches on either the ddragon id or the
// display name so the UI can pass whichever it has.
export function filterRows(rows, { champion, role, queue } = {}) {
  let out = rows || [];
  if (champion) {
    const c = String(champion).toLowerCase();
    out = out.filter((r) => String(r.championId || '').toLowerCase() === c || String(r.championName || '').toLowerCase() === c);
  }
  if (role) out = out.filter((r) => r.role === role);
  if (queue) {
    const q = Number(queue);
    out = out.filter((r) => r.queueId === q);
  }
  return out;
}
