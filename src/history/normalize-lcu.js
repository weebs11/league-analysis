// LCU (/lol-match-history/v1/games/{gameId}) payload -> Index Row fields.
//
// This is the match-v4-shaped schema the League client still serves. Two traps
// live in here, both verified against real payloads:
//
//   * timeline.*Deltas are ALWAYS empty objects. Riot ships the keys and stopped
//     filling them, so lane differentials must be computed from the ten players
//     rather than read off the payload.
//   * timeline.role is "DUO" for BOTH bottom-lane players, so ADC and Support
//     are indistinguishable from it. Creep score separates them.
import * as ddragon from '../ddragon.js';
import { makeMatchId } from './paths.js';
import { bansOf, buildIndexRow, csOf, itemsOf, laneCsOf } from './normalize-shared.js';

// Only a hint — see assignTeamRoles for why this is not trusted directly.
const LANE_TO_ROLE_HINT = { TOP: 'Top', MIDDLE: 'Mid', BOTTOM: 'ADC' };

const SMITE_SPELL_ID = 11;

const hasSmite = (p) => p.spell1Id === SMITE_SPELL_ID || p.spell2Id === SMITE_SPELL_ID;
const camps = (p) => p.stats?.neutralMinionsKilled ?? 0;
const laneMinions = (p) => p.stats?.totalMinionsKilled ?? 0;

// Assigns each of the five roles exactly once per team.
//
// timeline.lane cannot be trusted on its own — real payloads report JUNGLE for
// two players on the same team, or a single BOTTOM with no support. So roles are
// resolved by strength of signal instead: Smite is definitive for jungle, lane
// minions separate Support from the rest, and only then does the lane hint get
// a say. Resolving by assignment also guarantees a sane permutation, which
// matters because lane-opponent matching pairs on role across teams.
function assignTeamRoles(members, roles) {
  const remaining = [...members];
  const claim = (p, role) => {
    roles.set(p.participantId, role);
    remaining.splice(remaining.indexOf(p), 1);
  };
  const maxBy = (list, fn) => list.reduce((best, p) => (fn(p) > fn(best) ? p : best), list[0]);
  const minBy = (list, fn) => list.reduce((best, p) => (fn(p) < fn(best) ? p : best), list[0]);

  // 1. Jungle. Smite is near-definitive; camp count breaks ties or covers the
  //    case where nobody took it.
  if (remaining.length) {
    const smiters = remaining.filter(hasSmite);
    claim(maxBy(smiters.length ? smiters : remaining, camps), 'Jungle');
  }
  // 2. Support — by far the fewest lane minions of anyone left.
  if (remaining.length) claim(minBy(remaining, laneMinions), 'Support');

  // 3. Top / Mid / ADC from the lane hint, then fill whatever is left over.
  const unclaimed = ['Top', 'Mid', 'ADC'];
  for (const role of [...unclaimed]) {
    const p = remaining.find((m) => LANE_TO_ROLE_HINT[m.timeline?.lane] === role);
    if (p) {
      claim(p, role);
      unclaimed.splice(unclaimed.indexOf(role), 1);
    }
  }
  for (const p of [...remaining]) claim(p, unclaimed.shift() ?? null);
}

export function deriveRoles(participants) {
  const roles = new Map();
  const teams = new Map();
  for (const p of participants || []) {
    if (!teams.has(p.teamId)) teams.set(p.teamId, []);
    teams.get(p.teamId).push(p);
  }
  for (const members of teams.values()) assignTeamRoles(members, roles);
  return roles;
}

function identityMap(payload) {
  const m = new Map();
  for (const pi of payload.participantIdentities || []) {
    m.set(pi.participantId, pi.player || {});
  }
  return m;
}

function champRef(numericKey) {
  const c = ddragon.champByNumericKey(numericKey);
  return c ? { championKey: numericKey, championId: c.id, championName: c.name } : { championKey: numericKey, championId: null, championName: null };
}

// Builds the per-player rows used by the detail view. Exported so the detail
// route can reuse it without going through the index.
export function playersFromLcu(payload) {
  const ids = identityMap(payload);
  const roles = deriveRoles(payload.participants || []);
  return (payload.participants || []).map((p) => {
    const player = ids.get(p.participantId) || {};
    const s = p.stats || {};
    return {
      participantId: p.participantId,
      teamId: p.teamId,
      puuid: player.puuid || null,
      gameName: player.gameName || player.summonerName || null,
      tagLine: player.tagLine || null,
      role: roles.get(p.participantId) ?? null,
      ...champRef(p.championId),
      win: Boolean(s.win),
      kills: s.kills ?? 0,
      deaths: s.deaths ?? 0,
      assists: s.assists ?? 0,
      cs: csOf(s),
      laneCs: laneCsOf(s),
      goldEarned: s.goldEarned ?? 0,
      damageToChampions: s.totalDamageDealtToChampions ?? 0,
      damageTaken: s.totalDamageTaken ?? 0,
      visionScore: s.visionScore ?? 0,
      wardsPlaced: s.wardsPlaced ?? 0,
      champLevel: s.champLevel ?? 0,
      items: itemsOf(s),
      runes: {
        primaryStyle: s.perkPrimaryStyle ?? null,
        subStyle: s.perkSubStyle ?? null,
        perks: [s.perk0, s.perk1, s.perk2, s.perk3, s.perk4, s.perk5].filter((v) => v !== undefined && v !== null),
      },
    };
  });
}

// teams[].win is the STRING "Win"/"Fail" here, unlike stats.win which is a
// boolean. Normalize to boolean so nothing downstream has to know.
export function teamsFromLcu(payload) {
  return (payload.teams || []).map((t) => ({
    teamId: t.teamId,
    win: t.win === 'Win' || t.win === true,
    towerKills: t.towerKills ?? 0,
    inhibitorKills: t.inhibitorKills ?? 0,
    dragonKills: t.dragonKills ?? 0,
    baronKills: t.baronKills ?? 0,
    riftHeraldKills: t.riftHeraldKills ?? 0,
    hordeKills: t.hordeKills ?? 0,
    firstBlood: Boolean(t.firstBlood),
    firstTower: Boolean(t.firstTower),
    bans: bansOf(t),
  }));
}

// With no owner recorded on the container there is nothing to match a puuid
// against, so a payload is only unambiguous when it holds a single participant.
function findOwner(players, ownerPuuid) {
  if (ownerPuuid) return players.find((p) => p.puuid === ownerPuuid) || null;
  return players.length === 1 ? players[0] : null;
}

export function normalizeLcu(payload, ownerPuuid) {
  if (!payload?.participants?.length || !payload.gameId) return null;
  const matchId = makeMatchId(payload.platformId, payload.gameId);
  if (!matchId) return null;

  const players = playersFromLcu(payload);
  const me = findOwner(players, ownerPuuid);
  if (!me) return null;

  // gameEndedInEarlySurrender is not carried onto the player rows, so it has to
  // be read back off the raw participant.
  const mine = payload.participants.find((p) => p.participantId === me.participantId);

  return buildIndexRow({
    matchId,
    players,
    me,
    playedAt: payload.gameCreation,
    durationSec: payload.gameDuration ?? 0,
    queueId: payload.queueId,
    gameVersion: payload.gameVersion,
    endedInEarlySurrender: mine?.stats?.gameEndedInEarlySurrender,
  });
}
