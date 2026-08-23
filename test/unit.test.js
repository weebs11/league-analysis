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
const lanecompare = await import('../src/lanecompare.js');
const mock = await import('../src/mock.js');
const coach = await import('../src/coach.js');
const briefings = await import('../src/briefings.js');

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

test('ddragon: roster excludes LoL Classic variants and has no duplicate names', () => {
  const champs = ddragon.allChampions();
  const classic = champs.filter((c) => c.id.startsWith('Jade_') || c.key >= 60000);
  assert.deepEqual(classic, [], 'LoL Classic (Jade_) entries must be filtered out');
  const names = champs.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate display names');
  // The live entry, not the Classic one, must win the by-name lookup.
  assert.equal(ddragon.champByName('Ahri').key, 103);
});

test('ddragon: champion details include passive, 4 spells, and tips', async () => {
  const d = await ddragon.champDetails('Garen');
  assert.deepEqual(d.spells.map((s) => s.key), ['Q', 'W', 'E', 'R']);
  assert.ok(d.passive.name.length > 0);
  assert.ok(Array.isArray(d.enemytips));
  assert.ok(Array.isArray(d.allytips));
  assert.equal(await ddragon.champDetails('NotAChampion'), null);
});

test('ddragon: champion details carry per-rank cooldowns for every spell', async () => {
  const d = await ddragon.champDetails('Garen');
  for (const s of d.spells) {
    assert.ok(s.cooldowns.length >= 1, `${s.key} has at least one rank`);
    assert.ok(s.cooldowns.every((c) => typeof c === 'number' && c >= 0), `${s.key} cooldowns are seconds`);
  }
  // Basic abilities rank to 5; the ultimate to 3.
  assert.equal(d.spells[0].cooldowns.length, 5);
  assert.equal(d.spells[3].cooldowns.length, 3);
});

test('ddragon: champion index entries carry base stats', () => {
  const cait = ddragon.champByName('Caitlyn');
  assert.ok(cait.stats, 'index entries keep the Data Dragon stats block');
  assert.ok(cait.stats.hp > 400 && cait.stats.hpperlevel > 0);
  assert.equal(cait.stats.attackrange, 650, 'Caitlyn keeps the longest base range in the game');
  assert.ok(cait.stats.attackdamage > 0 && cait.stats.armor > 0 && cait.stats.movespeed > 0);
  // Every champion has the block — the lane comparison depends on it.
  assert.ok(ddragon.allChampions().every((c) => c.stats && c.stats.hp > 0));
});

test('ddragon: champion details carry base stats and per-rank costs', async () => {
  const d = await ddragon.champDetails('Caitlyn');
  assert.ok(d.stats.hp > 400);
  const q = d.spells[0];
  assert.ok(Array.isArray(q.costs) && q.costs.length >= 1, 'Q carries per-rank costs');
  assert.ok(q.costs.every((c) => typeof c === 'number' && c >= 0));
});

test('ddragon: item lookup carries ids, gold, and stat lines for tooltips', () => {
  const list = ddragon.itemLookup();
  assert.ok(list.length > 150, 'covers the purchasable catalog');
  for (const it of list) {
    assert.ok(it.id > 0 && it.name.length > 0 && typeof it.gold === 'number');
    assert.ok(Array.isArray(it.stats));
  }
  const ie = list.find((i) => i.name === 'Infinity Edge');
  assert.ok(ie.gold > 1000, 'legendary items carry their gold cost');
  assert.ok(ie.stats.length >= 1 && ie.stats.some((s) => /\d/.test(s)), 'stat lines carry numbers');
  assert.ok(list.some((i) => i.name === "Doran's Blade"), 'starter items included');
});

test('ddragon: item ids resolve to names', () => {
  assert.equal(ddragon.itemName(1055), "Doran's Blade");
  assert.match(ddragon.itemName(999999999), /^Item /);
});

