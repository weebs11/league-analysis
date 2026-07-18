# ADR-0005: History is a top-level view that phase changes cannot navigate away from

**Status:** Accepted (2026-07-18)

## Context

The dashboard has no navigation. `showView()` (`public/app.js:133`) toggles exactly three
sections — `view-waiting`, `view-champselect`, `view-ingame` — driven entirely by `snap.phase`
off the SSE stream (`public/app.js:102`). The user never chooses what is on screen. **The game
decides.**

That is a coherent design for a reactive dashboard on a second monitor, and it should not
change.

History is the first thing in the app that is not a Phase. It is browsable at any time, and it
is the first screen where the *user* has an opinion about what should be displayed. This
collides with the phase machine directly: reading last night's Matches when champ select fires
would yank the page away mid-sentence.

The collision is not incidental. **Auto-switching is a feature during play and a bug during
review**, and both happen through the same mechanism — you are most likely to review history
during champ select ("how do I do on this champion?"), which is exactly when the phase machine
most wants the screen.

## Decision

A two-level structure.

- A top-level nav: **Live** / **History**.
- **Live** contains the existing three phase views, behaving exactly as they do today.
  Auto-switching is unchanged, bit for bit.
- **History** is a sibling the phase machine is **not permitted to navigate**. A phase change
  while the user is in History surfaces a dismissible notice — *"Champ select started → Go to
  live"* — instead of switching.

History contains three screens: a paginated Match list, a per-Match detail view, and a compact
summary strip above the list.

Rejected: embedding history in `view-waiting` (disappears exactly when wanted); a separate
`/history` page (a second frontend to keep consistent, and loses live status); and letting
auto-switch always win (simpler rule, but makes review during champ select impossible).

## Consequences

- The app gains a navigation concept it did not have. `showView()` needs a second level:
  top-level section, then phase sub-view within Live.
- The phase machine must learn that it does not own the screen unconditionally. Its writes
  become conditional on the active top-level section.
- Existing Live behaviour is untouched, so the regression surface is limited to the new
  branch rather than spread across the phase machine.
- A dedicated analytics page is deliberately deferred. The summary strip discharges the
  Personal Baseline requirement from
  [ADR-0004](0004-diagnostic-stats-with-benchmarks.md) without committing to charts whose
  usefulness is unproven.
- The detail view reuses `renderPlanTab` / `renderItemsTab` / `renderMatchupTab` to render the
  Coaching Record, since they already render exactly that JSON shape.
