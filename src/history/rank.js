// Rank tracking: turns the LCU's live ranked-stats snapshot into an append-only
// LP time series.
//
// This exists because historical LP is not retrievable from anywhere. Neither
// LCU match details nor match-v5 carry LP or rank per game, and league-v4 only
// serves the current standing — every LP graph on the internet was built by
// polling and remembering. So this module records the standing each time
// Forward Sync runs (EndOfGame is one of its triggers, which is exactly when LP
// moves) and the graph grows from the day tracking started. See ADR-0006.
import * as lcu from '../lcu.js';
import * as store from './store.js';

// LCU queueType strings ↔ the numeric queue ids the rest of the app keys on.
const QUEUE_TYPES = { RANKED_SOLO_5x5: 420, RANKED_FLEX_SR: 440 };

// The climb as one number, so tiers chart on a continuous y-axis:
// 100 LP per division, 4 divisions per tier. Apex tiers (Master+) have no
// divisions and unbounded LP; they share one base and keep their tier label for
// display. Ordering apex by LP alone is exactly how Riot ladders them anyway.
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIVISIONS = { IV: 0, III: 100, II: 200, I: 300 };
const APEX_BASE = TIERS.length * 400; // 2800

export function ladderValue(tier, division, lp) {
  const t = TIERS.indexOf(tier);
  if (t === -1) return APEX_BASE + (Number(lp) || 0); // MASTER, GRANDMASTER, CHALLENGER
  return t * 400 + (DIVISIONS[division] ?? 0) + (Number(lp) || 0);
}

// One snapshot row per ranked queue with a real standing. Unranked and
// in-placement entries report tier "" or "NONE" and carry no plottable rank, so
// they produce nothing rather than a fake zero.
export function snapshotsFromRankedStats(payload, at = Date.now()) {
  const out = [];
  for (const [queueType, queueId] of Object.entries(QUEUE_TYPES)) {
    const e = payload?.queueMap?.[queueType];
    const tier = String(e?.tier || '').toUpperCase();
    if (!tier || tier === 'NONE' || tier === 'UNRANKED') continue;
    const division = String(e.division || '').toUpperCase();
    const lp = Number(e.leaguePoints) || 0;
    out.push({
      at,
      queueId,
      tier,
      division: division in DIVISIONS ? division : null,
      lp,
      wins: Number(e.wins) || 0,
      losses: Number(e.losses) || 0,
      value: ladderValue(tier, division, lp),
    });
  }
  return out;
}

// Two snapshots describe the same standing when everything the graph plots is
// equal. wins/losses are included on purpose: an LP-neutral change (decay
// compensation, a dodge, flex games while solo is stable) still marks time
// passing at the same rank, and dropping it would leave the line implying the
// account sat idle.
function sameStanding(a, b) {
  return !!a && !!b
    && a.tier === b.tier && a.division === b.division && a.lp === b.lp
    && a.wins === b.wins && a.losses === b.losses;
}

// The append decision, pure: which fresh snapshots differ from their queue's
// last recorded standing. Split out of recordRankSnapshot so it can be tested
// without a client.
export function changedSnapshots(fresh, history) {
  const lastByQueue = new Map();
  for (const row of history) lastByQueue.set(row.queueId, row);
  return fresh.filter((s) => !sameStanding(lastByQueue.get(s.queueId), s));
}

// Called by Forward Sync on every trigger. Reads the client's current standing
// and appends whichever queues changed since their last recorded snapshot.
// Returns the number of rows appended; never throws — rank tracking must not
// be able to break match capture.
export async function recordRankSnapshot() {
  try {
    const stats = await lcu.rankedStats();
    if (!stats) return 0;

    const fresh = snapshotsFromRankedStats(stats);
    if (!fresh.length) return 0;

    const changed = changedSnapshots(fresh, await store.readRankHistory());
    if (changed.length) await store.appendRankSnapshots(changed);
    return changed.length;
  } catch {
    return 0;
  }
}
