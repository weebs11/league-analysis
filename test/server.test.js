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
const MOCK_LCU_PORT = 3973;
const tmpConfig = path.join(os.tmpdir(), `lol-coach-server-test-${process.pid}.json`);
// The archive holds matches that exist nowhere else, so the suite gets its own
// data directory and must never be able to reach the real one.
const tmpData = path.join(os.tmpdir(), `lol-coach-server-data-${process.pid}`);
const tmpLockfile = path.join(tmpData, 'lockfile');

let appProc;
let mockProc;
const suiteStartedAt = Date.now();

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
  fs.mkdirSync(tmpData, { recursive: true });
  // LOL_COACH_DATA_DIR moves the Data Dragon cache as well as the archive, so
  // seed it from the real one — otherwise every run re-downloads champion data.
  // Only the archive needs isolating; the cache is disposable either way.
  const realCache = path.join(ROOT, 'data', 'cache');
  if (fs.existsSync(realCache)) fs.cpSync(realCache, path.join(tmpData, 'cache'), { recursive: true });
  mockProc = spawn(process.execPath, [path.join(ROOT, 'test', 'mock-league-server.js')], {
    env: {
      ...process.env,
      MOCK_PORT: String(MOCK_PORT),
      MOCK_LCU_PORT: String(MOCK_LCU_PORT),
      MOCK_LOCKFILE: tmpLockfile,
    },
    stdio: 'ignore',
  });
  // The mock writes the lockfile once its LCU listener is up; the app discovers
  // credentials from it exactly as it would from a real install.
  await waitFor(async () => fs.existsSync(tmpLockfile), 'mock LCU lockfile');

  appProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      LIVE_CLIENT_PORT: String(MOCK_PORT),
      LIVE_CLIENT_INSECURE_HTTP: '1',
      LCU_INSECURE_HTTP: '1',
      LEAGUE_LOCKFILE: tmpLockfile,
      LOL_COACH_CONFIG: tmpConfig,
      LOL_COACH_DATA_DIR: tmpData,
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
  fs.rmSync(tmpData, { recursive: true, force: true });
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

