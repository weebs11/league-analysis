// LoL Matchup Coach — local companion server.
// Serves the dashboard UI, watches for League games, and calls the AI coach.
import express from 'express';
import path from 'path';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { getConfig, updateConfig } from './src/config.js';
import * as ddragon from './src/ddragon.js';
import * as gamestate from './src/gamestate.js';
import * as coach from './src/coach.js';
import * as fallback from './src/fallback.js';
import * as briefings from './src/briefings.js';
import * as mock from './src/mock.js';
import * as lcu from './src/lcu.js';
import { router as historyRouter } from './src/history/routes.js';
import * as historyStore from './src/history/store.js';
import { ensureDirs, makeMatchId } from './src/history/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Champion artwork (proxied + cached from Riot's CDN) --------------------

app.get('/img/champion/:kind/:id', async (req, res) => {
  try {
    const img = await ddragon.championImage(req.params.kind, req.params.id);
    if (!img) return res.status(404).end();
    res.set('Content-Type', img.type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(img.data);
  } catch {
    res.status(502).end();
  }
});

app.get('/img/item/:id', async (req, res) => {
  try {
    const img = await ddragon.itemImage(req.params.id);
    if (!img) return res.status(404).end();
    res.set('Content-Type', img.type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(img.data);
  } catch {
    res.status(502).end();
  }
});

// ---- State pushed to the browser -------------------------------------------

// Cached generations, keyed by a fingerprint of the situation, so we don't
// re-bill for the same game every time the page reloads.
const planCache = new Map();
// Relays { phase, pct } updates from an in-flight game-plan generation to every
// connected SSE client (as `coachprogress` events). Single-user app, so there
// is at most one generation in flight and no need to key by request.
const coachProgress = new EventEmitter();
// Handed to the chat endpoint as context. Tagged with the patch it was
// generated on so a plan from before an hourly patch refresh never grounds
// post-refresh chat answers: { plan, patch }.
let lastGamePlan = null;

function currentGamePlan() {
  return lastGamePlan?.patch === ddragon.getVersion() ? lastGamePlan.plan : null;
}

// Persists the generated plan against the match it was generated for, so the
// history detail view can show what you were told next to how it went.
//
// The join key is only readable while the game is running — gameData.gameId off
// the gameflow session — so this has to happen now or never. The match itself
// arrives later via Forward Sync and joins on the same id.
async function persistCoaching(plan, patch) {
  try {
    if (gamestate.snapshot().mode !== 'live') return; // demo never reaches the archive
    const session = await lcu.gameflowSession();
    const gameId = session?.gameData?.gameId;
    if (!gameId) return;
    // The gameflow session carries no platformId, so the canonical id needs the
    // one Forward Sync recorded. Before the first sync there is nothing to join
    // against anyway.
    const { platformId } = await historyStore.readSyncState();
    const matchId = makeMatchId(platformId, gameId);
    if (!matchId) return;
    await historyStore.writeCoaching(matchId, {
      matchId,
      generatedAt: Date.now(),
      model: getConfig().model,
      patch,
      basicMode: Boolean(plan.basicMode),
      plan,
    });
  } catch {
    // Coaching capture is best-effort — never fail a generation because the
    // archive write did not work out.
  }
}

app.get('/api/state', (_req, res) => {
  res.json({ ...gamestate.snapshot(), aiAvailable: coach.aiAvailable() });
});

// Server-Sent Events: the UI learns about phase changes instantly.
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (snap) => {
    res.write(`data: ${JSON.stringify({ ...snap, aiAvailable: coach.aiAvailable() })}\n\n`);
  };
  send(gamestate.snapshot());
  gamestate.events.on('update', send);
  const sendProgress = (p) => {
    res.write(`event: coachprogress\ndata: ${JSON.stringify(p)}\n\n`);
  };
  coachProgress.on('progress', sendProgress);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    gamestate.events.off('update', send);
    coachProgress.off('progress', sendProgress);
    clearInterval(heartbeat);
  });
});

// ---- Coaching endpoints ------------------------------------------------------

function planKey(g, patch) {
  // Keyed by patch too, so a cached plan doesn't outlive a mid-session patch refresh.
  return `${patch}:game:${g.me?.champion?.id}:${g.enemies.map((e) => e.champion?.id).join(',')}`;
}

app.post('/api/coach/gameplan', async (req, res) => {
  const snap = gamestate.snapshot();
  const game = snap.game;
  if (!game || !game.me?.champion) {
    return res.status(409).json({ error: 'No active game (or your champion could not be identified).' });
  }
  const force = Boolean(req.body?.force);
  // Capture the patch once, before the (long) generation await — if a patch
  // refresh lands mid-generation, the plan is tagged with the patch whose
  // data actually produced it, so currentGamePlan() correctly drops it.
  const patch = ddragon.getVersion();
  const key = planKey(game, patch);
  if (!force && planCache.has(key)) {
    const plan = planCache.get(key);
    lastGamePlan = { plan, patch };
    return res.json({ plan, cached: true });
  }
  const progress = (p) => coachProgress.emit('progress', p);
  try {
    let plan;
    if (coach.aiAvailable()) {
      plan = await coach.generateGamePlan(game, progress);
      plan.basicMode = false;
    } else {
      progress({ phase: 'preparing', pct: 10 });
      plan = await fallback.generateBasicGamePlan(game);
    }
    planCache.set(key, plan);
    lastGamePlan = { plan, patch };
    persistCoaching(plan, patch); // fire-and-forget; never blocks the response
    progress({ phase: 'done', pct: 100 });
    res.json({ plan, cached: false });
  } catch (err) {
    console.error('gameplan generation failed:', err);
    progress({ phase: 'error', pct: 0 });
    res.status(502).json({ error: coach.describeApiError(err) });
  }
});

