#!/usr/bin/env node
// One-time historical import via Riot's match-v5 API.
//
// The League client only serves the 20 most recent matches (see
// docs/adr/0003), so everything older has to come from Riot's Web API. This is
// a script rather than an app feature on purpose: it needs a key, it runs once,
// and keeping it out of the server means the ongoing sync path stays keyless.
//
//   node scripts/import-history.mjs --key=RGAPI-xxxx [--months=24] [--upgrade] [--dry-run]
//
// Get a development key from https://developer.riotgames.com (valid 24h — which
// is plenty, because you run this once).
import process from 'process';
import { pathToFileURL } from 'url';
import * as store from '../src/history/store.js';
import { ensureDirs } from '../src/history/paths.js';
import * as lcu from '../src/lcu.js';
import { RANKED_QUEUES } from '../src/history/sync.js';

// ---- args ------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  })
);

// True only when run as a command. Tests import this module for windowRange, and
// must not trip the argument validation below or start an import.
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain && (args.help || !args.key)) {
  console.log(`
Import your ranked match history from Riot's match-v5 API.

  --key=RGAPI-...     Required. Development key from developer.riotgames.com
  --months=24         How far back to walk, in 30-day windows (default 24;
                      Riot retains ~2 years)
  --riot-id=Name#TAG  Only needed if no client is running and nothing is synced
                      yet. Must be given together with --platform
  --platform=NA1      Your shard (NA1, EUW1, KR, …). Only needed with --riot-id
  --upgrade           Also re-fetch matches already captured from the client,
                      adding the richer match-v5 fields alongside them
  --dry-run           Report what would be fetched, write nothing
`);
  process.exit(args.key ? 0 : 1);
}

const API_KEY = String(args.key);
const UPGRADE = Boolean(args.upgrade);
const DRY = Boolean(args['dry-run']);

// Reject a bad --months loudly. Left as NaN it made the walk loop zero times and
// then mark the import complete, reporting success having imported nothing.
const MONTHS = args.months === undefined ? 24 : Number(args.months);
if (isMain && (!Number.isInteger(MONTHS) || MONTHS < 1)) {
  console.error(`\n--months must be a whole number of windows (got "${args.months}").\n`);
  process.exit(1);
}

// match-v5 is routed by super-region, not by platform.
const REGIONAL = {
  NA1: 'americas', BR1: 'americas', LA1: 'americas', LA2: 'americas',
  EUW1: 'europe', EUN1: 'europe', TR1: 'europe', RU: 'europe', ME1: 'europe',
  KR: 'asia', JP1: 'asia',
  OC1: 'sea', PH2: 'sea', SG2: 'sea', TH2: 'sea', TW2: 'sea', VN2: 'sea',
};

// account-v1 is NOT served on `sea` — only americas, europe and asia. Sending a
// SEA player's Riot ID lookup to the sea host fails, which broke the documented
// cold-start path for every SEA user.
const ACCOUNT_REGIONAL = { americas: 'americas', europe: 'europe', asia: 'asia', sea: 'asia' };

// ---- rate limiting ---------------------------------------------------------

