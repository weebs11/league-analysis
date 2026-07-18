// Merges a raw container's per-source payloads into one Index Row.
//
// The sources are complementary, not ranked: match-v5 has challenges the LCU
// lacks, and either can be the only one present. So the merge is "riot-api wins
// where it has a value, LCU fills the rest" rather than a straight replace.
import { normalizeLcu, playersFromLcu, teamsFromLcu } from './normalize-lcu.js';
import { normalizeRiot, playersFromRiot, teamsFromRiot } from './normalize-riot.js';

export function normalize(container, { hasCoachingRecord = false } = {}) {
  const ownerPuuid = container?.owner?.puuid || null;
  const lcuPayload = container?.sources?.lcu?.payload;
  const riotPayload = container?.sources?.['riot-api']?.payload;

  const lcuRow = lcuPayload ? normalizeLcu(lcuPayload, ownerPuuid) : null;
  const riotRow = riotPayload ? normalizeRiot(riotPayload, ownerPuuid) : null;
  if (!lcuRow && !riotRow) return null;

  const merged = { ...(lcuRow || {}) };
  if (riotRow) {
    for (const [k, v] of Object.entries(riotRow)) {
      if (v !== null && v !== undefined) merged[k] = v;
    }
  }

  merged.matchId = container.matchId || merged.matchId;
  merged.sources = Object.keys(container?.sources || {});
  merged.hasCoachingRecord = Boolean(hasCoachingRecord);
  return merged;
}

// Full per-match detail for the detail view. Prefers match-v5 when present
// because teamPosition gives every player a reliable role, which the LCU can
// only infer for the bottom-lane pair.
export function buildDetail(container) {
  const riotPayload = container?.sources?.['riot-api']?.payload;
  const lcuPayload = container?.sources?.lcu?.payload;
  if (riotPayload) {
    return { players: playersFromRiot(riotPayload), teams: teamsFromRiot(riotPayload), detailSource: 'riot-api' };
  }
  if (lcuPayload) {
    return { players: playersFromLcu(lcuPayload), teams: teamsFromLcu(lcuPayload), detailSource: 'lcu' };
  }
  return { players: [], teams: [], detailSource: null };
}
