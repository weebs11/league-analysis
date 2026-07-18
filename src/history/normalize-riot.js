// Riot Web API match-v5 payload -> Index Row fields.
//
// Flatter and richer than the LCU shape: teamPosition is authoritative for role,
// and `challenges` carries the true 10-minute lane deltas the LCU cannot supply.
import * as ddragon from '../ddragon.js';
import { bansOf, buildIndexRow, csOf, itemsOf, laneCsOf } from './normalize-shared.js';

const POSITION_TO_ROLE = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support',
};

// match-v5 reports gameDuration in seconds when gameEndTimestamp is present and
// in milliseconds when it is not — a documented quirk from the patch that added
// the field. Normalize explicitly rather than guessing from magnitude.
export function durationSeconds(info) {
  const d = info?.gameDuration ?? 0;
  return info?.gameEndTimestamp ? d : Math.round(d / 1000);
}

function runesOf(p) {
  const styles = p?.perks?.styles || [];
  const primary = styles.find((s) => s.description === 'primaryStyle') || styles[0];
  const sub = styles.find((s) => s.description === 'subStyle') || styles[1];
  const perks = styles.flatMap((s) => (s.selections || []).map((sel) => sel.perk)).filter(Boolean);
  return { primaryStyle: primary?.style ?? null, subStyle: sub?.style ?? null, perks };
}

function champRef(p) {
  const byKey = ddragon.champByNumericKey(p.championId);
  const byName = byKey || ddragon.champByName(p.championName);
  return {
    championKey: p.championId ?? null,
    championId: byName?.id ?? p.championName ?? null,
    championName: byName?.name ?? p.championName ?? null,
  };
}

export function playersFromRiot(payload) {
  const info = payload?.info || {};
  return (info.participants || []).map((p) => ({
    participantId: p.participantId ?? null,
    teamId: p.teamId,
    puuid: p.puuid || null,
    gameName: p.riotIdGameName || p.summonerName || null,
    tagLine: p.riotIdTagline || p.riotIdTagLine || null,
    role: POSITION_TO_ROLE[p.teamPosition] ?? null,
    ...champRef(p),
    win: Boolean(p.win),
    kills: p.kills ?? 0,
    deaths: p.deaths ?? 0,
    assists: p.assists ?? 0,
    cs: csOf(p),
    laneCs: laneCsOf(p),
    goldEarned: p.goldEarned ?? 0,
    damageToChampions: p.totalDamageDealtToChampions ?? 0,
    damageTaken: p.totalDamageTaken ?? 0,
    visionScore: p.visionScore ?? 0,
    wardsPlaced: p.wardsPlaced ?? 0,
    champLevel: p.champLevel ?? 0,
    items: itemsOf(p),
    runes: runesOf(p),
  }));
}

export function teamsFromRiot(payload) {
  const info = payload?.info || {};
  return (info.teams || []).map((t) => {
    const o = t.objectives || {};
    return {
      teamId: t.teamId,
      win: Boolean(t.win),
      towerKills: o.tower?.kills ?? 0,
      inhibitorKills: o.inhibitor?.kills ?? 0,
      dragonKills: o.dragon?.kills ?? 0,
      baronKills: o.baron?.kills ?? 0,
      riftHeraldKills: o.riftHerald?.kills ?? 0,
      hordeKills: o.horde?.kills ?? 0,
      firstBlood: Boolean(o.champion?.first),
      firstTower: Boolean(o.tower?.first),
      bans: bansOf(t),
    };
  });
}

export function normalizeRiot(payload, ownerPuuid) {
  const info = payload?.info;
  const matchId = payload?.metadata?.matchId;
  if (!info?.participants?.length || !matchId) return null;

  const players = playersFromRiot(payload);
  const me = ownerPuuid ? players.find((p) => p.puuid === ownerPuuid) : null;
  if (!me) return null;

  const mine = info.participants.find((p) => p.puuid === me.puuid);
  const ch = mine?.challenges || {};

  const row = buildIndexRow({
    matchId,
    players,
    me,
    playedAt: info.gameCreation,
    durationSec: durationSeconds(info),
    queueId: info.queueId,
    gameVersion: info.gameVersion,
    endedInEarlySurrender: mine?.gameEndedInEarlySurrender,
  });

  // match-v5 precomputes the two rates the LCU path has to derive by hand.
  // Prefer Riot's numbers, but leave the derived value in place when a challenge
  // is missing so the field means the same thing regardless of source.
  if (typeof ch.killParticipation === 'number') row.killParticipation = +ch.killParticipation.toFixed(3);
  if (typeof ch.teamDamagePercentage === 'number') row.damageShare = +ch.teamDamagePercentage.toFixed(3);

  // These two exist only here — the LCU has no way to supply them (ADR-0004).
  if (typeof ch.maxCsAdvantageOnLaneOpponent === 'number') row.csDiffAt10 = Math.round(ch.maxCsAdvantageOnLaneOpponent);
  if (typeof ch.damagePerMinute === 'number') row.damagePerMinute = Math.round(ch.damagePerMinute);

  return row;
}
