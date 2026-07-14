// Demo scenarios — realistic game snapshots so the app can be explored (and
// tested) without League running. Champion sets chosen to be instructive for
// a newer player: classic matchups, mixed damage profiles, healing to punish.
import * as ddragon from './ddragon.js';

function ref(ddragonId) {
  const c = ddragon.champByName(ddragonId) || null;
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    tags: c.tags,
    image: ddragon.imageUrls(c.id).square,
  };
}

function player(champId, { role = '', team = 'ORDER', level = 1, items = [], isMe = false, name }) {
  return {
    summonerName: name || champId,
    champion: ref(champId),
    team,
    level,
    role,
    isDead: false,
    items: items.map((n, i) => ({ id: 9000 + i, name: n })),
    scores: { kills: 0, deaths: 0, assists: 0, cs: 0 },
    isMe,
  };
}

const SCENARIOS = {
  botlane: {
    label: 'Bot lane: Jinx & Thresh vs Caitlyn & Lux',
    myChamp: 'Jinx',
    role: 'ADC (Bot)',
    allies: [
      ['Jinx', 'ADC (Bot)', true],
      ['Thresh', 'Support'],
      ['Ahri', 'Mid'],
      ['Vi', 'Jungle'],
      ['Shen', 'Top'],
    ],
    enemies: [
      ['Caitlyn', 'ADC (Bot)'],
      ['Lux', 'Support'],
      ['Syndra', 'Mid'],
      ['LeeSin', 'Jungle'],
      ['Darius', 'Top'],
    ],
  },
  jungle: {
    label: 'Jungle: Vi vs Kha\'Zix',
    myChamp: 'Vi',
    role: 'Jungle',
    allies: [
      ['Vi', 'Jungle', true],
      ['Garen', 'Top'],
      ['Lux', 'Mid'],
      ['Ashe', 'ADC (Bot)'],
      ['Leona', 'Support'],
    ],
    enemies: [
      ['Khazix', 'Jungle'],
      ['Aatrox', 'Top'],
      ['Zed', 'Mid'],
      ['MissFortune', 'ADC (Bot)'],
      ['Soraka', 'Support'],
    ],
  },
  top: {
    label: 'Top lane: Garen vs Darius',
    myChamp: 'Garen',
    role: 'Top',
    allies: [
      ['Garen', 'Top', true],
      ['Amumu', 'Jungle'],
      ['Annie', 'Mid'],
      ['Caitlyn', 'ADC (Bot)'],
      ['Morgana', 'Support'],
    ],
    enemies: [
      ['Darius', 'Top'],
      ['Warwick', 'Jungle'],
      ['Katarina', 'Mid'],
      ['Jhin', 'ADC (Bot)'],
      ['Blitzcrank', 'Support'],
    ],
  },
};

export function scenarioList() {
  return Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label, role: s.role }));
}

export function buildGameSnapshot(scenarioId) {
  const s = SCENARIOS[scenarioId];
  if (!s) return null;
  const allies = s.allies.map(([c, role, isMe]) =>
    player(c, { role, team: 'ORDER', level: isMe ? 3 : 3, isMe: Boolean(isMe), items: isMe ? ["Doran's Blade", 'Health Potion'] : [] })
  );
  const enemies = s.enemies.map(([c, role]) => player(c, { role, team: 'CHAOS', level: 3 }));
  const me = allies.find((p) => p.isMe);
  return {
    gameMode: 'CLASSIC',
    mapName: "Summoner's Rift",
    gameTime: 5 * 60,
    me,
    allies,
    enemies,
    activePlayer: { level: 3, gold: 550 },
  };
}

export function buildChampSelectSnapshot(scenarioId) {
  const s = SCENARIOS[scenarioId];
  if (!s) return null;
  const mapSide = (list, isMyTeam) =>
    list.map(([c, role, isMe], i) => ({
      cellId: (isMyTeam ? 0 : 5) + i,
      champion: isMyTeam || i < 3 ? ref(c) : null, // enemy team: only 3 picks visible yet
      locked: isMyTeam || i < 3,
      role: isMyTeam ? role : '',
      isMe: Boolean(isMyTeam && isMe),
    }));
  const myTeam = mapSide(s.allies, true);
  const theirTeam = mapSide(s.enemies, false);
  return {
    myTeam,
    theirTeam,
    bans: ['Yasuo', 'Zed', 'Blitzcrank', 'Morgana'].map(ref).filter(Boolean),
    me: myTeam.find((m) => m.isMe),
    timerPhase: 'FINALIZATION',
  };
}
