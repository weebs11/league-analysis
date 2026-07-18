# ADR-0002: Write-once raw Archive with a derived Index

**Status:** Accepted (2026-07-18)

## Context

Before this feature the app persisted almost nothing: `config.json` for settings and
patch-versioned Data Dragon files in `data/cache/`. The plan cache in `server.js` is an
in-memory `Map` keyed by champion composition, lost on every restart.

Match history had to decide what its store *is*. A **cache** can be deleted and rebuilt, so
schema changes are free — but it can never be deeper than what the upstream still serves. An
**archive** outlives upstream retention, which is the only way "full history" is true, but it
becomes a system of record and needs durability and migration discipline.

Storage options considered: `node:sqlite` (built in, but `engines` bump to >=22.5 and an
`ExperimentalWarning`), `better-sqlite3` (verified working on Node 25.6.0 via prebuilt binary
in 2s — but 38 transitive packages into a 2-dependency project, and its installer
`prebuild-install` is flagged unmaintained), and plain JSON.

## Decision

An **Archive**, stored as **write-once JSON files**, with a **derived Index**.

```
data/matches/
  raw/NA1_5603939853.lcu.json       ← written once, never mutated
  raw/NA1_5603939853.riot-api.json  ← added by Import; never replaces the above
  index.json                        ← derived, disposable, rebuildable
  sync-state.json                   ← sync bookkeeping
  coaching/NA1_5603939853.json
```

Raw payloads are stored **in full**, exactly as received. Adding a stat later is a rebuild of
the Index from the Archive, not a data migration.

**One file per Source, created with the `wx` flag** — atomic create-if-not-exists at the OS
level. That single flag is the whole write-once guarantee, and it is what makes the property
structural rather than merely intended. A single container file per Match would need a
read-modify-write across an `await`; two writers would each read the pre-existing container,
each add their key, and the second write would silently discard the first Source. That is not
hypothetical — the Import script runs in **its own process**, so no in-process lock could cover
it, and the documented workflow has it running while the app is open.

No new dependencies. No `engines` change.

## Consequences

- **Crash safety is structural, not defensive.** Existing raw files are never rewritten, so a
  process death mid-sync cannot corrupt prior Matches — only fail to add new ones.
- **Concurrency safety is structural too, and only for the Archive.** The Index is a single
  file rewritten wholesale, so it *does* need serializing within the process, and its temp
  files must be uniquely named — a fixed `.tmp` path makes concurrent writers collide on
  `rename`. See the spec §3.1.
- **The Index is never authoritative.** Corrupt it, reshape it, delete it — rebuild from
  `raw/`. This is the migration story.
- **Deleting `raw/` is unrecoverable.** It holds Matches that exist nowhere else. Test
  isolation is therefore a safety requirement, not a nicety — see
  [ADR-0004](0004-diagnostic-stats-with-benchmarks.md) consequences and the spec's testing
  section. `LOL_COACH_DATA_DIR` must exist before the Archive does.
- Aggregates are JS reduces over an in-memory array. At single-user volume (a few thousand
  Matches, ~300 bytes per Index Row) this is microseconds and well under 1 MB resident.
- Raw payloads are ~31 KB per Match; ~500 Matches/year ≈ 15 MB/year. Not a concern.
- **SQLite remains available later at low cost.** Because the Index is derived, adopting it
  would be an Index rebuild into a different backing store — not a data migration.
