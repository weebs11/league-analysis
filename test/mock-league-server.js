// Simulates Riot's Live Client Data API (normally https://127.0.0.1:2999)
// so game detection can be tested without League installed.
// Run the app with LIVE_CLIENT_INSECURE_HTTP=1 LIVE_CLIENT_PORT=2999 to use it.
import http from 'http';

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
