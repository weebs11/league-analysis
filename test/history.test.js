// Unit tests for the match history subsystem.
//
// The normalizer tests run against payloads captured from a real League client
// (test/fixtures), because the shapes Riot actually sends differ from the
// documented ones in ways that already caused three wrong assumptions: empty
// timeline deltas, unreliable lane data, and win being a string in one place
// and a boolean in another.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

// Point the whole subsystem at a throwaway directory BEFORE anything imports
// config.js. The real archive holds matches that exist nowhere else, so a test
// run must not be able to reach it.
const TMP_DATA = path.join(os.tmpdir(), `lol-coach-history-${process.pid}`);
process.env.LOL_COACH_DATA_DIR = TMP_DATA;
process.env.LOL_COACH_CONFIG = path.join(TMP_DATA, 'config.json');
delete process.env.ANTHROPIC_API_KEY;
fs.mkdirSync(TMP_DATA, { recursive: true });
// Seed the Data Dragon cache from the real one so an isolated data dir doesn't
// mean re-downloading champion data on every run.
const realCache = path.join(ROOT, 'data', 'cache');
if (fs.existsSync(realCache)) fs.cpSync(realCache, path.join(TMP_DATA, 'cache'), { recursive: true });

const ddragon = await import('../src/ddragon.js');
const paths = await import('../src/history/paths.js');
const store = await import('../src/history/store.js');
const { normalize, buildDetail } = await import('../src/history/normalize.js');
const { normalizeLcu, deriveRoles, playersFromLcu, teamsFromLcu } = await import('../src/history/normalize-lcu.js');
const { durationSeconds } = await import('../src/history/normalize-riot.js');
const { patchOf } = await import('../src/history/normalize-shared.js');
const { csPerMinute } = await import('../src/history/normalize-shared.js');
const { windowRange } = await import('../scripts/import-history.mjs');
const { compareToBenchmark, benchmarkFor } = await import('../src/history/benchmarks.js');
const { summarize, playableRows, filterRows } = await import('../src/history/aggregate.js');

const readFixture = (n) => JSON.parse(fs.readFileSync(path.join(FIXTURES, n), 'utf8'));
const detailFixture = readFixture('lcu-match-detail.json');
const listFixture = readFixture('lcu-matchlist.json');
const summonerFixture = readFixture('lcu-current-summoner.json');
const OWNER = { puuid: summonerFixture.puuid, gameName: summonerFixture.gameName, tagLine: summonerFixture.tagLine };

const containerFor = (payload) => ({
  matchId: paths.makeMatchId(payload.platformId, payload.gameId),
  schemaVersion: 1,
  owner: OWNER,
  sources: { lcu: { fetchedAt: Date.now(), payload } },
});

before(async () => {
  // Needs network on first ever run; afterwards served from the disk cache.
  await ddragon.init();
});

// ---- paths / identity -------------------------------------------------------

test('paths: match ids are derived from platform + game id, and uppercased', () => {
  assert.equal(paths.makeMatchId('na1', 5603939853), 'NA1_5603939853');
  assert.equal(paths.makeMatchId('EUW1', 1), 'EUW1_1');
  assert.equal(paths.makeMatchId(null, 5), null);
  assert.equal(paths.makeMatchId('NA1', null), null);
});

