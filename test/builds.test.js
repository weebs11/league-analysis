// Champion Database tests: the op.gg payload parsers against checked-in
// fixtures, plus the /api/builds HTTP surface against a mock op.gg server.
// Run with `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Keep tests hermetic: never read the user's real config or write real data.
delete process.env.ANTHROPIC_API_KEY;
process.env.LOL_COACH_CONFIG = path.join(os.tmpdir(), `lol-coach-builds-unit-${process.pid}.json`);

const { extractBuild, extractRoster, ExtractError, ROLES, TIERS } = await import('../src/builds/extract.js');
const { isFresh } = await import('../src/builds/store.js');

const championFixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'opgg-champion-sample.json'), 'utf8'));
const rosterFixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'opgg-roster-sample.json'), 'utf8'));

const CTX = { championId: 'Caitlyn', role: 'adc', tier: 'emerald_plus' };

// ---- extract: champion build ------------------------------------------------

test('extractBuild: parses the fixture into a complete Build Extract', () => {
  const b = extractBuild(championFixture, CTX);
  assert.equal(b.championId, 'Caitlyn');
  assert.equal(b.role, 'adc');
  assert.equal(b.patch, championFixture.meta.version);
  assert.ok(b.fetchedAt > 0);

  // Rune page: keystone + 3 primary, 2 secondary, 3 shards, real style ids.
  assert.equal(b.runes.primaryPerks.length, 4);
  assert.equal(b.runes.subPerks.length, 2);
  assert.equal(b.runes.shards.length, 3);
  for (const style of [b.runes.primaryStyleId, b.runes.subStyleId]) {
    assert.ok(style >= 8000 && style <= 8499, `implausible style id ${style}`);
  }
  assert.notEqual(b.runes.primaryStyleId, b.runes.subStyleId);

  assert.equal(b.spells.ids.length, 2);
  assert.ok(b.startingItems.ids.length >= 1);
  assert.equal(b.boots.ids.length, 1);
  assert.ok(b.coreItems.ids.length >= 2 && b.coreItems.ids.length <= 4);
  assert.ok(b.lateItems.length >= 3, 'expected several late-item options');
  assert.ok(b.lateItems.every((e) => Number.isInteger(e.id) && e.play > 0));

  // Skill order: a Q/W/E/R sequence with a 3-key priority.
  assert.ok(b.skills.order.length >= 9);
  assert.ok(b.skills.order.every((k) => ['Q', 'W', 'E', 'R'].includes(k)));
  assert.equal(b.skills.priority.length, 3);
  assert.ok(b.skills.priority.every((k) => ['Q', 'W', 'E'].includes(k)));

  assert.ok(b.counters.length > 10, 'counters captured for the future matchups view');
});

test('extractBuild: every ranked section carries a sane win rate', () => {
  const b = extractBuild(championFixture, CTX);
  for (const [name, sec] of Object.entries({
    runes: b.runes, spells: b.spells, starting: b.startingItems,
    boots: b.boots, core: b.coreItems, skills: b.skills,
  })) {
    const wr = sec.wins / sec.play;
    assert.ok(wr > 0.3 && wr < 0.7, `${name} WR ${wr} out of band`);
    assert.ok(sec.play > 100, `${name} has a real sample`);
  }
  assert.ok(b.overall.play > 1000);
  assert.ok(b.overall.winRate > 0.3 && b.overall.winRate < 0.7);
});

test('extractBuild: rejects malformed payloads instead of caching garbage', () => {
  assert.throws(() => extractBuild({}, CTX), ExtractError);
  assert.throws(() => extractBuild({ data: {}, meta: { version: '16.14' } }, CTX), ExtractError);

  // Wrong role — op.gg tracks Caitlyn only as ADC.
  assert.throws(() => extractBuild(championFixture, { ...CTX, role: 'jungle' }), ExtractError);

  // A section whose top pick claims a 90% win rate is a broken feed, not data.
  const poisoned = structuredClone(championFixture);
  poisoned.data.runes[0].win = Math.round(poisoned.data.runes[0].play * 0.9);
  assert.throws(() => extractBuild(poisoned, CTX), ExtractError);

  // Shape drift: rune slots not 4/2/3.
  const drifted = structuredClone(championFixture);
  drifted.data.runes[0].primary_rune_ids = [8008];
  assert.throws(() => extractBuild(drifted, CTX), ExtractError);
});

// ---- extract: roster --------------------------------------------------------

test('extractRoster: maps champions to their played roles, primary first', () => {
  const r = extractRoster(rosterFixture, { tier: 'emerald_plus' });
  assert.equal(r.patch, rosterFixture.meta.version);
  assert.ok(r.matchCount > 1000000, 'global roster covers millions of matches');

  const caitlyn = r.champions[51];
  assert.ok(caitlyn, 'Caitlyn present');
  assert.equal(caitlyn.positions[0].role, 'adc');
  assert.ok(caitlyn.positions[0].roleRate > 0.5);

  for (const c of Object.values(r.champions)) {
    for (const p of c.positions) {
      assert.ok(ROLES.includes(p.role));
      assert.ok(p.winRate > 0.3 && p.winRate < 0.7);
    }
    // Primary-first ordering.
    for (let i = 1; i < c.positions.length; i++) {
      assert.ok(c.positions[i - 1].roleRate >= c.positions[i].roleRate);
    }
  }
});

