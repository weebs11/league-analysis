// HTTP surface for match history, mounted at /api/history.
import express from 'express';
import * as store from './store.js';
import * as sync from './sync.js';
import { buildDetail } from './normalize.js';
import { compareToBenchmark } from './benchmarks.js';
import { summarize, filterRows } from './aggregate.js';
import { isValidMatchId } from './paths.js';
import * as ddragon from '../ddragon.js';

export const router = express.Router();

const QUEUE_LABELS = { 420: 'Ranked Solo/Duo', 440: 'Ranked Flex' };

function champImage(championId) {
  return championId ? ddragon.imageUrls(championId).square : null;
}

function decorate(row) {
  return {
    ...row,
    queueLabel: QUEUE_LABELS[row.queueId] || 'Ranked',
    championImage: champImage(row.championId),
    kda: row.deaths === 0 ? null : +((row.kills + row.assists) / row.deaths).toFixed(2),
  };
}

router.get('/matches', async (req, res) => {
  try {
    const all = await store.loadIndex();
    const filtered = filterRows(all, {
      champion: req.query.champion,
      role: req.query.role,
      queue: req.query.queue,
    });
    const page = Math.max(0, Number(req.query.page) || 0);
    const size = Math.min(100, Math.max(1, Number(req.query.size) || 20));
    const start = page * size;
    res.json({
      rows: filtered.slice(start, start + size).map(decorate),
      total: filtered.length,
      page,
      size,
    });
  } catch (err) {
    console.error('history list failed:', err);
    res.status(500).json({ error: 'Could not read match history.' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const all = await store.loadIndex();
    const window = Math.min(100, Math.max(1, Number(req.query.window) || 20));
    const summary = summarize(all, { window });
    summary.topChampions = summary.topChampions.map((c) => ({ ...c, championImage: champImage(c.championId) }));
    res.json(summary);
  } catch (err) {
    console.error('history summary failed:', err);
    res.status(500).json({ error: 'Could not summarize match history.' });
  }
});

router.get('/matches/:matchId', async (req, res) => {
  const { matchId } = req.params;
  if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'Invalid match id.' });
  try {
    const container = await store.readRaw(matchId);
    if (!container) return res.status(404).json({ error: 'Match not found.' });

    const index = await store.loadIndex();
    const row = index.find((r) => r.matchId === matchId);
    const { players, teams, detailSource } = buildDetail(container);
    const coaching = await store.readCoaching(matchId);

    res.json({
      match: row ? decorate(row) : null,
      benchmarks: row ? compareToBenchmark(row) : {},
      players: players.map((p) => ({ ...p, championImage: champImage(p.championId) })),
      teams,
      detailSource,
      coaching,
    });
  } catch (err) {
    console.error('history detail failed:', err);
    res.status(500).json({ error: 'Could not read that match.' });
  }
});

// The LP time series, grouped per queue for the chart. Forward-only by nature:
// points exist from the day tracking started, because historical LP is not
// retrievable from any API (ADR-0006).
router.get('/rank', async (_req, res) => {
  try {
    const rows = await store.readRankHistory();
    const byQueue = new Map();
    for (const row of rows) {
      if (!byQueue.has(row.queueId)) byQueue.set(row.queueId, []);
      byQueue.get(row.queueId).push(row);
    }
    res.json({
      queues: [...byQueue.entries()].map(([queueId, points]) => ({
        queueId,
        queueLabel: QUEUE_LABELS[queueId] || 'Ranked',
        points,
      })),
    });
  } catch (err) {
    console.error('rank history failed:', err);
    res.status(500).json({ error: 'Could not read rank history.' });
  }
});

router.post('/sync', async (_req, res) => {
  const result = await sync.syncForward();
  res.json(result);
});

router.post('/rebuild-index', async (_req, res) => {
  try {
    const rows = await store.rebuildIndex();
    res.json({ rows: rows.length });
  } catch (err) {
    console.error('index rebuild failed:', err);
    res.status(500).json({ error: 'Could not rebuild the index.' });
  }
});
