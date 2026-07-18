# Spec: Ranked Match History

Implementation spec for the match history feature. Decisions and their rationale live in
[`docs/adr/0001`–`0005`](../adr/); vocabulary in [`CONTEXT.md`](../../CONTEXT.md). This
document is the *how*.

---

## 1. Scope

**In:** Ranked Solo/Duo (`queueId` 420) and Ranked Flex (`queueId` 440) only. Permanent
archive, forward sync from the LCU, one-time historical import via `match-v5`, a History UI
with list / detail / summary, and persistence of the Game Plan generated for each Match.

**Out:** ARAM, Arena, normals, bots, custom games — not stored at all. Multi-account UI. A
dedicated analytics page. Any change to Live view behaviour.

---

## 2. On-disk layout

```
data/matches/
  raw/EUW1_5603939853.json         Archive — the system of record
  coaching/EUW1_5603939853.json    Coaching Record
  index.json                       derived; rebuildable from raw/
  sync-state.json                  bookkeeping
src/history/benchmarks.json        checked in, hand-maintained
```

Root is `process.env.LOL_COACH_DATA_DIR || path.join(projectRoot, 'data')`. **This override
must exist before any write path does** — see §9.

### 2.1 Raw files — one file per Source

**One file per Source, not one per Match.** `raw/{matchId}.{source}.json`:

```
data/matches/raw/
  NA1_5603939853.lcu.json
  NA1_5603939853.riot-api.json     ← only after an Import/Upgrade
```

```jsonc
{
  "matchId": "NA1_5603939853",
  "source": "lcu",
  "fetchedAt": 1752800000000,
  "owner": { "puuid": "…", "gameName": "…", "tagLine": "…" },
  "payload": { /* verbatim, exactly as received */ }
}
```

`store.readRaw()` assembles the `{ matchId, owner, sources }` container callers work with by
reading whichever Source files exist. Nothing stores that shape; it is derived.

**Why one file per Source.** This is what makes "written once, never mutated" *structural*
rather than merely intended. A Source is created with the `wx` flag — an atomic
create-if-not-exists at the OS level — so "already present" and "another writer won the race"
are the same outcome, and neither can destroy stored data.

A single container file would need a read-modify-write across an `await`, and **the import
script runs in its own process**, so no in-process lock could have covered it. Two writers
touching one Match would each read the pre-existing container, each add their key, and the
second `rename()` would silently discard the first Source. For an `lcu` payload that is
unrecoverable: the client's 20-match window has already moved on.

**Rules.** Payloads are stored verbatim — never trimmed, never reshaped. `owner` is recorded on
first touch and identifies which account the Match belongs to. Upgrade adds a Source file
beside the existing one; it never rewrites one.

### 2.2 Index Row

```jsonc
{
  "matchId": "EUW1_5603939853",
  "puuid": "…", "gameName": "…", "tagLine": "…",
  "playedAt": 1752800000000,
  "durationSec": 2164,
  "queueId": 420,
  "patch": "16.14",
  "isRemake": false,
  "sources": ["lcu"],

  "championId": "Ashe", "championName": "Ashe",
  "role": "ADC",
  "win": true,

  "kills": 7, "deaths": 2, "assists": 11,
  "cs": 241, "csPerMin": 6.68,
  "goldEarned": 14203,
  "damageToChampions": 28410,
  "visionScore": 24,
  "items": [3006, 6672, 3031, 3036, 3072, 0, 3363],
  "runes": { "primaryStyle": 8000, "subStyle": 8200, "perks": [8005, 9111, 9104, 8014, 8226, 8210] },

  "killParticipation": 0.68,
  "damageShare": 0.31,
  "csDiffVsLaneOpponent": 23,
  "csDiffAt10": null,
  "damagePerMinute": null,

  "teamKills": 26,
  "teamDamageToChampions": 91600,
  "hasCoachingRecord": true
}
```

`null` means **not available from any stored Source** — never `0`. The UI hides null fields;
it must never render them as zero (ADR-0004).