test('extractRoster: rejects payloads with no usable champions', () => {
  assert.throws(() => extractRoster({}, { tier: 'all' }), ExtractError);
  assert.throws(() => extractRoster({ data: [], meta: { version: '16.14' } }, { tier: 'all' }), ExtractError);
  assert.throws(() => extractRoster({ data: [{ nope: 1 }], meta: { version: '16.14' } }, { tier: 'all' }), ExtractError);
});

// ---- store: TTL -------------------------------------------------------------

test('isFresh: TTL boundaries', () => {
  const ttl = 1000;
  assert.equal(isFresh(5000, ttl, 5999), true);
  assert.equal(isFresh(5000, ttl, 6000), false);
  assert.equal(isFresh(undefined, ttl, 6000), false);
  assert.equal(isFresh(null, ttl, 6000), false);
});

// ---- HTTP surface (real server + mock op.gg) --------------------------------

const APP_PORT = 3981;
const OPGG_PORT = 3982;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const tmpConfig = path.join(os.tmpdir(), `lol-coach-builds-config-${process.pid}.json`);
const tmpData = path.join(os.tmpdir(), `lol-coach-builds-data-${process.pid}`);

let appProc;
let opggMock;
const hits = { roster: 0, champion: 0 };

const get = async (p) => {
  const res = await fetch(BASE + p);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body, type };
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
  // Seed the Data Dragon cache so the suite doesn't re-download champion data.
  const realCache = path.join(ROOT, 'data', 'cache');
  if (fs.existsSync(realCache)) fs.cpSync(realCache, path.join(tmpData, 'cache'), { recursive: true });

  opggMock = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${OPGG_PORT}`);
    // Champion builds only exist for caitlyn/adc in this mock — everything the
    // suite requests beyond that is a deliberate failure case.
    if (url.pathname === '/api/GLOBAL/champions/ranked') {
      hits.roster++;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(rosterFixture));
    }
    if (url.pathname === '/api/GLOBAL/champions/ranked/caitlyn/adc') {
      hits.champion++;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(championFixture));
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((resolve) => opggMock.listen(OPGG_PORT, '127.0.0.1', resolve));

  appProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      OPGG_BASE: `http://127.0.0.1:${OPGG_PORT}`,
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
  opggMock?.close();
  fs.rmSync(tmpConfig, { force: true });
  fs.rmSync(tmpData, { recursive: true, force: true });
});

