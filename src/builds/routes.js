// HTTP surface for the Champion Database, mounted at /api/builds. Ids are
// decorated into display-ready refs (names + local image-proxy URLs) here, at
// the edge, so the client stays a dumb renderer.
import express from 'express';
import * as service from './service.js';
import { ROLES, TIERS } from './extract.js';
import * as ddragon from '../ddragon.js';

export const router = express.Router();

const ROLE_LABELS = { top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'ADC', support: 'Support' };
const TIER_LABELS = {
  all: 'All ranks',
  gold_plus: 'Gold +',
  platinum_plus: 'Platinum +',
  emerald_plus: 'Emerald +',
  diamond_plus: 'Diamond +',
  master_plus: 'Master +',
};

function tierOf(req) {
  const tier = String(req.query.tier || '');
  return TIERS.includes(tier) ? tier : service.DEFAULT_TIER;
}

function itemRef(id) {
  return { id, name: ddragon.itemName(id), icon: `/img/item/${id}` };
}

function spellRef(id) {
  return { id, name: ddragon.spellByNumericKey(id)?.name || `Spell ${id}`, icon: `/img/spell/${id}` };
}

function shardRef(id) {
  return { id, name: ddragon.shardInfo(id)?.name || `Shard ${id}`, icon: `/img/shard/${id}` };
}

function runeRef(id) {
  return { id, name: ddragon.runeInfo(id)?.name || `Rune ${id}`, icon: `/img/rune/${id}` };
}

function withWr(section) {
  return { ...section, winRate: section.play ? section.wins / section.play : null };
}

// The full champion list needs nothing from op.gg — the grid stays browsable
// even when the stats feed is down (it just loses the role badges/filter).
router.get('/champions', async (req, res) => {
  try {
    const tier = tierOf(req);
    let rosterInfo = null;
    try {
      rosterInfo = await service.getRoster(tier);
    } catch {
      // grid works without roles
    }
    const roster = rosterInfo?.roster || null;
    const champions = ddragon
      .allChampions()
      .map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        title: c.title,
        image: ddragon.imageUrls(c.id).square,
        roles: roster?.champions[c.key]?.positions.map((p) => p.role) || [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      patch: ddragon.getVersion(),
      dataPatch: roster?.patch || null,
      matchCount: roster?.matchCount || null,
      rosterStale: Boolean(rosterInfo?.stale),
      champions,
    });
  } catch (err) {
    console.error('champion list failed:', err);
    res.status(500).json({ error: 'Could not build the champion list.' });
  }
});

// Static render support the client fetches once per session: the full rune
// trees (for the rune-page renderer), shard slot rows, and filter labels.
router.get('/meta', (_req, res) => {
  try {
    res.json({
      styles: ddragon.runeStyles().map((s) => ({
        id: s.id,
        name: s.name,
        icon: `/img/rune/${s.id}`,
        slots: s.slots.map((slot) => slot.map((r) => ({ id: r.id, name: r.name, icon: `/img/rune/${r.id}` }))),
      })),
      shardRows: ddragon.shardRows().map((row) => row.map(shardRef)),
      roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id] })),
      tiers: TIERS.map((id) => ({ id, label: TIER_LABELS[id] })),
    });
  } catch (err) {
    console.error('builds meta failed:', err);
    res.status(500).json({ error: 'Could not load rune data.' });
  }
});

router.get('/champion/:champId', async (req, res) => {
  const champ = ddragon.champByName(req.params.champId);
  if (!champ) return res.status(404).json({ error: 'Unknown champion.' });
  const tier = tierOf(req);

  // Roles this champion is actually played in, from the roster (best-effort —
  // op.gg tracks a role once it has enough games).
  let roles = [];
  try {
    const { roster } = await service.getRoster(tier);
    roles = roster.champions[champ.key]?.positions.map((p) => p.role) || [];
  } catch {
    // fall through: role can still come from the query or the tag guess below
  }

  let role = String(req.query.role || '').toLowerCase();
  if (!role) {
    role = roles[0] || (champ.tags?.includes('Marksman') ? 'adc' : champ.tags?.includes('Support') ? 'support' : 'mid');
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role.' });
  if (roles.length && !roles.includes(role)) {
    return res.status(404).json({ error: `No tracked builds for ${champ.name} ${ROLE_LABELS[role]}.`, roles });
  }

  try {
    const { extract, source, stale } = await service.getBuild(champ.id, role, tier, {
      refresh: req.query.refresh === '1',
    });
    res.json({
      champion: { id: champ.id, key: champ.key, name: champ.name, title: champ.title, image: ddragon.imageUrls(champ.id) },
      role,
      roles: roles.length ? roles : [role],
      tier,
      patch: extract.patch,
      fetchedAt: extract.fetchedAt,
      source,
      stale,
      overall: extract.overall,
      runes: {
        ...withWr(extract.runes),
        primaryStyle: runeRef(extract.runes.primaryStyleId),
        primaryPerks: extract.runes.primaryPerks.map(runeRef),
        subStyle: runeRef(extract.runes.subStyleId),
        subPerks: extract.runes.subPerks.map(runeRef),
        shards: extract.runes.shards.map(shardRef),
      },
      spells: { ...withWr(extract.spells), list: extract.spells.ids.map(spellRef) },
      startingItems: { ...withWr(extract.startingItems), list: extract.startingItems.ids.map(itemRef) },
      boots: { ...withWr(extract.boots), list: extract.boots.ids.map(itemRef) },
      coreItems: { ...withWr(extract.coreItems), list: extract.coreItems.ids.map(itemRef) },
      lateItems: extract.lateItems.map((e) => ({ ...itemRef(e.id), ...withWr(e) })),
      skills: withWr(extract.skills),
    });
  } catch (err) {
    if (err instanceof service.BuildsUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    console.error('champion build failed:', err);
    res.status(500).json({ error: 'Could not load that champion build.' });
  }
});
