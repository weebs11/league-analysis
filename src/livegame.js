// Live Client Data API — served by the game itself on https://127.0.0.1:2999
// whenever a match is running. Self-signed cert, no auth required.
import https from 'https';
import http from 'http';

// Local-only, self-signed cert — verification is intentionally disabled for
// requests to 127.0.0.1. Never reuse this agent for external hosts.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

const HOST = process.env.LIVE_CLIENT_HOST || '127.0.0.1';
const PORT = Number(process.env.LIVE_CLIENT_PORT || 2999);
// Test hook: our integration test runs a plain-HTTP mock of the API.
const USE_TLS = process.env.LIVE_CLIENT_INSECURE_HTTP !== '1';

// Returns the full game snapshot, or null when no game is running.
export function fetchAllGameData() {
  const mod = USE_TLS ? https : http;
  return new Promise((resolve) => {
    const req = mod.request(
      {
        host: HOST,
        port: PORT,
        path: '/liveclientdata/allgamedata',
        method: 'GET',
        agent: USE_TLS ? insecureAgent : undefined,
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
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}
