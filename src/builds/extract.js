// Pure parsers: op.gg API payloads -> compact Build Extracts. No I/O here —
// everything is testable against checked-in fixtures, and the WR sanity gate
// means a shape change upstream produces an ExtractError, never cached garbage.

export const SCHEMA_VERSION = 1;

export const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
export const TIERS = ['all', 'gold_plus', 'platinum_plus', 'emerald_plus', 'diamond_plus', 'master_plus'];

// Any section whose top pick sits outside this band is not real build data —
// either the payload shape changed under us or the sample is junk.
const WR_MIN = 0.3;
const WR_MAX = 0.7;
// Sections below this sample size skip the WR gate (a tiny sample can land
// anywhere without meaning the feed is broken).
const WR_GATE_MIN_PLAY = 50;

export class ExtractError extends Error {}

function fail(msg) {
  throw new ExtractError(`op.gg payload: ${msg}`);
}

function intArray(v, what) {
  if (!Array.isArray(v) || !v.length || !v.every((n) => Number.isInteger(n))) fail(`${what} is not a non-empty integer array`);
  return v;
}

// Top entry of a ranked section. op.gg serves these sorted by play, but that is
// exactly the kind of upstream detail not worth depending on.
function topOf(list, what) {
  if (!Array.isArray(list) || !list.length) fail(`missing section ${what}`);
  return [...list].sort((a, b) => (b.play || 0) - (a.play || 0))[0];
}

function stats(entry, what) {
  const play = Number(entry?.play);
  const wins = Number(entry?.win);
  if (!Number.isFinite(play) || !Number.isFinite(wins) || play < 0 || wins < 0 || wins > play) {
    fail(`${what} has no usable play/win counts`);
  }
  if (play >= WR_GATE_MIN_PLAY) {
    const wr = wins / play;
    if (wr < WR_MIN || wr > WR_MAX) fail(`${what} win rate ${(wr * 100).toFixed(1)}% is outside the sane band`);
  }
  return { play, wins };
}

const SKILL_KEYS = new Set(['Q', 'W', 'E', 'R']);

// The op.gg champion payload -> one Build Extract for (champion, role, tier).
export function extractBuild(raw, { championId, role, tier }) {
  const data = raw?.data;
  const patch = raw?.meta?.version;
  if (!data || typeof patch !== 'string') fail('missing data/meta.version');

  const position = (data.summary?.positions || []).find((p) => String(p?.name).toLowerCase() === role);
  if (!position?.stats) fail(`champion has no tracked data for role "${role}"`);
  const overallPlay = Number(position.stats.play);
  const overallWr = Number(position.stats.win_rate);
  if (!Number.isFinite(overallPlay) || !Number.isFinite(overallWr)) fail('position stats are not numbers');

  const runes = topOf(data.runes, 'runes');
  const primaryPerks = intArray(runes.primary_rune_ids, 'primary runes');
  const subPerks = intArray(runes.secondary_rune_ids, 'secondary runes');
  const shards = intArray(runes.stat_mod_ids, 'stat shards');
  if (primaryPerks.length !== 4 || subPerks.length !== 2 || shards.length !== 3) fail('rune page has unexpected slot counts');
  for (const style of [runes.primary_page_id, runes.secondary_page_id]) {
    if (!Number.isInteger(style) || style < 8000 || style > 8499) fail(`implausible rune style id ${style}`);
  }

  const spells = topOf(data.summoner_spells, 'summoner spells');
  if (intArray(spells.ids, 'summoner spells').length !== 2) fail('expected exactly 2 summoner spells');

  const starter = topOf(data.starter_items, 'starter items');
  const boots = topOf(data.boots, 'boots');
  const core = topOf(data.core_items, 'core items');
  if (intArray(core.ids, 'core items').length < 2) fail('core build has fewer than 2 items');

  const lateItems = (Array.isArray(data.last_items) ? data.last_items : [])
    .filter((e) => Array.isArray(e?.ids) && e.ids.length === 1 && Number.isInteger(e.ids[0]))
    .sort((a, b) => (b.play || 0) - (a.play || 0))
    .slice(0, 8)
    .map((e) => ({ id: e.ids[0], ...stats(e, 'late item') }));

  const skillsTop = topOf(data.skills, 'skill order');
  const order = skillsTop.order;
  if (!Array.isArray(order) || order.length < 9 || !order.every((k) => SKILL_KEYS.has(k))) fail('skill order is not a Q/W/E/R sequence');
  const masteries = topOf(data.skill_masteries, 'skill priority');
  const priority = masteries.ids;
  if (!Array.isArray(priority) || priority.length !== 3 || !priority.every((k) => SKILL_KEYS.has(k))) fail('skill priority is not 3 of Q/W/E');

  const counters = (Array.isArray(data.counters) ? data.counters : [])
    .filter((c) => Number.isInteger(c?.champion_id))
    .map((c) => ({ championKey: c.champion_id, ...stats(c, 'counter') }));

  return {
    schemaVersion: SCHEMA_VERSION,
    patch,
    fetchedAt: Date.now(),
    championId,
    role,
    tier,
    overall: { play: overallPlay, winRate: overallWr },
    runes: {
      ...stats(runes, 'runes'),
      primaryStyleId: runes.primary_page_id,
      primaryPerks,
      subStyleId: runes.secondary_page_id,
      subPerks,
      shards,
    },
    spells: { ...stats(spells, 'summoner spells'), ids: spells.ids },
    startingItems: { ...stats(starter, 'starter items'), ids: intArray(starter.ids, 'starter items') },
    boots: { ...stats(boots, 'boots'), ids: intArray(boots.ids, 'boots') },
    coreItems: { ...stats(core, 'core items'), ids: core.ids },
    lateItems,
    skills: { ...stats(skillsTop, 'skill order'), order, priority },
    counters,
  };
}

// The op.gg all-champions ranking payload -> the roster: which roles each
// champion is actually played in, keyed by numeric champion key.
export function extractRoster(raw, { tier }) {
  const list = raw?.data;
  const patch = raw?.meta?.version;
  if (!Array.isArray(list) || !list.length || typeof patch !== 'string') fail('roster is missing data/meta.version');
  const champions = {};
  for (const entry of list) {
    if (!Number.isInteger(entry?.id)) continue;
    const positions = (Array.isArray(entry.positions) ? entry.positions : [])
      .filter((p) => ROLES.includes(String(p?.name).toLowerCase()) && p?.stats)
      .map((p) => ({
        role: String(p.name).toLowerCase(),
        play: Number(p.stats.play) || 0,
        winRate: Number(p.stats.win_rate) || 0,
        roleRate: Number(p.stats.role_rate) || 0,
      }))
      .sort((a, b) => b.roleRate - a.roleRate);
    champions[entry.id] = { positions };
  }
  if (!Object.keys(champions).length) fail('roster has no usable champions');
  return {
    schemaVersion: SCHEMA_VERSION,
    patch,
    tier,
    fetchedAt: Date.now(),
    matchCount: Number(raw.meta.match_count) || null,
    champions,
  };
}
