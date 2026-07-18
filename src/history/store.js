// The only module that touches the match archive on disk.
//
// Two things live here and they have very different rules:
//
//   raw/    the Archive — the system of record. A payload is written once per
//           source and never mutated. Holds matches that exist nowhere else,
//           because the LCU serves only a 20-match rolling window.
//   index   derived, disposable, and always rebuildable from raw/. If it ever
//           disagrees with the Archive, the Archive wins.
import fs from 'fs/promises';
import path from 'path';
import * as P from './paths.js';
import { normalize } from './normalize.js';

export const SCHEMA_VERSION = 1;

let indexCache = null; // IndexRow[] sorted by playedAt desc

// ---- low-level io ----------------------------------------------------------

// Write via a temp file + rename so a crash mid-write can never leave a
// half-written file behind for the next read to choke on.
//
// The temp name must be unique per call. A fixed `${file}.tmp` looks fine until
// two writers overlap: both truncate the same temp, the first rename moves it
// away, and the second fails with ENOENT. That is reachable — the History view
// loads the summary and the list in parallel, and on a cold cache both rebuild
// the index.
let tmpCounter = 0;
async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---- raw archive -----------------------------------------------------------

// Assembles the container view callers expect — { matchId, owner, sources } —
// from the per-Source files on disk. Nothing stores that shape; it is derived.
export async function readRaw(matchId) {
  if (!P.isValidMatchId(matchId)) return null;
  const sources = {};
  let owner = null;
  for (const source of P.SOURCES) {
    const rec = await readJson(P.sourcePath(matchId, source));
    if (!rec) continue;
    sources[source] = { fetchedAt: rec.fetchedAt, payload: rec.payload };
    owner = owner || rec.owner || null;
  }
  if (!Object.keys(sources).length) return null;
  return { matchId, schemaVersion: SCHEMA_VERSION, owner, sources };
}

// Cheaper than readRaw when all you need is "do I already have this?" — it is
// called once per match on every sync, before any 31KB detail fetch.
export async function hasSource(matchId, source) {
  if (!P.isValidMatchId(matchId) || !P.SOURCES.includes(source)) return false;
  try {
    await fs.access(P.sourcePath(matchId, source));
    return true;
  } catch {
    return false;
  }
}

