# Briefing Library

Pre-generated pre-game briefings, one JSON file per champion, served instantly during
champion select (`src/briefings.js`) — no API key, no network call, no wait.

- `manifest.json` records the patch, model, and date the library was generated.
- Each `<ChampionId>.json` holds the champion's playstyle summary, strengths/weaknesses,
  ability guide (Passive/Q/W/E/R), early-game plan, quick tips, a "what to expect" blurb
  used when the champion appears as an *enemy*, and a glossary of jargon used.
- Ability names are copied verbatim from Data Dragon for the patch in the manifest.
- Briefings deliberately contain **no item or rune advice** — that goes stale every patch
  and is handled by the live Game Plan instead.

## Regenerating

The library is written by Claude (Sonnet) in a Claude Code session, not by the app:
champion data is dumped from Data Dragon, split into batches, briefings are generated
per batch, validated (structure + exact ability names), and assembled here. Ask Claude
Code to "regenerate the briefing library" after a patch that meaningfully reworks
champions, or when new champions are released.

A champion missing from the library (released after generation) automatically falls back
to basic mode (Riot data only) in the UI.
