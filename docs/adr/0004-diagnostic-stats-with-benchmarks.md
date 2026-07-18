# ADR-0004: Diagnostic stats, compared against role Benchmarks and a Personal Baseline

**Status:** Accepted (2026-07-18)

## Context

The app's stated purpose is teaching — advice that explains *why*, for players still learning
the game. Match history could have mirrored op.gg: champion, KDA, CS, damage, vision.

That set is **descriptive** — it reports what happened. Appropriate for a site showing you
strangers' profiles, less so for a coach. "You averaged 4.2 CS/min" is a number. "You were 23
CS behind your lane opponent at 10 minutes in 7 of your last 10 games" is a lesson, and it is
something `src/coach.js` could actually talk about.

The **diagnostic** data costs nothing extra — but *where* it comes from was measured wrong
twice before landing here.

**`timeline.*Deltas` from the LCU are dead fields.** Verified against a live client across all
10 participants of a full match and all 20 matches in the list: `csDiffPerMinDeltas`,
`xpDiffPerMinDeltas`, `creepsPerMinDeltas`, and `goldPerMinDeltas` are **empty objects (`{}`)
in every case**. Riot still ships the keys and no longer populates them. Earlier drafts of this
ADR and the spec claimed these supplied lane differentials. They do not.

What *is* available:

- **Computed from the LCU**, because `/games/{gameId}` returns all ten players — kill
  participation, damage share, and an **end-of-game CS differential against the opposing
  laner** (found by matching lane across teams). Not a 10-minute snapshot, but a real lane
  differential, available from live capture with no key.
- **From `match-v5` only** — `challenges.*`: true lane deltas at 10/15 minutes
  (`laneMinionsFirst10Minutes`, `maxCsAdvantageOnLaneOpponent`), damage per minute, and
  reliable `teamPosition`.

The real cost is that diagnostic stats are **role-relative and meaningless without context**.
6 CS/min is fine for a support and poor for a mid laner. Showing a beginner an uninterpretable
number is the exact failure the app exists to avoid.

## Decision

Store and display **core + diagnostic** stats, each with two comparisons:

- a **Benchmark** — a per-role absolute target from a checked-in `benchmarks.json`, answering
  *"is this good?"*
- a **Personal Baseline** — a rolling average over the player's own recent Matches, answering
  *"am I improving?"*

Both, because they fail in opposite directions. An absolute target alone renders a real month
of improvement (4.9 → 5.8 CS/min) as a persistent "below target", which reads as failure. A
personal baseline alone never surfaces a weakness you have always had.

**Ranked only** (`queueId` 420, 440). ARAM and Arena have no lane opponent, no role, and no CS
target; every diagnostic would be meaningless. They are not stored at all.

Rejected: scraping live per-rank averages from an unofficial stats source. More accurate, but
an unstable dependency with ToS friction and a network requirement in a feature that otherwise
works fully offline.

## Consequences

- `benchmarks.json` is hand-maintained and will drift. Acceptable: CS/min and vision targets
  move slowly, and it is one small file to bump.
- **CS is not one stat, and the split applies to the rate, not the count.** Junglers accumulate
  `neutralMinionsKilled` (camps), laners accumulate `totalMinionsKilled`, and both sources
  report them separately. `csFormula` in `benchmarks.json` scopes `csPerMin` per role — `lane`,
  `camps+lane`, or `none` — while `cs` stays total farm, because "how much did you farm" is
  meaningful for everyone and is what the match list shows. Without this, a top laner's stray
  camps are scored against a lane-only target, and Support gets a concrete `csPerMin` that the
  summary strip then averages into its CS baseline.
- **Remakes must be excluded from aggregates.** Observed in real data: a 1-minute ranked game
  reporting `endOfGameResult: "GameComplete"` with a `win` value and nothing marking it as
  special. Flag at write time (`gameDuration < 300` or `gameEndedInEarlySurrender`) so every
  consumer agrees; still list them, never count them.
- Fields only `match-v5` can supply are `null` on `lcu`-sourced Index Rows. Display hides
  them; it must never render `null` as `0`. Concretely: `csDiffAt10` is `null` until the Import
  script has run, while `csDiffVsLaneOpponent` is present from live capture.
- **Role is not directly readable from the LCU, and `timeline.lane` is not merely incomplete —
  it is wrong.** A real payload reported `JUNGLE` for two players on the same team and only one
  `BOTTOM`, and `timeline.role` returns `DUO` for both bottom players. Roles are therefore
  resolved by **assignment**, strongest signal first: Smite (summoner spell `11`) is definitive
  for Jungle, fewest lane minions identifies Support, and only then does the lane hint fill
  Top/Mid/ADC. This guarantees each role is assigned exactly once per team — which matters
  because lane-opponent pairing matches on role across teams, and a duplicate would pair the
  wrong players. `match-v5`'s `teamPosition` is reliable and takes precedence when present.
- The Personal Baseline needs ~10 Matches before it means anything. Suppress the trend arrow
  below that threshold rather than showing a noisy one.
