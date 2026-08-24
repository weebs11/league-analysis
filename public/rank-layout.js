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

  // Typical spacing between ranked games, used to size the lead-in room ahead
  // of the game sequence. The median ignores the overnight gaps that would
  // otherwise make one slot swallow a whole session.
  function typicalGameGap(games) {
    const gaps = games.slice(1)
      .map((game, index) => Number(game.at) - Number(games[index].at))
      .filter((gap) => gap > 0)
      .sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 30 * 60 * 1000;
  }

  // Fraction of one slot to hold back an observation recorded before the first
  // game. Strictly increasing in elapsed time and always short of a full slot,
  // so however far back the lead-in runs it never reaches game one.
  function slotOverhang(elapsed, gap) {
    const distance = Math.max(0, Number(elapsed));
    return 0.95 * (distance / (distance + gap));
  }

  // The game scale: every ranked game owns one equal-width slot, the nth game
  // at x=n. A snapshot takes the slot of the game it followed — it records
  // where you stood after that game — so consecutive post-game snapshots come
  // out exactly one slot apart whatever the clock did in between, and the axis
  // measures games rather than the whitespace between sessions. Two snapshots
  // with no ranked game between them share a slot, which is the honest reading:
  // the LP moved without a game to attribute it to.
  function gamePosition(at, games, gap) {
    if (!games.length) return 1;
    const time = Number(at);
    let played = 0;
    while (played < games.length && Number(games[played].at) <= time) played += 1;
    // Nothing to attach a pre-history snapshot to, so it keeps an ordered
    // sliver of the slot ahead of game one instead of landing on it.
    if (played === 0) return 1 - slotOverhang(Number(games[0].at) - time, gap);
    return played;
  }

  function layoutQueues(queues, games = []) {
    const projected = queues.map((queue) => ({
      ...queue,
      points: [...(queue.points || [])]
        .filter((point) => Number.isFinite(Number(point.at)))
        .sort((a, b) => Number(a.at) - Number(b.at))
        .map((point) => ({ ...point, chartX: Number(point.at) })),
    }));
    const projectedGames = [...games]
      .filter((game) => Number.isFinite(Number(game.at)))
      .sort((a, b) => Number(a.at) - Number(b.at))
      .map((game, index) => ({ ...game, chartX: Number(game.at), gameX: index + 1 }));
    const gameGap = typicalGameGap(projectedGames);
    for (const queue of projected) {
      for (const point of queue.points) {
        point.gameX = gamePosition(point.at, projectedGames, gameGap);
      }
    }
    const rankEntries = projected.flatMap((queue, queueIndex) =>
      queue.points.map((point, pointIndex) => ({
        kind: 'snapshot',
        queueId: queue.queueId,
        queueIndex,
        pointIndex,
        point,
        day: dayIdentity(point.at),
      })));

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
        const slots = day.entries.map((entry) => entry.point.gameX);
        return {
          key: day.key,
          ordinal: day.ordinal,
          at: day.at,
          center: positions.reduce((sum, value) => sum + value, 0) / positions.length,
          minX: Math.min(...positions),
          maxX: Math.max(...positions),
          minGameX: Math.min(...slots),
          maxGameX: Math.max(...slots),
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
    const slots = entries.map((entry) => entry.point.gameX);
    const minSlot = slots.length ? Math.min(...slots) : 0;
    const maxSlot = slots.length ? Math.max(...slots) : 0;

    return {
      queues: projected,
      games: projectedGames,
      days,
      xExtent: [minX - padding, maxX + padding],
      gameExtent: [minSlot - 0.5, maxSlot + 0.5],
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

  // Window covering the most recent `count` ranked games, in slot space: the
  // game scale measures games, so the window is the last `count` slots plus the
  // half-slot margin the extent already uses. Exactly `count` games land inside
  // it however far apart they were played.
  function windowForGames(layout, count) {
    const games = layout.games || [];
    if (!games.length || games.length <= count) return [...layout.gameExtent];
    return [games[games.length - count].gameX - 0.5, layout.gameExtent[1]];
  }

  // `space` names the projection the bounds are expressed in: 'time' for real
  // timestamps, 'games' for slots.
  function daysInWindow(layout, start, end, space = 'time') {
    const [low, high] = space === 'games' ? ['minGameX', 'maxGameX'] : ['minX', 'maxX'];
    return (layout.days || []).filter((day) => day[high] >= start && day[low] <= end);
  }

  function matchesInWindow(layout, start, end, space = 'time') {
    const key = space === 'games' ? 'gameX' : 'chartX';
    return (layout.games || []).filter((game) => game[key] >= start && game[key] <= end);
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
    windowForGames,
    daysInWindow,
    matchesInWindow,
    isCertainTransition,
  });
})(globalThis);
