// Data Dragon client — Riot's free, keyless CDN for champion/item static data.
// Caches everything in memory and on disk (data/cache) so restarts are fast
// and the app keeps working offline once primed.
import fs from 'fs';
import path from 'path';
import { dataRoot } from './config.js';

const CACHE_DIR = path.join(dataRoot, 'cache');
const BASE = 'https://ddragon.leagueoflegends.com';

let version = null;
let championIndex = null; // { byId, byKey, byName }
const championDetails = new Map(); // ddragon id -> full champion data
let items = null; // itemId -> { name, plaintext, tags, gold }
let itemCatalog = null; // compact text list of purchasable SR items, for the coach
let runes = null; // { byId: perk/style id -> { id, name, icon }, styles: [tree] }
let spells = null; // numeric key -> { id, key, name } (summoner spells)

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
  // Resolve the target patch and fetch everything into locals first; module
  // state is committed only once every fetch has succeeded. A half-applied
  // init would otherwise leave `version` pointing at data we don't hold
  // (see checkForNewPatch, whose catch swallows refresh failures).
  let nextVersion;
  try {
    const versions = await fetchJson(`${BASE}/api/versions.json`);
    nextVersion = versions[0];
  } catch {
    try {
      nextVersion = JSON.parse(fs.readFileSync(cachePath('version.json'), 'utf8'));
    } catch {
      throw new Error('Cannot reach Data Dragon and no cached data exists. Connect to the internet once to prime the cache.');
    }
  }

  const champJson = await cachedFetch(`champion-${nextVersion}.json`, `${BASE}/cdn/${nextVersion}/data/en_US/champion.json`);
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

  const itemJson = await cachedFetch(`item-${nextVersion}.json`, `${BASE}/cdn/${nextVersion}/data/en_US/item.json`);

  // Runes and summoner spells, for the Champion Database. Both indexed by the
  // ids that op.gg/match data use (perk ids, numeric spell keys).
  const runesJson = await cachedFetch(`runes-${nextVersion}.json`, `${BASE}/cdn/${nextVersion}/data/en_US/runesReforged.json`);
  const runesById = {};
  const runeStylesList = [];
  for (const style of runesJson) {
    runesById[style.id] = { id: style.id, name: style.name, icon: style.icon };
    runeStylesList.push({
      id: style.id,
      key: style.key,
      name: style.name,
      icon: style.icon,
      slots: style.slots.map((slot) => slot.runes.map((r) => ({ id: r.id, name: r.name, icon: r.icon }))),
    });
    for (const slot of style.slots) {
      for (const r of slot.runes) runesById[r.id] = { id: r.id, name: r.name, icon: r.icon };
    }
  }

  const summonerJson = await cachedFetch(`summoner-${nextVersion}.json`, `${BASE}/cdn/${nextVersion}/data/en_US/summoner.json`);
  const spellsByKey = {};
  for (const s of Object.values(summonerJson.data)) {
    spellsByKey[Number(s.key)] = { id: s.id, key: Number(s.key), name: s.name };
  }

  // Commit — everything for nextVersion is in hand.
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath('version.json'), JSON.stringify(nextVersion));
  version = nextVersion;
  championIndex = { byId, byKey, byName };
  items = itemJson.data;
  itemCatalog = buildItemCatalog(items);
  runes = { byId: runesById, styles: runeStylesList };
  spells = spellsByKey;
}

export function getVersion() {
  return version;
}

// ---- Item catalog for the AI coach -----------------------------------------
// The coach model's training data predates recent patches, so item advice must
// be grounded in what the shop actually sells right now. This builds a compact
// one-line-per-item listing of every purchasable Summoner's Rift item.

function buildItemCatalog(itemData) {
  // The same item can appear under several ids (e.g. Ornn masterwork variants).
  // Keep one entry per name — the base-shop version with the lowest id.
  const byName = new Map();
  for (const [id, it] of Object.entries(itemData)) {
    if (!it.maps?.['11']) continue; // Summoner's Rift only
    if (it.gold?.purchasable === false) continue;
    if (it.inStore === false) continue;
    if (it.requiredAlly || it.requiredChampion) continue; // Ornn/champion-specific variants
    if (it.hideFromAll) continue;
    const prev = byName.get(it.name);
    if (!prev || Number(id) < Number(prev.id)) byName.set(it.name, { id, it });
  }
  const lines = [...byName.values()].map(({ it }) => {
    const cat = it.tags?.includes('Boots') ? 'Boots'
      : it.tags?.includes('Consumable') ? 'Consumable'
      : it.into?.length ? 'Component'
      : 'Completed';
    const desc = (it.plaintext || stripHtml(it.description)).slice(0, 220);
    return `- ${it.name} (${it.gold.total}g, ${cat}): ${desc}`;
  });
  return lines.join('\n');
}

