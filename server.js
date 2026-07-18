// LoL Matchup Coach — local companion server.
// Serves the dashboard UI, watches for League games, and calls the AI coach.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, updateConfig } from './src/config.js';
import * as ddragon from './src/ddragon.js';
import * as gamestate from './src/gamestate.js';
import * as coach from './src/coach.js';
import * as fallback from './src/fallback.js';
import * as mock from './src/mock.js';

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

// ---- State pushed to the browser -------------------------------------------

// Cached generations, keyed by a fingerprint of the situation, so we don't
// re-bill for the same game every time the page reloads.
const planCache = new Map();
let lastGamePlan = null; // handed to the chat endpoint as context

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
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    gamestate.events.off('update', send);
    clearInterval(heartbeat);
  });
});

// ---- Coaching endpoints ------------------------------------------------------

function planKey(kind, snapshot) {
  // Keyed by patch too, so cached advice doesn't outlive a mid-session patch refresh.
  const patch = ddragon.getVersion();
  if (kind === 'game') {
    const g = snapshot;
    return `${patch}:game:${g.me?.champion?.id}:${g.enemies.map((e) => e.champion?.id).join(',')}`;
  }
  const cs = snapshot;
  return `${patch}:cs:${cs.me?.champion?.id}:${cs.theirTeam.map((e) => e.champion?.id || '_').join(',')}`;
}

app.post('/api/coach/gameplan', async (req, res) => {
  const snap = gamestate.snapshot();
  const game = snap.game;
  if (!game || !game.me?.champion) {
    return res.status(409).json({ error: 'No active game (or your champion could not be identified).' });
  }
  const force = Boolean(req.body?.force);
  const key = planKey('game', game);
  if (!force && planCache.has(key)) {
    lastGamePlan = planCache.get(key);
    return res.json({ plan: lastGamePlan, cached: true });
  }
  try {
    let plan;
    if (coach.aiAvailable()) {
      plan = await coach.generateGamePlan(game);
      plan.basicMode = false;
    } else {
      plan = await fallback.generateBasicGamePlan(game);
    }
    planCache.set(key, plan);
    lastGamePlan = plan;
    res.json({ plan, cached: false });
  } catch (err) {
    console.error('gameplan generation failed:', err);
    res.status(502).json({ error: coach.describeApiError(err) });
  }
});

app.post('/api/coach/champselect', async (req, res) => {
  const snap = gamestate.snapshot();
  const cs = snap.champSelect;
  if (!cs?.me?.champion) {
    return res.status(409).json({ error: 'Not in champion select (or no champion hovered yet).' });
  }
  const force = Boolean(req.body?.force);
  const key = planKey('cs', cs);
  if (!force && planCache.has(key)) {
    return res.json({ advice: planCache.get(key), cached: true });
  }
  try {
    let advice;
    if (coach.aiAvailable()) {
      advice = await coach.generateChampSelectAdvice(cs);
      advice.basicMode = false;
    } else {
      advice = await fallback.generateBasicChampSelect(cs);
    }
    planCache.set(key, advice);
    res.json({ advice, cached: false });
  } catch (err) {
    console.error('champselect advice failed:', err);
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
    const reply = await coach.chat(history, gamestate.snapshot().game, lastGamePlan);
    res.json({ reply });
  } catch (err) {
    console.error('chat failed:', err);
    res.status(502).json({ error: coach.describeApiError(err) });
  }
});

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

console.log('Loading champion data from Data Dragon...');
await ddragon.init();
console.log(`Data Dragon ready (patch ${ddragon.getVersion()}).`);
// Re-check Riot's version list hourly so a long-running app picks up new patches.
ddragon.startAutoRefresh();

gamestate.start();

// Bind to localhost only — the app stores an API key and is meant for the
// machine League runs on.
app.listen(port, '127.0.0.1', () => {
  console.log(`\n  LoL Matchup Coach is running:  http://localhost:${port}\n`);
  console.log('  Leave this window open while you play. The app detects');
  console.log('  champion select and live games automatically.\n');
});