// Development keys allow 20 requests/second and 100 requests/2 minutes. The
// second limit is the binding one: ~500 matches takes about 10 minutes.
const calls = [];
async function rateLimited(fn) {
  for (;;) {
    const now = Date.now();
    while (calls.length && now - calls[0] > 120000) calls.shift();
    const inLastSecond = calls.filter((t) => now - t < 1000).length;
    if (calls.length < 100 && inLastSecond < 18) break;
    const waitFor = calls.length >= 100 ? 120000 - (now - calls[0]) + 250 : 1100 - (now - calls[calls.length - 1]);
    await sleep(Math.max(250, waitFor));
  }
  calls.push(Date.now());
  return fn();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function riotGet(url) {
  return rateLimited(async () => {
    const res = await fetch(url, { headers: { 'X-Riot-Token': API_KEY } });
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 10);
      console.log(`  rate limited, waiting ${retry}s…`);
      await sleep((retry + 1) * 1000);
      return riotGet(url);
    }
    if (res.status === 403) throw new Error('Riot rejected the key (403). Development keys expire after 24 hours — grab a fresh one.');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Riot API ${res.status} for ${url.replace(API_KEY, '***')}`);
    return res.json();
  });
}

// ---- identity --------------------------------------------------------------

// The LCU and the Web API disagree about what a PUUID is. The client hands out a
// 36-char UUID scoped to the local install; match-v5 wants the ~78-char
// encrypted form account-v1 returns, and answers a UUID with
// "400 Bad Request - Exception decrypting <uuid>". The two are never
// interchangeable, so a PUUID that is not in Web API shape is unusable here no
// matter how trustworthy its source.
function isWebApiPuuid(puuid) {
  return typeof puuid === 'string' && /^[A-Za-z0-9_-]{70,}$/.test(puuid);
}

async function resolveIdentity() {
  const state = await store.readSyncState();

  // An explicit --riot-id wins over every cached or client-supplied identity.
  // It used to be consulted last, so passing it while the client happened to be
  // running did nothing at all: the LCU branch returned first and account-v1 was
  // never called, and the whole walk 400ed on the client's UUID.
  if (args['riot-id']) {
    const [name, tag] = String(args['riot-id']).split('#');
    const platformId = String(args.platform || '').toUpperCase();
    const regional = REGIONAL[platformId];
    if (!name || !tag || !regional) {
      throw new Error('With --riot-id you must also pass --platform=NA1 (or EUW1, KR, …).');
    }
    const acctHost = ACCOUNT_REGIONAL[regional];
    const acct = await riotGet(`https://${acctHost}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    if (!acct?.puuid) throw new Error(`Could not resolve Riot ID ${args['riot-id']}.`);
    return { puuid: acct.puuid, platformId, gameName: acct.gameName, tagLine: acct.tagLine };
  }

  if (state.puuid && state.platformId && isWebApiPuuid(state.puuid)) {
    return { puuid: state.puuid, platformId: state.platformId, gameName: state.gameName, tagLine: state.tagLine };
  }

  const me = await lcu.currentSummoner();
  if (me?.puuid) {
    // The client knows who you are but not which platform string match-v5 wants;
    // fall back to whatever a sync recorded, else ask for it explicitly.
    const platformId = state.platformId || String(args.platform || '').toUpperCase();
    if (platformId && isWebApiPuuid(me.puuid)) {
      return { puuid: me.puuid, platformId, gameName: me.gameName, tagLine: me.tagLine };
    }
  }

  // Reaching here with a client running means its PUUID was UUID-shaped. Say so,
  // rather than letting the caller guess why an identity we clearly have was
  // rejected.
  const sawLocalPuuid = Boolean(me?.puuid) && !isWebApiPuuid(me.puuid);
  throw new Error(
    'Could not work out whose history to import.\n' +
    (sawLocalPuuid
      ? 'The League client reported a local PUUID, which Riot\'s Web API cannot decrypt.\n'
      : '') +
    'Pass --riot-id="Name#TAG" --platform=NA1 to look your account up directly.'
  );
}

// ---- main ------------------------------------------------------------------