test('ddragon: item catalog lists current-patch purchasable items for the coach', () => {
  const catalog = ddragon.itemCatalogText();
  assert.ok(catalog.length > 10000, 'catalog has real content');
  const lines = catalog.split('\n');
  assert.ok(lines.length > 150, `expected the full SR shop, got ${lines.length} items`);
  assert.ok(lines.every((l) => /^- .+ \(\d+g, (Completed|Component|Boots|Consumable)\): /.test(l)), 'every line is well-formed');
  // Staples that exist in every patch.
  assert.ok(catalog.includes("- Doran's Blade ("), 'includes starter items');
  assert.ok(/^- Boots \(/m.test(catalog), 'includes boots');
  // One name per item — no Ornn masterwork or duplicate-id variants.
  const names = lines.map((l) => l.match(/^- (.+?) \(\d+g/)[1]);
  assert.equal(new Set(names).size, names.length, 'no duplicate item names');
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
    summonerSpells: {
      summonerSpellOne: { displayName: 'Flash' },
      summonerSpellTwo: { displayName: 'Heal' },
    },
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
  assert.deepEqual(g.me.spells, ['Flash', 'Heal'], 'summoner spells reach the coach context');
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

// ---- level-1 lane comparison ---------------------------------------------------

test('lanecompare: pairs every lane by role and flags the player\'s own', async () => {
  const cmp = await lanecompare.compareGame(mock.buildGameSnapshot('botlane'));
  assert.equal(cmp.lanes.length, 5, 'all five lanes paired');
  assert.deepEqual(cmp.lanes.map((l) => l.role), ['Top', 'Jungle', 'Mid', 'ADC (Bot)', 'Support']);
  const mine = cmp.lanes.find((l) => l.isMyLane);
  assert.equal(mine.role, 'ADC (Bot)');
  assert.equal(mine.ally.champion.name, 'Jinx');
  assert.equal(mine.enemy.champion.name, 'Caitlyn');
  assert.equal(cmp.lanes.filter((l) => l.isMyLane).length, 1, 'exactly one lane is mine');
  assert.ok(cmp.patch, 'reports the patch the stats came from');
});

test('lanecompare: rows carry formatted level-1 values with a winner per stat', async () => {
  const cmp = await lanecompare.compareGame(mock.buildGameSnapshot('botlane'));
  const mine = cmp.lanes.find((l) => l.isMyLane);
  const byId = Object.fromEntries(mine.rows.map((r) => [r.id, r]));
  // Values match Data Dragon exactly — this view must be verifiable by hand.
  const jinx = ddragon.champByName('Jinx').stats;
  const cait = ddragon.champByName('Caitlyn').stats;
  assert.equal(byId.hp.ally, String(jinx.hp));
  assert.equal(byId.hp.enemy, String(cait.hp));
  assert.equal(byId.range.enemy, String(cait.attackrange));
  assert.equal(byId.range.better, 'enemy', 'Caitlyn out-ranges Jinx at level 1');
  // Derived math: DPS = AD × AS, effective HP folds in resists.
  assert.equal(byId.dps.ally, (Math.round(jinx.attackdamage * jinx.attackspeed * 10) / 10).toString().replace(/\.0$/, ''));
  assert.ok(Number(byId.ehpphys.ally) > jinx.hp);
  for (const lane of cmp.lanes) {
    assert.ok(lane.rows.length >= 10, 'full stat sheet per lane');
    assert.ok(lane.rows.every((r) => ['ally', 'enemy', null].includes(r.better)));
    assert.ok(['ally', 'enemy', 'even'].includes(lane.verdict.side));
    assert.ok(lane.verdict.drivers.length <= 3);
    assert.ok(lane.ally.resource.length > 0 && lane.enemy.resource.length > 0);
  }
});

test('lanecompare: verdicts are deterministic and spells decorate best-effort', async () => {
  const game = mock.buildGameSnapshot('botlane');
  const [a, b] = await Promise.all([lanecompare.compareGame(game), lanecompare.compareGame(game)]);
  assert.deepEqual(a, b, 'same game in, same comparison out — no model, no randomness');
  const mine = a.lanes.find((l) => l.isMyLane);
  // With the Data Dragon cache primed, rank-1 cooldowns are present.
  assert.equal(mine.ally.spells.length, 4);
  assert.deepEqual(mine.ally.spells.map((s) => s.key), ['Q', 'W', 'E', 'R']);
  assert.ok(mine.ally.spells.every((s) => s.cooldown === null || s.cooldown >= 0));
});

test('lanecompare: role gaps fall back to list order instead of dropping champions', async () => {
  const game = mock.buildGameSnapshot('botlane');
  for (const p of [...game.allies, ...game.enemies]) p.role = ''; // no position data at all
  const cmp = await lanecompare.compareGame(game);
  assert.equal(cmp.lanes.length, 5, 'all five pairs still form');
  assert.ok(cmp.lanes.every((l) => l.ally.champion.id && l.enemy.champion.id));
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

// ---- briefing library ---------------------------------------------------------

test('briefings: library is present and covers the current roster', () => {
  const info = briefings.libraryInfo();
  assert.ok(info, 'briefing library is shipped with the repo');
  assert.ok(info.count > 150, `expected the full roster, got ${info.count}`);
  const missing = ddragon.allChampions().filter((c) => !briefings.getBriefing(c.id)).map((c) => c.id);
  // Champions released after the library was generated are allowed to be
  // missing (they fall back to basic mode) — but only a handful.
  assert.ok(missing.length <= 3, `too many uncovered champions: ${missing.join(', ')}`);
});

test('briefings: every briefing has the full structure', () => {
  for (const c of ddragon.allChampions()) {
    const b = briefings.getBriefing(c.id);
    if (!b) continue; // roster drift is covered by the test above
    assert.deepEqual(b.abilities.map((a) => a.key), ['Passive', 'Q', 'W', 'E', 'R'], c.id);
    assert.ok(b.playstyleSummary.length > 30, `${c.id}: playstyleSummary`);
    assert.ok(b.whatToExpect.length > 30, `${c.id}: whatToExpect`);
    assert.ok(b.earlyGamePlan.length > 30, `${c.id}: earlyGamePlan`);
    assert.ok(b.strengths.length >= 2 && b.weaknesses.length >= 2, `${c.id}: strengths/weaknesses`);
    assert.ok(b.quickTips.length >= 3, `${c.id}: quickTips`);
    assert.ok(b.glossary.length >= 2, `${c.id}: glossary`);
  }
});

test('briefings: champ select advice assembles from the library', async () => {
  const advice = await briefings.champSelectAdvice(mock.buildChampSelectSnapshot('top'));
  assert.equal(advice.basicMode, false);
  assert.ok(advice.briefingPatch, 'reports the patch it was generated on');
  assert.deepEqual(advice.yourChampion.abilities.map((a) => a.key), ['Passive', 'Q', 'W', 'E', 'R']);
  assert.ok(advice.knownEnemies.length >= 1, 'visible enemy picks are covered');
  assert.ok(advice.knownEnemies.every((e) => e.whatToExpect.length > 0));
  assert.ok(advice.quickTips.length >= 3);
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

test('coach: attachCooldowns decorates called-out abilities with patch data', async () => {
  const game = mock.buildGameSnapshot('top'); // enemies include Darius and Blitzcrank
  const plan = {
    gamePlan: {
      earlyGame: {
        threats: [
          { champion: 'Darius', ability: 'Q', name: 'Decimate', danger: 'x', play: 'y' },
          { champion: 'Darius', ability: 'Passive', name: 'Hemorrhage', danger: 'x', play: 'y' },
          { champion: 'Warwick', ability: 'R', name: 'Infinite Duress', danger: 'x', play: 'y' },
          { champion: 'Not A Champion', ability: 'Q', name: 'x', danger: 'x', play: 'y' },
        ],
      },
    },
    enemyThreats: [
      { champion: 'Blitzcrank', keyAbilities: [{ key: 'Q', name: 'Rocket Grab' }] },
    ],
  };
  await coach.attachCooldowns(plan, game);
  const [q, passive, ult, unknown] = plan.gamePlan.earlyGame.threats;
  assert.ok(q.cooldowns.length >= 1 && q.cooldowns.every((c) => typeof c === 'number' && c >= 0));
  assert.equal(q.unlockLevel, undefined, 'basic abilities carry no unlock level');
  assert.equal(passive.cooldowns, undefined, 'passives have no spell cooldown to attach');
  assert.equal(ult.unlockLevel, 6, 'a standard 3-rank ultimate is tagged as level-6');
  assert.equal(unknown.cooldowns, undefined, 'a name the roster lacks decorates to nothing');
  assert.ok(plan.enemyThreats[0].keyAbilities[0].cooldowns.length >= 1, 'threat-tab abilities get cooldowns too');
  // Guard rails: a plan or game missing whole branches must never throw —
  // decoration failing after a paid generation would turn success into a 502.
  await coach.attachCooldowns({}, {});
});
