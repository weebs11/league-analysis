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
const { layoutQueues, windowForPreset, daysInWindow, isCertainTransition } = sandbox.RankChartLayout;

const at = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

function queue(points) {
  return {
    queueId: 420,
    points: points.map(([time, value = 600]) => ({ at: time, value })),
  };
}

test('rank layout gives each active day equal horizontal weight regardless of elapsed hours', () => {
  const times = [
    at(2026, 7, 18, 23, 40),
    at(2026, 7, 19, 23, 35),
    at(2026, 7, 23, 6, 5),
  ];
  const layout = layoutQueues([queue(times.map((time) => [time]))]);

  assert.equal(layout.days.length, 3);
  assert.deepEqual(Array.from(layout.queues[0].points, (point) => point.at), times);
  assert.deepEqual(
    Array.from(layout.days, (day) => day.center),
    [1, 3, 5],
  );
  assert.deepEqual(
    Array.from(layout.queues[0].points, (point) => point.chartX),
    [1, 3, 5],
  );
});

test('rank layout preserves game order while containing dense sessions inside one day band', () => {
  const points = Array.from({ length: 24 }, (_, index) => [
    at(2026, 7, 19, 0, index * 2),
    560 + index,
  ]);
  const layout = layoutQueues([queue(points)]);
  const xs = Array.from(layout.queues[0].points, (point) => point.chartX);

  assert.equal(layout.days.length, 1);
  assert.ok(xs.every((x, index) => index === 0 || x > xs[index - 1]));
  assert.ok(Math.max(...xs) - Math.min(...xs) <= 1.5);
  assert.ok(Math.min(...xs) > 0);
  assert.ok(Math.max(...xs) < 2);
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

test('rank layout shares a single day band across multiple queues', () => {
  const layout = layoutQueues([
    queue([[at(2026, 7, 19, 18)]]),
    { queueId: 440, points: [{ at: at(2026, 7, 19, 20), value: 800 }] },
  ]);
  const first = layout.queues[0].points[0].chartX;
  const second = layout.queues[1].points[0].chartX;

  assert.equal(layout.days.length, 1);
  assert.ok(first < 1 && second > 1);
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

test('rank range presets use calendar-day inclusion while plotting only active days', () => {
  const layout = layoutQueues([queue([
    [at(2026, 7, 1)],
    [at(2026, 7, 16)],
    [at(2026, 7, 17)],
    [at(2026, 7, 23)],
  ])]);

  assert.deepEqual(Array.from(windowForPreset(layout, 7)), [4, 8]);
  assert.deepEqual(Array.from(windowForPreset(layout, 'all')), [0, 8]);
  assert.deepEqual(
    Array.from(daysInWindow(layout, 4, 8), (day) => day.key),
    ['2026-07-17', '2026-07-23'],
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
