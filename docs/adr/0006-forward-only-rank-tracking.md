# ADR-0006: Rank is tracked forward-only, from LCU snapshots

**Status:** Accepted (2026-07-18)

## Context

The History view wants a graph of LP and rank over time. The obvious sources were checked
and none carries historical LP:

- **LCU match details** (`/lol-match-history/v1/games/{id}`): no LP, no rank fields.
  Verified against captured payloads in `test/fixtures/`.
- **`match-v5`**: no LP, no per-game rank. Its participants carry performance stats only.
- **`league-v4`** (Web API): serves the *current* standing per queue — a snapshot, not a
  series. It also requires a key, which the running server deliberately does not have
  ([ADR-0003](0003-one-time-match-v5-import.md) keeps the key confined to the one-time
  Import script).
- **LCU `/lol-ranked/v1/current-ranked-stats`**: the current standing per queue — tier,
  division, LP, wins, losses. Keyless, local, live.

Every LP graph on the internet (op.gg, u.gg, …) is built the same way: poll the current
standing, remember it, plot the memories. Historical LP is not retrievable by anyone who
was not already recording it.

## Decision

Record **Rank Snapshots** forward-only, from the LCU, inside Forward Sync.

- `recordRankSnapshot()` (`src/history/rank.js`) reads `current-ranked-stats` on every
  Forward Sync trigger. `EndOfGame` is one of those triggers — which is exactly the moment
  LP moves — and the safety-net interval catches anything missed.
- A snapshot is appended **only when the standing changed** (tier, division, LP, wins or
  losses — wins/losses included so an LP-neutral game still marks time at the same rank).
  Sync ticks at an unchanged rank append nothing.
- Storage is `data/matches/rank-history.json`: one append-only array, atomic rewrite.
  Unlike the Archive this is *our own observation*, not Riot data that exists nowhere
  else — losing it loses a graph, not matches — so the write-once-per-file machinery of
  ADR-0002 would be overkill.
- Unranked and in-placement queues (tier `NONE`/empty) produce no snapshot. A fake
  "Iron IV 0 LP" point would be worse than a gap.
- Rank tracking can never break match capture: `recordRankSnapshot()` swallows every
  failure and Forward Sync proceeds regardless.

The chart maps the climb onto one continuous axis: `tier × 400 + division × 100 + LP`,
with the three apex tiers sharing a base of 2800 and ordered by LP alone — which is how
Riot orders them anyway.

## Consequences

- **The graph starts the day the app first sees the client.** There is no backfill and
  none is possible; the History UI says so rather than hiding it.
- A player who stops running the app gets gaps. Acceptable: the app is a companion, and
  the safety-net trigger records a catch-up point on next launch (one point per gap, at
  whatever the standing then is).
- Promos, dodges and decay are not modeled — the series just shows the standing whenever
  it was observed to change. Good enough for a trend line; not a per-game LP ledger.
- If Riot ever exposes historical LP, this becomes seedable — the store is a plain array
  and would take a backfilled prefix without a migration.