// Adds one source to a match's container. Existing sources are never touched:
// the two sources carry different fields (the LCU has no usable timeline
// deltas, match-v5 has no per-window data in the match endpoint), so replacing
// rather than accumulating would silently lose data.
// `owner` ({ puuid, gameName, tagLine }) records which account the match belongs
// to. Written once, on first touch. One player per install today, but a smurf on
// the same machine stays separable without a migration.
export async function writeSource(matchId, source, payload, owner = null) {
  if (!P.isValidMatchId(matchId)) throw new Error(`invalid matchId: ${matchId}`);
  if (!P.SOURCES.includes(source)) throw new Error(`unknown source: ${source}`);

  // `wx` fails if the file exists, atomically, at the OS level. That single flag
  // is the whole write-once guarantee: "already present" and "someone else won
  // the race" are the same outcome, and neither can destroy stored data. No
  // read-modify-write means no lock is needed — which matters because the import
  // script is a separate process that an in-process lock could never cover.
  const record = { matchId, source, fetchedAt: Date.now(), owner: owner?.puuid ? owner : null, payload };
  await fs.mkdir(P.rawDir, { recursive: true });
  try {
    await fs.writeFile(P.sourcePath(matchId, source), JSON.stringify(record, null, 2), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

export async function listMatchIds() {
  try {
    const entries = await fs.readdir(P.rawDir);
    const ids = new Set(); // a match has one file per source; dedupe to one id
    for (const name of entries) {
      const parsed = P.parseSourceFile(name);
      if (parsed) ids.add(parsed.matchId);
    }
    return [...ids];
  } catch {
    return [];
  }
}

// ---- coaching records ------------------------------------------------------

export async function writeCoaching(matchId, record) {
  if (!P.isValidMatchId(matchId)) throw new Error(`invalid matchId: ${matchId}`);
  await writeJsonAtomic(P.coachingPath(matchId), record);
}

export async function readCoaching(matchId) {
  if (!P.isValidMatchId(matchId)) return null;
  return readJson(P.coachingPath(matchId));
}

async function coachingIds() {
  try {
    const entries = await fs.readdir(P.coachingDir);
    return new Set(entries.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
  } catch {
    return new Set();
  }
}

// ---- index -----------------------------------------------------------------

function sortRows(rows) {
  return rows.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
}

// Serializes index mutations within this process. The Archive needs no lock
// (writeSource is atomic-create), but the index is a single file that several
// callers rewrite wholesale, and two overlapping rewrites would interleave.
let indexWork = Promise.resolve();
function queueIndexWork(fn) {
  const run = indexWork.then(fn, fn);
  indexWork = run.then(() => {}, () => {});
  return run;
}

// Full rescan of the Archive. This is the migration story: any change to the
// normalizers or the row shape is applied by running this, not by rewriting
// stored data.
export function rebuildIndex() {
  return queueIndexWork(doRebuildIndex);
}

async function doRebuildIndex() {
  const ids = await listMatchIds();
  const withCoaching = await coachingIds();
  const rows = [];
  for (const id of ids) {
    const container = await readRaw(id);
    if (!container) continue;
    const row = normalize(container, { hasCoachingRecord: withCoaching.has(id) });
    if (row) rows.push(row);
  }
  sortRows(rows);
  indexCache = rows;
  await writeJsonAtomic(P.indexPath, { schemaVersion: SCHEMA_VERSION, rows });
  return rows;
}

export function loadIndex() {
  // Fast path: no queueing once the cache is warm, which is every request after
  // the first.
  if (indexCache) return Promise.resolve(indexCache);
  return queueIndexWork(async () => {
    // Re-check inside the queue: a rebuild may have landed while we waited, and
    // without this two parallel first-requests each trigger a full rescan.
    if (indexCache) return indexCache;
    const onDisk = await readJson(P.indexPath);
    if (onDisk && onDisk.schemaVersion === SCHEMA_VERSION && Array.isArray(onDisk.rows)) {
      indexCache = sortRows(onDisk.rows);
      return indexCache;
    }
    // Missing, unparseable, or written by an older schema — rebuild rather than
    // trusting it. The Archive is the source of truth.
    return doRebuildIndex();
  });
}

export async function upsertIndexRows(rows) {
  if (!rows?.length) return loadIndex();
  const current = await loadIndex();
  return queueIndexWork(async () => {
    const byId = new Map((indexCache || current).map((r) => [r.matchId, r]));
    for (const r of rows) byId.set(r.matchId, r);
    indexCache = sortRows([...byId.values()]);
    await writeJsonAtomic(P.indexPath, { schemaVersion: SCHEMA_VERSION, rows: indexCache });
    return indexCache;
  });
}

// Re-derives a single match's row from the Archive and merges it in. Used after
// a sync writes a new source.
export async function refreshRow(matchId) {
  const container = await readRaw(matchId);
  if (!container) return null;
  const withCoaching = await coachingIds();
  const row = normalize(container, { hasCoachingRecord: withCoaching.has(matchId) });
  if (row) await upsertIndexRows([row]);
  return row;
}

// ---- sync state ------------------------------------------------------------

const DEFAULT_SYNC_STATE = {
  schemaVersion: SCHEMA_VERSION,
  puuid: null,
  gameName: null,
  tagLine: null,
  platformId: null,
  lastForwardSyncAt: null,
  lastImportAt: null,
  importComplete: false,
  // Resume state for the import script: a stable anchor timestamp plus the index
  // of the next fixed-width window to walk. Both null when no import is in
  // flight. See scripts/import-history.mjs for why windows are not calendar months.
  importAnchor: null,
  importCursorWindow: null,
};

export async function readSyncState() {
  const s = await readJson(P.syncStatePath);
  return { ...DEFAULT_SYNC_STATE, ...(s || {}) };
}

export async function writeSyncState(patch) {
  const next = { ...(await readSyncState()), ...patch, schemaVersion: SCHEMA_VERSION };
  await writeJsonAtomic(P.syncStatePath, next);
  return next;
}

// ---- rank history ----------------------------------------------------------

// Append-only log of rank snapshots, one array in one file. Unlike the Archive
// this is *our own observation*, not Riot data that exists nowhere else — losing
// it loses a graph, not matches — so a plain atomic rewrite is enough and the
// write-once machinery would be overkill. Growth is bounded by play rate: a
// snapshot is only appended when the rank actually changed, so even a heavy
// season is a few thousand small rows.
export async function readRankHistory() {
  const rows = await readJson(P.rankHistoryPath);
  return Array.isArray(rows) ? rows : [];
}

export async function appendRankSnapshots(snapshots) {
  if (!snapshots.length) return [];
  const rows = await readRankHistory();
  rows.push(...snapshots);
  await writeJsonAtomic(P.rankHistoryPath, rows);
  return rows;
}

// Test seam: drops the in-memory index so the next read comes off disk.
export function _resetCache() {
  indexCache = null;
}
