# ADR-0007: The desktop app is an Electron shell around the untouched server

**Status:** Accepted (2026-07-20)

## Context

The app ran as a terminal window plus a browser tab — workable, but wrong-shaped for what it
is: a companion that should sit quietly on a gaming PC, keep watching for games, and survive
an accidental tab close. Making it a desktop app raised the framework question. The candidates:

- **Electron** bundles Chromium and a full Node runtime.
- **Tauri v2** uses the OS WebView and a Rust core. It is the smaller, more modern choice —
  when the backend is Rust, or thin enough for Tauri's JS API.
- **Neutralino / Wails** — same story with fewer batteries: the backend is not Node.

The deciding fact: this backend **is** Node, and not incidentally. Express serves the UI and
SSE; the LCU client rides Node's `https.Agent({ rejectUnauthorized: false })` against the
client's self-signed cert and shells out via `child_process` for process inspection;
`@anthropic-ai/sdk` drives coaching; the Archive is Node `fs` with `wx`-flag atomicity
([ADR-0002](0002-write-once-archive-derived-index.md)). Under Tauri all of that must either be
rewritten in Rust or shipped as a **sidecar** Node binary (Node SEA or pkg — both awkward with
ESM, and now two processes need lifecycle glue). Tauri's genuine wins — ~5 MB binaries, lower
memory, mobile targets — buy nothing on a machine that runs a 30 GB game.

## Decision

Ship an **Electron shell around the unchanged server**: `server.js` stays the whole product
and runs *in-process* in Electron's main process; the window is chrome around
`http://127.0.0.1:<port>`. A regular browser on the same URL keeps working alongside — it is
the same server socket.

- **The env seam built for tests carried the whole conversion.** `LOL_COACH_DATA_DIR` and
  `LOL_COACH_CONFIG` already redirect every writable path, so packaged mode just points them
  at `%APPDATA%\LoL Matchup Coach` before importing the server. Dev mode (`npm run app`)
  leaves them unset and keeps using the repo's `config.json` and `data/`. The shell had to
  add no path logic of its own — ~200 lines total (`electron/main.js`,
  `electron/window-state.js`).
- Those imports are **dynamic and ordered**: a static `import` of anything touching
  `src/config.js` would hoist above the env setup and freeze paths into the read-only asar.
  This ordering is the one fragile thing in the shell; `electron/main.js` documents it.
- **Readiness and failure surface through a `ready` promise** exported by `server.js`,
  resolved by the `listen` callback, rejected by its error handler. The server's
  `process.exit(1)` on EADDRINUSE is guarded with `process.versions.electron` — inside
  Electron an exit would tear down the GUI with no dialog; under plain `node server.js`
  behavior is unchanged, which keeps `npm start`, `start.bat`, and the test suite (which
  spawns `node server.js`) byte-for-byte identical. The shell also pre-flights the port to
  show a readable "already running" dialog instead of racing to a crash.
- **Closing the window hides to the tray** and the app keeps watching — Forward Sync and
  Rank Snapshots ([ADR-0006](0006-forward-only-rank-tracking.md)) continue. Quit lives in the
  tray menu. Single-instance lock: a second launch focuses the existing window.
- **Packaging** is electron-builder → NSIS, per-user (no admin), with a `files` whitelist.
  `config.json` (it holds the API key) and `data/` are excluded twice over — not in the
  whitelist *and* explicitly negated — because an installer that ships either is a data
  breach, not a bug. `deleteAppDataOnUninstall` stays false: uninstalling must never delete
  the Archive, which holds matches that exist nowhere else.

## Consequences

- **~100 MB installer, ~300 MB installed.** The Electron tax, accepted deliberately: the
  alternative was a sidecar toolchain or a rewrite.
- **Two data locations can exist.** The packaged app writes `%APPDATA%\LoL Matchup Coach\`;
  from-source runs keep using the repo. Migration is a one-time copy of `data\` and
  `config.json` (safe by construction: Archive files are write-once, the Index rebuilds).
  The README documents it.
- **The installer is unsigned** — SmartScreen will warn on other machines. Irrelevant for a
  personal install; signing is a follow-up if this is ever distributed.
- **No native modules, and it should stay that way**: Electron's bundled Node tracks its own
  ABI, and this app currently rebuilds nothing. A future native dependency would buy the
  whole electron-rebuild toolchain.
- Browser mode is not legacy: `npm start` remains the dev loop, and the tests keep spawning
  the server as a plain Node process.
