import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'public', 'rank-layout.js'), 'utf8');
const sandbox = {};
vm.runInNewContext(source, sandbox, { filename: 'rank-layout.js' });
const {
  layoutQueues,
  windowForPreset,
  windowForGames,
  daysInWindow,
  matchesInWindow,
  isCertainTransition,
} = sandbox.RankChartLayout;

const at = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

function queue(points) {
  return {
    queueId: 420,
    points: points.map(([time, value = 600]) => ({ at: time, value })),
  };
}

test('rank layout uses real elapsed time for horizontal distance', () => {
  const times = [
    at(2026, 7, 18, 23, 40),
    at(2026, 7, 19, 23, 35),
    at(2026, 7, 23, 6, 5),
  ];
  const layout = layoutQueues([queue(times.map((time) => [time]))]);

  assert.equal(layout.days.length, 3);
  assert.deepEqual(Array.from(layout.queues[0].points, (point) => point.at), times);
  const xs = Array.from(layout.queues[0].points, (point) => point.chartX);
  assert.deepEqual(xs, times);
  assert.ok(xs[2] - xs[1] > 3 * (xs[1] - xs[0]), 'a three-day gap must be visibly wider than one day');
});

test('rank layout preserves every observation in a dense session as a readable step', () => {
  const points = Array.from({ length: 24 }, (_, index) => [
    at(2026, 7, 19, 0, index * 2),
    560 + index,
  ]);
  const layout = layoutQueues([queue(points)]);
  const xs = Array.from(layout.queues[0].points, (point) => point.chartX);

  assert.equal(layout.days.length, 1);
  assert.deepEqual(xs, points.map(([time]) => time));
});

test('rank layout preserves the actual timestamps of Matches and Rank Snapshots', () => {
  const games = Array.from({ length: 20 }, (_, index) => ({
    at: at(2026, 7, 19, 8, index * 10),
    queueId: 420,
    win: index % 2 === 0,
    matchId: `match-${index + 1}`,
  }));
  const points = games.map((game, index) => ({
    at: game.at + 5 * 60 * 1000,
    value: 560 + index,
    wins: 100 + Math.ceil((index + 1) / 2),
    losses: 100 + Math.floor((index + 1) / 2),
  }));
  const layout = layoutQueues([{ queueId: 420, points }], games);
  const gameXs = Array.from(layout.games, (game) => game.chartX);
  const snapshotXs = Array.from(layout.queues[0].points, (point) => point.chartX);

  assert.deepEqual(gameXs, games.map((game) => game.at));
  assert.deepEqual(snapshotXs, points.map((point) => point.at));
  assert.ok(snapshotXs.every((value, index) => value > gameXs[index]));
});

test('rank layout does not synthesize LP points inside a catch-up gap', () => {
  const games = Array.from({ length: 6 }, (_, index) => ({
    at: at(2026, 7, 19, 8, index * 10),
    queueId: 420,
    matchId: `match-${index + 1}`,
  }));
  const points = [
    { at: games[0].at + 60_000, value: 600, wins: 50, losses: 50 },
    { at: games[5].at + 60_000, value: 650, wins: 53, losses: 52 },
  ];
  const layout = layoutQueues([{ queueId: 420, points }], games);
  const xs = Array.from(layout.queues[0].points, (point) => point.chartX);

  assert.deepEqual(xs, points.map((point) => point.at));
  assert.equal(layout.queues[0].points.length, 2, 'must not synthesize intermediate LP points');
});

test('rank layout is driven by observation day and order, not LP magnitude', () => {
  const times = [
    at(2026, 7, 18, 20),
    at(2026, 7, 18, 23),
    at(2026, 7, 19, 22),
  ];
  const lowSwing = layoutQueues([queue(times.map((time, index) => [time, 600 + index]))]);
  const highSwing = layoutQueues([queue(times.map((time, index) => [time, 300 + index * 500]))]);

  assert.deepEqual(
    Array.from(lowSwing.queues[0].points, (point) => point.chartX),
    Array.from(highSwing.queues[0].points, (point) => point.chartX),
  );
});

test('rank layout preserves chronological order across multiple queues', () => {
  const layout = layoutQueues([
    queue([[at(2026, 7, 19, 18)]]),
    { queueId: 440, points: [{ at: at(2026, 7, 19, 20), value: 800 }] },
  ]);
  const first = layout.queues[0].points[0].chartX;
  const second = layout.queues[1].points[0].chartX;

  assert.equal(layout.days.length, 1);
  assert.equal(first, at(2026, 7, 19, 18));
  assert.equal(second, at(2026, 7, 19, 20));
});

test('rank layout includes game-only days and projects every archived match', () => {
  const layout = layoutQueues(
    [queue([
      [at(2026, 7, 21, 23), 700],
      [at(2026, 7, 23, 6), 740],
    ])],
    [
      { at: at(2026, 7, 21, 22), queueId: 420, win: false, matchId: 'day-one' },
      ...Array.from({ length: 9 }, (_, index) => ({
        at: at(2026, 7, 22, 12, index * 5),
        queueId: 420,
        win: index % 2 === 0,
        matchId: `day-two-${index}`,
      })),
      { at: at(2026, 7, 23, 5), queueId: 420, win: true, matchId: 'day-three' },
    ],
  );

  assert.deepEqual(
    Array.from(layout.days, (day) => day.key),
    ['2026-07-21', '2026-07-22', '2026-07-23'],
  );
  assert.equal(layout.games.length, 11);
  const middleDay = layout.games.filter((game) => game.dayKey === '2026-07-22');
  assert.equal(middleDay.length, 9);
  assert.ok(middleDay.every((game, index) => index === 0 || game.chartX > middleDay[index - 1].chartX));
});

