(function exposeRankChartLayout(root) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
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
        .filter((point) => Number.isFinite(Number(point.at)))
        .sort((a, b) => Number(a.at) - Number(b.at))
        .map((point) => ({ ...point, chartX: Number(point.at) })),
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
      .map((game) => ({ ...game, chartX: Number(game.at) }));

    const gameEntries = projectedGames.map((game, pointIndex) => ({
      kind: 'game',
      queueId: game.queueId,
      queueIndex: -1,
      pointIndex,
      point: game,
      day: dayIdentity(game.at),
    }));
    const entries = [...rankEntries, ...gameEntries]
      .sort((a, b) => Number(a.point.at) - Number(b.point.at));

    const groups = new Map();
    for (const entry of entries) {
      if (!groups.has(entry.day.key)) {
        groups.set(entry.day.key, { ...entry.day, entries: [] });
      }
      groups.get(entry.day.key).entries.push(entry);
      entry.point.dayKey = entry.day.key;
    }

    const days = [...groups.values()]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((day) => {
        const positions = day.entries.map((entry) => entry.point.chartX);
        return {
          key: day.key,
          ordinal: day.ordinal,
          at: day.at,
          center: positions.reduce((sum, value) => sum + value, 0) / positions.length,
          minX: Math.min(...positions),
          maxX: Math.max(...positions),
          pointCount: positions.length,
          gameCount: day.entries.filter((entry) => entry.kind === 'game').length,
          snapshotCount: day.entries.filter((entry) => entry.kind === 'snapshot').length,
        };
      });

    const positions = entries.map((entry) => entry.point.chartX);
    const minX = positions.length ? Math.min(...positions) : Date.now();
    const maxX = positions.length ? Math.max(...positions) : minX;
    const span = maxX - minX;
    const padding = span ? Math.min(DAY_MS / 2, Math.max(30 * 60 * 1000, span * 0.01)) : DAY_MS / 2;

    return {
      queues: projected,
      games: projectedGames,
      days,
      xExtent: [minX - padding, maxX + padding],
      firstAt: entries.length ? Number(entries[0].point.at) : null,
      lastAt: entries.length ? Number(entries[entries.length - 1].point.at) : null,
    };
  }

  function windowForPreset(layout, preset) {
    if (preset === 'all' || !Number.isFinite(layout.lastAt)) return [...layout.xExtent];
    const duration = Math.max(1, Number(preset)) * DAY_MS;
    if (layout.lastAt - layout.firstAt <= duration) return [...layout.xExtent];
    return [layout.lastAt - duration, layout.xExtent[1]];
  }

  function daysInWindow(layout, start, end) {
    return (layout.days || []).filter((day) => day.maxX >= start && day.minX <= end);
  }

  function matchesInWindow(layout, start, end) {
    return (layout.games || []).filter((game) => game.chartX >= start && game.chartX <= end);
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
    matchesInWindow,
    isCertainTransition,
  });
})(globalThis);
