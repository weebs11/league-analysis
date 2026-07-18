# ADR-0003: Historical depth comes from a one-time `match-v5` Import script

**Status:** Accepted (2026-07-18)

## Context

[ADR-0001](0001-lcu-match-history-as-forward-source.md) chose the LCU partly on the belief
that it was retroactive — that shipping would backfill recent history for free.

**That belief was wrong, and it was measured.** Probing a live client on an account at
**summoner level 274** (hundreds of games played):

```
[begIndex=0,   endIndex=19]   count=20  oldest=2026-07-10  newest=2026-07-18
[begIndex=0,   endIndex=199]  count=20  oldest=2026-07-10  newest=2026-07-18
[begIndex=100, endIndex=119]  count=20  oldest=2026-07-10  newest=2026-07-18
[begIndex=200, endIndex=219]  count=20  oldest=2026-07-10  newest=2026-07-18
```

The endpoint serves a **fixed window of the 20 most recent matches** — here about 8 days —
and **pagination parameters are ignored entirely**: every index range returns the same 20.

(An earlier probe in the same session returned only 3 games. That was a cold cache mid-populate,
not the steady state. The steady state is 20. Either way the conclusion holds: there is no
depth here.)

So the LCU can capture matches going forward, but cannot supply any historical depth at all.

The only source with real depth is Riot's `match-v5`, which retains ~2 years. Its
`by-puuid/{puuid}/ids` endpoint [caps at ~990 IDs](https://github.com/RiotGames/developer-relations/issues/517)
(`start=1000` returns empty) regardless of games played; slicing by `startTime`/`endTime`
windows works around this, as each window paginates independently.

`match-v5` was initially rejected because personal dev keys expire every 24 hours. **That
objection only applies to ongoing use.** For a script run once, a 24-hour key is entirely
sufficient.

## Decision

Split the two jobs.

- **Forward Sync** — in-app, keyless, LCU, runs forever. Ships with the feature.
- **Import** — a standalone `scripts/import-history.mjs`, run once by hand with a personal dev
  key, walking `match-v5` in month-sized `startTime`/`endTime` windows.

Both write into the same Archive, in the same format, tagged with their Source. The Import
script never runs inside the server, never touches Settings, and never handles rate limits at
request time.

Rejected: extracting the client's RSO token to query Riot's SGP backend. It needs no dev key
and may reach deeper than 2 years, but it is undocumented, breaks on client patches, and
requires lifting an auth credential out of a running process. Revisit only if `match-v5`
proves measurably short.

## Consequences

- **The two Sources emit different payload shapes.** `match-v5` is flatter
  (`info.participants[].win`) and carries a `challenges` block the LCU lacks. One normalizer
  each; a `source` field on every raw file selects which.
- **Match ID must be derived, not taken.** The LCU gives `gameId` + `platformId`; `match-v5`
  gives `EUW1_5603939853`. These are the same Match. Keying raw files by whatever each source
  hands over would store duplicates under different names and double-count every aggregate.
  Canonical form is `{platformId}_{gameId}` for both.
- **Forward Sync is time-critical in a way it would not otherwise be.** Because the LCU window
  is small and volatile, a Match missed while the app is closed is only recoverable via a
  later Import run — and only within `match-v5`'s 2-year retention.
- **Upgrade accumulates a Source rather than replacing one** — see the spec §2.1. `match-v5` is
  in fact the richer payload for every field the app reads today, so "replace on upgrade" would
  work *right now*. It is still the wrong rule, for two reasons that outlive the current field
  list: a raw payload is the only record of what the client actually reported at capture time,
  and the Archive is permanent, so discarding captured bytes is irreversible in a way that
  keeping them is not. A future normalizer may want something out of the LCU payload that
  nothing reads today; it can only do that if the payload is still there.

  (Two earlier drafts of this bullet were wrong in opposite directions. The first called
  `match-v5` "strictly richer". The correction then justified accumulation by claiming the LCU
  supplies per-window lane deltas that `match-v5`'s match endpoint lacks — but those fields
  ship empty and always have; see [ADR-0004](0004-diagnostic-stats-with-benchmarks.md). The
  decision was right both times; the reasoning was not.)
- Kill participation and damage share are **not** `match-v5`-exclusive: the LCU's
  `/games/{gameId}` returns all ten players, so both are computable from either Source.
- Import takes ~10–20 minutes for 500–1000 Matches at the personal-key limit of 100
  requests/2min.
