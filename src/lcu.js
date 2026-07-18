// LCU (League Client Update) API client.
// The League client runs a local HTTPS server with a self-signed cert and
// basic auth. Credentials come from the "lockfile" in the install directory
// (format: name:pid:port:password:protocol) or from the LeagueClientUx
// process command line.
import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import { execFile } from 'child_process';
import { getConfig } from './config.js';

// Local-only, self-signed cert — verification is intentionally disabled for
// requests to 127.0.0.1. Never reuse this agent for external hosts.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// Test hook, mirroring LIVE_CLIENT_INSECURE_HTTP in livegame.js: our integration
// tests run a plain-HTTP mock of the LCU, which avoids generating a throwaway
// certificate just to exercise the client.
const USE_TLS = process.env.LCU_INSECURE_HTTP !== '1';

let creds = null; // { port, password }

const LOCKFILE_CANDIDATES = [
  'C:/Riot Games/League of Legends/lockfile',
  'D:/Riot Games/League of Legends/lockfile',
  'C:/Program Files/Riot Games/League of Legends/lockfile',
  '/Applications/League of Legends.app/Contents/LoL/lockfile',
];

function parseLockfile(contents) {
  const parts = contents.trim().split(':');
  if (parts.length < 5) return null;
  return { port: Number(parts[2]), password: parts[3] };
}

function tryLockfilePaths() {
  const cfg = getConfig();
  const candidates = [...LOCKFILE_CANDIDATES];
  if (cfg.leaguePath) {
    candidates.unshift(path.join(cfg.leaguePath, 'lockfile'));
  }
  if (process.env.LEAGUE_LOCKFILE) {
    candidates.unshift(process.env.LEAGUE_LOCKFILE);
  }
  for (const p of candidates) {
    try {
      const parsed = parseLockfile(fs.readFileSync(p, 'utf8'));
      if (parsed) return parsed;
    } catch {
      // not there — keep trying
    }
  }
  return null;
}

function execFileP(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

// Fallback discovery: read --app-port / --remoting-auth-token off the
// LeagueClientUx process command line (works even for custom install paths).
async function tryProcessArgs() {
  if (process.platform !== 'win32') return null;
  let out = await execFileP('wmic', ['PROCESS', 'WHERE', "name='LeagueClientUx.exe'", 'GET', 'commandline']);
  if (!out.includes('--app-port')) {
    // wmic is removed on recent Windows builds; PowerShell CIM query instead.
    out = await execFileP('powershell.exe', [
      '-NoProfile', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine",
    ]);
  }
  const port = out.match(/--app-port=["']?(\d+)/)?.[1];
  const password = out.match(/--remoting-auth-token=["']?([\w-]+)/)?.[1];
  if (port && password) return { port: Number(port), password };
  return null;
}

async function discover() {
  return tryLockfilePaths() || (await tryProcessArgs());
}

async function request(endpoint, timeoutMs = 3000) {
  if (!creds) {
    creds = await discover();
    if (!creds) return null;
  }
  const auth = Buffer.from(`riot:${creds.password}`).toString('base64');
  return httpsGet(endpoint, auth, timeoutMs);
}

function httpsGet(endpoint, auth, timeoutMs = 3000) {
  const mod = USE_TLS ? https : http;
  return new Promise((resolve) => {
    const req = mod.request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path: endpoint,
        method: 'GET',
        agent: USE_TLS ? insecureAgent : undefined,
        headers: { Authorization: `Basic ${auth}` },
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => {
      creds = null; // client probably closed — rediscover next poll
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

// "None" | "Lobby" | "Matchmaking" | "ReadyCheck" | "ChampSelect" |
// "GameStart" | "InProgress" | "WaitingForStats" | "EndOfGame" | null (client not found)
export async function gameflowPhase() {
  const phase = await request('/lol-gameflow/v1/gameflow-phase');
  return typeof phase === 'string' ? phase.replace(/"/g, '') : phase;
}

export async function champSelectSession() {
  return request('/lol-champ-select/v1/session');
}

export function isConnected() {
  return creds !== null;
}

// ---- Match history ---------------------------------------------------------

// The identity every archived match is tagged with: { puuid, gameName, tagLine }.
export async function currentSummoner() {
  const s = await request('/lol-summoner/v1/current-summoner');
  return s?.puuid ? s : null;
}

// Recent matches. Measured against a live client, this endpoint ignores
// begIndex/endIndex entirely and always returns the same 20 most-recent games —
// so there is no point paging it. Only the current player's participant row is
// included here; matchDetail() is what returns all ten.
export async function matchList() {
  const r = await request('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19', 8000);
  const games = r?.games?.games;
  return Array.isArray(games) ? games : null;
}

// Full match: all 10 participants, their identities, and the teams block.
export async function matchDetail(gameId) {
  const d = await request(`/lol-match-history/v1/games/${gameId}`, 10000);
  return d?.participants?.length ? d : null;
}

// Live game session. gameData.gameId is only readable while a game is running,
// and it is the join key between a generated plan and the match it was for.
export async function gameflowSession() {
  return request('/lol-gameflow/v1/session');
}
