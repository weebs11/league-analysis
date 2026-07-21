// Orchestrates the champion-build data flow: disk cache first, op.gg on a
// 24h TTL, stale cache as the fallback when the feed is unreachable. Callers
// always get either a usable Build Extract (possibly flagged stale) or a
// BuildsUnavailableError whose message is fit to show the user.
import * as opgg from './opgg.js';
import * as store from './store.js';
import { extractBuild, extractRoster, SCHEMA_VERSION } from './extract.js';
import * as ddragon from '../ddragon.js';

// Build stats move within a patch (op.gg re-aggregates continuously), so a
// day-old extract is refreshed — but never thrown away until a fresh one lands.
export const EXTRACT_TTL_MS = 24 * 60 * 60 * 1000;
export const ROSTER_TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_TIER = 'emerald_plus';

export class BuildsUnavailableError extends Error {}

// One upstream fetch per (champion, role, tier) no matter how many requests
// race — the inflightImages idiom from ddragon.js.
const inflight = new Map();
function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function usable(cached) {
  return cached && cached.schemaVersion === SCHEMA_VERSION;
}

// Fire-and-forget a background revalidation. The promise is already deduped and
// already persists on success; here we only need to keep a rejected refresh
// (op.gg down, payload drift) from surfacing as an unhandled rejection — the
// user keeps the cached data they were just served either way.
function revalidate(promise) {
  promise.catch(() => {});
}

// The upstream half of a fetch: op.gg -> gated Extract -> disk. Deduped so a
// background revalidation and any request that blocks on the same key share one
// upstream call. Rejects (never returns stale) — callers decide the fallback.
function fetchRosterFresh(tier) {
  return dedupe(`roster|${tier}`, async () => {
    const roster = extractRoster(await opgg.fetchRoster(tier), { tier });
    await store.writeRoster(roster);
    return roster;
  });
}

function fetchBuildFresh(championId, role, tier) {
  // op.gg keys champions by the lowercased ddragon id ("MonkeyKing" -> "monkeyking").
  return dedupe(`build|${championId}|${role}|${tier}`, async () => {
    const raw = await opgg.fetchChampionBuild(championId.toLowerCase(), role, tier);
    const extract = extractBuild(raw, { championId, role, tier });
    await store.writeExtract(extract);
    return extract;
  });
}

// Serve-cache-first with stale-while-revalidate. A day-old extract is served
// instantly and refreshed in the background, so a page load never waits on
// op.gg when usable data is already on disk — the same reason the cache is our
// offline fallback (ADR-0008): build stats barely move within a day. Only a
// cold cache (nothing usable) or an explicit refresh blocks on the upstream,
// and only those surface `stale: true` when the feed is down.
export async function getRoster(tier = DEFAULT_TIER) {
  const cached = await store.readRoster(tier);
  const haveUsable = usable(cached);
  if (haveUsable && store.isFresh(cached.fetchedAt, ROSTER_TTL_MS)) {
    return { roster: cached, source: 'cache', stale: false };
  }
  if (haveUsable) {
    revalidate(fetchRosterFresh(tier)); // past TTL but usable: refresh behind the response
    return { roster: cached, source: 'cache', stale: false };
  }
  try {
    return { roster: await fetchRosterFresh(tier), source: 'fresh', stale: false };
  } catch (err) {
    throw new BuildsUnavailableError('Champion stats could not be fetched — check your connection and try again.', { cause: err });
  }
}

export async function getBuild(championId, role, tier = DEFAULT_TIER, { refresh = false } = {}) {
  const cached = await store.readExtract(championId, role, tier);
  const haveUsable = usable(cached);
  if (!refresh && haveUsable && store.isFresh(cached.fetchedAt, EXTRACT_TTL_MS)) {
    return { extract: cached, source: 'cache', stale: false };
  }
  if (!refresh && haveUsable) {
    revalidate(fetchBuildFresh(championId, role, tier)); // past TTL but usable
    return { extract: cached, source: 'cache', stale: false };
  }
  try {
    return { extract: await fetchBuildFresh(championId, role, tier), source: 'fresh', stale: false };
  } catch (err) {
    // A forced refresh (or cold miss) that can't reach op.gg: fall back to the
    // last good extract, labeled so the UI can say the refresh didn't land.
    if (haveUsable) return { extract: cached, source: 'stale-cache', stale: true };
    throw new BuildsUnavailableError(
      `Build stats for this champion aren't available right now — the stats service may be unreachable, or has no data for this role yet.`,
      { cause: err }
    );
  }
}