test('builds: champion list merges the full roster with op.gg roles', async () => {
  const { status, body } = await get('/api/builds/champions');
  assert.equal(status, 200);
  assert.ok(body.champions.length > 150, 'full ddragon roster');
  assert.equal(body.dataPatch, rosterFixture.meta.version);
  assert.ok(body.matchCount > 1000000);
  const caitlyn = body.champions.find((c) => c.id === 'Caitlyn');
  assert.deepEqual(caitlyn.roles, ['adc']);
  assert.match(caitlyn.image, /^\/img\/champion\/square\//);
  // Champions the (trimmed) roster doesn't know still render, just without roles.
  assert.ok(body.champions.some((c) => c.roles.length === 0));
  // Sorted for the grid.
  const names = body.champions.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('builds: meta serves full rune trees, shard rows, and filter labels', async () => {
  const { status, body } = await get('/api/builds/meta');
  assert.equal(status, 200);
  assert.equal(body.styles.length, 5, 'five rune trees');
  for (const s of body.styles) {
    assert.equal(s.slots.length, 4, `${s.name} has keystone + 3 rows`);
    assert.match(s.icon, /^\/img\/rune\/\d+$/);
    assert.ok(s.slots[0].length >= 3, 'keystone row');
    assert.ok(s.slots.flat().every((r) => r.name && /^\/img\/rune\/\d+$/.test(r.icon)));
  }
  assert.equal(body.shardRows.length, 3);
  assert.ok(body.shardRows.every((row) => row.length === 3 && row.every((sh) => sh.name)));
  assert.deepEqual(body.roles.map((r) => r.id), ROLES);
  assert.deepEqual(body.tiers.map((t) => t.id), TIERS);
});

test('builds: champion build is decorated and role defaults to the primary', async () => {
  const { status, body } = await get('/api/builds/champion/Caitlyn');
  assert.equal(status, 200);
  assert.equal(body.role, 'adc', 'role defaulted from the roster');
  assert.equal(body.source, 'fresh');
  assert.equal(body.stale, false);
  assert.equal(body.patch, championFixture.meta.version);
  assert.deepEqual(body.roles, ['adc']);

  assert.equal(body.champion.name, 'Caitlyn');
  assert.ok(body.overall.play > 1000);

  // Decoration: ids became { id, name, icon } refs everywhere.
  assert.equal(body.runes.primaryPerks.length, 4);
  assert.ok(body.runes.primaryPerks.every((r) => r.name && /^\/img\/rune\/\d+$/.test(r.icon)));
  assert.ok(body.runes.shards.every((s) => s.name && /^\/img\/shard\/\d+$/.test(s.icon)));
  assert.ok(body.spells.list.every((s) => s.name && /^\/img\/spell\/\d+$/.test(s.icon)));
  assert.ok(body.coreItems.list.every((i) => i.name && /^\/img\/item\/\d+$/.test(i.icon)));
  assert.ok(body.lateItems.every((i) => i.name && i.winRate > 0.3 && i.winRate < 0.7));
  assert.ok(body.runes.winRate > 0.3 && body.runes.winRate < 0.7);
  assert.ok(body.skills.order.length >= 9);
});

test('builds: a second request is served from the cache, not op.gg', async () => {
  const beforeHits = hits.champion;
  const { status, body } = await get('/api/builds/champion/Caitlyn?role=adc');
  assert.equal(status, 200);
  assert.equal(body.source, 'cache');
  assert.equal(hits.champion, beforeHits, 'no new upstream request');
});

test('builds: a stale-but-usable cache is served instantly, revalidated in the background', async () => {
  const extractFile = path.join(tmpData, 'builds', 'champions', 'Caitlyn.adc.emerald_plus.json');
  const cached = JSON.parse(fs.readFileSync(extractFile, 'utf8'));
  cached.fetchedAt = Date.now() - 48 * 60 * 60 * 1000; // past the 24h TTL
  fs.writeFileSync(extractFile, JSON.stringify(cached));
  const beforeHits = hits.champion;

  // The response comes straight off disk — no upstream fetch blocks it.
  const { status, body } = await get('/api/builds/champion/Caitlyn?role=adc');
  assert.equal(status, 200);
  assert.equal(body.source, 'cache');
  assert.equal(body.stale, false);

  // The refresh runs behind the response: op.gg is hit and the extract's
  // fetchedAt is bumped back to fresh, so the next view needs no refresh.
  await waitFor(() => hits.champion > beforeHits, 'background revalidation to hit op.gg');
  await waitFor(() => {
    const after = JSON.parse(fs.readFileSync(extractFile, 'utf8'));
    return isFresh(after.fetchedAt, 24 * 60 * 60 * 1000);
  }, 'the refreshed extract to be persisted');
});

test('builds: unknown champion 404s, unknown role 400s, untracked role 404s', async () => {
  assert.equal((await get('/api/builds/champion/NotAChampion')).status, 404);
  assert.equal((await get('/api/builds/champion/Caitlyn?role=nonsense')).status, 400);
  const offRole = await get('/api/builds/champion/Caitlyn?role=jungle');
  assert.equal(offRole.status, 404);
  assert.deepEqual(offRole.body.roles, ['adc'], 'the error names the tracked roles');
});

test('builds: a forced refresh with op.gg down degrades to labeled stale data', async () => {
  // Kill the mock, then expire the cached extract by rewinding fetchedAt.
  await new Promise((resolve) => opggMock.close(resolve));
  const extractFile = path.join(tmpData, 'builds', 'champions', 'Caitlyn.adc.emerald_plus.json');
  const cached = JSON.parse(fs.readFileSync(extractFile, 'utf8'));
  cached.fetchedAt = Date.now() - 48 * 60 * 60 * 1000;
  fs.writeFileSync(extractFile, JSON.stringify(cached));

  // A plain load serves cache instantly (SWR), so the stale label only surfaces
  // when the user explicitly retries — `refresh=1`, which blocks on op.gg.
  const { status, body } = await get('/api/builds/champion/Caitlyn?role=adc&refresh=1');
  assert.equal(status, 200);
  assert.equal(body.source, 'stale-cache');
  assert.equal(body.stale, true);
  assert.equal(body.patch, championFixture.meta.version, 'stale data is labeled with its patch');

  // A champion with no cache at all gets a readable failure instead.
  const missing = await get('/api/builds/champion/Jhin?role=adc');
  assert.equal(missing.status, 503);
  assert.match(missing.body.error, /aren't available/);
});

test('builds: serves rune, spell, and shard artwork through the local cache', async () => {
  const { body: meta } = await get('/api/builds/meta');
  const perkIcon = meta.styles[0].slots[0][0].icon; // a real keystone for this patch
  const rune = await get(perkIcon);
  assert.equal(rune.status, 200);
  assert.equal(rune.type, 'image/png');
  assert.ok(rune.body.byteLength > 500, 'expected real image bytes');
  const style = await get(meta.styles[0].icon);
  assert.equal(style.status, 200);
  const spell = await get('/img/spell/4'); // Flash
  assert.equal(spell.status, 200);
  assert.equal(spell.type, 'image/png');
  const shard = await get('/img/shard/5008');
  assert.equal(shard.status, 200);
  assert.equal((await get('/img/rune/999999')).status, 404);
  assert.equal((await get('/img/spell/999999')).status, 404);
  assert.equal((await get('/img/shard/999999')).status, 404);
});
