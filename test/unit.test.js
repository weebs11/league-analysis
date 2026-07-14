// Unit tests for the core modules. Run with `npm test`.
// Uses Node's built-in test runner — no extra dependencies.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Keep tests hermetic: never read the user's real config.json or API key.
delete process.env.ANTHROPIC_API_KEY;
process.env.LOL_COACH_CONFIG = path.join(os.tmpdir(), `lol-coach-unit-${process.pid}.json`);

const ddragon = await import('../src/ddragon.js');
const { normalizeChampSelect, normalizeLiveGame } = await import('../src/gamestate.js');
const fallback = await import('../src/fallback.js');
const mock = await import('../src/mock.js');
const coach = await import('../src/coach.js');

before(async () => {
  // Needs network on first ever run; afterwards served from data/cache.
  await ddragon.init();
});

// ---- ddragon ----------------------------------------------------------------

test('ddragon: champion lookups work by name, ddragon id, and numeric key', () => {
  assert.equal(ddragon.champByName('Miss Fortune').id, 'MissFortune');
  assert.equal(ddragon.champByName('MissFortune').id, 'MissFortune'); // ddragon id form
  const jinx = ddragon.champByName('Jinx');
  assert.equal(ddragon.champByNumericKey(jinx.key).id, 'Jinx');
  assert.equal(ddragon.champByName('Not A Champion'), null);
  assert.ok(ddragon.allChampions().length > 150, 'expected the full champion roster');
});

test('ddragon: champion details include passive, 4 spells, and tips', async () => {
  const d = await ddragon.champDetails('Garen');
  assert.deepEqual(d.spells.map((s) => s.key), ['Q', 'W', 'E', 'R']);
  assert.ok(d.passive.name.length > 0);
  assert.ok(Array.isArray(d.enemytips));
  assert.ok(Array.isArray(d.allytips));
  assert.equal(await ddragon.champDetails('NotAChampion'), null);
});

test('ddragon: item ids resolve to names', () => {
  assert.equal(ddragon.itemName(1055), "Doran's Blade");
  assert.match(ddragon.itemName(999999999), /^Item /);
});

test('ddragon: artwork urls point at the app, not the CDN', () => {
  const urls = ddragon.imageUrls('Jinx');
  assert.ok(urls.square.startsWith('/img/champion/square/'));
  assert.ok(urls.splash.startsWith('/img/champion/splash/'));
});

test('ddragon: championImage fetches art and rejects bad input', async () => {
  const img = await ddragon.championImage('square', 'Jinx');
  assert.equal(img.type, 'image/png');
  assert.ok(img.data.length > 1000, 'expected real image bytes');
  assert.equal(await ddragon.championImage('square', '../../etc/passwd'), null);
  assert.equal(await ddragon.championImage('bogus-kind', 'Jinx'), null);
});

// ---- gamestate normalizers ----------------------------------------------------

test('gamestate: normalizeChampSelect maps an LCU session', () => {
  const key = (n) => ddragon.champByName(n).key;
  const session = {
    localPlayerCellId: 0,
    myTeam: [
      { cellId: 0, championId: key('Jinx'), assignedPosition: 'bottom' },
      { cellId: 1, championId: key('Thresh'), assignedPosition: 'utility' },
    ],
    theirTeam: [
      { cellId: 5, championId: key('Caitlyn') },
      { cellId: 6, championId: 0 }, // not picked yet
    ],
    bans: { myTeamBans: [key('Yasuo')], theirTeamBans: [] },
    timer: { phase: 'BAN_PICK' },
  };
  const cs = normalizeChampSelect(session);
  assert.equal(cs.me.champion.id, 'Jinx');
  assert.equal(cs.me.role, 'ADC (Bot)');
  assert.equal(cs.me.isMe, true);
  assert.equal(cs.myTeam[1].champion.id, 'Thresh');
  assert.equal(cs.theirTeam[0].champion.id, 'Caitlyn');
  assert.equal(cs.theirTeam[1].champion, null);
  assert.equal(cs.theirTeam[1].locked, false);
  assert.equal(cs.bans[0].id, 'Yasuo');
  assert.equal(normalizeChampSelect(null), null);
  assert.equal(normalizeChampSelect({}), null);
});

