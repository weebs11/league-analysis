// Simulates the two local APIs League exposes, so both game detection and match
// history can be tested without League installed:
//
//   * Live Client Data API (normally https://127.0.0.1:2999) — MOCK_PORT
//     Run the app with LIVE_CLIENT_INSECURE_HTTP=1 LIVE_CLIENT_PORT=<port>.
//   * LCU / League client API — MOCK_LCU_PORT, plus a lockfile at MOCK_LOCKFILE.
//     Run the app with LCU_INSECURE_HTTP=1 LEAGUE_LOCKFILE=<path>.
//
// The LCU half replays captured real payloads from test/fixtures so the
// normalizers are exercised against the shapes Riot actually sends — including
// the empty timeline deltas and the unreliable lane data.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const player = (championName, team, position, isMe = false) => ({
  championName,
  isBot: false,
  isDead: false,
  items: isMe
    ? [{ itemID: 1055, displayName: "Doran's Blade", count: 1 }, { itemID: 2003, displayName: 'Health Potion', count: 2 }]
    : [],
  level: 4,
  position,
  rawChampionName: `game_character_displayname_${championName.replace(/[ .']/g, '')}`,
  respawnTimer: 0,
  scores: { kills: 1, deaths: 0, assists: 2, creepScore: 25, wardScore: 0 },
  skinID: 0,
  summonerName: `${championName} Player`,
  riotIdGameName: `${championName} Player`,
  riotIdTagLine: 'NA1',
  team,
});

const allGameData = {
  activePlayer: {
    riotIdGameName: 'Miss Fortune Player',
    summonerName: 'Miss Fortune Player',
    level: 4,
    currentGold: 731.5,
  },
  allPlayers: [
    player('Miss Fortune', 'ORDER', 'BOTTOM', true),
    player('Leona', 'ORDER', 'UTILITY'),
    player('Orianna', 'ORDER', 'MIDDLE'),
    player('Jarvan IV', 'ORDER', 'JUNGLE'),
    player('Malphite', 'ORDER', 'TOP'),
    player('Ezreal', 'CHAOS', 'BOTTOM'),
    player('Morgana', 'CHAOS', 'UTILITY'),
    player('Zed', 'CHAOS', 'MIDDLE'),
    player('Hecarim', 'CHAOS', 'JUNGLE'),
    player('Ornn', 'CHAOS', 'TOP'),
  ],
  events: { Events: [{ EventID: 0, EventName: 'GameStart', EventTime: 0 }] },
  gameData: {
    gameMode: 'CLASSIC',
    gameTime: 372.2,
    mapName: 'Map11',
    mapNumber: 11,
    mapTerrain: 'Default',
  },
};

const port = Number(process.env.MOCK_PORT || 2999);
http
  .createServer((req, res) => {
    if (req.url === '/liveclientdata/allgamedata') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(allGameData));
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Mock Live Client API on http://127.0.0.1:${port}`));

// ---- Mock LCU ---------------------------------------------------------------

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  } catch {
    return null;
  }
}

const summoner = fixture('lcu-current-summoner.json');
const rankedStats = fixture('lcu-ranked-stats.json');
const matchList = fixture('lcu-matchlist.json');
const matchDetail = fixture('lcu-match-detail.json');
const gameflow = fixture('lcu-gameflow-session.json');

// The detail fixture is one real match. Replaying it verbatim for every game id
// would collapse 20 matches into one, so the per-game fields that actually
// distinguish them are grafted on from the list entry. That keeps ids, dates,
// durations and queues distinct — and preserves the real remakes in the list,
// which is what makes the remake-exclusion test meaningful.
function detailFor(gameId) {
  if (!matchDetail || !matchList) return null;
  const entry = (matchList.games?.games || []).find((g) => String(g.gameId) === String(gameId));
  if (!entry) return null;
  return {
    ...matchDetail,
    gameId: entry.gameId,
    platformId: entry.platformId,
    queueId: entry.queueId,
    gameCreation: entry.gameCreation,
    gameDuration: entry.gameDuration,
    gameVersion: entry.gameVersion || matchDetail.gameVersion,
  };
}

const lcuPort = Number(process.env.MOCK_LCU_PORT || port + 1);
const lcuPassword = process.env.MOCK_LCU_PASSWORD || 'test-token';

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/lol-summoner/v1/current-summoner') return summoner ? send(summoner) : send({}, 404);
    if (url.pathname === '/lol-gameflow/v1/gameflow-phase') return send(process.env.MOCK_GAMEFLOW_PHASE || 'None');
    if (url.pathname === '/lol-gameflow/v1/session') return gameflow ? send(gameflow) : send({}, 404);
    if (url.pathname === '/lol-ranked/v1/current-ranked-stats') return rankedStats ? send(rankedStats) : send({}, 404);
    if (url.pathname === '/lol-match-history/v1/products/lol/current-summoner/matches') {
      return matchList ? send(matchList) : send({}, 404);
    }
    const game = url.pathname.match(/^\/lol-match-history\/v1\/games\/(\d+)$/);
    if (game) {
      const d = detailFor(game[1]);
      return d ? send(d) : send({}, 404);
    }
    res.writeHead(404);
    res.end();
  })
  .listen(lcuPort, '127.0.0.1', () => {
    if (process.env.MOCK_LOCKFILE) {
      fs.writeFileSync(process.env.MOCK_LOCKFILE, `LeagueClient:0:${lcuPort}:${lcuPassword}:http`);
    }
    console.log(`Mock LCU on http://127.0.0.1:${lcuPort}`);
  });
