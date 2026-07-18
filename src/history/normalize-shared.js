// Field mappings and the Index Row assembly that both source normalizers share.
import { csFormulaFor } from './benchmarks.js';

//
// The two sources disagree about almost everything at the payload level, but
// they converge on one Index Row shape — that is what lets the merge in
// normalize.js treat a row from either source interchangeably. Assembling the
// row in one place is what keeps that true: a field added for one source can no
// longer go quietly missing on the other.

// Under this, the game did not really happen. Riot still reports a remake as
// GameComplete with a win value, so nothing in the payload marks it — see
// ADR-0004.
const REMAKE_MAX_SEC = 300;

export function patchOf(gameVersion) {
  const parts = String(gameVersion || '').split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : null;
}

// Total farm — lane minions plus camps. Always true, always shown: "how much
// did you actually farm" is meaningful for every role.
export function csOf(src) {
  return (src?.totalMinionsKilled ?? 0) + (src?.neutralMinionsKilled ?? 0);
}

// Lane minions alone. Kept separately because the CS *rate* is role-scoped even
// though the CS *count* is not — see benchmarkedCs.
export function laneCsOf(src) {
  return src?.totalMinionsKilled ?? 0;
}

// The farm csPerMin is measured on, which is not the same as total farm
// (ADR-0004). A top laner who clears a few camps should not be scored against a
// lane-only target as though those camps were minions, and Support has no
// meaningful CS target at all — so its rate is null rather than a number that
// would then be averaged into the summary strip.
function benchmarkedCs(me) {
  switch (csFormulaFor(me.role)) {
    case 'none': return null;
    case 'lane': return me.laneCs ?? me.cs;
    case 'camps+lane': return me.cs;
    default: return me.cs; // unresolved role — total is the honest fallback
  }
}

// Both sources spell the inventory as flat item0..item6. An empty slot is a
// real 0 the UI renders as a blank square, not missing data.
export function itemsOf(src) {
  return [src.item0, src.item1, src.item2, src.item3, src.item4, src.item5, src.item6].map((i) => i ?? 0);
}

// A non-positive championId means nobody was banned in that slot — a player who
// let the timer run out. Not a champion, so it must not reach the UI.
export function bansOf(team) {
  return (team.bans || []).map((b) => b.championId).filter((id) => id > 0);
}

// Null rather than 0 when there is no denominator: "no data" and "genuinely
// zero" are different answers and the UI shows them differently.
export function ratio(numerator, denominator) {
  return denominator > 0 ? +(numerator / denominator).toFixed(3) : null;
}

export function csPerMinute(me, durationSec) {
  const cs = benchmarkedCs(me);
  if (cs === null || !(durationSec > 0)) return null;
  return +(cs / (durationSec / 60)).toFixed(2);
}

// Builds the Index Row from the owner's player row plus the full ten, which is
// what every team-relative stat needs.
//
// csDiffAt10 and damagePerMinute start null and stay null unless a caller has a
// real value: only match-v5 carries them, and the LCU's timeline deltas are
// empty objects that must never be used to fabricate one (ADR-0004).
export function buildIndexRow({ matchId, players, me, playedAt, durationSec, queueId, gameVersion, endedInEarlySurrender }) {
  const myTeam = players.filter((p) => p.teamId === me.teamId);
  const teamKills = myTeam.reduce((n, p) => n + p.kills, 0);
  const teamDamage = myTeam.reduce((n, p) => n + p.damageToChampions, 0);

  // Lane opponent: same derived role on the other team. Null for anything we
  // could not resolve, which keeps the differential honest rather than invented.
  const opponent = me.role ? players.find((p) => p.teamId !== me.teamId && p.role === me.role) : null;

  return {
    matchId,
    playedAt: playedAt ?? null,
    durationSec,
    queueId: queueId ?? null,
    patch: patchOf(gameVersion),
    isRemake: durationSec < REMAKE_MAX_SEC || Boolean(endedInEarlySurrender),

    puuid: me.puuid,
    gameName: me.gameName,
    tagLine: me.tagLine,

    championKey: me.championKey,
    championId: me.championId,
    championName: me.championName,
    role: me.role,
    win: me.win,

    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.cs,
    csPerMin: csPerMinute(me, durationSec),
    goldEarned: me.goldEarned,
    damageToChampions: me.damageToChampions,
    visionScore: me.visionScore,
    champLevel: me.champLevel,
    items: me.items,
    runes: me.runes,

    teamKills,
    teamDamageToChampions: teamDamage,
    killParticipation: ratio(me.kills + me.assists, teamKills),
    damageShare: ratio(me.damageToChampions, teamDamage),
    csDiffVsLaneOpponent: opponent ? me.cs - opponent.cs : null,

    csDiffAt10: null,
    damagePerMinute: null,
  };
}
