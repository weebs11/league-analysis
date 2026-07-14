// LCU (League Client Update) API client.
// The League client runs a local HTTPS server with a self-signed cert and
// basic auth. Credentials come from the "lockfile" in the install directory
// (format: name:pid:port:password:protocol) or from the LeagueClientUx
// process command line.
import fs from 'fs';
import https from 'https';
import path from 'path';
import { execFile } from 'child_process';
import { getConfig } from './config.js';

// Local-only, self-signed cert — verification is intentionally disabled for
// requests to 127.0.0.1. Never reuse this agent for external hosts.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

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

async function request(endpoint) {
  if (!creds) {
    creds = await discover();
    if (!creds) return null;
  }
  const auth = Buffer.from(`riot:${creds.password}`).toString('base64');
  try {
    const res = await fetch(`https://127.0.0.1:${creds.port}${endpoint}`, {
      headers: { Authorization: `Basic ${auth}` },
      dispatcher: undefined,
      // Node fetch (undici) has no per-request https.Agent; fall back below.
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // fetch/undici rejects the self-signed cert; use the https module.
    return httpsGet(endpoint, auth);
  }
}

function httpsGet(endpoint, auth) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path: endpoint,
        method: 'GET',
        agent: insecureAgent,
        headers: { Authorization: `Basic ${auth}` },
        timeout: 3000,
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