### 2.3 `sync-state.json`

```jsonc
{
  "schemaVersion": 1,
  "puuid": "…",
  "platformId": "EUW1",
  "lastForwardSyncAt": 1752900000000,
  "lastImportAt": null,
  "importComplete": false,
  // Import resume state, both null when no import is in flight. The anchor is
  // captured once and reused across resumes — recomputing it from "now" would
  // shift every window, re-scanning some spans and skipping others (§5).
  "importAnchor": null,
  "importCursorWindow": null
}
```

`platformId` is load-bearing beyond the Import script: the gameflow session carries no
platform, so it is the only place the app can learn one, and without it a Coaching Record has
no canonical Match ID to join on (§6). Forward Sync therefore reads it off **any** match in the
list, before the ranked filter, and never writes it back as `null`.

### 2.4 Coaching Record

```jsonc
{
  "matchId": "EUW1_5603939853",
  "generatedAt": 1752799000000,
  "model": "claude-opus-4-8",
  "patch": "16.14.1",
  "basicMode": false,
  "plan": { /* exactly the object /api/coach/gameplan returns */ }
}
```

### 2.5 `benchmarks.json`

Per role. `csPerMin` is `null` for Support — the stat is not meaningful there and must be
hidden, not compared.

Note the `roles` nesting — `benchmarks.js` reads `TABLE.roles[role]`.

```jsonc
{
  "_comment": "…",
  "roles": {
    "Top":    { "csPerMin": 7.0, "visionScore": 20, "killParticipation": 0.50, "csFormula": "lane" },
    "Jungle": { "csPerMin": 5.5, "visionScore": 28, "killParticipation": 0.70, "csFormula": "camps+lane" },
    "Mid":    { "csPerMin": 7.5, "visionScore": 22, "killParticipation": 0.60, "csFormula": "lane" },
    "ADC":    { "csPerMin": 7.5, "visionScore": 18, "killParticipation": 0.55, "csFormula": "lane" },
    "Support":{ "csPerMin": null, "visionScore": 45, "killParticipation": 0.65, "csFormula": "none" }
  }
}
```

**`csFormula` drives the computation, not just the threshold** (ADR-0004). It scopes the CS
*rate*; the CS *count* is always total farm, because "how much did you farm" is meaningful for
every role and is what the match list shows.

| `csFormula` | `csPerMin` measured on | Roles |
|---|---|---|
| `lane` | `totalMinionsKilled` | Top, Mid, ADC |
| `camps+lane` | `totalMinionsKilled + neutralMinionsKilled` | Jungle |
| `none` | `null` | Support |

Both halves matter. Scoring a top laner's stray camps against a lane-only target of 7.0
overstates their farm; and giving Support a concrete `csPerMin` means `aggregate.summarize()`
averages a meaningless number into the summary strip's CS baseline.

---

## 3. Modules — `src/history/`

| Module | Responsibility |
|---|---|
| `paths.js` | Every filesystem path, plus Match ID derivation/validation and the Source allowlist. The data root itself is resolved in `src/config.js` (`dataRoot`), which `ddragon.js` also uses for its cache. |
| `store.js` | Archive + Index + sync-state + coaching I/O. The only module that touches disk. |
| `normalize-shared.js` | Index Row assembly and the field converters both Sources share, so a field added for one cannot go quietly missing on the other. |
| `normalize-lcu.js` | LCU payload → partial Index Row. |
| `normalize-riot.js` | `match-v5` payload → partial Index Row. |
| `normalize.js` | Merges per-Source partials into one Index Row; owns null/precedence rules. |
| `benchmarks.js` | Loads `benchmarks.json`; compares an Index Row to role targets; supplies `csFormulaFor`. |
| `aggregate.js` | Summary strip + Personal Baseline over Index Rows. |
| `sync.js` | Forward Sync: triggers, dedup, write. |
| `routes.js` | `express.Router()` mounted at `/api/history`. |