// Served from the pre-generated briefing library — instant and keyless.
// Basic mode only appears for a champion the library doesn't know
// (i.e. released after the library was generated).
app.post('/api/coach/champselect', async (req, res) => {
  const snap = gamestate.snapshot();
  const cs = snap.champSelect;
  if (!cs?.me?.champion) {
    return res.status(409).json({ error: 'Not in champion select (or no champion hovered yet).' });
  }
  try {
    const advice = (await briefings.champSelectAdvice(cs)) || (await fallback.generateBasicChampSelect(cs));
    res.json({ advice });
  } catch (err) {
    console.error('champselect briefing failed:', err);
    res.status(502).json({ error: coach.describeApiError(err) });
  }
});

app.post('/api/coach/chat', async (req, res) => {
  const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!history.length) return res.status(400).json({ error: 'messages[] required' });
  if (!coach.aiAvailable()) {
    return res.status(409).json({ error: 'The coach chat needs an Anthropic API key — add one in Settings.' });
  }
  try {
    const reply = await coach.chat(history, gamestate.snapshot().game, currentGamePlan());
    res.json({ reply });
  } catch (err) {
    console.error('chat failed:', err);
    res.status(502).json({ error: coach.describeApiError(err) });
  }
});

// ---- Match history --------------------------------------------------------------

app.use('/api/history', historyRouter);

// ---- Demo mode ----------------------------------------------------------------

app.get('/api/demo/scenarios', (_req, res) => res.json(mock.scenarioList()));

app.post('/api/demo/start', (req, res) => {
  const { scenario = 'botlane', phase = 'game' } = req.body || {};
  const snapshotBuilder = phase === 'champselect' ? mock.buildChampSelectSnapshot : mock.buildGameSnapshot;
  const snap = snapshotBuilder(scenario);
  if (!snap) return res.status(400).json({ error: `Unknown scenario: ${scenario}` });
  gamestate.enterDemo(phase === 'champselect' ? 'champselect' : 'game', snap);
  res.json({ ok: true });
});

app.post('/api/demo/stop', (_req, res) => {
  gamestate.exitDemo();
  res.json({ ok: true });
});

// ---- Settings -------------------------------------------------------------------

app.get('/api/settings', (_req, res) => {
  const cfg = getConfig();
  res.json({
    model: cfg.model,
    leaguePath: cfg.leaguePath,
    hasApiKey: Boolean(cfg.anthropicApiKey),
  });
});

app.post('/api/settings', (req, res) => {
  const patch = {};
  const { anthropicApiKey, model, leaguePath } = req.body || {};
  if (typeof anthropicApiKey === 'string' && anthropicApiKey.trim() !== '') patch.anthropicApiKey = anthropicApiKey.trim();
  if (anthropicApiKey === null) patch.anthropicApiKey = '';
  if (typeof model === 'string' && model) patch.model = model;
  if (typeof leaguePath === 'string') patch.leaguePath = leaguePath;
  const cfg = updateConfig(patch);
  res.json({ model: cfg.model, leaguePath: cfg.leaguePath, hasApiKey: Boolean(cfg.anthropicApiKey) });
});

// ---- Boot -----------------------------------------------------------------------

const port = Number(process.env.PORT || getConfig().port || 3000);

ensureDirs();

console.log('Loading champion data from Data Dragon...');
await ddragon.init();
console.log(`Data Dragon ready (patch ${ddragon.getVersion()}).`);
// Re-check Riot's version list hourly so a long-running app picks up new patches.
ddragon.startAutoRefresh();

gamestate.start();

// Resolves once the server is listening, rejects if binding fails. The Electron
// shell (electron/main.js) awaits this to know when to open the window and what
// to put in an error dialog. Under plain `node server.js` nothing awaits it —
// the no-op catch keeps a bind failure from also printing an unhandled-rejection
// warning next to the real error message below.
let readyResolve, readyReject;
export const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
ready.catch(() => {});

// Bind to localhost only — the app stores an API key and is meant for the
// machine League runs on.
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`\n  LoL Matchup Coach is running:  http://localhost:${port}\n`);
  console.log('  Leave this window open while you play. The app detects');
  console.log('  champion select and live games automatically.\n');
  readyResolve({ port });
});

// Fail with a readable explanation instead of an unhandled 'error' event and a
// raw stack trace. EADDRINUSE almost always means the app is already running in
// another window. Inside Electron the server shares the GUI process, so exiting
// here would kill the window with no dialog — the shell handles the `ready`
// rejection instead.
server.on('error', (err) => {
  readyReject(err);
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${port} is already in use.\n`);
    console.error('  The LoL Matchup Coach is probably already running in another window.');
    console.error(`  Try opening http://localhost:${port} in your browser first.\n`);
    console.error('  If it is not running, another program is using the port. You can');
    console.error('  start this app on a different port, e.g. in a terminal:\n');
    console.error('      set PORT=3100 && node server.js     (Windows)');
    console.error('      PORT=3100 node server.js            (macOS/Linux)\n');
    if (!process.versions.electron) process.exit(1);
    return;
  }
  if (!process.versions.electron) throw err;
});
