// Every filesystem path the match archive uses. Nothing else composes a data
// path by hand — that is what keeps LOL_COACH_DATA_DIR able to redirect the
// whole subsystem, and what keeps tests away from the real archive.
import fs from 'fs';
import path from 'path';
import { dataRoot } from '../config.js';

export const matchesDir = path.join(dataRoot, 'matches');
export const rawDir = path.join(matchesDir, 'raw');
export const coachingDir = path.join(matchesDir, 'coaching');
export const indexPath = path.join(matchesDir, 'index.json');
export const syncStatePath = path.join(matchesDir, 'sync-state.json');

// The only Sources that may reach the filesystem. An allowlist rather than
// sanitising, because these become filenames.
export const SOURCES = ['lcu', 'riot-api'];

// One file per Source, not one per Match.
//
// This is what makes "written once, never mutated" structural instead of
// merely intended: a Source is created with the `wx` flag, which is an atomic
// create-if-not-exists at the OS level, so two writers cannot lose each other's
// data. A single file per Match would need a read-modify-write, and the import
// script runs in its OWN PROCESS — an in-process lock could not have protected
// it. See ADR-0002.
export function sourcePath(matchId, source) {
  return path.join(rawDir, `${matchId}.${source}.json`);
}

export function parseSourceFile(name) {
  const m = name.match(/^([A-Z0-9]{2,8}_\d+)\.([a-z0-9-]+)\.json$/);
  if (!m || !SOURCES.includes(m[2])) return null;
  return { matchId: m[1], source: m[2] };
}

export function coachingPath(matchId) {
  return path.join(coachingDir, `${matchId}.json`);
}

export function ensureDirs() {
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(coachingDir, { recursive: true });
}

// A Match ID is `{platformId}_{gameId}` — the form match-v5 uses natively. The
// LCU reports the two halves separately, so both sources converge here and the
// same game is never stored twice under different names.
export function makeMatchId(platformId, gameId) {
  if (!platformId || gameId === undefined || gameId === null) return null;
  return `${String(platformId).toUpperCase()}_${gameId}`;
}

// Rejects anything that could escape rawDir/coachingDir via a crafted id.
export function isValidMatchId(matchId) {
  return typeof matchId === 'string' && /^[A-Z0-9]{2,8}_\d+$/.test(matchId);
}