The LCU match-history endpoints live in **`src/lcu.js`**, not a separate `lcu-history.js` — it
already owned credential discovery and the authenticated `request()` helper, so a second client
would have duplicated both.

### 3.1 `store.js` contract

```js
export async function hasSource(matchId, source)        // → boolean; a stat(), no parse
export async function readRaw(matchId)                  // → assembled container | null
export async function writeSource(matchId, source, payload, owner = null)
                                                        // → true if created, false if already present
export async function listMatchIds()                    // → string[], deduped across Source files

export function loadIndex()                             // → Promise<IndexRow[]> (rebuilds if missing/stale)
export function rebuildIndex()                          // → Promise<IndexRow[]> full rescan of raw/
export async function upsertIndexRows(rows)             // merge by matchId, sort by playedAt desc
export async function refreshRow(matchId)               // re-derive one row and merge it in

export async function readSyncState() / writeSyncState(patch)
export async function writeCoaching(matchId, record) / readCoaching(matchId)
```

Path helpers (`sourcePath`, `coachingPath`, `makeMatchId`, `isValidMatchId`, `parseSourceFile`,
`SOURCES`) live in `paths.js`, not here.

`owner` on `writeSource` is not optional in practice: it is how `normalize` picks the archive
owner out of the ten players, so a Match written without one cannot produce an Index Row.

**Concurrency.** The Archive needs no lock — `writeSource` is an atomic create (§2.1). The
Index does: it is one file that several callers rewrite wholesale, so `loadIndex`,
`rebuildIndex` and `upsertIndexRows` are serialized through a promise queue, and `loadIndex`
re-checks the cache *inside* the queue so parallel first-requests trigger one rebuild rather
than several. Temp files are uniquely named per call; a fixed `.tmp` path made concurrent
writers collide with `ENOENT` on rename.

`loadIndex()` rebuilds automatically when `index.json` is missing, unparseable, or its
`schemaVersion` is behind. The Index is never authoritative (ADR-0002).

---

## 4. Forward Sync

### 4.1 LCU endpoints

Add to `src/lcu.js` (it already has auth discovery and a generic `request()`):

```js
export async function matchList(begIndex = 0, endIndex = 19)  // /lol-match-history/v1/products/lol/current-summoner/matches
export async function matchDetail(gameId)                     // /lol-match-history/v1/games/{gameId}   → all 10 players
export async function currentSummoner()                       // /lol-summoner/v1/current-summoner      → puuid, gameName, tagLine
export async function gameflowSession()                       // /lol-gameflow/v1/session               → gameData.gameId while in game
```

Also add an `LCU_INSECURE_HTTP=1` hook mirroring `LIVE_CLIENT_INSECURE_HTTP` in
`src/livegame.js:13`, so the LCU can be mocked over plain HTTP without cert work (§9).

### 4.2 Algorithm

```
syncForward():
  if not lcu.isConnected(): return
  me ← lcu.currentSummoner();  if !me?.puuid: return
  persist puuid/gameName/tagLine into sync-state

  list ← lcu.matchList(0, 19)
  for each game in list.games.games:
    if game.queueId ∉ {420, 440}: skip            # Ranked only
    matchId ← `${game.platformId}_${game.gameId}` # canonical, derived
    if await store.hasSource(matchId, 'lcu'): continue

    detail ← lcu.matchDetail(game.gameId)         # all 10 players
    if !detail: continue                          # transient; retried next trigger
    await store.writeSource(matchId, 'lcu', detail)
    rows.push(normalize(matchId))

  if rows.length: await store.upsertIndexRows(rows)
  write sync-state.lastForwardSyncAt
```

Idempotent by construction: `hasSource` is the only dedup needed. There is **no early-exit on
first-known** — the list is always exactly 20 entries, so scanning all of them is free and
immune to the gap failure mode. Never assume contiguity.

**Paging is pointless here.** Measured against a live client, the endpoint returns the 20 most
recent matches for *every* index range (`begIndex=200` included) — see
[ADR-0003](../adr/0003-one-time-match-v5-import.md). Call `matchList(0, 19)` and nothing else.

