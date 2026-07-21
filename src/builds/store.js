// The only module that touches data/builds on disk. Everything here is a cache
// of op.gg data — regenerable at will, unlike the match Archive. Filenames are
// built from a ddragon-validated champion id plus whitelisted role/tier tokens,
// so no user input ever reaches the filesystem.
import fs from 'fs/promises';
import path from 'path';
import { dataRoot } from '../config.js';
import { ROLES, TIERS } from './extract.js';

const buildsDir = path.join(dataRoot, 'builds');
const championsDir = path.join(buildsDir, 'champions');

function extractPath(championId, role, tier) {
  if (!/^[A-Za-z0-9]+$/.test(championId)) throw new Error(`invalid champion id: ${championId}`);
  if (!ROLES.includes(role)) throw new Error(`unknown role: ${role}`);
  if (!TIERS.includes(tier)) throw new Error(`unknown tier: ${tier}`);
  return path.join(championsDir, `${championId}.${role}.${tier}.json`);
}

function rosterPath(tier) {
  if (!TIERS.includes(tier)) throw new Error(`unknown tier: ${tier}`);
  return path.join(buildsDir, `roster-${tier}.json`);
}

// Same temp+rename idiom as the history store: a crash mid-write can never
// leave a half-written file for the next read to choke on.
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

export function readExtract(championId, role, tier) {
  return readJson(extractPath(championId, role, tier));
}

export function writeExtract(extract) {
  return writeJsonAtomic(extractPath(extract.championId, extract.role, extract.tier), extract);
}

export function readRoster(tier) {
  return readJson(rosterPath(tier));
}

export function writeRoster(roster) {
  return writeJsonAtomic(rosterPath(roster.tier), roster);
}

// Exported with an injectable clock so TTL boundaries are unit-testable.
export function isFresh(fetchedAt, ttlMs, now = Date.now()) {
  return Number.isFinite(fetchedAt) && now - fetchedAt < ttlMs;
}