test('gamestate: normalizeLiveGame maps Live Client data', () => {
  const mk = (name, team, position) => ({
    championName: name,
    team,
    position,
    level: 3,
    isDead: false,
    items: [{ itemID: 1055, displayName: "Doran's Blade" }],
    scores: { kills: 1, deaths: 0, assists: 2, creepScore: 25 },
    summonerName: `${name} P`,
    riotIdGameName: `${name} P`,
  });
  const data = {
    activePlayer: { riotIdGameName: 'Miss Fortune P', level: 3, currentGold: 500.7 },
    allPlayers: [
      mk('Miss Fortune', 'ORDER', 'BOTTOM'),
      mk('Leona', 'ORDER', 'UTILITY'),
      mk('Ezreal', 'CHAOS', 'BOTTOM'),
      mk('Zed', 'CHAOS', 'MIDDLE'),
    ],
    gameData: { gameMode: 'CLASSIC', gameTime: 300.5 },
  };
  const g = normalizeLiveGame(data);
  assert.equal(g.me.champion.id, 'MissFortune');
  assert.equal(g.me.isMe, true);
  assert.equal(g.me.role, 'ADC (Bot)');
  assert.deepEqual(g.allies.map((p) => p.champion.id), ['MissFortune', 'Leona']);
  assert.deepEqual(g.enemies.map((p) => p.champion.id), ['Ezreal', 'Zed']);
  assert.equal(g.gameTime, 300);
  assert.equal(g.activePlayer.gold, 500);
  assert.equal(g.me.items[0].name, "Doran's Blade");
  assert.equal(normalizeLiveGame(null), null);
  assert.equal(normalizeLiveGame({ allPlayers: [] }), null);
});

// ---- demo scenarios -------------------------------------------------------------

test('mock: every scenario builds complete game and champ select snapshots', () => {
  const scenarios = mock.scenarioList();
  assert.equal(scenarios.length, 3);
  for (const s of scenarios) {
    const g = mock.buildGameSnapshot(s.id);
    assert.equal(g.allies.length, 5, `${s.id}: 5 allies`);
    assert.equal(g.enemies.length, 5, `${s.id}: 5 enemies`);
    assert.ok(g.me?.champion?.id, `${s.id}: player champion resolves`);
    for (const p of [...g.allies, ...g.enemies]) {
      assert.ok(p.champion?.id, `${s.id}: champion ${p.summonerName} resolves in ddragon`);
    }
    const cs = mock.buildChampSelectSnapshot(s.id);
    assert.ok(cs.me?.champion?.id);
    assert.equal(cs.myTeam.length, 5);
    assert.equal(cs.theirTeam.length, 5);
  }
  assert.equal(mock.buildGameSnapshot('nope'), null);
  assert.equal(mock.buildChampSelectSnapshot('nope'), null);
});

// ---- fallback (basic mode) coach ---------------------------------------------------

test('fallback: basic game plan covers all enemies with riot data', async () => {
  const plan = await fallback.generateBasicGamePlan(mock.buildGameSnapshot('botlane'));
  assert.equal(plan.basicMode, true);
  assert.equal(plan.enemyThreats.length, 5);
  assert.ok(['Mostly Physical', 'Mostly Magic', 'Mixed'].includes(plan.itemization.enemyDamageProfile));
  for (const t of plan.enemyThreats) {
    assert.ok(t.champion, 'threat names its champion');
    assert.ok(t.keyAbilities.length >= 1, `${t.champion}: has ability breakdown`);
    assert.ok(t.howToPlayAgainst.length > 0, `${t.champion}: has counterplay advice`);
  }
  assert.ok(plan.glossary.length >= 1);
  assert.ok(plan.itemization.defensiveAdvice.length > 0);
});

test('fallback: jungle scenario flags enemy healing (Soraka/Warwick)', async () => {
  const plan = await fallback.generateBasicGamePlan(mock.buildGameSnapshot('jungle'));
  assert.match(plan.itemization.defensiveAdvice, /Grievous Wounds/i, 'anti-heal lesson should trigger');
});

test('fallback: basic champ select briefing lists passive + QWER', async () => {
  const advice = await fallback.generateBasicChampSelect(mock.buildChampSelectSnapshot('top'));
  assert.equal(advice.basicMode, true);
  assert.deepEqual(advice.yourChampion.abilities.map((a) => a.key), ['Passive', 'Q', 'W', 'E', 'R']);
  assert.ok(advice.knownEnemies.length >= 1, 'visible enemy picks are covered');
  assert.doesNotMatch(advice.yourChampion.playstyleSummary, /Uses None/, 'manaless champs read cleanly');
});

// ---- AI coach guardrails -------------------------------------------------------------

test('coach: cleanly refuses without an API key', async () => {
  assert.equal(coach.aiAvailable(), false);
  await assert.rejects(
    coach.generateGamePlan(mock.buildGameSnapshot('top')),
    (e) => e instanceof coach.CoachError && e.code === 'no_api_key'
  );
  await assert.rejects(
    coach.chat([{ role: 'user', content: 'hi' }], null, null),
    (e) => e instanceof coach.CoachError && e.code === 'no_api_key'
  );
});

test('coach: error descriptions are user-friendly', () => {
  assert.equal(coach.describeApiError(new coach.CoachError('x', 'Custom message')), 'Custom message');
  assert.match(coach.describeApiError(new Error('boom')), /Unexpected error: boom/);
});
