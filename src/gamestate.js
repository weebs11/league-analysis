// Game state manager: polls the LCU (champ select) and the Live Client Data
// API (in game), normalizes both into snapshots the UI and coach understand,
// and notifies subscribers when anything meaningful changes.
import { EventEmitter } from 'events';
import * as lcu from './lcu.js';
import * as live from './livegame.js';
import * as ddragon from './ddragon.js';

export const events = new EventEmitter();
events.setMaxListeners(50);

const POLL_MS = 2000;

const state = {
  mode: 'live', // 'live' | 'demo'
  phase: 'waiting', // 'waiting' | 'champselect' | 'ingame'
  clientDetected: false,
  champSelect: null, // normalized champ select snapshot
  game: null, // normalized in-game snapshot
  // Remembered from champ select so we still know the user's lane in game.
  lastAssignedRole: null,
};

let timer = null;

const ROLE_LABELS = {
  top: 'Top',
  jungle: 'Jungle',
  middle: 'Mid',
  bottom: 'ADC (Bot)',
  utility: 'Support',
  '': '',
};

const LIVE_POSITION_LABELS = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC (Bot)',
  UTILITY: 'Support',
};

function champRef(champ) {
  if (!champ) return null;
  return {
    id: champ.id,
    name: champ.name,
    title: champ.title,
    tags: champ.tags,
    image: ddragon.imageUrls(champ.id).square,
  };
}

function normalizeChampSelect(session) {
  if (!session || !Array.isArray(session.myTeam)) return null;
  const mapMember = (m) => {
    const champ =
      ddragon.champByNumericKey(m.championId) ||
      ddragon.champByNumericKey(m.championPickIntent);
    return {
      cellId: m.cellId,
      champion: champRef(champ),
      locked: Boolean(m.championId),
      role: ROLE_LABELS[m.assignedPosition ?? ''] || '',
      isMe: m.cellId === session.localPlayerCellId,
    };
  };
  const myTeam = session.myTeam.map(mapMember);
  const theirTeam = (session.theirTeam || []).map(mapMember).map((m) => ({ ...m, isMe: false }));
  const bans = [];
  for (const list of [session.bans?.myTeamBans, session.bans?.theirTeamBans]) {
    for (const id of list || []) {
      const c = ddragon.champByNumericKey(id);
      if (c) bans.push(champRef(c));
    }
  }
  const me = myTeam.find((m) => m.isMe) || null;
  return {
    myTeam,
    theirTeam,
    bans,
    me,
    timerPhase: session.timer?.phase || '',
  };
}

function normalizeLiveGame(data) {
  if (!data || !Array.isArray(data.allPlayers) || data.allPlayers.length === 0) return null;
  const activeName = data.activePlayer?.riotIdGameName || data.activePlayer?.summonerName || '';

  const mapPlayer = (p) => {
    const champ = ddragon.champByName(p.championName) || ddragon.champByName(p.rawChampionName?.replace(/^game_character_displayname_/i, ''));
    const pName = p.riotIdGameName || p.summonerName || '';
    return {
      summonerName: pName,
      champion: champRef(champ),
      team: p.team, // "ORDER" | "CHAOS"
      level: p.level,
      role: LIVE_POSITION_LABELS[p.position] || '',
      isDead: Boolean(p.isDead),
      items: (p.items || []).map((it) => ({ id: it.itemID, name: it.displayName || ddragon.itemName(it.itemID) })),
      scores: p.scores
        ? { kills: p.scores.kills, deaths: p.scores.deaths, assists: p.scores.assists, cs: p.scores.creepScore }
        : null,
      isMe: pName !== '' && pName === activeName,
    };
  };

  const players = data.allPlayers.map(mapPlayer);
  let me = players.find((p) => p.isMe) || null;
  // Fallback: some game modes report activePlayer.summonerName with the tag line.
  if (!me && activeName.includes('#')) {
    const bare = activeName.split('#')[0];
    me = players.find((p) => p.summonerName === bare) || null;
    if (me) me.isMe = true;
  }
  const myTeamSide = me?.team || 'ORDER';
  const allies = players.filter((p) => p.team === myTeamSide);
  const enemies = players.filter((p) => p.team !== myTeamSide);

  // Prefer the live-reported role; fall back to what champ select assigned.
  const myRole = me?.role || state.lastAssignedRole || '';

  return {
    gameMode: data.gameData?.gameMode || 'CLASSIC',
    mapName: data.gameData?.mapName || '',
    gameTime: Math.floor(data.gameData?.gameTime || 0),
    me: me ? { ...me, role: myRole } : null,
    allies,
    enemies,
    activePlayer: data.activePlayer
      ? { level: data.activePlayer.level, gold: Math.floor(data.activePlayer.currentGold || 0) }
      : null,
  };
}

function setPhase(phase, payload = {}) {
  const changed =
    state.phase !== phase ||
    JSON.stringify(payload.champSelect || null) !== JSON.stringify(state.champSelect) ||
    // In game we only re-emit when meaningful bits change (not gameTime).
    gameFingerprint(payload.game) !== gameFingerprint(state.game);
  state.phase = phase;
  state.champSelect = payload.champSelect ?? null;
  state.game = payload.game ?? null;
  if (changed) events.emit('update', snapshot());
}

function gameFingerprint(g) {
  if (!g) return 'none';
  return JSON.stringify({
    me: g.me?.champion?.id,
    lvl: g.me?.level,
    items: [...(g.me?.items || []), ...g.enemies?.flatMap((e) => e.items) || []].map((i) => i.id),
    enemies: g.enemies?.map((e) => `${e.champion?.id}:${e.level}`),
    allies: g.allies?.map((a) => `${a.champion?.id}:${a.level}`),
  });
}

async function pollOnce() {
  if (state.mode === 'demo') return;

  // 1) A running match takes priority — the Live Client API answers only in game.
  const liveData = await live.fetchAllGameData();
  if (liveData) {
    const game = normalizeLiveGame(liveData);
    if (game) {
      state.clientDetected = true;
      // Keep gameTime fresh on the snapshot without spamming updates.
      if (state.game) state.game.gameTime = game.gameTime;
      setPhase('ingame', { game });
      return;
    }
  }

  // 2) Otherwise ask the League client what's happening.
  const phase = await lcu.gameflowPhase();
  state.clientDetected = phase !== null;
  if (phase === 'ChampSelect') {
    const session = await lcu.champSelectSession();
    const champSelect = normalizeChampSelect(session);
    if (champSelect?.me?.role) state.lastAssignedRole = champSelect.me.role;
    setPhase('champselect', { champSelect });
    return;
  }

  setPhase('waiting');
}

export function start() {
  if (timer) return;
  timer = setInterval(() => {
    pollOnce().catch(() => {});
  }, POLL_MS);
  pollOnce().catch(() => {});
}

export function snapshot() {
  return {
    mode: state.mode,
    phase: state.phase,
    clientDetected: state.clientDetected,
    champSelect: state.champSelect,
    game: state.game,
    ddragonVersion: ddragon.getVersion(),
  };
}

// ---- Demo mode -------------------------------------------------------------

export function enterDemo(phase, payload) {
  state.mode = 'demo';
  if (phase === 'champselect') {
    setPhase('champselect', { champSelect: payload });
  } else {
    if (payload?.me?.role) state.lastAssignedRole = payload.me.role;
    setPhase('ingame', { game: payload });
  }
}

export function exitDemo() {
  state.mode = 'live';
  state.lastAssignedRole = null;
  setPhase('waiting');
}
