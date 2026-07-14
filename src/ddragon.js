// Data Dragon client — Riot's free, keyless CDN for champion/item static data.
// Caches everything in memory and on disk (data/cache) so restarts are fast
// and the app keeps working offline once primed.
import fs from 'fs';
import path from 'path';
import { projectRoot } from './config.js';

const CACHE_DIR = path.join(projectRoot, 'data', 'cache');
const BASE = 'https://ddragon.leagueoflegends.com';

let version = null;
let championIndex = null; // { byId, byKey, byName }
const championDetails = new Map(); // ddragon id -> full champion data
let items = null; // itemId -> { name, plaintext, tags, gold }

function cachePath(name) {
  return path.join(CACHE_DIR, name);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Data Dragon request failed: ${res.status} ${url}`);
  return res.json();
}

async function cachedFetch(name, url) {
  const file = cachePath(name);
  try {
    const data = await fetchJson(url);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
  } catch (err) {
    // Network failed — fall back to disk cache if we have one.
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw err;
    }
  }
}

export async function init() {
  try {
    const versions = await fetchJson(`${BASE}/api/versions.json`);
    version = versions[0];
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath('version.json'), JSON.stringify(version));
  } catch {
    try {
      version = JSON.parse(fs.readFileSync(cachePath('version.json'), 'utf8'));
    } catch {
      throw new Error('Cannot reach Data Dragon and no cached data exists. Connect to the internet once to prime the cache.');
    }
  }

  const champJson = await cachedFetch(`champion-${version}.json`, `${BASE}/cdn/${version}/data/en_US/champion.json`);
  const byId = {}; const byKey = {}; const byName = {};
  for (const c of Object.values(champJson.data)) {
    const entry = {
      id: c.id, // e.g. "MissFortune"
      key: Number(c.key), // numeric id used by LCU, e.g. 21
      name: c.name, // display name, e.g. "Miss Fortune"
      title: c.title,
      tags: c.tags, // e.g. ["Marksman"]
      info: c.info, // { attack, defense, magic, difficulty } 0-10
      partype: c.partype,
    };
    byId[entry.id] = entry;
    byKey[entry.key] = entry;
    byName[entry.name.toLowerCase()] = entry;
  }
  championIndex = { byId, byKey, byName };

  const itemJson = await cachedFetch(`item-${version}.json`, `${BASE}/cdn/${version}/data/en_US/item.json`);
  items = itemJson.data;
}

export function getVersion() {
  return version;
}

export function champByNumericKey(key) {
  return championIndex?.byKey[Number(key)] || null;
}

export function champByName(name) {
  if (!name) return null;
  const idx = championIndex;
  if (!idx) return null;
  // Live Client API sends display names ("Miss Fortune"); LCU sends ddragon
  // ids come through details. Try both forms.
  return idx.byName[String(name).toLowerCase()] || idx.byId[name] || null;
}

export function allChampions() {
  return championIndex ? Object.values(championIndex.byId) : [];
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Full per-champion data: abilities, tips, stats. Cached per champion.
export async function champDetails(ddragonId) {
  if (!ddragonId || !championIndex?.byId[ddragonId]) return null;
  if (championDetails.has(ddragonId)) return championDetails.get(ddragonId);
  const raw = await cachedFetch(
    `champ-${ddragonId}-${version}.json`,
    `${BASE}/cdn/${version}/data/en_US/champion/${ddragonId}.json`
  );
  const c = raw.data[ddragonId];
  const keys = ['Q', 'W', 'E', 'R'];
  const detail = {
    id: c.id,
    name: c.name,
    title: c.title,
    tags: c.tags,
    info: c.info,
    partype: c.partype,
    lore: c.blurb,
    passive: { name: c.passive.name, description: stripHtml(c.passive.description).slice(0, 300) },
    spells: c.spells.map((s, i) => ({
      key: keys[i] || '?',
      name: s.name,
      description: stripHtml(s.description).slice(0, 300),
    })),
    allytips: c.allytips || [],
    enemytips: c.enemytips || [],
  };
  championDetails.set(ddragonId, detail);
  return detail;
}

export function itemName(itemId) {
  return items?.[String(itemId)]?.name || `Item ${itemId}`;
}

export function imageUrls(ddragonId) {
  return {
    square: `${BASE}/cdn/${version}/img/champion/${ddragonId}.png`,
    splash: `${BASE}/cdn/img/champion/splash/${ddragonId}_0.jpg`,
    loading: `${BASE}/cdn/img/champion/loading/${ddragonId}_0.jpg`,
  };
}