**Consequence for trigger cadence:** 20 matches covered ~8 days for this account. A heavy
player can push a match out of the window in far less. If the app is closed across a long
session, those matches are recoverable only via Import, and only within `match-v5`'s 2-year
retention. This is why the connect trigger and the 5-minute safety net both exist.

### 4.3 Triggers

Wire in `src/gamestate.js`, which already polls every 2s and calls `lcu.gameflowPhase()`:

| Trigger | Condition |
|---|---|
| Client connect | `state.clientDetected` transitions `false → true` |
| Game end | `gameflowPhase()` transitions into `EndOfGame` |
| Safety net | every 5 minutes while `lcu.isConnected()` |

Guard all three with `state.mode === 'live'`. **Demo mode must never reach the Archive**
(`CONTEXT.md` boundaries). Sync reads the LCU directly rather than gamestate snapshots, so
demo data cannot leak through the data path — but the coaching capture path (§6) *does* run
through gamestate and needs the guard explicitly.

Sync runs must not overlap: hold a module-level `syncing` boolean and return early.

### 4.4 Source precedence in `normalize.js`

The two Sources are **complementary**, which is why the raw container accumulates them:

| Field group | Preferred Source | Why |
|---|---|---|
| Core (K/D/A, CS, gold, damage, vision, items, runes, win) | either | Both carry it. Prefer `riot-api` when present. |
| `killParticipation`, `damageShare` | computed | Derived from all 10 participants — **available from both**, since `/games/{gameId}` returns the full team. Compute, don't read. |
| `csDiffVsLaneOpponent` | computed | Match the opposing player in the same lane and subtract creep scores. Available from **both** Sources. End-of-game, not a 10-minute snapshot. |
| `csDiffAt10`, `csDiffAt15`, `damagePerMinute` | `riot-api` | `info.participants[].challenges.*`. **`null` on LCU-only Matches.** |
| `role` | `riot-api` if present, else computed | See below. |

**Do not read `timeline.*Deltas` from the LCU.** Measured against a live client, across all 10
participants of a full match and all 20 matches in the list, `csDiffPerMinDeltas`,
`xpDiffPerMinDeltas`, `creepsPerMinDeltas`, and `goldPerMinDeltas` are **empty objects in every
case**. Riot ships the keys and no longer fills them. An earlier draft of this spec built the
headline diagnostic on these fields; that was wrong.

Kill participation and damage share are **not** `match-v5`-only — the LCU detail endpoint
returns all ten players. Compute both as `(kills + assists) / teamKills` and
`damageToChampions / teamDamageToChampions`, guarding `teamKills === 0`.

**Role derivation.** `match-v5`'s `teamPosition` is authoritative when present. The LCU has no
equivalent, and `timeline.lane` is actively unreliable — a real payload reported `JUNGLE` for
two players on one team and only one `BOTTOM`, while `timeline.role` says `DUO` for both bottom
players. Resolve by **assignment per team**, strongest signal first:

1. **Jungle** — carries Smite (`spell1Id`/`spell2Id` === `11`); ties and no-Smite cases fall back
   to highest `neutralMinionsKilled`.
2. **Support** — fewest `totalMinionsKilled` among those left.
3. **Top / Mid / ADC** — by `timeline.lane` hint, then fill any leftovers.

Each role is assigned exactly once per team. That invariant is load-bearing: lane-opponent
pairing matches on role across teams, so a duplicated role would silently pair the wrong two
players and produce a nonsense differential.

**Type traps.** `stats.win` is a **boolean**; `teams[].win` is the **string** `"Win"`/`"Fail"`.
`summonerName` is empty in modern payloads — use `gameName` + `tagLine`.

### 4.5 Derived flags

- `isRemake` — `durationSec < 300 || stats.gameEndedInEarlySurrender === true`. Computed at
  write time and stored. Excluded from every aggregate and Benchmark; still listed, visually
  de-emphasised.
