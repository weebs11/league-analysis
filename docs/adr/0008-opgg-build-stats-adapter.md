# ADR-0008: Champion build stats come from op.gg's internal API, behind an adapter

**Status:** Accepted (2026-07-20)

## Context

The Champion Database needs what no official API provides: aggregated, current-patch build
statistics — rune pages, item orders, skill orders — weighted by real games and win rates.
Riot's API serves per-match data only; aggregating it ourselves would need millions of match
fetches against dev-key rate limits. Every real option is a stats site's internal endpoint.
Candidates probed live (2026-07-20):

- **op.gg** — `https://lol-api-champion.op.gg/api/{REGION}/champions/ranked/...`. Clean named
  JSON (~19KB per champion/role/tier): `rune_pages` with stat shards, `summoner_spells`,
  `starter_items`, `boots`, `core_items`, `last_items`, `skills` + `skill_masteries`,
  `counters`, and a `summary` with per-position stats. A roster endpoint returns all
  champions with positions and stats in one call. `GLOBAL` region pools every server
  (~9M ranked games per tier snapshot); `tier=` filtering verified for
  `all|gold_plus|platinum_plus|emerald_plus|diamond_plus|master_plus`. Champions are keyed by
  lowercased ddragon id (`monkeyking`). Requires a browser User-Agent; plain fetches 403.
  OP.GG also ships an official public MCP server over this same data — programmatic access
  is something they knowingly support.
- **u.gg** — `https://stats2.u.gg/lol/1.5/overview/{patch}/ranked_solo_5x5/{champKey}/{apiVer}.json`
  (patch as `16_14`; `{apiVer}` from
  `https://static.bigbrain.gg/assets/lol/riot_patch_update/prod/ugg/ugg-api-versions.json`).
  Works, and one ~460KB file carries every region × rank × role — but as cryptic positional
  arrays (region 12 = world; roles 1=jungle, 2=support, 3=adc, 4=top, 5=mid; sections
  [0]=runes, [1]=spells, [2]=starting, [3]=core, [4]=skills, [5]=item slots, [6]=overall,
  [8]=shards), purely reverse-engineered.
- **lolalytics** — Cloudflare-fronted, parameters unresolvable; rejected.
- **Claude web-search** (the `fetchMetaNotes` pattern generalized) — costs API tokens and
  returns prose, not exact win rates; rejected.
- **Own match archive** — only covers champions the player played; no global sample; rejected.

## Decision

**op.gg is the provider**, and it is quarantined behind an adapter:

- **`src/builds/opgg.js` is the only module that may know an op.gg URL, header, or naming
  convention.** Everything else consumes **Build Extracts** — our own compact schema.
  If the feed changes or dies, the blast radius is one file plus the parser.
- **`src/builds/extract.js` gates every payload before it can be cached.** Sections must have
  the expected shapes (4+2 perk slots, 3 shards, Q/W/E/R sequences) and every ranked
  section's win rate must land in 30–70%. A drifted or garbage payload throws `ExtractError`
  and is never written to disk — the cache only ever holds data that once made sense.
- **The cache is served first, then revalidated.** Extracts live under `data/builds/` with a
  24h TTL. A fresh extract is served straight off disk; one past the TTL is *also* served
  instantly and refreshed in the background (stale-while-revalidate) — a page load never blocks
  on op.gg when usable data is already on disk, and day-old build stats barely move. Only a
  cold cache (nothing usable) or an explicit `refresh=1` blocks on the upstream. When that
  blocking fetch can't reach op.gg, the newest cached extract is served with `stale: true` and
  the UI says so (with the patch it came from); with no cache at all the endpoint returns a
  readable 503 — the grid itself never depends on op.gg.
- **u.gg is the recorded alternate.** The endpoint shapes above were verified working the
  same day; a replacement adapter would implement `fetchRoster`/`fetchChampionBuild` against
  them and a new extract mapping, touching nothing else.

## Consequences

- The feature costs no API keys and no tokens, and one 19KB fetch per champion/role/tier per
  day at most — polite by any measure.
- An unofficial endpoint can break without notice. Accepted: the app degrades to labeled
  cached data rather than breaking, and the swap path is documented above.
- `OPGG_BASE` env-overrides the base URL, which is how integration tests point the real
  server at a local mock (`test/builds.test.js`) — the same seam pattern as
  `LIVE_CLIENT_PORT`.
- Rune names/icons and summoner spells now load from Data Dragon at init
  (`runesReforged.json`, `summoner.json`); stat shards are a hardcoded table in
  `src/ddragon.js` with Community Dragon icons, revisited only when Riot reworks shards.