test('gameplan generation streams coachprogress events over SSE', async () => {
  const res = await fetch(`${BASE}/api/events`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // Drain the initial snapshot frame so the stream is definitely open before
  // the generation starts — progress events are not replayed.
  let buf = decoder.decode((await reader.read()).value);

  const postDone = post('/api/coach/gameplan', { force: true }); // force past the cache
  const deadline = Date.now() + 30000;
  while (!buf.includes('"phase":"done"') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
  }
  const { status } = await postDone;
  await reader.cancel();
  assert.equal(status, 200);

  const frames = [...buf.matchAll(/^event: coachprogress\ndata: (.+)$/gm)].map((m) => JSON.parse(m[1]));
  assert.ok(frames.length >= 2, `expected at least preparing + done frames, got ${frames.length}`);
  assert.ok(frames.some((f) => f.phase === 'preparing'), 'reports the preparing phase');
  const last = frames[frames.length - 1];
  assert.deepEqual({ phase: last.phase, pct: last.pct }, { phase: 'done', pct: 100 });
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
  // Served from the checked-in briefing library — no API key involved.
  assert.equal(advice.body.advice.basicMode, false);
  assert.ok(advice.body.advice.briefingPatch);
  assert.ok(advice.body.advice.yourChampion.abilities.length === 5);
  assert.ok(advice.body.advice.knownEnemies.length > 0);

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

// ---- Match history ----------------------------------------------------------

test('history: detecting the client captures ranked matches with no manual trigger', async () => {
  // Boot fires the client-connect trigger, so the archive fills on its own.
  const list = await waitFor(async () => {
    const { body } = await get('/api/history/matches?size=50');
    return body.total > 0 ? body : null;
  }, 'matches to be captured by the automatic sync');

  assert.ok(list.rows.every((r) => [420, 440].includes(r.queueId)), 'only ranked queues are stored');
  assert.ok(list.rows.every((r) => /^[A-Z0-9]+_\d+$/.test(r.matchId)), 'ids are platform-qualified');
  assert.ok(list.rows.every((r) => r.puuid), 'every row records which account it belongs to');
});

test('history: sync is idempotent — a second pass writes nothing', async () => {
  const { body: before_ } = await get('/api/history/matches?size=50');
  const { status, body } = await post('/api/history/sync');
  assert.equal(status, 200);
  assert.equal(body.added, 0, `nothing new should be written, got ${JSON.stringify(body)}`);
  assert.ok(body.skipped > 0, 'the already-stored matches are skipped before any detail fetch');
  const { body: after_ } = await get('/api/history/matches?size=50');
  assert.equal(after_.total, before_.total);
});

test('history: archive files are written under the test data dir, never the real one', () => {
  const rawDir = path.join(tmpData, 'matches', 'raw');
  const files = fs.readdirSync(rawDir);
  assert.ok(files.length > 0, 'raw payloads land in the isolated archive');
  assert.ok(files.every((f) => f.endsWith('.json')));
  // The real archive may legitimately exist on a dev machine that has run the
  // app — what tests must never do is ADD to it. Every file this run produced
  // has to be under tmpData, which the mtime of the real raw dir can witness:
  // it must predate the suite. (An absence check here failed for anyone who had
  // actually used the app.)
  const realRaw = path.join(ROOT, 'data', 'matches', 'raw');
  if (fs.existsSync(realRaw)) {
    assert.ok(fs.statSync(realRaw).mtimeMs < suiteStartedAt,
      'the real archive must not gain files during a test run');
  }
});

test('history: summary excludes remakes and reports a record', async () => {
  const { status, body } = await get('/api/history/summary?window=20');
  assert.equal(status, 200);
  assert.equal(body.record.wins + body.record.losses, Math.min(20, body.playableMatches));
  assert.ok(body.playableMatches <= body.totalMatches);
  assert.ok(body.totalMatches > body.playableMatches, 'the captured fixture list contains remakes');
  assert.ok(Array.isArray(body.topChampions));
});

test('history: detail returns all ten players, teams, and benchmark comparisons', async () => {
  const { body: list } = await get('/api/history/matches?size=1');
  const id = list.rows[0].matchId;
  const { status, body } = await get(`/api/history/matches/${id}`);
  assert.equal(status, 200);
  assert.equal(body.players.length, 10);
  assert.equal(body.teams.length, 2);
  assert.equal(body.match.matchId, id);
  // Every team should have a complete role set — the invariant lane-opponent
  // pairing depends on.
  for (const teamId of [...new Set(body.players.map((p) => p.teamId))]) {
    const roles = body.players.filter((p) => p.teamId === teamId).map((p) => p.role).sort();
    assert.deepEqual(roles, ['ADC', 'Jungle', 'Mid', 'Support', 'Top']);
  }
  assert.equal(body.coaching, null, 'no plan was generated for this match');
});

test('history: rejects malformed match ids instead of touching the filesystem', async () => {
  assert.equal((await get('/api/history/matches/not-an-id')).status, 400);
  assert.equal((await get('/api/history/matches/NA1_999999999')).status, 404);
});

test('history: the index rebuilds from the archive alone', async () => {
  const { body: before_ } = await get('/api/history/matches?size=50');
  fs.rmSync(path.join(tmpData, 'matches', 'index.json'), { force: true });
  const rebuilt = await post('/api/history/rebuild-index');
  assert.equal(rebuilt.status, 200);
  assert.equal(rebuilt.body.rows, before_.total);
  const { body: after_ } = await get('/api/history/matches?size=50');
  assert.deepEqual(after_.rows.map((r) => r.matchId), before_.rows.map((r) => r.matchId));
});

test('history: filters and pagination narrow the list', async () => {
  const { body: all } = await get('/api/history/matches?size=50');
  const role = all.rows.find((r) => r.role)?.role;
  if (role) {
    const { body: filtered } = await get(`/api/history/matches?size=50&role=${role}`);
    assert.ok(filtered.rows.every((r) => r.role === role));
    assert.ok(filtered.total <= all.total);
  }
  const { body: page0 } = await get('/api/history/matches?size=2&page=0');
  const { body: page1 } = await get('/api/history/matches?size=2&page=1');
  assert.equal(page0.rows.length, 2);
  assert.notEqual(page0.rows[0].matchId, page1.rows[0]?.matchId);
});

test('history: serves item artwork through the local cache', async () => {
  const img = await get('/img/item/3006');
  assert.equal(img.status, 200);
  assert.equal(img.type, 'image/png');
  assert.ok(img.body.byteLength > 500, 'expected real image bytes');
  assert.equal((await get('/img/item/99999999')).status, 404);
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

test('history: rank is snapshotted by sync and served grouped per queue', async () => {
  // The automatic sync above already ran, so a snapshot should exist. The mock
  // reports solo GOLD IV 43LP, flex unranked, and a TFT entry that must not
  // leak into an LoL LP graph.
  const rank = await waitFor(async () => {
    const { body } = await get('/api/history/rank');
    return body.queues?.length ? body : null;
  }, 'a rank snapshot to be recorded');

  assert.equal(rank.queues.length, 1, 'unranked flex and TFT must not produce series');
  const solo = rank.queues[0];
  assert.equal(solo.queueId, 420);
  assert.equal(solo.queueLabel, 'Ranked Solo/Duo');
  assert.equal(solo.points.length, 1);
  const p = solo.points[0];
  assert.deepEqual(
    { tier: p.tier, division: p.division, lp: p.lp, value: p.value },
    { tier: 'GOLD', division: 'IV', lp: 43, value: 1243 }
  );
  assert.ok(p.at > 0 && p.wins >= 0 && p.losses >= 0);

  // An unchanged standing must not append: rank history grows on change, not
  // on every sync tick.
  await post('/api/history/sync');
  const { body: again } = await get('/api/history/rank');
  assert.equal(again.queues[0].points.length, 1, 'same standing re-synced must not duplicate');
});
