# Rank Snapshot chart across sparse and dense time ranges

**Checked:** 2026-07-23

## Recommendation

Use a **focus + context** chart:

- Use an **active-day scale**: every calendar day containing at least one ranked Match or
  Rank Snapshot gets equal horizontal weight, regardless of the hours between sessions.
  Preserve event order by distributing Matches and snapshots evenly inside that day's band.
- Show the latest 14 days in the large focus chart by default.
- Put a compact full-history navigator underneath it, with a draggable visible-range
  selection and `7D`, `14D`, and `All` buttons.
- Render dense, trustworthy runs as a **step-after** line because standings change at an
  observed instant; do not imply a gradual climb between snapshots.
- Break the line across long observation gaps. If continuity is useful, add a thin dashed
  connector explicitly labeled as an observation gap. Render externally seeded OP.GG
  snapshots as hollow markers and identify their source in the tooltip.
- Add a compact win/loss activity row with one tick per archived ranked Match. This keeps
  game volume visible when one catch-up Rank Snapshot covers several Matches.

Apache ECharts 6.1 is the best library fit. Its `dataZoom` component already provides a
linked in-chart interaction and a visible slider with a data thumbnail, selection handles,
drag-to-pan, and touch support. Multiple zoom components controlling the same axis stay
linked, so the slider and direct manipulation can share one viewport
([official `dataZoom` docs](https://github.com/apache/echarts-doc/blob/7fe8932a63a348122c428d29047e5c4b48117f84/en/option/component/data-zoom.md),
[slider docs](https://github.com/apache/echarts-doc/blob/7fe8932a63a348122c428d29047e5c4b48117f84/en/option/component/data-zoom-slider.md),
[inside docs](https://github.com/apache/echarts-doc/blob/7fe8932a63a348122c428d29047e5c4b48117f84/en/option/component/data-zoom-inside.md)).
It also natively supports step lines through `step: "end"`
([step-line guide](https://echarts.apache.org/handbook/en/how-to/chart-types/line/step-line/)).

The first implementation kept a linear timestamp scale, but real usage showed that elapsed
hours are not the useful comparison here. A session ending late one night and another
starting late the next night produced a large empty plateau, while many games on one active
day were compressed into a small area. Rank Snapshot timestamps remain exact in the tooltip
and table; the chart's horizontal geometry instead communicates active days and game order.
This is intentionally not "one point = one slot", which would let a high-volume day consume
most of the graph.

## Why the current chart fails

The chart in [`public/app.js`](../../public/app.js) maps the complete timestamp extent into
one 558 px plot using a single linear expression. The current data spans about 54.5 days,
while 32 of 35 points fall in the latest five days. Those recent points therefore receive
only about 49 px. Four OP.GG observations also create long, solid diagonal segments across
14-18 day intervals even though the app did not observe the standing between them
([current Rank Snapshots](../../data/matches/rank-history.json)).

The problem is not point count or rendering performance. It is that one fixed viewport is
being asked to show both overview and detail, elapsed downtime is receiving visual emphasis,
and the same solid line style is being used for two different evidence qualities.

## Design details

### 1. Focus chart

- Calendar days still determine which observations belong to a `7D` or `14D` preset.
- Inside the selected range, each active day receives one equal-width band. A single
  observation sits at its center; multiple observations are evenly ordered inside the band.
- Inactive dates receive no band. Date labels make skipped dates explicit without allocating
  empty chart width to them.
- `7D`, `14D`, and `All` are real buttons, not chart glyphs, so they are keyboard reachable.
- Dragging the navigator changes the domain; optional direct zoom should require `Ctrl` +
  wheel so normal page scrolling is not captured accidentally. ECharts exposes modifier
  keys for wheel zoom and pointer movement in its
  [inside-zoom options](https://github.com/apache/echarts-doc/blob/7fe8932a63a348122c428d29047e5c4b48117f84/en/option/component/data-zoom-inside.md).
- Recompute the y-domain from visible points, while retaining the existing minimum of one
  division (100 LP) of context. ECharts documents that x-axis
  `filterMode: "filter"` allows the other axis to adapt to the filtered data
  ([filtering guidance](https://github.com/apache/echarts-doc/blob/7fe8932a63a348122c428d29047e5c4b48117f84/en/option/component/data-zoom.md#how-datazoom-components-operates-axes-and-data)).
- Keep the current axis-triggered nearest-snapshot tooltip and "Now" readout.

### 2. Full-history context

The navigator should always show the entire active-day extent. Its selection is a map of
where the focus chart sits, not a second independent filter. ECharts' slider is already
shaped this way: it supplies a data thumbnail, selection brush, handles, and drag-to-move behavior
([slider docs](https://github.com/apache/echarts-doc/blob/7fe8932a63a348122c428d29047e5c4b48117f84/en/option/component/data-zoom-slider.md)).

Keep the navigator's y-domain fixed to all history so its silhouette remains stable while
the focus chart's y-domain adapts. Exact y-axis labels are unnecessary in the navigator.

### 3. Observation semantics

Use step-after inside a reliable run: the recorded standing holds until the next observed
change, then jumps. ECharts describes step lines as emphasizing sudden changes rather than
interpolating a straight trend between points
([step-line guide](https://echarts.apache.org/handbook/en/how-to/chart-types/line/step-line/)).

Do not carry the step through sparse imported history as if the standing were known:

- Split a series when the source changes to OP.GG or when the elapsed gap crosses a clearly
  named observation-gap threshold.
- Leave the gap empty by default. A secondary dashed connector can communicate "next known
  observation" without looking like measured progress.
- Use hollow circles for `source: "opgg"` and filled circles for Forward Sync observations.
- Include "OP.GG snapshot" or "Forward Sync snapshot" in the tooltip.

The cumulative wins/losses on adjacent Forward Sync snapshots reveal catch-up intervals. If
the total record increases by more than one game, the intermediate LP path is unknown even
when the elapsed time is under the ordinary observation-gap threshold. Render that connector
as dashed and show the known Matches as individual green/red activity ticks. Never interpolate
or synthesize LP for those Matches.

This also respects ADR-0006: these are observed standings, not a per-Match LP ledger
([ADR-0006](../adr/0006-forward-only-rank-tracking.md)).

### 4. Accessibility

Keep the existing "View as table" disclosure as the exact, non-visual representation. Add a
short live status such as "Showing Jul 10-Jul 23" when the window changes, and make the range
buttons the complete keyboard alternative to dragging.

ECharts can generate an ARIA description and add an accessible chart label, but the feature
is off by default and requires the ARIA component in modular builds
([ECharts ARIA guide](https://echarts.apache.org/handbook/en/best-practices/aria/)).
That description is useful context, not a substitute for the table or keyboard-operable
range controls. ECharts' own tracker records that chart interaction is not comprehensively
keyboard accessible
([accessibility issue #18585](https://github.com/apache/echarts/issues/18585)).

Use the SVG renderer to stay close to the current DOM/SVG styling and retain crisp rendering.
ECharts supports both Canvas and SVG
([renderer overview](https://echarts.apache.org/en/index.html)).

## Library comparison

| Candidate | What it gives this chart | What remains custom | Fit |
|---|---|---|---|
| **Apache ECharts 6.1** | Time axis, linked inside + slider `dataZoom`, overview thumbnail, tooltips, step lines, SVG or Canvas, ARIA description | Source/gap segmentation, accessible range buttons, table | **Best fit.** The exact interaction is built in, and the project is active: 6.1.0 shipped May 2026 ([repository](https://github.com/apache/echarts)). |
| **uPlot 1.6.32** | Very small Canvas time-series library, cursor sync, missing-data support, stepped paths, high-performance zoom | No built-in drag panning; the repository explicitly routes it through plugins. A two-chart navigator and accessible controls would be custom ([repository](https://github.com/leeoniya/uPlot)). | Best size/performance choice, but performance is not this chart's problem and it leaves the key UI to us. |
| **D3 7.9** | Precise primitives: linear time scales, `brushX` for a navigator, `zoom` for focus, and `curveStepAfter`; works directly with SVG | Nearly the entire chart system: axes, tooltip, state synchronization, resize, keyboard behavior, and styling | Best if preserving the handcrafted SVG is more important than reducing implementation code. D3 explicitly supports combining zoom and brush for focus + context ([zoom](https://d3js.org/d3-zoom), [brush](https://d3js.org/d3-brush), [step-after](https://d3js.org/d3-shape/curve#curveStepAfter)). |
| **Observable Plot 0.6.17** | Excellent concise SVG authoring, temporal scales, line gaps from null values, and pointer/tip interactions ([line](https://observablehq.com/plot/marks/line), [pointer](https://observablehq.com/plot/interactions/pointer)) | No first-class navigator/brush pair; zoom/filter requires surrounding application logic or D3 | Strong for static/exploratory charts, but not for this interaction-first requirement. Its `interval` feature regularizes sampled data; it does not solve the viewport compression without changing aggregation or scale semantics ([scales](https://observablehq.com/plot/features/scales)). |

Chart.js plus `chartjs-plugin-zoom` is also popular, but its official plugin supplies pan,
wheel, drag, and pinch zoom—not a persistent full-history navigator—and a time axis needs a
date adapter. It therefore adds multiple dependencies while still leaving focus + context
custom ([zoom options](https://www.chartjs.org/chartjs-plugin-zoom/guide/options.html),
[time-axis docs](https://www.chartjs.org/docs/latest/axes/cartesian/time.html)).

## Dependency and packaging impact

The app currently has no frontend bundler and only two runtime dependencies
([`package.json`](../../package.json)). The versioned prebuilt browser distributions measured
locally are approximately:

| Package | Minified browser file | Gzip |
|---|---:|---:|
| ECharts 6.1.0 | 1,122 KB | 369 KB |
| uPlot 1.6.32 | 51 KB | 22 KB |
| Observable Plot 0.6.17 | 209 KB | 69 KB |
| D3 7.9.0 | 280 KB | 93 KB |

ECharts' full file is the cost of the convenient interaction. For this Electron app, that is
small relative to the accepted desktop-shell footprint, but it should still be a pinned local
asset so the companion works offline. Do not load it from a CDN at runtime.

ECharts provides a tree-shakeable `echarts/core` interface and separate chart, component, and
renderer imports, but that path requires adding a frontend build step
([official import guide](https://echarts.apache.org/handbook/en/basics/import/)). For a first
implementation, prefer the pinned full browser build; introduce bundling only if more
frontend dependencies appear. The project is Apache-2.0 licensed
([package manifest](https://github.com/apache/echarts/blob/6.1.0/package.json)).

## Proposed acceptance checks

1. On initial load, the last 14 days occupy the full focus plot while the navigator shows all
   history.
2. `7D`, `14D`, and `All` work by mouse and keyboard and announce the visible date range.
3. Active days remain equally spaced after dragging or resizing the navigator; hours within
   and between days never change their horizontal weight.
4. OP.GG observations are visually distinguishable and no solid line crosses their long
   unobserved gaps.
5. Dense Forward Sync data uses step-after transitions; tooltips still expose exact Rank
   Snapshot values and timestamps.
6. The complete table remains available and readable without operating the chart.
7. A day with one observation, a day with 20+ observations, widely separated active days,
   and large LP swings all render without hour-driven gaps or clipped range boundaries.
8. Every non-remake ranked Match in the Archive produces exactly one activity tick, including
   Match-only days with no Rank Snapshot.
9. A Rank Snapshot whose cumulative record jumps by more than one game never creates a solid
   "known LP" segment across those Matches.