export function itemCatalogText() {
  return itemCatalog;
}

// ---- Patch auto-refresh -----------------------------------------------------
// The app is meant to be left running for days; without this it would keep
// serving whatever patch was live at startup. Checks hourly and re-inits when
// Riot ships a new version.

const REFRESH_MS = 60 * 60 * 1000;
let refreshTimer = null;
let refreshing = false;

async function checkForNewPatch() {
  if (refreshing) return;
  refreshing = true;
  try {
    const versions = await fetchJson(`${BASE}/api/versions.json`);
    if (versions[0] && versions[0] !== version) {
      console.log(`New League patch detected: ${version} -> ${versions[0]}. Reloading Data Dragon...`);
      // init() commits state only on full success, so a failed refresh leaves
      // the old (consistent) patch data in place. Details are cached under
      // patch-scoped keys, so the clear here is only reclaiming memory —
      // even an in-flight old-patch fetch can't leak into the new patch.
      await init();
      championDetails.clear();
      console.log(`Data Dragon refreshed (patch ${version}).`);
    }
  } catch {
    // Offline or CDN hiccup — keep serving the current data and retry later.
  } finally {
    refreshing = false;
  }
}

export function startAutoRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { checkForNewPatch(); }, REFRESH_MS);
  refreshTimer.unref?.();
}

export function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
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

