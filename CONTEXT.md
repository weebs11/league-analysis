# Context: LoL Matchup Coach

A local companion app that detects your active League of Legends game, coaches you through
it, and keeps a permanent archive of your ranked match history.

Single context. Decisions live in [`docs/adr/`](docs/adr/).

## Glossary

Use these terms exactly. Where a term has a tempting synonym, the synonym is listed as
**avoid** — drift between "match" and "game" and "session" makes the codebase harder to read
than the concepts warrant.

### Game state (existing)

| Term | Meaning |
|---|---|
| **Phase** | What the player is doing right now: `waiting`, `champselect`, or `ingame`. Derived from the LCU gameflow and the Live Client API. Drives the Live view's auto-switching. Avoid: "screen", "state". |
| **Snapshot** | A normalized, UI-ready view of the current phase, emitted over SSE. Never persisted. Avoid: "payload". |
| **Game Plan** | The AI-generated coaching for one game: matchup analysis, phase-by-phase plan, threat cards, itemization with reasoning. Avoid: "advice" (that's the champ-select variant), "report". |
| **Basic Mode** | Coaching generated from Riot data alone, with no Anthropic API key present. |

### Match history (new)

| Term | Meaning |
|---|---|
| **Match** | One completed game of League, permanently recorded. A *Match* is history; a *game* is the thing currently being played. Never use them interchangeably. |
| **Match ID** | The canonical key for a Match: `{platformId}_{gameId}`, e.g. `EUW1_5603939853`. Derived — the LCU supplies `gameId` and `platformId` separately, `match-v5` supplies the joined form. Always store the joined form. Avoid: "gameId" as a bare identifier. |
| **Archive** | The permanent, write-once store of raw match payloads under `data/matches/raw/`. The system of record. Deleting it loses matches that exist nowhere else. Avoid: "cache" — the Archive is explicitly *not* a cache. |
| **Index** | The derived, queryable list of **Index Rows** at `data/matches/index.json`. Disposable by design: rebuildable in full from the Archive. Avoid: "database", "store". |
| **Index Row** | One Match, normalized to a single flat shape regardless of which Source produced it. What the list, summary, and aggregates read. |
| **Source** | Where a raw payload came from: `lcu` or `riot-api`. Stored on every raw file. Determines which normalizer applies, and whether richer fields are available. |
| **Forward Sync** | The ongoing, keyless capture of new Matches from the LCU while the app runs. Idempotent. Avoid: "polling" (that's the phase loop), "fetch". |
| **Import** | The one-time, key-requiring backfill of historical Matches via Riot's `match-v5`, run as a standalone script. Avoid: "backfill" as a verb for Forward Sync; Import is specifically the historical script. |
| **Upgrade** | Re-fetching an `lcu`-sourced Match via `match-v5` to obtain fields the LCU payload cannot supply. **Adds** a Source alongside the existing one — it never replaces or rewrites what was already captured. |
| **Diagnostic Stat** | A stat that points at something to fix — CS differential vs lane opponent, kill participation, damage share. Contrasted with a descriptive stat (raw KDA) that only reports. The app prefers Diagnostic Stats because it teaches. |
| **Benchmark** | A per-role absolute target from `benchmarks.json`, used to answer "is this good?". Hand-maintained, checked in. |
| **Personal Baseline** | The player's own rolling average over recent Matches, used to answer "am I improving?". Computed from the Index; needs no sourcing. |
| **Remake** | A Match that ended early enough not to count as real play (under 5 minutes, or flagged early-surrender). Flagged at write time, excluded from all aggregates and Benchmarks, still listed. |
| **Coaching Record** | The Game Plan that was generated for a Match, persisted alongside it and joined on Match ID. Lets the detail view show what you were told next to how it went. |
| **Rank Snapshot** | One observation of the player's standing in one ranked queue — tier, division, LP, wins, losses — recorded by Forward Sync whenever the standing changed. Forward-only: historical LP is not retrievable from any API ([ADR-0006](docs/adr/0006-forward-only-rank-tracking.md)). Avoid: "LP history" as if it were fetched — it is observed, never downloaded. |

## Scope

**Ranked only.** Match history covers `queueId` 420 (Solo/Duo) and 440 (Flex). ARAM, Arena,
bots, and normals are not stored — they have no lane opponent, no meaningful role, and no CS
target, so every Diagnostic Stat and Benchmark would be meaningless or misleading.

**One player per install.** No multi-user design. A `puuid` is recorded on every Match so a
second account on the same machine stays separable, but the UI shows one account.

## Boundaries that matter

- The **Archive is written once and never mutated.** A Source key is added to a Match's raw
  file exactly once; nothing ever overwrites one, Upgrade included. Every other durability
  property follows from that.
- The **Index is always derivable**. If it disagrees with the Archive, the Archive wins and the
  Index is rebuilt.
- **Forward Sync never requires an API key.** Only Import does. Keeping the ongoing path
  keyless is deliberate — see [ADR-0003](docs/adr/0003-one-time-match-v5-import.md).
- **Demo mode must never reach the Archive.** Demo produces game-shaped objects; the Archive
  only ever accepts data read from the LCU or `match-v5`.
