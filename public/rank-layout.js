(function exposeRankChartLayout(root) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DAY_POINT_SPAN = 1.36;
  const CERTAIN_GAP_MS = 48 * 60 * 60 * 1000;

  function dayIdentity(at) {
    const date = new Date(Number(at));
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    return {
      key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      ordinal: Date.UTC(year, month, day),
      at: new Date(year, month, day, 12).getTime(),
    };
  }

  function layoutQueues(queues, games = []) {
    const projected = queues.map((queue) => ({
      ...queue,
      points: [...(queue.points || [])]
        .sort((a, b) => Number(a.at) - Number(b.at))
        .map((point) => ({ ...point })),
    }));
    const rankEntries = projected.flatMap((queue, queueIndex) =>
      queue.points.map((point, pointIndex) => ({
        kind: 'snapshot',
        queueId: queue.queueId,
        queueIndex,
        pointIndex,
        point,
        day: dayIdentity(point.at),
      })));
    const projectedGames = [...games]
      .filter((game) => Number.isFinite(Number(game.at)))
      .sort((a, b) => Number(a.at) - Number(b.at))
      .map((game) => ({ ...game }));
    const gameEntries = projectedGames.map((game, pointIndex) => ({
      kind: 'game',
      queueId: game.queueId,
      queueIndex: -1,
      pointIndex,
      point: game,
      day: dayIdentity(game.at),
    }));
    const entries = [...rankEntries, ...gameEntries];

    entries.sort((a, b) =>
      Number(a.point.at) - Number(b.point.at)
      || Number(a.queueId) - Number(b.queueId)
      || a.kind.localeCompare(b.kind)
      || a.pointIndex - b.pointIndex);

    const groups = new Map();
    for (const entry of entries) {
      if (!groups.has(entry.day.key)) {
        groups.set(entry.day.key, { ...entry.day, entries: [] });
      }
      groups.get(entry.day.key).entries.push(entry);
    }

    const days = [...groups.values()]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((day, index) => {
        const center = index * 2 + 1;
        const count = day.entries.length;
        day.entries.forEach((entry, entryIndex) => {
          const offset = count === 1
            ? 0
            : -DAY_POINT_SPAN / 2 + DAY_POINT_SPAN * entryIndex / (count - 1);
          entry.point.chartX = center + offset;
          entry.point.dayKey = day.key;
        });
        return {
          key: day.key,
          ordinal: day.ordinal,
          at: day.at,
          center,
          pointCount: count,
          gameCount: day.entries.filter((entry) => entry.kind === 'game').length,
          snapshotCount: day.entries.filter((entry) => entry.kind === 'snapshot').length,
        };
      });

    return {
      queues: projected,
      games: projectedGames,
      days,
      xExtent: days.length ? [0, days.length * 2] : [0, 1],
      firstAt: entries.length ? Number(entries[0].point.at) : null,
      lastAt: entries.length ? Number(entries[entries.length - 1].point.at) : null,
    };
  }

  function windowForPreset(layout, preset) {
    const days = layout.days || [];
    if (!days.length || preset === 'all') return [...layout.xExtent];
    const finalDay = days[days.length - 1];
    const cutoff = finalDay.ordinal - Math.max(0, Number(preset) - 1) * DAY_MS;
    const firstDay = days.find((day) => day.ordinal >= cutoff) || finalDay;
    return [firstDay.center - 1, finalDay.center + 1];
  }

  function daysInWindow(layout, start, end) {
    return (layout.days || []).filter((day) => day.center > start && day.center < end);
  }

  function isCertainTransition(from, to) {
    const fromSource = from?.source === 'opgg' ? 'opgg' : 'forward-sync';
    const toSource = to?.source === 'opgg' ? 'opgg' : 'forward-sync';
    if (fromSource !== 'forward-sync' || toSource !== 'forward-sync') return false;
    if (Number(to.at) - Number(from.at) > CERTAIN_GAP_MS) return false;

    const fromRecord = Number(from.wins) + Number(from.losses);
    const toRecord = Number(to.wins) + Number(to.losses);
    if (Number.isFinite(fromRecord) && Number.isFinite(toRecord)) {
      const games = toRecord - fromRecord;
      if (games < 0 || games > 1) return false;
    }
    return true;
  }

  root.RankChartLayout = Object.freeze({
    layoutQueues,
    windowForPreset,
    daysInWindow,
    isCertainTransition,
  });
})(globalThis);