- `patch` — first two segments of `gameVersion` (`"16.14.523.9744"` → `"16.14"`).
- `role` — see the role derivation rules in §4.4. Do **not** read `timeline.role`; it is never
  used. The canonical vocabulary is `Top | Jungle | Mid | ADC | Support`, which is **not** the
  same set as `ROLE_LABELS` in `src/gamestate.js` (that one uses `'ADC (Bot)'` for the live
  views). The two vocabularies are deliberately separate: `benchmarks.json` is keyed on the
  history set, so substituting the live labels silently breaks every bot-lane benchmark lookup.
- `durationSec` — `match-v5` reports `gameDuration` in **seconds** when `gameEndTimestamp` is
  present and **milliseconds** when it is not. Normalize explicitly; do not assume.

---

## 5. Import script — `scripts/import-history.mjs`

Standalone. Never imported by the server.

```bash
node scripts/import-history.mjs --key=RGAPI-xxxx [--months=24] [--upgrade] [--dry-run]
```

- **puuid/platform**: from `sync-state.json` if present; otherwise from a running client via
  `/lol-summoner/v1/current-summoner`; otherwise `--riot-id="Name#TAG"` resolved via
  `account-v1`. Fail loudly if none resolve.
- **Regional routing**: `match-v5` uses regional hosts, not platform hosts. Map
  `EUW1|EUN1|TR1|RU → europe`, `NA1|BR1|LA1|LA2 → americas`, `KR|JP1 → asia`,
  `OC1|PH2|SG2|TH2|TW2|VN2 → sea`.
- **Windowing**: walk **fixed 30-day** `startTime`/`endTime` windows backwards from a stable
  anchor, `count=100` per page, paginating within each window. Sidesteps the ~990-ID cap
  (ADR-0003).

  **Not calendar months.** `setUTCMonth` clamps when the target month is shorter, so a run
  started on the 31st produces windows that skip whole days — days the run then marks complete
  and never revisits. The same clamping makes `YYYY-MM` labels collide, so a resume cursor can
  map to the wrong window. Uniform spans tile exactly, by construction. The anchor is persisted
  (`importAnchor`) and reused on resume; recomputing it from "now" would shift every window.
- **Filter**: `queue=420` and `queue=440` passed as query params — do not fetch and discard.
- **Rate limit**: personal keys allow 100 requests/2min. Use a token bucket; on `429`, honour
  `Retry-After`. Expect ~10–20 min for 500–1000 Matches.
- **Resume**: persist `importCursorWindow` (an integer index) after each completed window.
  Re-running continues from there.
- **Reject a bad `--months` loudly.** `Number('abc')` is `NaN`, the walk loop then runs zero
  times, and the run reports success having imported nothing — while marking the import
  complete, so nothing revisits it.
- **`--riot-id` requires `--platform`**, and `account-v1` is served only on
  `americas`/`europe`/`asia` — never `sea`, so SEA platforms must route their account lookup
  to `asia` even though their match lookups go to `sea`.
- **`--upgrade`**: also fetch Matches that already have an `lcu` Source, adding `riot-api`
  alongside it. Without the flag, skip any Match that already has a `riot-api` Source.
- Writes via the same `store.writeSource(matchId, 'riot-api', payload)`, then
  `store.rebuildIndex()` at the end.

---

## 6. Coaching capture

In `server.js`, `/api/coach/gameplan` currently caches by champion composition
(`planKey`, `server.js:75`) into an in-memory `Map`.

1. When generating a plan, read `gameData.gameId` from `lcu.gameflowSession()` and combine it
   with `platformId` from `sync-state.json` to form the canonical `matchId`.

   **The gameflow session carries no `platformId`**, so the Coaching Record depends on a
   Forward Sync having recorded one. On a completely fresh install — app opened for the first
   time, plan generated before any sync has completed — there is no platform yet and the plan
   is silently not persisted. Self-correcting after the first sync, and the reason Forward Sync
   reads the platform off *any* match rather than only ranked ones (§2.3).