test('paths: match id validation rejects anything that could escape the archive dir', () => {
  assert.ok(paths.isValidMatchId('NA1_5603939853'));
  for (const bad of ['../etc/passwd', 'NA1_5603/../x', 'NA1-5603', '', 'NA1_', '_123', 'NA1_12a', null]) {
    assert.equal(paths.isValidMatchId(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

// ---- role derivation --------------------------------------------------------

test('normalize-lcu: every team gets each of the five roles exactly once', () => {
  const players = playersFromLcu(detailFixture);
  for (const teamId of [100, 200]) {
    const roles = players.filter((p) => p.teamId === teamId).map((p) => p.role).sort();
    assert.deepEqual(roles, ['ADC', 'Jungle', 'Mid', 'Support', 'Top'],
      `team ${teamId} must have a complete, unique role set`);
  }
});

test('normalize-lcu: Smite wins the jungle role even when lane data disagrees', () => {
  // The real payload reports lane JUNGLE for two players on one team, which is
  // exactly the case that used to produce two junglers and no support.
  const lanes = detailFixture.participants.map((p) => p.timeline?.lane);
  const jungleLanes = lanes.filter((l) => l === 'JUNGLE').length;
  assert.ok(jungleLanes > 2, 'fixture should contain the ambiguous lane data this guards against');

  const roles = deriveRoles(detailFixture.participants);
  const smiters = detailFixture.participants.filter((p) => p.spell1Id === 11 || p.spell2Id === 11);
  for (const p of smiters) {
    assert.equal(roles.get(p.participantId), 'Jungle', 'a Smite holder must be the jungler');
  }
});

test('normalize-lcu: timeline deltas in real payloads are empty, so nothing may read them', () => {
  for (const p of detailFixture.participants) {
    for (const key of ['csDiffPerMinDeltas', 'xpDiffPerMinDeltas', 'creepsPerMinDeltas', 'goldPerMinDeltas']) {
      assert.equal(Object.keys(p.timeline?.[key] || {}).length, 0,
        `${key} is expected to be empty — if Riot starts populating it, revisit ADR-0004`);
    }
  }
  const row = normalizeLcu(detailFixture, OWNER.puuid);
  assert.equal(row.csDiffAt10, null, 'csDiffAt10 must stay null on LCU-only matches');
  assert.equal(row.damagePerMinute, null);
});

// ---- normalization ----------------------------------------------------------

test('normalize-lcu: produces a complete row for the archive owner', () => {
  const row = normalizeLcu(detailFixture, OWNER.puuid);
  assert.equal(row.matchId, `NA1_${detailFixture.gameId}`);
  assert.equal(row.puuid, OWNER.puuid);
  assert.equal(row.queueId, 420);
  assert.equal(typeof row.win, 'boolean');
  assert.equal(row.role, 'ADC');
  assert.equal(row.championName, 'Caitlyn');
  assert.ok(row.cs > 0 && row.csPerMin > 0);
  assert.equal(row.items.length, 7);
  assert.equal(row.isRemake, false);
});

test('normalize-lcu: lane differential is computed against the opposing laner', () => {
  const row = normalizeLcu(detailFixture, OWNER.puuid);
  const players = playersFromLcu(detailFixture);
  const me = players.find((p) => p.puuid === OWNER.puuid);
  const opp = players.find((p) => p.teamId !== me.teamId && p.role === me.role);
  assert.ok(opp, 'an opposing laner should be resolvable');
  assert.equal(row.csDiffVsLaneOpponent, me.cs - opp.cs);
});

test('normalize-lcu: kill participation and damage share come from the full team', () => {
  const row = normalizeLcu(detailFixture, OWNER.puuid);
  const players = playersFromLcu(detailFixture);
  const me = players.find((p) => p.puuid === OWNER.puuid);
  const team = players.filter((p) => p.teamId === me.teamId);
  const teamKills = team.reduce((n, p) => n + p.kills, 0);
  assert.equal(row.teamKills, teamKills);
  assert.equal(row.killParticipation, +((me.kills + me.assists) / teamKills).toFixed(3));
  assert.ok(row.damageShare > 0 && row.damageShare <= 1);
});

test('normalize-lcu: returns null when the owner did not play in the match', () => {
  assert.equal(normalizeLcu(detailFixture, 'not-a-participant-puuid'), null);
});

test('normalize-lcu: teams block converts the "Win"/"Fail" string to a boolean', () => {
  const teams = teamsFromLcu(detailFixture);
  assert.equal(teams.length, 2);
  for (const t of teams) assert.equal(typeof t.win, 'boolean');
  assert.equal(teams.filter((t) => t.win).length, 1, 'exactly one team wins');
  assert.ok(teams.some((t) => t.bans.length > 0));
});

test('normalize: patch is the first two segments of the game version', () => {
  assert.equal(patchOf('16.14.794.5912'), '16.14');
  assert.equal(patchOf('16.14'), '16.14');
  assert.equal(patchOf(''), null);
  assert.equal(patchOf(undefined), null);
});

test('normalize-riot: duration is seconds with an end timestamp and ms without', () => {
  assert.equal(durationSeconds({ gameDuration: 1572, gameEndTimestamp: 1 }), 1572);
  assert.equal(durationSeconds({ gameDuration: 1572000 }), 1572);
});

test('normalize: match-v5 values win, LCU fills the gaps it leaves', () => {
  const container = containerFor(detailFixture);
  const lcuOnly = normalize(container, {});
  assert.deepEqual(lcuOnly.sources, ['lcu']);
  assert.equal(lcuOnly.csDiffAt10, null);

  // A minimal match-v5 payload carrying only the fields the LCU cannot supply.
  container.sources['riot-api'] = {
    fetchedAt: Date.now(),
    payload: {
      metadata: { matchId: container.matchId },
      info: {
        gameCreation: detailFixture.gameCreation,
        gameDuration: detailFixture.gameDuration,
        gameEndTimestamp: 1,
        gameVersion: detailFixture.gameVersion,
        queueId: 420,
        participants: [{
          puuid: OWNER.puuid, championId: 51, championName: 'Caitlyn', teamId: 200,
          teamPosition: 'BOTTOM', win: false, kills: 0, deaths: 10, assists: 5,
          totalMinionsKilled: 141, neutralMinionsKilled: 0, goldEarned: 7608,
          totalDamageDealtToChampions: 8301, visionScore: 7, champLevel: 12,
          challenges: { maxCsAdvantageOnLaneOpponent: 12.4, damagePerMinute: 317.2 },
        }],
        teams: [],
      },
    },
  };
  const merged = normalize(container, { hasCoachingRecord: true });
  assert.deepEqual(merged.sources.sort(), ['lcu', 'riot-api']);
  assert.equal(merged.csDiffAt10, 12, 'challenge field should now be populated');
  assert.equal(merged.damagePerMinute, 317);
  assert.equal(merged.hasCoachingRecord, true);
  // Kept from the LCU, which match-v5 did not override here.
  assert.equal(merged.championName, 'Caitlyn');
});

test('normalize: detail prefers match-v5 when both sources are present', () => {
  const container = containerFor(detailFixture);
  assert.equal(buildDetail(container).detailSource, 'lcu');
  assert.equal(buildDetail(container).players.length, 10);
  container.sources['riot-api'] = { fetchedAt: 1, payload: { metadata: {}, info: { participants: [], teams: [] } } };
  assert.equal(buildDetail(container).detailSource, 'riot-api');
});

// ---- remakes ----------------------------------------------------------------

test('remakes: short games are flagged even though Riot reports GameComplete with a win', () => {
  const short = listFixture.games.games.find((g) => g.gameDuration < 300);
  assert.ok(short, 'the captured list should contain at least one remake');
  assert.equal(short.endOfGameResult, 'GameComplete', 'nothing in the payload marks it as special');

  const payload = { ...detailFixture, gameId: short.gameId, gameDuration: short.gameDuration };
  assert.equal(normalizeLcu(payload, OWNER.puuid).isRemake, true);
});

test('remakes: excluded from aggregates but not from the list', () => {
  const rows = [
    { matchId: 'NA1_1', win: true, isRemake: false, csPerMin: 6, role: 'ADC', championId: 'Ashe', playedAt: 3 },
    { matchId: 'NA1_2', win: false, isRemake: true, csPerMin: 0.4, role: 'ADC', championId: 'Ashe', playedAt: 2 },
    { matchId: 'NA1_3', win: true, isRemake: false, csPerMin: 8, role: 'ADC', championId: 'Ashe', playedAt: 1 },
  ];
  assert.equal(playableRows(rows).length, 2);
  const s = summarize(rows, { window: 20 });
  assert.equal(s.record.wins, 2);
  assert.equal(s.record.losses, 0);
  assert.equal(s.record.winrate, 1, 'the remake loss must not count against winrate');
  assert.equal(s.baseline.csPerMin.current, 7, 'the remake CS must not drag the average');
});

// ---- benchmarks -------------------------------------------------------------

test('benchmarks: compares only stats that are meaningful for the role', () => {
  const cmp = compareToBenchmark({ role: 'ADC', csPerMin: 8.1, visionScore: 12, killParticipation: 0.7 });
  assert.equal(cmp.csPerMin.direction, 'above');
  assert.equal(cmp.visionScore.direction, 'below');
  assert.equal(cmp.killParticipation.direction, 'above');
});

test('benchmarks: Support has no CS target, so CS is omitted rather than compared to nothing', () => {
  assert.equal(benchmarkFor('Support').csPerMin, null);
  const cmp = compareToBenchmark({ role: 'Support', csPerMin: 1.2, visionScore: 60, killParticipation: 0.7 });
  assert.equal(cmp.csPerMin, undefined);
  assert.equal(cmp.visionScore.direction, 'above');
});

test('benchmarks: jungle counts camps as well as lane minions', () => {
  assert.equal(benchmarkFor('Jungle').csFormula, 'camps+lane');
  assert.equal(benchmarkFor('ADC').csFormula, 'lane');
});

test('benchmarks: a null stat is skipped, never treated as zero', () => {
  const cmp = compareToBenchmark({ role: 'ADC', csPerMin: null, visionScore: 20, killParticipation: null });
  assert.equal(cmp.csPerMin, undefined);
  assert.equal(cmp.killParticipation, undefined);
  assert.equal(cmp.visionScore.value, 20);
  assert.deepEqual(compareToBenchmark({ role: null, csPerMin: 5 }), {});
});

// ---- aggregates -------------------------------------------------------------

test('aggregate: trends are suppressed until there are enough games', () => {
  const few = Array.from({ length: 5 }, (_, i) => ({ matchId: `NA1_${i}`, win: true, isRemake: false, csPerMin: 6, role: 'ADC', playedAt: i }));
  assert.equal(summarize(few).insufficientData, true);
  const many = Array.from({ length: 12 }, (_, i) => ({ matchId: `NA1_${i}`, win: true, isRemake: false, csPerMin: 6, role: 'ADC', playedAt: i }));
  assert.equal(summarize(many).insufficientData, false);
});

test('aggregate: the trend compares the current window against the one before it', () => {
  const mk = (i, cs) => ({ matchId: `NA1_${i}`, win: true, isRemake: false, csPerMin: cs, role: 'ADC', playedAt: 1000 - i });
  const rows = [...Array.from({ length: 5 }, (_, i) => mk(i, 8)), ...Array.from({ length: 5 }, (_, i) => mk(i + 5, 6))];
  const s = summarize(rows, { window: 5 });
  assert.equal(s.baseline.csPerMin.current, 8);
  assert.equal(s.baseline.csPerMin.previous, 6);
  assert.equal(s.baseline.csPerMin.delta, 2);
});

test('aggregate: top champions are ranked by games played', () => {
  const rows = [
    { matchId: 'NA1_1', win: true, isRemake: false, role: 'ADC', championId: 'Ashe', championName: 'Ashe', playedAt: 3 },
    { matchId: 'NA1_2', win: false, isRemake: false, role: 'ADC', championId: 'Ashe', championName: 'Ashe', playedAt: 2 },
    { matchId: 'NA1_3', win: true, isRemake: false, role: 'Mid', championId: 'Zed', championName: 'Zed', playedAt: 1 },
  ];
  const s = summarize(rows);
  assert.equal(s.topChampions[0].championId, 'Ashe');
  assert.equal(s.topChampions[0].games, 2);
  assert.equal(s.topChampions[0].winrate, 0.5);
  assert.equal(s.role, 'ADC', 'primary role drives which benchmark set the strip uses');
});

test('aggregate: filters narrow by champion, role, and queue', () => {
  const rows = [
    { matchId: 'NA1_1', championId: 'Ashe', championName: 'Ashe', role: 'ADC', queueId: 420 },
    { matchId: 'NA1_2', championId: 'Zed', championName: 'Zed', role: 'Mid', queueId: 440 },
  ];
  assert.equal(filterRows(rows, { champion: 'ashe' }).length, 1);
  assert.equal(filterRows(rows, { role: 'Mid' })[0].matchId, 'NA1_2');
  assert.equal(filterRows(rows, { queue: '420' })[0].matchId, 'NA1_1');
  assert.equal(filterRows(rows, {}).length, 2);
});

// ---- store ------------------------------------------------------------------

test('store: a source is written once and never overwritten', async () => {
  const id = 'NA1_900000001';
  assert.equal(await store.writeSource(id, 'lcu', detailFixture, OWNER), true);
  assert.equal(await store.writeSource(id, 'lcu', { different: true }, OWNER), false, 'second write must be a no-op');
  const raw = await store.readRaw(id);
  assert.equal(raw.sources.lcu.payload.gameId, detailFixture.gameId, 'original payload survives');
  assert.equal(raw.owner.puuid, OWNER.puuid);
});

test('store: adding a second source keeps the first intact', async () => {
  const id = 'NA1_900000002';
  await store.writeSource(id, 'lcu', detailFixture, OWNER);
  await store.writeSource(id, 'riot-api', { metadata: { matchId: id }, info: { participants: [] } }, OWNER);
  const raw = await store.readRaw(id);
  assert.deepEqual(Object.keys(raw.sources).sort(), ['lcu', 'riot-api']);
  assert.ok(raw.sources.lcu.payload.participants.length === 10);
});

test('store: refuses match ids that would escape the archive directory', async () => {
  await assert.rejects(() => store.writeSource('../escape', 'lcu', {}, OWNER));
  assert.equal(await store.readRaw('../escape'), null);
});

test('store: the index is rebuildable from the archive alone', async () => {
  const id = paths.makeMatchId(detailFixture.platformId, detailFixture.gameId);
  await store.writeSource(id, 'lcu', detailFixture, OWNER);

  const built = await store.rebuildIndex();
  assert.ok(built.some((r) => r.matchId === id));

  // Deleting the derived index must lose nothing.
  fs.rmSync(paths.indexPath, { force: true });
  store._resetCache();
  const reloaded = await store.loadIndex();
  assert.deepEqual(
    reloaded.map((r) => r.matchId).sort(),
    built.map((r) => r.matchId).sort(),
    'rebuild from raw/ must reproduce the same set of matches'
  );
});

test('store: index rows are ordered newest first', async () => {
  const rows = await store.loadIndex();
  const times = rows.map((r) => r.playedAt || 0);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('store: sync state round-trips and defaults are sane', async () => {
  const fresh = await store.readSyncState();
  assert.equal(fresh.importComplete, false);
  await store.writeSyncState({ puuid: 'abc', platformId: 'NA1' });
  const back = await store.readSyncState();
  assert.equal(back.puuid, 'abc');
  assert.equal(back.platformId, 'NA1');
  assert.equal(back.importComplete, false, 'unrelated fields survive a partial write');
});

// ---- concurrency ------------------------------------------------------------
//
// These cover the class of bug the rest of this suite cannot: everything else
// exercises one caller at a time, and the archive has two writers by design —
// the running app and the import script, in separate processes.

test('store: concurrent writes of different sources both survive', async () => {
  const id = 'NA1_900000010';
  const results = await Promise.all([
    store.writeSource(id, 'lcu', detailFixture, OWNER),
    store.writeSource(id, 'riot-api', { metadata: { matchId: id }, info: { participants: [] } }, OWNER),
  ]);
  assert.deepEqual(results, [true, true]);
  const raw = await store.readRaw(id);
  assert.deepEqual(Object.keys(raw.sources).sort(), ['lcu', 'riot-api'],
    'a read-modify-write would have silently dropped one of these — and the LCU payload is unrecoverable');
});

test('store: concurrent writes of the same source — exactly one wins, payload intact', async () => {
  const id = 'NA1_900000011';
  const results = await Promise.all(
    Array.from({ length: 8 }, () => store.writeSource(id, 'lcu', detailFixture, OWNER))
  );
  assert.equal(results.filter(Boolean).length, 1, 'create-if-not-exists means exactly one writer succeeds');
  const raw = await store.readRaw(id);
  assert.equal(raw.sources.lcu.payload.gameId, detailFixture.gameId);
  assert.equal(raw.sources.lcu.payload.participants.length, 10, 'payload is whole, not interleaved');
});

test('store: parallel index loads neither collide nor leave temp files behind', async () => {
  store._resetCache();
  fs.rmSync(paths.indexPath, { force: true });
  // Mirrors refreshHistory(), which loads the summary and the list in parallel:
  // on a cold cache both used to trigger a full rebuild onto one temp path.
  const results = await Promise.all(Array.from({ length: 6 }, () => store.loadIndex()));
  assert.equal(new Set(results.map((r) => r.length)).size, 1, 'every caller sees the same index');
  assert.ok(fs.existsSync(paths.indexPath));
  const strays = fs.readdirSync(paths.matchesDir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(strays, [], 'no orphaned temp files');
});

test('store: a partial write never leaves a readable half-file', async () => {
  // rebuild + upsert racing each other must still leave valid JSON on disk.
  await Promise.all([store.rebuildIndex(), store.upsertIndexRows([]), store.rebuildIndex()]);
  const parsed = JSON.parse(fs.readFileSync(paths.indexPath, 'utf8'));
  assert.equal(parsed.schemaVersion, store.SCHEMA_VERSION);
  assert.ok(Array.isArray(parsed.rows));
});

// ---- role-scoped CS ---------------------------------------------------------

test('csPerMin is scoped by role: lane minions for laners, camps too for jungle, null for Support', () => {
  const me = (role) => ({ role, cs: 240, laneCs: 180 });
  const tenMinutes = 600;
  assert.equal(csPerMinute(me('ADC'), tenMinutes), 18, 'a laner is measured on minions only');
  assert.equal(csPerMinute(me('Top'), tenMinutes), 18);
  assert.equal(csPerMinute(me('Jungle'), tenMinutes), 24, 'a jungler is measured on camps + minions');
  assert.equal(csPerMinute(me('Support'), tenMinutes), null, 'Support has no meaningful CS rate');
  assert.equal(csPerMinute(me(null), tenMinutes), 24, 'unresolved role falls back to total farm');
  assert.equal(csPerMinute(me('ADC'), 0), null, 'no duration, no rate');
});

test('aggregate: a Support row with no CS rate does not drag the baseline down', () => {
  const rows = [
    { matchId: 'NA1_1', win: true, isRemake: false, role: 'ADC', csPerMin: 8, playedAt: 3 },
    { matchId: 'NA1_2', win: true, isRemake: false, role: 'Support', csPerMin: null, playedAt: 2 },
  ];
  assert.equal(summarize(rows).baseline.csPerMin.current, 8);
});

// ---- import windowing -------------------------------------------------------

test('import: windows tile exactly from any anchor, leaving no unqueried gap', () => {
  // Calendar-month arithmetic clamped on short months, skipping whole days that
  // were then marked complete and never revisited. Jan 31 is the case that broke.
  const anchors = [
    Date.parse('2027-01-31T12:00:00Z'),
    Date.parse('2026-03-31T00:00:00Z'),
    Date.parse('2026-02-28T23:59:59Z'),
    Date.now(),
  ];
  for (const anchor of anchors) {
    let previousStart = null;
    for (let i = 0; i < 30; i++) {
      const w = windowRange(anchor, i);
      assert.ok(w.start < w.end, 'a window must span forwards');
      if (previousStart !== null) {
        assert.equal(w.end, previousStart, `window ${i} must abut window ${i - 1} exactly (anchor ${new Date(anchor).toISOString()})`);
      }
      previousStart = w.start;
    }
  }
});

test('import: window 0 ends at the anchor and windows walk backwards', () => {
  const anchor = Date.parse('2026-07-18T00:00:00Z');
  assert.equal(windowRange(anchor, 0).end, anchor);
  assert.ok(windowRange(anchor, 5).end < windowRange(anchor, 4).end);
});

test('store: coaching records round-trip and are reflected on the index row', async () => {
  const id = paths.makeMatchId(detailFixture.platformId, detailFixture.gameId);
  await store.writeCoaching(id, { matchId: id, plan: { overview: { summary: 'test plan' } } });
  assert.equal((await store.readCoaching(id)).plan.overview.summary, 'test plan');
  const rows = await store.rebuildIndex();
  assert.equal(rows.find((r) => r.matchId === id).hasCoachingRecord, true);
});

// ---- rank tracking ----------------------------------------------------------

test('rank: ladder values are monotonic across the whole climb', async () => {
  const { ladderValue } = await import('../src/history/rank.js');
  const climb = [
    ladderValue('IRON', 'IV', 0),
    ladderValue('IRON', 'I', 99),
    ladderValue('BRONZE', 'IV', 0),
    ladderValue('GOLD', 'IV', 43),
    ladderValue('DIAMOND', 'I', 99),
    ladderValue('MASTER', null, 0),
    ladderValue('GRANDMASTER', null, 480),
    ladderValue('CHALLENGER', null, 1200),
  ];
  for (let i = 1; i < climb.length; i++) {
    assert.ok(climb[i] > climb[i - 1], `step ${i} must rank above step ${i - 1} (${climb[i - 1]} → ${climb[i]})`);
  }
  assert.equal(ladderValue('GOLD', 'IV', 43), 3 * 400 + 0 + 43);
});

test('rank: snapshots cover ranked queues only, and never fabricate a standing for unranked', async () => {
  const { snapshotsFromRankedStats } = await import('../src/history/rank.js');
  const payload = readFixture('lcu-ranked-stats.json');
  const snaps = snapshotsFromRankedStats(payload, 1000);

  // Fixture: solo GOLD IV 43LP, flex NONE (in placements), plus a TFT entry
  // that must be ignored — TFT rank on an LoL LP graph would be nonsense.
  assert.equal(snaps.length, 1);
  const solo = snaps[0];
  assert.equal(solo.queueId, 420);
  assert.deepEqual(
    { tier: solo.tier, division: solo.division, lp: solo.lp, at: solo.at },
    { tier: 'GOLD', division: 'IV', lp: 43, at: 1000 }
  );
  assert.equal(solo.value, 1243);
});

test('rank: only a changed standing appends — wins count as change even at equal LP', async () => {
  const { snapshotsFromRankedStats, changedSnapshots } = await import('../src/history/rank.js');
  const base = snapshotsFromRankedStats(readFixture('lcu-ranked-stats.json'), 1000);

  // Same standing again → nothing to append.
  assert.equal(changedSnapshots(base, base).length, 0);

  // LP moved → append.
  const lpMoved = base.map((s) => ({ ...s, at: 2000, lp: s.lp + 17, value: s.value + 17 }));
  assert.equal(changedSnapshots(lpMoved, base).length, 1);

  // LP identical but a game was played (dodge, decay compensation): still a
  // point — dropping it would make the line imply the account sat idle.
  const winAtSameLp = base.map((s) => ({ ...s, at: 2000, wins: s.wins + 1 }));
  assert.equal(changedSnapshots(winAtSameLp, base).length, 1);
});

test('rank: history store round-trips and appends in order', async () => {
  const first = { at: 1, queueId: 420, tier: 'GOLD', division: 'IV', lp: 43, wins: 1, losses: 0, value: 1243 };
  const second = { at: 2, queueId: 420, tier: 'GOLD', division: 'IV', lp: 61, wins: 2, losses: 0, value: 1261 };
  await store.appendRankSnapshots([first]);
  await store.appendRankSnapshots([second]);
  const rows = await store.readRankHistory();
  assert.deepEqual(rows.slice(-2), [first, second]);
});

test('rank: recordRankSnapshot resolves to a count and never throws', async () => {
  const { recordRankSnapshot } = await import('../src/history/rank.js');
  // The unit-test env has no mock lockfile, but lcu.js probes real install
  // paths — so on a dev machine with League open this may genuinely record.
  // The contract under test is narrower: it resolves to a number and can never
  // throw into Forward Sync, whatever the client is doing.
  const appended = await recordRankSnapshot();
  assert.equal(typeof appended, 'number');
});