// Full per-champion data: abilities, tips, stats. Cached per champion + patch —
// keying by patch (pinned before the fetch) means a fetch that started on the
// old patch can't finish after a refresh and pollute the new patch's cache.
export async function champDetails(ddragonId) {
  if (!ddragonId || !championIndex?.byId[ddragonId]) return null;
  const v = version;
  const cacheKey = `${v}:${ddragonId}`;
  if (championDetails.has(cacheKey)) return championDetails.get(cacheKey);
  const raw = await cachedFetch(
    `champ-${ddragonId}-${v}.json`,
    `${BASE}/cdn/${v}/data/en_US/champion/${ddragonId}.json`
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
  championDetails.set(cacheKey, detail);
  return detail;
}

export function itemName(itemId) {
  return items?.[String(itemId)]?.name || `Item ${itemId}`;
}

// ---- Runes, summoner spells, stat shards ------------------------------------

export function runeInfo(id) {
  return runes?.byId[Number(id)] || null;
}

// The full rune trees, in display order — what a rune-page renderer needs.
export function runeStyles() {
  return runes?.styles || [];
}

export function spellByNumericKey(key) {
  return spells?.[Number(key)] || null;
}

// Stat shards are not in Data Dragon at all. They also change once every few
// years, so a hardcoded table beats taking on a third upstream dependency —
// only the icons come from Community Dragon, fetched lazily like all other art.
const SHARD_ICON_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods';
const STAT_SHARDS = {
  5001: { name: 'Health Scaling', icon: 'statmodshealthscalingicon.png' },
  5005: { name: 'Attack Speed', icon: 'statmodsattackspeedicon.png' },
  5007: { name: 'Ability Haste', icon: 'statmodscdrscalingicon.png' },
  5008: { name: 'Adaptive Force', icon: 'statmodsadaptiveforceicon.png' },
  5010: { name: 'Move Speed', icon: 'statmodsmovementspeedicon.png' },
  5011: { name: 'Health', icon: 'statmodshealthplusicon.png' },
  5013: { name: 'Tenacity and Slow Resist', icon: 'statmodstenacityicon.png' },
};
// The three shard slots (offense / flex / defense) as picked in game.
const SHARD_ROWS = [
  [5008, 5005, 5007],
  [5008, 5010, 5001],
  [5011, 5013, 5001],
];

export function shardInfo(id) {
  return STAT_SHARDS[Number(id)] || null;
}

export function shardRows() {
  return SHARD_ROWS;
}

// Artwork is served through the app (/img/champion/...) rather than linking
// the browser straight to Riot's CDN — the server fetches each image once
// and caches it on disk, so art always renders and survives going offline.
export function imageUrls(ddragonId) {
  return {
    square: `/img/champion/square/${ddragonId}`,
    splash: `/img/champion/splash/${ddragonId}`,
    loading: `/img/champion/loading/${ddragonId}`,
  };
}

const IMAGE_KINDS = {
  // Square icons are patch-versioned; splash/loading art lives at an
  // unversioned CDN path.
  square: { url: (id) => `${BASE}/cdn/${version}/img/champion/${id}.png`, type: 'image/png', versioned: true },
  splash: { url: (id) => `${BASE}/cdn/img/champion/splash/${id}_0.jpg`, type: 'image/jpeg', versioned: false },
  loading: { url: (id) => `${BASE}/cdn/img/champion/loading/${id}_0.jpg`, type: 'image/jpeg', versioned: false },
};

const inflightImages = new Map();

// Item icons, cached on disk like champion art. Validating against the item
// catalogue keeps arbitrary ids off the filesystem and the CDN.
export async function itemImage(itemId) {
  const id = String(itemId);
  if (!/^\d{1,6}$/.test(id) || !items?.[id]) return null;
  const file = path.join(CACHE_DIR, 'img', `item-${version}-${id}.png`);
  try {
    return { data: fs.readFileSync(file), type: 'image/png' };
  } catch {
    // not cached yet
  }
  const inflightKey = `item:${id}`;
  if (inflightImages.has(inflightKey)) return inflightImages.get(inflightKey);
  const fetching = (async () => {
    const res = await fetch(`${BASE}/cdn/${version}/img/item/${id}.png`);
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return { data, type: 'image/png' };
  })().finally(() => inflightImages.delete(inflightKey));
  inflightImages.set(inflightKey, fetching);
  return fetching;
}

export async function championImage(kind, ddragonId) {
  const spec = IMAGE_KINDS[kind];
  // Validating the id against the champion index also makes the route safe —
  // only real champion ids ever reach the filesystem or the CDN.
  if (!spec || !championIndex?.byId[ddragonId]) return null;
  const fileName = spec.versioned ? `${kind}-${version}-${ddragonId}` : `${kind}-${ddragonId}`;
  const file = path.join(CACHE_DIR, 'img', fileName);
  try {
    return { data: fs.readFileSync(file), type: spec.type };
  } catch {
    // not cached yet
  }
  const inflightKey = `${kind}:${ddragonId}`;
  if (inflightImages.has(inflightKey)) return inflightImages.get(inflightKey);
  const fetching = (async () => {
    const res = await fetch(spec.url(ddragonId));
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return { data, type: spec.type };
  })().finally(() => inflightImages.delete(inflightKey));
  inflightImages.set(inflightKey, fetching);
  return fetching;
}

// Shared fetch-and-cache for the rune/spell/shard icons below. Same contract as
// the champion/item art: disk cache under data/cache/img, in-flight dedupe, and
// callers validate ids against loaded indexes before any path is built.
async function cachedImage(cacheName, url, type = 'image/png') {
  const file = path.join(CACHE_DIR, 'img', cacheName);
  try {
    return { data: fs.readFileSync(file), type };
  } catch {
    // not cached yet
  }
  if (inflightImages.has(cacheName)) return inflightImages.get(cacheName);
  const fetching = (async () => {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return { data, type };
  })().finally(() => inflightImages.delete(cacheName));
  inflightImages.set(cacheName, fetching);
  return fetching;
}

// Rune icons accept a perk id or a style id. Their CDN paths are unversioned,
// like splash art.
export function runeImage(id) {
  const info = runeInfo(id);
  if (!info) return null;
  return cachedImage(`rune-${info.id}.png`, `${BASE}/cdn/img/${info.icon}`);
}

export function spellImage(numericKey) {
  const s = spellByNumericKey(numericKey);
  if (!s) return null;
  return cachedImage(`spell-${version}-${s.key}.png`, `${BASE}/cdn/${version}/img/spell/${s.id}.png`);
}

export function shardImage(id) {
  const s = shardInfo(id);
  if (!s) return null;
  return cachedImage(`shard-${Number(id)}.png`, `${SHARD_ICON_BASE}/${s.icon}`);
}