async function main() {
  ensureDirs();
  const identity = await resolveIdentity();
  const regional = REGIONAL[identity.platformId];
  if (!regional) throw new Error(`Unknown platform "${identity.platformId}" — cannot pick a match-v5 region.`);

  console.log(`Importing for ${identity.gameName || identity.puuid}${identity.tagLine ? '#' + identity.tagLine : ''} (${identity.platformId} → ${regional})`);
  console.log(`Walking back ${MONTHS} months${UPGRADE ? ', upgrading client-captured matches too' : ''}${DRY ? ' [dry run]' : ''}.\n`);

  const owner = { puuid: identity.puuid, gameName: identity.gameName, tagLine: identity.tagLine };
  const state = await store.readSyncState();

  // Reuse the anchor a previous run recorded. Recomputing it from "now" would
  // shift every window on resume, re-scanning some spans and skipping others.
  const anchor = state.importAnchor || Date.now();
  const startWindow = Number.isInteger(state.importCursorWindow) ? state.importCursorWindow : 0;
  if (startWindow > 0) console.log(`Resuming at window ${startWindow + 1} of ${MONTHS}.\n`);
  if (!DRY) await store.writeSyncState({ importAnchor: anchor });

  let fetched = 0;
  let skipped = 0;
  let written = 0;

  for (let m = startWindow; m < MONTHS; m++) {
    const { start, end, label } = windowRange(anchor, m);
    const ids = await listMatchIds(regional, identity.puuid, start, end);
    if (ids.length) console.log(`${label}: ${ids.length} ranked match(es)`);

    for (const matchId of ids) {
      if (await store.hasSource(matchId, 'riot-api')) { skipped++; continue; }
      if (!UPGRADE && (await store.hasSource(matchId, 'lcu'))) { skipped++; continue; }
      if (DRY) { fetched++; continue; }

      const match = await riotGet(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${matchId}`);
      if (!match) { skipped++; continue; }
      await store.writeSource(matchId, 'riot-api', match, owner);
      written++;
      fetched++;
      if (written % 25 === 0) console.log(`  …${written} written`);
    }

    // Persist after every window so an interrupted run resumes rather than
    // restarting — the whole point of the cursor.
    if (!DRY) await store.writeSyncState({ importCursorWindow: m + 1 });
  }

  if (!DRY) {
    await store.writeSyncState({
      lastImportAt: Date.now(),
      importComplete: true,
      importCursorWindow: null,
      importAnchor: null,
    });
    console.log('\nRebuilding index…');
    const rows = await store.rebuildIndex();
    console.log(`Done. ${written} match(es) imported, ${skipped} already present. Index now holds ${rows.length}.`);
  } else {
    console.log(`\nDry run: would fetch ${fetched} match(es); ${skipped} already present.`);
  }
}

// Riot caps by-puuid/ids at ~990 results regardless of paging, so the walk is
// windowed by month — each window paginates independently and stays well under.
async function listMatchIds(regional, puuid, startTime, endTime) {
  const out = [];
  for (const queue of RANKED_QUEUES) {
    let start = 0;
    for (;;) {
      const url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`
        + `?startTime=${Math.floor(startTime / 1000)}&endTime=${Math.floor(endTime / 1000)}&queue=${queue}&start=${start}&count=100`;
      const page = await riotGet(url);
      if (!Array.isArray(page) || page.length === 0) break;
      out.push(...page);
      if (page.length < 100) break;
      start += 100;
    }
  }
  return [...new Set(out)];
}

// Fixed-width windows measured back from a stable anchor, NOT calendar months.
//
// Calendar arithmetic looked natural and was wrong: setUTCMonth clamps when the
// target month is shorter, so a run started on the 31st produced windows that
// skipped whole days — and those days were then marked complete and never
// revisited. The same clamping made the YYYY-MM labels collide, so the resume
// cursor could map to the wrong window. Uniform spans have neither problem: they
// tile exactly, by construction.
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function windowRange(anchor, index) {
  const end = anchor - index * WINDOW_MS;
  const start = end - WINDOW_MS;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  return { start, end, label: `${day(start)} … ${day(end)}` };
}

// Only run when invoked directly, so tests can import windowRange without the
// script executing.
if (isMain) {
  main().catch((err) => {
    console.error(`\n${err.message}\n`);
    // Setting the code rather than calling process.exit() lets undici tear its
    // sockets down first. Exiting under an in-flight fetch tripped a libuv
    // assertion on Windows (UV_HANDLE_CLOSING in async.c), so a plain API error
    // surfaced as a hard crash on top of its own message.
    process.exitCode = 1;
  });
}