2. On success, `store.writeCoaching(matchId, { plan, model, generatedAt, patch, basicMode })`.
3. Keep `planCache` as-is for in-session reuse — this adds durability, it does not replace it.
4. **Skip entirely when `gamestate` is in demo mode**, or when no `gameId` is available.

The Match itself arrives later via Forward Sync; the join is on `matchId` and needs no
coordination. `hasCoachingRecord` on the Index Row is set during normalize by checking for the
coaching file.

---

## 7. API — `/api/history`

| Route | Returns |
|---|---|
| `GET /api/history/matches?page=0&size=20&champion=&role=&queue=` | `{ rows, total, page, size }` — Index Rows, newest first |
| `GET /api/history/matches/:matchId` | Full detail: all 10 players, teams block, benchmark comparisons, coaching record if present |
| `GET /api/history/summary?window=20` | Record, winrate, top champions, Personal Baseline + deltas for headline stats |
| `GET /api/history/rank` | `{ queues: [{ queueId, queueLabel, points }] }` — Rank Snapshots per queue, oldest first (ADR-0006) |
| `POST /api/history/sync` | Manual Forward Sync trigger; returns `{ added, skipped }` |
| `POST /api/history/rebuild-index` | Rebuild Index from Archive; returns `{ rows }` |

Rank Snapshot point shape: `{ at, queueId, tier, division, lp, wins, losses, value }`,
where `value` is the continuous ladder position (`tier×400 + division×100 + LP`; apex
tiers share base 2800). Recorded by Forward Sync only when the standing changed; queues
never ranked this season produce no series. See `src/history/rank.js` and ADR-0006.

All read paths serve from the in-memory Index. Detail lazily reads the raw container.

Summary shape:

```jsonc
{
  "window": 20,
  "record": { "wins": 12, "losses": 8, "winrate": 0.60 },
  "topChampions": [ { "championId": "Ashe", "games": 8, "wins": 5, "winrate": 0.63 } ],
  "baseline": {
    "csPerMin":          { "current": 6.7, "previous": 5.9, "delta": 0.8, "benchmark": 7.5 },
    "killParticipation": { "current": 0.62, "previous": 0.60, "delta": 0.02, "benchmark": 0.55 },
    "visionScore":       { "current": 24, "previous": 21, "delta": 3, "benchmark": 18 }
  },
  "insufficientData": false   // true when < 10 non-remake Matches; UI suppresses trend arrows
}
```

`current` = mean over the last `window` non-remake Matches; `previous` = the `window` before
that. Aggregates are always scoped to one `puuid` and exclude remakes.

---

## 8. UI

### 8.1 Navigation (ADR-0005)

`public/index.html` gains a top-level nav and a `#view-history` section. `showView()`
(`public/app.js:133`) becomes two-level:

```js
let activeSection = 'live';          // 'live' | 'history'
function showSection(name) { … }     // user-driven only
function showView(name) {            // phase-driven
  if (activeSection !== 'live') { showPhaseNotice(name); return; }  // ← the guard
  …existing behaviour, unchanged…
}
```

The guard in `showView` is the whole of ADR-0005. When suppressed, render a dismissible
banner: *"Champ select started → Go to live"*.

### 8.2 Screens

**Summary strip** — record + winrate over the window, top 3 champions with per-champion
winrate, and up to three baseline stats with trend arrows. Arrows suppressed when
`insufficientData`.

**Match list** — 20 per page. Row: result stripe (W/L), champion portrait via the existing
`/img/champion/square/:id` route, role, K/D/A + ratio, CS + CS/min, duration, patch, relative
time. Remakes rendered muted and labelled. Row click → detail.

**Detail** — header (champion, role, queue, result, duration, date); your stat block with
Benchmark and Baseline comparisons per ADR-0004 (hide null fields, never render null as 0);
all 10 players in two team columns with champion, summoner name, K/D/A, CS, damage; team
objectives from the `teams` block; runes and final items; and a collapsible **"What you were
told before this game"** section rendering the Coaching Record via the existing
`renderPlanTab` / `renderMatchupTab` / `renderItemsTab`.