test('rank range presets select real elapsed calendar time', () => {
  const games = [1, 16, 17, 23].map((day, index) => ({
    at: at(2026, 7, day),
    queueId: 420,
    matchId: `match-${index + 1}`,
  }));
  const layout = layoutQueues([], games);

  const sevenDays = Array.from(windowForPreset(layout, 7));
  assert.equal(sevenDays[0], at(2026, 7, 16));
  assert.equal(sevenDays[1], layout.xExtent[1]);
  assert.deepEqual(Array.from(windowForPreset(layout, 'all')), Array.from(layout.xExtent));
  assert.deepEqual(
    Array.from(daysInWindow(layout, ...sevenDays), (day) => day.key),
    ['2026-07-16', '2026-07-17', '2026-07-23'],
  );
  assert.equal(matchesInWindow(layout, ...sevenDays).length, 3);
});

test('the game scale gives every ranked game an equal slot whatever the clock did', () => {
  // Two games minutes apart, then a two-day break, then two more.
  const games = [
    { at: at(2026, 7, 21, 20, 0), queueId: 420, matchId: 'a' },
    { at: at(2026, 7, 21, 20, 30), queueId: 420, matchId: 'b' },
    { at: at(2026, 7, 23, 21, 0), queueId: 420, matchId: 'c' },
    { at: at(2026, 7, 23, 21, 30), queueId: 420, matchId: 'd' },
  ];
  const layout = layoutQueues([], games);

  assert.deepEqual(Array.from(layout.games, (game) => game.gameX), [0, 1, 2, 3]);
  assert.deepEqual(Array.from(layout.gameExtent), [-0.5, 3.5]);
});

test('the game scale keeps snapshots with the game they followed', () => {
  const games = Array.from({ length: 4 }, (_, index) => ({
    at: at(2026, 7, 19, 8, index * 30),
    queueId: 420,
    matchId: `match-${index + 1}`,
  }));
  // One snapshot a minute after each game, plus a trailing one hours later.
  const points = [
    ...games.map((game, index) => ({ at: game.at + 60_000, value: 600 + index })),
    { at: at(2026, 7, 19, 14), value: 640 },
  ];
  const layout = layoutQueues([{ queueId: 420, points }], games);
  const slots = Array.from(layout.queues[0].points, (point) => point.gameX);

  slots.slice(0, 4).forEach((slot, index) => {
    assert.ok(slot > index && slot < index + 1, `snapshot ${index} must sit just past its game`);
  });
  assert.ok(slots[4] > 3 && slots[4] < 4, 'a trailing snapshot stays inside the last slot');
  assert.ok(slots.every((slot, index) => index === 0 || slot > slots[index - 1]), 'order is preserved');
});

test('a snapshot recorded before the first game stays left of it', () => {
  const games = [{ at: at(2026, 7, 19, 12), queueId: 420, matchId: 'only' }];
  const layout = layoutQueues(
    [{ queueId: 420, points: [{ at: at(2026, 7, 19, 8), value: 600 }] }],
    games,
  );

  const slot = layout.queues[0].points[0].gameX;
  assert.ok(slot < 0 && slot > -1, 'it sits in the half slot before game zero');
  assert.equal(layout.gameExtent[0] < slot, true);
});

test('a game window holds exactly that many games however far apart they were played', () => {
  const games = Array.from({ length: 30 }, (_, index) => ({
    // Ten games a night across three nights: dense sessions, long breaks.
    at: at(2026, 7, 19 + Math.floor(index / 10), 20, (index % 10) * 25),
    queueId: 420,
    matchId: `match-${index + 1}`,
  }));
  const layout = layoutQueues([], games);

  const window = windowForGames(layout, 25);
  assert.equal(matchesInWindow(layout, ...window, 'games').length, 25);
  assert.deepEqual(Array.from(windowForGames(layout, 100)), Array.from(layout.gameExtent));

  // Every one of the 25 gets the same width; on the time axis the same window
  // would have spent most of its room on the two overnight breaks.
  const slots = matchesInWindow(layout, ...window, 'games').map((game) => game.gameX);
  const steps = slots.slice(1).map((slot, index) => slot - slots[index]);
  assert.ok(steps.every((step) => step === 1), 'slots are evenly spaced');

  assert.deepEqual(
    Array.from(daysInWindow(layout, ...window, 'games'), (day) => day.key),
    ['2026-07-19', '2026-07-20', '2026-07-21'],
  );
});

test('rank transitions are uncertain when one snapshot catches up multiple games', () => {
  const before = {
    at: at(2026, 7, 21, 20),
    wins: 169,
    losses: 175,
    source: 'forward-sync',
  };

  assert.equal(isCertainTransition(before, {
    ...before,
    at: at(2026, 7, 21, 21),
    wins: 170,
  }), true);
  assert.equal(isCertainTransition(before, {
    ...before,
    at: at(2026, 7, 23, 6),
    wins: 175,
    losses: 181,
  }), false);
  assert.equal(isCertainTransition(before, {
    ...before,
    at: at(2026, 7, 21, 21),
    source: 'opgg',
  }), false);
});
