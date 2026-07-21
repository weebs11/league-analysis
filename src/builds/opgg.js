// The only module that knows op.gg exists. Everything else works with Build
// Extracts, so if this feed dies the swap happens here (ADR-0008 records a
// verified alternate provider).
//
// OPGG_BASE is the test seam: integration tests point it at a local mock.
const BASE = process.env.OPGG_BASE || 'https://lol-api-champion.op.gg';

// The endpoint 403s plain fetches; a browser User-Agent is all it asks for.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// GLOBAL = all regions pooled — the biggest sample and the "what does the world
// build" answer this feature promises.
const REGION = 'GLOBAL';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`op.gg request failed: ${res.status} ${url}`);
  return res.json();
}

export function fetchRoster(tier) {
  return fetchJson(`${BASE}/api/${REGION}/champions/ranked?tier=${encodeURIComponent(tier)}`);
}

// champName is the lowercased ddragon id (e.g. "monkeyking"); position is one
// of extract.js ROLES. Both are validated upstream against known lists.
export function fetchChampionBuild(champName, position, tier) {
  return fetchJson(`${BASE}/api/${REGION}/champions/ranked/${encodeURIComponent(champName)}/${encodeURIComponent(position)}?tier=${encodeURIComponent(tier)}`);
}