Styling reuses `public/styles.css` tokens. No build step, no framework — consistent with the
rest of `public/`.

---

## 9. Testing

**Prerequisite, before any Archive write path exists.** `data/matches/` holds Matches that
exist nowhere else (ADR-0002); a fixture teardown pointed at the real directory is
unrecoverable data loss.

1. `LOL_COACH_DATA_DIR` resolved exclusively through `src/history/paths.js`. No module
   composes a data path itself. Consider retrofitting `src/ddragon.js:8` (`CACHE_DIR`) onto the
   same override — `test/unit.test.js:19` documents that tests currently read and write the
   *real* `data/cache`.
2. `LCU_INSECURE_HTTP=1` in `src/lcu.js`, mirroring `src/livegame.js:13`.
3. Extend `test/mock-league-server.js` with `/lol-match-history/v1/…`, `/lol-summoner/v1/…`,
   and `/lol-gameflow/v1/session`. `src/lcu.js:37` already honours `LEAGUE_LOCKFILE`, so tests
   write a temp lockfile pointing at the mock's port.

**Fixtures** — capture from a live client rather than hand-writing (they drift):
`lcu-matchlist.json`, `lcu-match-detail.json` (all 10 players), `lcu-gameflow-session.json`,
`riot-match-v5.json`.

**Unit:** both normalizers against fixtures; merge precedence in `normalize.js`; remake
detection incl. the observed 1-minute `GameComplete` case; per-role CS formulas (jungle camps
vs lane minions); benchmark comparison with `null` handling; aggregate math incl.
`insufficientData`; `killParticipation` with `teamKills === 0`.

**Integration:** boot the server against the mock; assert Forward Sync writes only Ranked
queues, is idempotent across repeated runs, skips already-present Sources, and that
`/api/history/*` returns expected shapes. Assert an Index rebuild from `raw/` reproduces the
Index exactly.

---

## 10. Build order

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | `paths.js`, `LOL_COACH_DATA_DIR`, test isolation | Tests provably cannot write to real `data/` |
| 2 | `store.js` + raw container + Index rebuild | Round-trips a fixture; rebuild is deterministic |
| 3 | `normalize-lcu.js` + `normalize.js` + benchmarks | Fixture → Index Row, unit tested |
| 4 | `lcu-history.js` + `sync.js` + triggers | Real games appear in `index.json` while playing |
| 5 | `routes.js` + list + summary strip UI | History tab shows real Matches |
| 6 | Detail view + benchmark rendering | Diagnostic stats visible with comparisons |
| 7 | Coaching capture + detail section | Plan shown against outcome |
| 8 | `normalize-riot.js` + `scripts/import-history.mjs` | Historical Matches imported |

Phases 1–4 deliver a working archive; 5–7 make it visible; 8 adds depth. **Phase 1 is not
optional and must not be reordered** — every later phase writes to disk.

---

## 11. Decisions made while writing this spec

These were open at the end of the grilling session and resolved here. Flagged so they can be
overridden cheaply.

1. **Remake rule** — `durationSec < 300 || gameEndedInEarlySurrender`. Stored, not
   display-time. Listed but excluded from aggregates.
2. **Demo isolation** — sync reads the LCU directly so demo cannot leak via the data path; the
   coaching path gets an explicit `state.mode === 'live'` guard.
3. **Import identity** — `sync-state.json` → running client → `--riot-id`, in that order.
4. **Upgrade trigger** — manual only, via `--upgrade`. Nothing upgrades automatically.
5. **Raw container accumulates Sources** (§2.1) rather than one payload per file. Not because
   the LCU carries fields `match-v5` lacks — an earlier draft claimed that, citing the
   timeline deltas, which ship empty (§4.4). The reason is that the Archive is permanent:
   a raw payload records what the client actually reported at capture time, and discarding
   captured bytes is irreversible while keeping them is not. See
   [ADR-0003](../adr/0003-one-time-match-v5-import.md) consequences.
