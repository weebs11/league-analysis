# Historical ranked matches and LP before 2026-07-18

**Checked:** 2026-07-23

## Bottom line

- **Older ranked Matches are importable.** Riot's `match-v5` API can list a player's
  Match IDs with `startTime`, `endTime`, `queue`, `start`, and `count`, then return each
  Match. The repo already has a one-time, API-key-based Import that walks those endpoints
  in 30-day windows ([Riot API reference](https://developer.riotgames.com/apis#match-v5/GET_getMatchIdsByPUUID),
  [importer](../../scripts/import-history.mjs#L180-L251)).
- **Exact historical LP is not importable from Riot.** `match-v5`'s `MatchDto` contains
  match and participant performance fields but no tier, division, or LP. Riot's
  `league-v4` endpoint returns the player's standing in each queue (`tier`, `rank`,
  `leaguePoints`, wins, and losses), but its response has no timestamped history or
  per-Match values ([MatchDto](https://developer.riotgames.com/apis#match-v5/GET_getMatch),
  [LeagueEntryDTO](https://developer.riotgames.com/apis#league-v4/GET_getLeagueEntriesByPUUID)).
  Therefore 2026-07-18 is the earliest exact LP point available to this app unless some
  other service had already recorded older snapshots.

## What the local data currently contains

- 77 ranked Matches, from 2026-07-10 through 2026-07-23, all captured from the LCU.
- No `riot-api` Match sources and no completed Import (`lastImportAt: null`,
  `importComplete: false`; [sync state](../../data/matches/sync-state.json#L7-L11)).
- 30 Rank Snapshots. The first is 2026-07-18 18:43:27 UTC at Bronze I, 50 LP.

The dates differ because the client exposes a small recent Match window, while rank
tracking only observes the current standing after the app starts. The LCU match payload
has match time, queue, participants, and results but no LP
([captured fixture](../../test/fixtures/lcu-match-detail.json#L1-L12)); its separate
current-ranked-stats response contains the rank fields
([rank fixture](../../test/fixtures/lcu-ranked-stats.json#L1-L12)). The app turns those
live values into append-only Rank Snapshots whenever the standing changes
([rank recorder](../../src/history/rank.js#L30-L52),
[recording path](../../src/history/rank.js#L75-L92)).

## Practical implication

Running the existing Import can fill Matches before July 10 (subject to Riot's actual
Match availability), but it cannot extend the LP chart before July 18. Match outcomes
cannot reconstruct exact LP because LP gains/losses and non-Match changes such as dodges
or decay are not present in the Match records.

Riot documents that time-filtered match-list timestamps begin on June 16, 2021 and caps
each page at 100; it does not document a guaranteed retention period. A Riot
developer-relations issue also records an approximately 990-ID ceiling for one
unwindowed listing, which the repo avoids by querying fixed time windows
([Riot issue #517](https://github.com/RiotGames/developer-relations/issues/517)).
