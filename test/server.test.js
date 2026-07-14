// Integration tests: boots the real server (plus a fake Live Client API) and
// exercises the HTTP surface the dashboard uses. Run with `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = 3971;
const MOCK_PORT = 3972;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const tmpConfig = path.join(os.tmpdir(), `lol-coach-server-test-${process.pid}.json`);

let appProc;
let mockProc;

const get = async (p) => {
  const res = await fetch(BASE + p);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body, type };
};
const post = async (p, body = {}) => {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function waitFor(fn, what, timeoutMs = 45000, everyMs = 400) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out waiting for ${what}${lastErr ? ` (last error: ${lastErr.message})` : ''}`);
}

before(async () => {
  mockProc = spawn(process.execPath, [path.join(ROOT, 'test', 'mock-league-server.js')], {
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT) },
    stdio: 'ignore',
  });
  appProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      LIVE_CLIENT_PORT: String(MOCK_PORT),
      LIVE_CLIENT_INSECURE_HTTP: '1',
      LOL_COACH_CONFIG: tmpConfig,
      ANTHROPIC_API_KEY: '', // hermetic: never bill the developer's key from tests
    },
    stdio: 'ignore',
  });
  await waitFor(async () => (await get('/api/state')).status === 200, 'server to boot');
});

after(() => {
  appProc?.kill();
  mockProc?.kill();
  fs.rmSync(tmpConfig, { force: true });
});

test('detects the (mock) live game and identifies the player', async () => {
  const state = await waitFor(async () => {
    const { body } = await get('/api/state');
    return body.phase === 'ingame' ? body : null;
  }, 'live game detection');
  assert.equal(state.clientDetected, true);
  assert.equal(state.game.me.champion.name, 'Miss Fortune');
  assert.equal(state.game.me.role, 'ADC (Bot)');
  assert.equal(state.game.allies.length, 5);
  assert.equal(state.game.enemies.length, 5);
  assert.ok(state.game.enemies.some((e) => e.champion.name === 'Zed'));
});

test('generates a basic-mode game plan for the detected game', async () => {
  const { status, body } = await post('/api/coach/gameplan');
  assert.equal(status, 200);
  assert.equal(body.plan.basicMode, true);
  assert.equal(body.plan.enemyThreats.length, 5);
  // Second call must hit the cache instead of regenerating.
  const again = await post('/api/coach/gameplan');
  assert.equal(again.body.cached, true);
});

test('serves champion artwork with caching headers', async () => {
  const img = await get('/img/champion/square/Jinx');
  assert.equal(img.status, 200);
  assert.equal(img.type, 'image/png');
  assert.ok(img.body.byteLength > 1000, 'expected real image bytes');
  const splash = await get('/img/champion/splash/Garen');
  assert.equal(splash.status, 200);
  assert.equal(splash.type, 'image/jpeg');
  assert.equal((await get('/img/champion/square/NotAChampion')).status, 404);
  assert.equal((await get('/img/champion/bogus/Jinx')).status, 404);
});

test('demo mode overrides live detection and champ select advice works', async () => {
  const start = await post('/api/demo/start', { scenario: 'top', phase: 'champselect' });
  assert.equal(start.status, 200);
  const { body: state } = await get('/api/state');
  assert.equal(state.phase, 'champselect');
  assert.equal(state.mode, 'demo');
  assert.equal(state.champSelect.me.champion.name, 'Garen');

  const advice = await post('/api/coach/champselect');
  assert.equal(advice.status, 200);
  assert.equal(advice.body.advice.basicMode, true);
  assert.ok(advice.body.advice.yourChampion.abilities.length === 5);

  const stop = await post('/api/demo/stop');
  assert.equal(stop.status, 200);
});

test('demo scenarios endpoint lists all three roles', async () => {
  const { body } = await get('/api/demo/scenarios');
  assert.deepEqual(body.map((s) => s.id).sort(), ['botlane', 'jungle', 'top']);
  const bad = await post('/api/demo/start', { scenario: 'nonsense' });
  assert.equal(bad.status, 400);
});

test('chat requires an API key and says so clearly', async () => {
  const { status, body } = await post('/api/coach/chat', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(status, 409);
  assert.match(body.error, /API key/);
  const empty = await post('/api/coach/chat', {});
  assert.equal(empty.status, 400);
});

test('settings round-trip persists to the (test) config file', async () => {
  const before_ = await get('/api/settings');
  assert.equal(before_.body.hasApiKey, false);
  const saved = await post('/api/settings', { model: 'claude-haiku-4-5', leaguePath: 'C:\\Riot Games\\League of Legends' });
  assert.equal(saved.body.model, 'claude-haiku-4-5');
  const after_ = await get('/api/settings');
  assert.equal(after_.body.model, 'claude-haiku-4-5');
  assert.equal(after_.body.leaguePath, 'C:\\Riot Games\\League of Legends');
  assert.equal(after_.body.hasApiKey, false);
  assert.ok(fs.existsSync(tmpConfig), 'config written to the test path, not the real one');
});

test('SSE endpoint streams the current state immediately', async () => {
  const res = await fetch(`${BASE}/api/events`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const frame = new TextDecoder().decode(value);
  assert.match(frame, /^data: \{/m, 'first frame carries a state snapshot');
  const snap = JSON.parse(frame.replace(/^data: /, ''));
  assert.ok(['waiting', 'champselect', 'ingame'].includes(snap.phase));
  await reader.cancel();
});
