// Forward Sync: pulls newly-finished ranked matches out of the League client
// and into the Archive.
//
// The LCU only holds the 20 most recent matches and forgets everything else, so
// this is the one chance to capture a game permanently. It is deliberately
// sloppy about *when* it runs — several triggers, overlapping, retrying — and
// precise about what it writes. Re-running costs one list call plus a lookup
// per match, because a match already on disk is skipped before any detail fetch.
import * as lcu from '../lcu.js';
import * as store from './store.js';
import { makeMatchId } from './paths.js';

// Ranked Solo/Duo and Ranked Flex. Everything else is out of scope: ARAM and
// Arena have no lane opponent, no role, and no CS target, so every diagnostic
// stat the app shows would be meaningless there.
export const RANKED_QUEUES = new Set([420, 440]);

// Guards against overlapping runs: several triggers fire independently, and two
// concurrent syncs would race on the same detail fetches for no benefit.
let syncing = false;

export async function syncForward() {
  if (syncing) return { added: 0, skipped: 0, busy: true };
  syncing = true;
  try {
    const me = await lcu.currentSummoner();
    if (!me?.puuid) return { added: 0, skipped: 0, reason: 'no-summoner' };

    const owner = { puuid: me.puuid, gameName: me.gameName || null, tagLine: me.tagLine || null };
    const games = await lcu.matchList();
    if (!games) return { added: 0, skipped: 0, reason: 'no-match-list' };

    let added = 0;
    let skipped = 0;
    let platformId = null;
    const touched = [];

    for (const g of games) {
      // Read the platform off ANY game, before the ranked filter. It identifies
      // the shard, not the queue, and it is the only place the app can learn it —
      // the gameflow session omits it, so Coaching Records cannot be keyed
      // without it. Filtering first meant a run of 20 non-ranked games left it
      // null, and the write below then erased a previously-good value.
      platformId = platformId || g.platformId || null;
      if (!RANKED_QUEUES.has(g.queueId)) { skipped++; continue; }
      const matchId = makeMatchId(g.platformId, g.gameId);
      if (!matchId) { skipped++; continue; }
      // Cheap dedup before the expensive call: the detail fetch is ~31KB and we
      // only ever need it once per match.
      if (await store.hasSource(matchId, 'lcu')) { skipped++; continue; }

      const detail = await lcu.matchDetail(g.gameId);
      // A failed detail fetch is left alone rather than written partially — the
      // next trigger retries it, and the match is still in the LCU window.
      if (!detail) { skipped++; continue; }

      await store.writeSource(matchId, 'lcu', detail, owner);
      touched.push(matchId);
      added++;
    }

    for (const id of touched) await store.refreshRow(id);

    await store.writeSyncState({
      puuid: owner.puuid,
      gameName: owner.gameName,
      tagLine: owner.tagLine,
      // Belt and braces: never overwrite a known platform with null, even if a
      // future change reintroduces a path where none is resolved.
      ...(platformId ? { platformId } : {}),
      lastForwardSyncAt: Date.now(),
    });

    return { added, skipped };
  } catch (err) {
    return { added: 0, skipped: 0, error: err.message };
  } finally {
    syncing = false;
  }
}
