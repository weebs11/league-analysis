/* LoL Matchup Coach — dashboard logic */
'use strict';

// ---------- tiny helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Minimal markdown for chat replies: bold, italics, inline code, lists, paragraphs.
function md(text) {
  const lines = String(text || '').split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
    if (/^[-*] /.test(line)) {
      if (!inList) { html += '<ul class="tip-list">'; inList = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.startsWith('### ')) html += `<h4>${inline(line.slice(4))}</h4>`;
      else if (line.startsWith('## ')) html += `<h4>${inline(line.slice(3))}</h4>`;
      else if (line) html += `<p>${inline(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function badge(text, cls) {
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}
function levelBadge(level) {
  const cls = String(level || '').toLowerCase().replace(/\s+/g, '');
  return badge(level, cls);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- splash art ----------
// Served by our own server, which caches Riot's art on disk.
function splashUrl(ddragonId) {
  return `/img/champion/splash/${ddragonId}`;
}
function setSplash(el, ddragonId) {
  if (!el) return;
  if (ddragonId) {
    el.classList.add('has-splash');
    el.style.setProperty('--splash', `url('${splashUrl(ddragonId)}')`);
  } else {
    el.classList.remove('has-splash');
    el.style.removeProperty('--splash');
  }
}
// Rotating hero art for the home screen.
const HERO_CHAMPS = ['Jinx', 'Ahri', 'Yasuo', 'Lux', 'Garen', 'Kaisa', 'Ezreal', 'Vi', 'Thresh', 'Leona'];
const heroChamp = HERO_CHAMPS[Math.floor(Math.random() * HERO_CHAMPS.length)];

// ---------- coaching models ----------
const MODEL_OPTIONS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', desc: 'smartest coaching', cost: '10–15¢ / game' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', desc: 'great quality', cost: '6–9¢ / game' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', desc: 'fastest and cheapest', cost: '1–2¢ / game' },
];
function modelLabel(id) {
  return MODEL_OPTIONS.find((m) => m.id === id)?.name || id || '';
}
// Cached /api/settings info for the sidebar attribution line.
let settingsInfo = null;
async function loadSettingsInfo() {
  settingsInfo = await api('/api/settings').catch(() => null);
}

// ---------- state ----------
let state = null;           // latest server snapshot
let currentPlan = null;     // generated game plan
let currentCsAdvice = null; // champ select advice
let chatHistory = [];

// ---------- SSE ----------
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    try {
      const snap = JSON.parse(ev.data);
      onState(snap);
    } catch { /* ignore malformed frame */ }
  };
  es.addEventListener('coachprogress', (ev) => {
    try {
      onCoachProgress(JSON.parse(ev.data));
    } catch { /* ignore malformed frame */ }
  });
  es.onerror = () => {
    // EventSource auto-reconnects; reflect uncertainty in the pill.
    setPill('waiting', 'Reconnecting…');
  };
}

function onState(snap) {
  const prevPhase = state?.phase;
  state = snap;
  renderStatus();
  if (snap.phase === 'champselect') {
    showView('champselect');
    renderChampSelect();
  } else if (snap.phase === 'ingame') {
    showView('ingame');
    renderGameHeader();
    if (prevPhase !== 'ingame') resetGamePanels();
    loadLaneCompare();
  } else {
    showView('waiting');
    if (prevPhase === 'ingame' || prevPhase === 'champselect') {
      currentPlan = null; currentCsAdvice = null; csBriefingKey = null; chatHistory = [];
      resetLaneCompare();
      home.loaded = false; // a finished game means fresh history for the home screen
    }
    renderWaiting();
  }
}

// ---------- status / views ----------
function setPill(cls, text) {
  const pill = $('#status-pill');
  pill.className = `status-pill ${cls}`;
  $('#status-text').textContent = text;
}

function renderStatus() {
  if (!state) return;
  const meta = $('#topbar-meta');
  if (state.phase === 'ingame') {
    setPill('ingame', 'In game');
    // renderGameHeader fills the meta with mode + minutes right after.
  } else if (state.phase === 'champselect') {
    setPill('champselect', 'Champion select');
    meta.textContent = '';
  } else {
    if (state.clientDetected) setPill('waiting detected', 'Client detected');
    else setPill('waiting', 'Waiting for League');
    meta.textContent = state.ddragonVersion ? `Patch ${state.ddragonVersion}` : '';
  }
}

// ---------- sections (user navigation) ----------
// The Live section keeps the original behaviour: the game decides what's on
// screen. History is the first place the *user* has an opinion, so the phase
// machine is not allowed to navigate away from it — it offers a link instead.
let activeSection = 'live';
let noticedPhase = null;

function showSection(name) {
  activeSection = name;
  $('#section-live').classList.toggle('hidden', name !== 'live');
  $('#section-history').classList.toggle('hidden', name !== 'history');
  $('#section-champions').classList.toggle('hidden', name !== 'champions');
  $$('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
  if (name === 'live') {
    hidePhaseNotice();
    applyCurrentPhase();
  } else if (name === 'history') {
    refreshHistory();
  } else if (name === 'champions') {
    refreshChampions();
  }
}

const PHASE_VIEWS = ['waiting', 'champselect', 'ingame'];

function showPhaseView(name) {
  for (const v of PHASE_VIEWS) $(`#view-${v}`).classList.toggle('hidden', v !== name);
}

function applyCurrentPhase() {
  if (!state) return;
  showPhaseView(PHASE_VIEWS.includes(state.phase) ? state.phase : 'waiting');
}

const PHASE_NOTICE = {
  champselect: 'Champion select started.',
  ingame: 'Your game has started.',
};

function notePhaseChange(name) {
  if (name === noticedPhase) return;
  noticedPhase = name;
  const label = PHASE_NOTICE[name];
  if (!label) return hidePhaseNotice();
  $('#phase-notice-text').textContent = label;
  $('#phase-notice').classList.remove('hidden');
}

function hidePhaseNotice() {
  $('#phase-notice').classList.add('hidden');
}

function showView(name) {
  if (activeSection !== 'live') { notePhaseChange(name); return; }
  noticedPhase = name;
  showPhaseView(name);
}

// ---------- home (waiting) ----------
// The hero pulls its headline and stats from local history; everything is
// cached per session and refreshed when a game ends.
const home = { loaded: false, loading: false, summary: null, rank: null, matches: null, total: 0 };

function renderWaiting() {
  setSplash($('#home-hero'), heroChamp);
  $('#hero-eyebrow').innerHTML = state.clientDetected
    ? `${icon('radar', 14)}Watching for a game`
    : `${icon('radar', 14)}Start League on this computer — watching for the client`;
  if (!home.loaded && !home.loading) loadHome();
  else renderHome();
}

async function loadHome() {
  home.loading = true;
  const [summary, rank, matches] = await Promise.allSettled([
    api('/api/history/summary?window=20'),
    api('/api/history/rank'),
    api('/api/history/matches?page=0&size=6'),
  ]);
  home.summary = summary.status === 'fulfilled' ? summary.value : null;
  home.rank = rank.status === 'fulfilled' ? rank.value : null;
  home.matches = matches.status === 'fulfilled' ? matches.value.rows : null;
  home.total = matches.status === 'fulfilled' ? matches.value.total : 0;
  home.loaded = true;
  home.loading = false;
  renderHome();
}

function latestRankPoint() {
  const queues = home.rank?.queues || [];
  for (const queueId of [420, 440]) {
    const q = queues.find((x) => x.queueId === queueId && x.points?.length);
    if (q) return [...q.points].sort((a, b) => a.at - b.at).pop();
  }
  return null;
}

function renderHome() {
  const s = home.summary;
  const rank = latestRankPoint();
  $('#hero-headline').textContent = rank ? pointLabel(rank) : 'Ready when you are';
  const stats = [];
  if (s?.playableMatches > 0) {
    stats.push(`<span><b class="w">${s.record.wins}</b>W <b class="l">${s.record.losses}</b>L last ${Math.min(s.window, s.playableMatches)}</span>`);
    if (s.baseline?.csPerMin?.current != null) stats.push(`<span>${s.baseline.csPerMin.current} CS/min</span>`);
    if (s.baseline?.killParticipation?.current != null) stats.push(`<span>${pctText(s.baseline.killParticipation.current)} kill participation</span>`);
  } else {
    stats.push(`<span class="muted">Your record, rank and recent games appear here after you play.</span>`);
  }
  $('#hero-stats').innerHTML = stats.join('<span class="sep"></span>');

  const rows = home.matches || [];
  $('#home-recent-meta').textContent = home.total ? `recorded locally · ${home.total} kept` : '';
  $('#home-recent').innerHTML = rows.length
    ? rows.map(homeRowHtml).join('')
    : `<p class="muted">No games recorded yet. They appear here automatically after you play — leave the app running.</p>`;
  $$('#home-recent .home-row').forEach((el) => {
    el.onclick = () => { showSection('history'); openMatchDetail(el.dataset.match); };
  });
}

function homeRowHtml(m) {
  return `<button class="home-row ${outcomeClass(m)}" data-match="${esc(m.matchId)}">
    <span class="stripe"></span>
    ${m.championImage ? `<img src="${esc(m.championImage)}" alt="" loading="lazy" />` : '<span></span>'}
    <span style="min-width:0">
      <span class="hr-champ">${esc(m.championName || '?')}</span>
      <span class="hr-sub">${esc(m.role || '')}${m.role ? ' · ' : ''}${esc(m.queueLabel || '')}</span>
    </span>
    <span class="r">${m.kills}/${m.deaths}/${m.assists}</span>
    <span class="r">${m.cs} CS <span class="muted">${m.csPerMin ?? '—'}</span></span>
    <span class="r">${signed(m.csDiffVsLaneOpponent)}</span>
    <span class="r">
      <span class="hr-outcome">${outcomeLabel(m)}</span>
      <span class="hr-when">${fmtDuration(m.durationSec)} · ${esc(relTime(m.playedAt))}</span>
    </span>
  </button>`;
}

// ---------- champ select ----------
function csPlayerRow(p, side) {
  const c = p.champion;
  if (!c) {
    return `<div class="cs-player pending">
      <span class="q">?</span>
      <span style="font-size:13px">${p.locked ? 'Locked — unknown' : 'Not picked yet'}</span>
    </div>`;
  }
  return `<div class="cs-player ${side} ${p.isMe ? 'me' : ''}" title="${esc(c.name)}${p.role ? ' — ' + esc(p.role) : ''}">
    <img src="${esc(c.image)}" alt="" />
    <span class="who">
      <span class="n">${esc(c.name)}</span>
      ${p.role ? `<span class="rl">${esc(p.role)}</span>` : ''}
    </span>
    ${p.isMe ? '<span class="you-chip">You</span>' : ''}
  </div>`;
}

function renderChampSelect() {
  const cs = state.champSelect;
  if (!cs) return;
  $('#cs-myteam').innerHTML = cs.myTeam.map((p) => csPlayerRow(p, 'ally')).join('');
  const known = cs.theirTeam.filter((p) => p.champion).length;
  const enemyRows = cs.theirTeam.map((p) => csPlayerRow(p, 'enemy'));
  while (enemyRows.length < 5) enemyRows.push(csPlayerRow({}, 'enemy'));
  $('#cs-theirteam').innerHTML = enemyRows.join('');
  $('#cs-enemy-count').textContent = `${known} of 5`;
  $('#cs-bans').innerHTML = cs.bans.length
    ? cs.bans.map((b) => `<img src="${esc(b.image)}" title="${esc(b.name)}" alt="${esc(b.name)}" />`).join('')
    : '<span class="muted">None yet</span>';
  $('#cs-bans-wrap').classList.toggle('hidden', false);

  if (cs.me?.champion) loadCsBriefing();
  else if (currentCsAdvice) renderCsAdvice(currentCsAdvice);
}

function renderCsAdvice(advice) {
  currentCsAdvice = advice;
  const yc = advice.yourChampion;
  const me = state?.champSelect?.me;
  const champ = me?.champion;
  const parts = [];

  if (champ) {
    const tags = [me.role, ...(champ.tags || [])].filter(Boolean);
    parts.push(`<section class="champ-banner" id="cs-banner">
      <div class="cb-inner">
        <img class="cb-portrait" src="${esc(champ.image)}" alt="" />
        <div>
          <h2>${esc(champ.name)}${champ.title ? ` <span class="cb-title">${esc(champ.title)}</span>` : ''}</h2>
          <div class="cb-tags">${tags.map((t, i) => `<span${i ? ' class="dim"' : ''}>${esc(t)}</span>`).join('')}</div>
        </div>
        <div class="spacer"></div>
        <div class="cb-right">
          <div class="lbl">Briefing</div>
          <div class="val">${advice.basicMode ? "Riot's official data" : `built-in library${advice.briefingPatch ? ` · patch ${esc(advice.briefingPatch)}` : ''}`}</div>
        </div>
      </div>
    </section>`);
  }
  if (advice.basicMode) {
    parts.push(`<div class="notice-box">This champion isn't in the built-in briefing library yet (probably a brand-new release) — showing Riot's official data instead.</div>`);
  }

  const worksBody = yc ? `
    <p style="margin:0 0 14px">${esc(yc.playstyleSummary)}</p>
    ${yc.strengths?.length ? `<div class="sw-row">${icon('trending-up', 15, 'good')}<div><b class="good">Strengths</b> — ${esc(yc.strengths.join(' · '))}</div></div>` : ''}
    ${yc.weaknesses?.length ? `<div class="sw-row">${icon('trending-down', 15, 'bad')}<div><b class="bad">Weaknesses</b> — ${esc(yc.weaknesses.join(' · '))}</div></div>` : ''}` : '';
  const firstBody = `
    ${advice.earlyGamePlan ? `<p style="margin:0 0 14px">${esc(advice.earlyGamePlan)}</p>` : ''}
    ${advice.quickTips?.length ? `<ul class="tip-list compact">${advice.quickTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}`;
  if (worksBody.trim() || firstBody.trim()) {
    parts.push(`<div class="two-col">
      <section class="panel">
        <div class="panel-head"><span class="crest">${icon('book-open', 14)}</span><h3>How your champion works</h3></div>
        ${worksBody}
      </section>
      <section class="panel">
        <div class="panel-head">${icon('clock', 15)}<h3>Your first few minutes</h3></div>
        ${firstBody}
      </section>
    </div>`);
  }

  if (yc?.abilities?.length) {
    parts.push(`<section class="panel">
      <div class="panel-head">${icon('zap', 15)}<h3>Abilities</h3>
        <span class="head-meta" style="margin-left:auto">plain-language, in the order you'll use them</span></div>
      <div class="ab-grid">${yc.abilities.map((a) => `
        <div class="ab-card">
          <span class="ability-key">${esc(a.key === 'Passive' ? 'P' : a.key)}</span>
          <div style="min-width:0">
            <div class="ab-name">${esc(a.name)}</div>
            <div class="ab-how">${esc(a.howToUseIt)}</div>
          </div>
        </div>`).join('')}</div>
    </section>`);
  }

  if (advice.knownEnemies?.length) {
    parts.push(`<section class="panel">
      <div class="panel-head">${icon('eye', 15)}<h3>Known enemies</h3></div>
      ${advice.knownEnemies.map((e) => `<p><b style="color:var(--gold-text)">${esc(e.champion)}:</b> ${esc(e.whatToExpect)}</p>`).join('')}
    </section>`);
  }
  parts.push(glossaryDetails(advice.glossary));
  $('#cs-advice').innerHTML = parts.join('');
  if (champ) setSplash($('#cs-banner'), champ.id);
}

// ---------- broadcast-style champion tiles (live game strip) ----------
function stripChamp(p) {
  const c = p.champion;
  const label = c ? c.name : (p.locked ? 'Unknown' : 'Picking…');
  const art = c
    ? `<img src="/img/champion/loading/${esc(c.id)}" alt="${esc(c.name)}"
        onerror="this.onerror=null;this.src='${esc(c.image)}'" />`
    : `<span class="strip-empty">?</span>`;
  return `<div class="strip-champ ${p.isMe ? 'me' : ''} ${c ? '' : 'empty'}" title="${esc(label)}${p.role ? ' — ' + esc(p.role) : ''}">
    ${art}
    ${p.isMe ? '<span class="you-tag">You</span>' : ''}
    <span class="plate">
      <span class="cn">${esc(label)}</span>
    </span>
  </div>`;
}

function renderGameHeader() {
  const g = state.game;
  if (!g) return;
  const mins = Math.floor((g.gameTime || 0) / 60);
  $('#topbar-meta').textContent = `${g.gameMode === 'CLASSIC' ? "Summoner's Rift" : g.gameMode} · ${mins} min`;
  $('#game-teams').innerHTML = `<div class="teams-inner">
    <div class="team-side ally">${g.allies.map(stripChamp).join('')}</div>
    <div class="vs">VS</div>
    <div class="team-side enemy">${g.enemies.map(stripChamp).join('')}</div>
  </div>`;
  setSplash($('#game-teams'), g.me?.champion?.id);
}

// Pre-coaching sidebar: the deterministic lane check renders separately into
// #lane-compare; this fills the rest (key hint + glossary chips).
function renderSideBasic() {
  const chips = (currentPlan?.glossary?.length ? currentPlan.glossary.map((g) => g.term) : STATIC_GLOSSARY.slice(0, 7).map(([t]) => t));
  const noKey = !state?.aiAvailable ? `
    <section class="side-panel">
      <div class="side-label">${icon('key-round', 13)}No API key set</div>
      <p class="side-note" style="margin:0 0 14px">Basic mode uses Riot's own data: champion briefings, enemy abilities, damage profile. The AI coach adds the personalised plan.</p>
      <button class="btn secondary" id="btn-side-settings">${icon('settings', 14)}Add a key</button>
    </section>` : '';
  return `${noKey}
    <section class="side-panel">
      <div class="side-label">${icon('book-open', 13)}Terms in this plan</div>
      <div class="chip-row">${chips.map((t) => `<button class="chip" data-term="${esc(t)}">${esc(shortTerm(t))}</button>`).join('')}</div>
    </section>`;
}

// "CS (creep score)" reads better as a chip without the parenthetical.
function shortTerm(t) {
  return String(t).replace(/\s*\(.*\)$/, '');
}

function wireSideExtra() {
  const settings = $('#btn-side-settings');
  if (settings) settings.onclick = openSettings;
  $$('#game-side-extra .chip').forEach((el) => {
    el.onclick = () => {
      renderGlossaryModal(shortTerm(el.dataset.term));
      $('#glossary-search').value = shortTerm(el.dataset.term);
      $('#modal-glossary').classList.remove('hidden');
    };
  });
  const ask = $('#btn-side-ask');
  if (ask) ask.onclick = () => selectTab('chat');
}

function resetGamePanels() {
  currentPlan = null;
  chatHistory = [];
  resetLaneCompare(); // a new game means a new comparison — loadLaneCompare refills it
  $('#tabs').classList.add('hidden');
  $('#tab-panels').classList.add('hidden');
  $('#gen-bar').classList.remove('hidden');
  $('#btn-generate').classList.remove('hidden');
  $('#btn-generate').disabled = false;
  $('#btn-regenerate').classList.add('hidden');
  $('#gen-title').textContent = 'Ready to coach this game';
  $('#gen-sub').textContent = state?.aiAvailable
    ? 'A matchup breakdown, a plan for your role and an item path — tailored to all ten champions.'
    : 'No API key set — you\'ll get basic mode (Riot data only). Add a key in Settings for full coaching.';
  $('#game-side-extra').innerHTML = renderSideBasic();
  wireSideExtra();
  $('#chat-log').innerHTML = `<div class="chat-msg assistant"><p>Ask me anything about this game — "why that item?", "what does kiting mean?", "how do I fight Darius?"…</p></div>`;
}

// ---------- level-1 lane comparison ----------
// Deterministic stat-sheet math from /api/lanecompare — rendered the moment a
// game is detected, before (and independent of) any AI coaching. The server
// computes everything; this is display only.
let laneCompareKey = null; // fingerprint of the comparison currently shown or loading

function laneCompareKeyOf(g) {
  const side = (list) => (list || []).map((p) => `${p.champion?.id || ''}:${p.role || ''}`).join(',');
  return `${side(g.allies)}|${side(g.enemies)}`;
}

function resetLaneCompare() {
  laneCompareKey = null;
  $('#lane-compare').classList.add('hidden');
  $('#lane-compare').innerHTML = '';
}

async function loadLaneCompare() {
  const g = state?.game;
  if (!g) return;
  const key = laneCompareKeyOf(g);
  if (key === laneCompareKey) return; // already shown or in flight
  laneCompareKey = key;
  try {
    const data = await api('/api/lanecompare');
    if (laneCompareKey !== key) return; // superseded
    renderLaneCompare(data);
  } catch {
    if (laneCompareKey !== key) return;
    laneCompareKey = null; // let the next snapshot retry
    $('#lane-compare').classList.add('hidden');
  }
}

// Compact sidebar rows: role · both squares · the strongest driver · verdict.
// The full driver list rides in the tooltip.
function laneRowHtml(lane) {
  const v = lane.verdict;
  const verdictWord = v.side === 'ally' ? 'Ally' : v.side === 'enemy' ? 'Enemy' : 'Even';
  const drivers = v.drivers?.length
    ? v.drivers.map((d) => {
        const who = d.side === 'ally' ? lane.ally : lane.enemy;
        return `${who.champion.name} ${d.text}`;
      })
    : ['Stat sheets nearly identical'];
  const tip = v.side === 'even' ? drivers.join(' · ') : `${v.label} — ${drivers.join(' · ')}`;
  return `<div class="side-row ${lane.isMyLane ? 'me' : ''}" title="${esc(tip)}">
    <span class="role">${esc(lane.isMyLane ? 'You' : (lane.role || '—'))}</span>
    <img class="sq26 ally" src="${esc(lane.ally.champion.image)}" alt="${esc(lane.ally.champion.name)}" loading="lazy" />
    <img class="sq26 enemy" src="${esc(lane.enemy.champion.image)}" alt="${esc(lane.enemy.champion.name)}" loading="lazy" />
    <span class="driver">${esc(drivers[0])}</span>
    <span class="verdict ${v.side}">${verdictWord}</span>
  </div>`;
}

function renderLaneCompare(data) {
  const box = $('#lane-compare');
  if (!data?.lanes?.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<section class="side-panel accent">
    <div class="side-label">${icon('scale', 13)}Level-1 lane check
      <span class="side-label-meta" title="Who starts ahead, lane by lane, from the stat sheet alone — health, damage, resists, range. Abilities, passives, and runes aren't counted, so read an edge as a head start, not a verdict.">Riot stats · no AI</span>
    </div>
    ${data.lanes.map(laneRowHtml).join('')}
  </section>`;
  box.classList.remove('hidden');
}

// ---------- game plan rendering ----------
function glossaryDetails(glossary) {
  if (!glossary?.length) return '';
  return `<details class="glossary-inline"><summary>${icon('book-open', 13)} Terms used (${glossary.length})</summary>
    ${glossary.map((g) => `<div class="g-term"><b>${esc(g.term)}</b>${esc(g.definition)}</div>`).join('')}
  </details>`;
}

function kv(k, v, extra = '') {
  return `<div class="kv"><div class="k">${esc(k)}</div><div class="v">${extra}${esc(v)}</div></div>`;
}

// "12 / 11 / 10 / 9 / 8s" — collapsed to "12s" when the cooldown never changes.
// Shared by the coaching chips here and the champion-DB skill-order grid.
function cooldownTextOf(cooldowns) {
  if (!cooldowns?.length) return '';
  const perRank = cooldowns.every((c) => c === cooldowns[0]) ? [cooldowns[0]] : cooldowns;
  return `${perRank.join(' / ')}s`;
}

// Cooldown chip for an ability the coach called out. Shows the rank-1 number
// (the one that matters in lane) with the full per-rank list in the tooltip.
// Cooldowns are attached server-side from patch data; absent → no chip.
function cdChip(cooldowns) {
  if (!cooldowns?.length || !cooldowns[0]) return '';
  return `<span class="cd-chip" title="${esc(`Cooldown by rank: ${cooldownTextOf(cooldowns)}`)}">${icon('timer', 11)}${esc(String(cooldowns[0]))}s</span>`;
}

// The laning threat board: one row per enemy ability that can kill or catch
// you early, with its real cooldown so you know how long it's down after a miss.
// `roleOf` maps champion name -> role (from the plan itself, so it works
// identically for live games and archived history).
function earlyThreatsHtml(threats, imageFor, roleOf = new Map()) {
  if (!threats?.length) return '';
  return `<div class="early-threats">${threats.map((t) => {
    const img = imageFor(t.champion);
    const jungler = /jungl/i.test(roleOf.get(t.champion) || '');
    return `<div class="et-row">
      <div class="et-who" title="${esc(t.champion)}">
        ${img ? `<img src="${esc(img)}" alt="${esc(t.champion)}" />` : ''}
        <span class="ability-key">${esc(t.ability === 'Passive' ? 'P' : t.ability)}</span>
      </div>
      <div class="et-body">
        <div class="et-head">
          <span class="an">${esc(t.name)}</span>
          <span class="et-champ">${esc(t.champion)}</span>
          ${jungler ? `<span class="badge neutral et-tag" title="Comes from the fog of war — answer with wards, not sidesteps">Jungle</span>` : ''}
          ${cdChip(t.cooldowns)}
          ${t.unlockLevel ? `<span class="lvl-chip" title="${esc(`Unlocked at level ${t.unlockLevel} — this threat doesn't exist before then`)}">from lvl ${esc(String(t.unlockLevel))}</span>` : ''}
        </div>
        <div class="et-danger">${esc(t.danger)}</div>
        <div class="react">${icon('corner-down-right', 13)}${esc(t.play)}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// The *Html builders below are shared by the live tabs and the history detail
// view, so coaching renders identically whether you're mid-game or reviewing.
function planTabHtml(plan, imageFor = champImageByName) {
  const o = plan.overview || {};
  const gp = plan.gamePlan || {};
  const phase = (label, iconName, range, ph) => ph ? `
    <section class="panel">
      <div class="panel-head">${icon(iconName, 15)}<h3>${esc(label)}</h3>
        <span class="head-meta" style="margin-left:auto">${esc(range)}</span></div>
      <p style="margin:0 0 10px"><b class="goal">Goal —</b> ${esc(ph.goal || '')}</p>
      ${ph.tips?.length ? `<ul class="tip-list compact">${ph.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </section>` : '';
  const eg = gp.earlyGame;
  const roleOf = new Map((plan.enemyThreats || []).map((t) => [t.champion, t.role || '']));
  const early = eg ? `
    <section class="panel">
      <div class="panel-head">${icon('sunrise', 15)}<h3>Early game</h3><span class="head-meta">0–14 min</span></div>
      <p style="margin:0 0 18px"><b class="goal">Goal —</b> ${esc(eg.goal || '')}</p>
      ${eg.threats?.length ? `<div class="et-h danger">${icon('triangle-alert', 13)}Abilities that can kill you</div>${earlyThreatsHtml(eg.threats, imageFor, roleOf)}` : ''}
      ${eg.tips?.length ? `<div class="et-h good">${icon('check', 13)}How to win the lane</div><ul class="tip-list">${eg.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </section>` : '';
  const midLate = (gp.midGame || gp.lateGame)
    ? `<div class="two-col">
        ${phase('Mid game', 'swords', '14–25', gp.midGame)}
        ${phase('Late game', 'castle', '25+', gp.lateGame)}
      </div>`
    : '';
  return `
    ${plan.basicMode ? `<div class="notice-box">Basic mode (no API key) — showing Riot's official data. Add an Anthropic API key in Settings for a personalized plan.</div>` : ''}
    <section class="panel">
      <div class="panel-head"><span class="crest">${icon('map', 14)}</span><h3>The shape of this game</h3></div>
      <p style="margin:0">${esc(o.summary || '')}</p>
      <div class="kv-grid">
        ${kv('Difficulty', o.matchupDifficulty ? '' : '—', o.matchupDifficulty ? levelBadge(o.matchupDifficulty) : '')}
        ${kv('Remember this', o.keyPrinciple || '—')}
        ${kv('How your team wins', o.winCondition || '—')}
      </div>
    </section>
    ${early}
    ${midLate}
    ${gp.teamfightRole ? `<section class="panel">
      <div class="panel-head">${icon('users', 15)}<h3>Your job in teamfights</h3></div>
      <p style="margin:0">${esc(gp.teamfightRole)}</p>
    </section>` : ''}
    ${glossaryDetails(plan.glossary)}`;
}
function renderPlanTab(plan) { $('#panel-plan').innerHTML = planTabHtml(plan); }

function matchupTabHtml(plan) {
  const lm = plan.laneMatchup;
  if (!lm) {
    return `<div class="panel"><p class="muted" style="margin:0">Lane matchup analysis needs the AI coach — add an Anthropic API key in Settings.</p></div>`;
  }
  return `
    <section class="panel">
      <div class="panel-head">${icon('crosshair', 15)}<h3>How this lane plays out</h3></div>
      <p style="margin:0">${esc(lm.analysis || '')}</p>
      <div class="kv-grid">
        ${kv('Stronger early', lm.whoIsStrongerEarly || '—', lm.whoIsStrongerEarly === 'You' ? badge('You', 'low') + ' ' : lm.whoIsStrongerEarly === 'Enemy' ? badge('Enemy', 'high') + ' ' : '')}
        ${kv('When to trade damage', lm.tradingPattern || '—')}
        ${kv('Danger windows', lm.dangerWindows || '—')}
      </div>
      ${lm.tips?.length ? `<div class="et-h good">${icon('check', 13)}Lane tips</div><ul class="tip-list">${lm.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </section>`;
}
function renderMatchupTab(plan) { $('#panel-matchup').innerHTML = matchupTabHtml(plan); }

function champImageByName(name) {
  const all = [...(state?.game?.enemies || []), ...(state?.game?.allies || [])];
  const found = all.find((p) => p.champion?.name === name);
  return found?.champion?.image || null;
}

// imageFor is injectable so history detail can resolve portraits from the
// archived match rather than from whatever game is live right now.
function threatsTabHtml(plan, imageFor = champImageByName) {
  const threats = plan.enemyThreats || [];
  return threats.length
    ? `<p class="muted" style="margin:0 0 12px">Ordered by how dangerous they are <b>to you specifically</b>.</p>` +
      threats.map((t) => {
        const img = imageFor(t.champion);
        return `<div class="panel threat-card">
          <div class="threat-head">
            ${img ? `<img src="${esc(img)}" alt="${esc(t.champion)}" />` : ''}
            <div><div class="t-name">${esc(t.champion)}</div><div class="t-role">${esc(t.role || '')}</div></div>
            <div class="spacer"></div>
            ${levelBadge(t.threatLevel)}
          </div>
          <p>${esc(t.summary || '')}</p>
          ${(t.keyAbilities || []).map((a) => `
            <div class="ability-row">
              <div class="ability-key" title="${esc(a.key)}">${esc(a.key === 'Passive' ? 'P' : a.key)}</div>
              <div class="ability-body">
                <span class="an">${esc(a.name)}</span>${cdChip(a.cooldowns)} — ${esc(a.whatItDoes)}
                ${a.howToReact ? `<div class="react">${icon('corner-down-right', 13)}${esc(a.howToReact)}</div>` : ''}
              </div>
            </div>`).join('')}
          ${t.howToPlayAgainst ? `<p style="margin-bottom:0"><b style="color:var(--gold-text)">How to play against ${esc(t.champion)}:</b> ${esc(t.howToPlayAgainst)}</p>` : ''}
        </div>`;
      }).join('')
    : `<div class="panel"><p class="muted" style="margin:0">No threat data.</p></div>`;
}
function renderThreatsTab(plan) { $('#panel-threats').innerHTML = threatsTabHtml(plan); }

function itemsTabHtml(plan) {
  const it = plan.itemization || {};
  const profCls = it.enemyDamageProfile === 'Mostly Physical' ? 'physical' : it.enemyDamageProfile === 'Mostly Magic' ? 'magic' : 'mixed';
  const core = (it.coreBuild || []).map((s, i) => `
    <div class="build-step">
      <div class="idx">${i + 1}</div>
      <div><div class="item-n">${itemRefHtml(s.item)}</div><div class="item-w">${esc(s.why)}</div></div>
    </div>`).join('');
  const head = (name, label, meta = '') => `<div class="panel-head">${icon(name, 15)}<h3>${label}</h3>${meta ? `<span class="head-meta" style="margin-left:auto">${meta}</span>` : ''}</div>`;
  return `
    ${plan.basicMode ? `<div class="notice-box">Basic mode can only analyze the enemy damage profile. Add an Anthropic API key in Settings to get a full build path — starting items, core build order, boots, and situational swaps with reasons.</div>` : ''}
    ${it.startingItems?.items?.length ? `
    <section class="panel">
      ${head('shopping-cart', 'Start with')}
      <p style="margin:0 0 6px"><b>${it.startingItems.items.map(itemRefHtml).join(' + ')}</b></p>
      <p class="muted" style="margin:0">${esc(it.startingItems.why || '')}</p>
    </section>` : ''}
    ${core ? `<section class="panel">${head('brick-wall', 'Core build', 'in order')}${core}</section>` : ''}
    ${it.boots?.item ? `<section class="panel">${head('footprints', 'Boots')}<p style="margin:0"><b>${itemRefHtml(it.boots.item)}</b> — ${esc(it.boots.why || '')}</p></section>` : ''}
    ${it.situational?.length ? `
    <section class="panel">
      ${head('shuffle', 'Situational swaps')}
      ${it.situational.map((s) => `<div class="build-step"><div class="idx">→</div><div><div class="item-n">${itemRefHtml(s.item)}</div><div class="item-w">Buy when: ${esc(s.buyWhen)}</div></div></div>`).join('')}
    </section>` : ''}
    <section class="panel">
      ${head('shield', 'Defending against this team')}
      <p style="margin:0 0 6px">Enemy damage profile: ${badge(it.enemyDamageProfile || 'Mixed', profCls)}</p>
      <p style="margin:0">${esc(it.defensiveAdvice || '')}</p>
    </section>`;
}
function renderItemsTab(plan) { $('#panel-items').innerHTML = itemsTabHtml(plan); }

// ---------- coached sidebar ----------
let planGeneratedAt = null;

// Threat level → meter fill + color for the sidebar danger ranking.
function threatMeter(level) {
  const l = String(level || '').toLowerCase();
  if (/extreme|very/.test(l)) return { pct: 95, color: 'var(--red)', label: 'High' };
  if (/high|hard/.test(l)) return { pct: 78, color: 'var(--red)', label: 'High' };
  if (/mod|mixed|medium/.test(l)) return { pct: 52, color: 'var(--gold)', label: 'Mod' };
  return { pct: 24, color: 'var(--green)', label: 'Low' };
}

function sideRankingHtml(plan) {
  const threats = plan.enemyThreats || [];
  if (!threats.length) return '';
  return `<section class="side-panel">
    <div class="side-label">${icon('skull', 13)}Danger ranking</div>
    ${threats.map((t) => {
      const m = threatMeter(t.threatLevel);
      const img = champImageByName(t.champion);
      return `<div class="rank-row" title="${esc(t.summary || t.champion)}">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" />` : ''}
        <span class="n">${esc(t.champion)}</span>
        <span class="meter"><i style="width:${m.pct}%;background:${m.color}"></i></span>
        <span class="lv" style="color:${m.color}">${m.label}</span>
      </div>`;
    }).join('')}
  </section>`;
}

function sideItemPathHtml(plan) {
  const it = plan.itemization || {};
  const names = [
    ...(it.startingItems?.items?.slice(0, 1) || []),
    ...(it.coreBuild || []).map((s) => s.item),
    ...(it.boots?.item ? [it.boots.item] : []),
  ];
  const resolved = names
    .map((n) => itemIndex.byName.get(String(n).toLowerCase()))
    .filter(Boolean);
  if (resolved.length < 2) return '';
  const last = resolved[resolved.length - 1];
  const lead = resolved.slice(0, -1);
  const prof = it.enemyDamageProfile ? `vs ${it.enemyDamageProfile.toLowerCase()}` : '';
  const note = it.coreBuild?.[0]?.why || '';
  return `<section class="side-panel">
    <div class="side-label">${icon('sword', 13)}Item path
      ${prof ? `<span class="side-label-meta">${esc(prof)}</span>` : ''}
    </div>
    <div class="side-items">
      ${lead.map((i) => `<img src="/img/item/${i.id}" alt="" title="${esc(itemTitle(i))}" loading="lazy" />`).join('')}
      <span class="chev">${icon('chevron-right', 14)}</span>
      <img class="final" src="/img/item/${last.id}" alt="" title="${esc(itemTitle(last))}" loading="lazy" />
    </div>
    ${note ? `<div class="side-note">${esc(note)}</div>` : ''}
  </section>`;
}

function renderSideCoached(plan) {
  const attribution = plan.basicMode
    ? `${icon('shield-half', 12)}Riot data · no AI`
    : `${icon('sparkles', 12)}${esc(modelLabel(settingsInfo?.model))} · generated ${esc(relTime(planGeneratedAt) || 'just now')}`;
  $('#game-side-extra').innerHTML = `
    ${sideRankingHtml(plan)}
    ${sideItemPathHtml(plan)}
    ${plan.glossary?.length ? `<section class="side-panel">
      <div class="side-label">${icon('book-open', 13)}Terms in this plan</div>
      <div class="chip-row">${plan.glossary.map((g) => `<button class="chip" data-term="${esc(g.term)}">${esc(shortTerm(g.term))}</button>`).join('')}</div>
    </section>` : ''}
    <button class="btn primary big block" id="btn-side-ask">${icon('message-circle', 16)}Ask the coach</button>
    <div class="side-attribution">${attribution}</div>`;
  wireSideExtra();
}

function renderPlan(plan) {
  currentPlan = plan;
  planGeneratedAt = Date.now();
  renderPlanTab(plan);
  renderMatchupTab(plan);
  renderThreatsTab(plan);
  renderItemsTab(plan);
  renderSideCoached(plan);
  $('#tabs').classList.remove('hidden');
  $('#tab-panels').classList.remove('hidden');
  $('#btn-generate').classList.add('hidden');
  $('#btn-regenerate').classList.remove('hidden');
  $('#gen-title').textContent = plan.basicMode ? 'Basic guidance (Riot data)' : 'Your coaching breakdown is ready';
  $('#gen-sub').textContent = 'Items or enemies changed a lot? Refresh to re-analyze with the current game state.';
  selectTab('plan');
}

// ---------- tabs ----------
function selectTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  for (const p of ['plan', 'matchup', 'threats', 'items', 'chat']) {
    $(`#panel-${p}`).classList.toggle('hidden', p !== name);
  }
}

// ---------- generation ----------
// Live progress for the in-flight generation, pushed by the server over SSE
// as `coachprogress` events. Only rendered while our own request is running.
let genInFlight = false;

const GEN_PHASE_LABELS = {
  preparing: 'Reading champion data and checking the current-patch meta…',
  thinking: 'The coach is thinking through your matchup…',
  writing: 'Writing your game plan…',
};

function onCoachProgress(p) {
  if (!genInFlight || !p?.phase) return;
  if (p.phase === 'error') return; // the request's catch handler renders the error
  const label = GEN_PHASE_LABELS[p.phase];
  if (label) $('#gen-sub').textContent = label;
  const fill = $('#gen-progress-fill');
  fill.style.width = `${Math.max(0, Math.min(100, p.pct || 0))}%`;
  fill.classList.toggle('indeterminate', p.phase === 'preparing');
}

async function generatePlan(force = false) {
  const btn = force ? $('#btn-regenerate') : $('#btn-generate');
  btn.disabled = true;
  genInFlight = true;
  $('#gen-title').textContent = state?.aiAvailable ? 'Analyzing your matchup…' : 'Building basic guidance…';
  $('#gen-sub').textContent = state?.aiAvailable
    ? 'This takes 30–90 seconds — perfect time to buy your starting items.'
    : 'Assembling Riot\'s official data for this game.';
  $('#gen-progress').classList.remove('hidden');
  onCoachProgress({ phase: 'preparing', pct: 3 });
  try {
    const { plan } = await api('/api/coach/gameplan', { method: 'POST', body: { force } });
    onCoachProgress({ phase: 'writing', pct: 100 });
    renderPlan(plan);
  } catch (err) {
    $('#gen-title').textContent = 'Something went wrong';
    $('#gen-sub').innerHTML = `<span class="error-box" style="display:inline-block">${esc(err.message)}</span>`;
    $('#btn-generate').classList.remove('hidden');
  } finally {
    genInFlight = false;
    $('#gen-progress').classList.add('hidden');
    $('#gen-progress-fill').style.width = '0%';
    $('#gen-progress-fill').classList.remove('indeterminate');
    btn.disabled = false;
  }
}

// The briefing is pre-generated for every champion, so it loads automatically
// whenever the hovered/locked champion or the visible enemy picks change.
let csBriefingKey = null; // fingerprint of the briefing currently shown or loading

async function loadCsBriefing() {
  const cs = state?.champSelect;
  if (!cs?.me?.champion) return;
  const key = `${cs.me.champion.id}|${cs.theirTeam.map((m) => m.champion?.id || '').join(',')}`;
  if (key === csBriefingKey) return; // already shown or in flight
  csBriefingKey = key;
  if (!currentCsAdvice) {
    $('#cs-advice').innerHTML = `<div class="loading"><div class="spinner"></div> Loading your briefing…</div>`;
  }
  try {
    const { advice } = await api('/api/coach/champselect', { method: 'POST', body: {} });
    if (csBriefingKey !== key) return; // superseded by a newer pick
    renderCsAdvice(advice);
  } catch (err) {
    if (csBriefingKey !== key) return;
    csBriefingKey = null; // let the next snapshot retry
    $('#cs-advice').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// ---------- chat ----------
function pushChat(role, html, cls = '') {
  const div = document.createElement('div');
  div.className = `chat-msg ${role} ${cls}`;
  div.innerHTML = html;
  $('#chat-log').appendChild(div);
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
  return div;
}

async function sendChat(text) {
  chatHistory.push({ role: 'user', content: text });
  pushChat('user', `<p>${esc(text)}</p>`);
  const thinking = pushChat('assistant', '<p>Thinking…</p>', 'thinking');
  try {
    const { reply } = await api('/api/coach/chat', { method: 'POST', body: { messages: chatHistory } });
    chatHistory.push({ role: 'assistant', content: reply });
    thinking.classList.remove('thinking');
    thinking.innerHTML = md(reply);
  } catch (err) {
    thinking.classList.remove('thinking');
    thinking.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    chatHistory.pop(); // let the user retry the same question
  }
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
}

// ---------- static glossary ----------
const STATIC_GLOSSARY = [
  ['CS (creep score)', 'How many minions and monsters you\'ve killed. Gold comes mostly from CS — a good benchmark is 7–8 per minute.'],
  ['Last-hitting', 'Landing the killing blow on a minion. Only the killing blow gives gold.'],
  ['Wave management', 'Controlling where the minion wave sits. Freezing it near your tower keeps you safe; pushing it lets you roam or recall.'],
  ['Freeze', 'Holding the minion wave in one spot (usually near your tower) so the enemy must overextend to farm.'],
  ['Slow push', 'Building up a big minion wave that crashes into the enemy tower later — great before objectives.'],
  ['Trading', 'Exchanging damage with your lane opponent. Good trades happen when your abilities are up and theirs aren\'t.'],
  ['All-in', 'Committing everything (abilities, summoners, ignite) to kill someone. Only all-in when you\'re sure you win the fight.'],
  ['Power spike', 'A moment your champion gets much stronger — often a level (2, 6, 11) or completing a key item.'],
  ['Gank', 'When the jungler (or another laner) shows up to your lane to surprise-attack.'],
  ['Roam', 'Leaving your lane to help another lane or take objectives.'],
  ['Ward / Vision', 'Placing wards reveals parts of the map. Vision wins games — you can\'t dodge what you can\'t see.'],
  ['Crowd control (CC)', 'Anything that limits enemy control: stuns, roots, slows, knock-ups, charms, fears.'],
  ['Peel', 'Protecting your fragile damage dealers by blocking, slowing, or CC-ing enemies that dive them.'],
  ['Kiting', 'Attacking while moving away, so melee enemies can never quite reach you. Core ADC skill.'],
  ['Engage', 'Starting a fight, usually with hard CC or a big gap-closer.'],
  ['Disengage', 'Tools that stop or undo a fight — knockbacks, slows, shields.'],
  ['Poke', 'Chipping enemies down with long-range abilities before a real fight starts.'],
  ['Burst', 'Deleting someone with a fast combo, before they can react or be healed.'],
  ['Sustain', 'Healing or regeneration that keeps you in lane / fights longer.'],
  ['Tempo', 'Having time to act while the enemy is busy or dead — use it to take towers, dragons, or vision.'],
  ['Objectives', 'Dragons, Baron, Rift Herald, and towers. Games are won by objectives, not kills.'],
  ['Split push', 'Pushing a side lane alone to pressure towers while your team distracts elsewhere.'],
  ['Snowball', 'Turning a small lead into a bigger one — a fed player gets stronger and wins more fights.'],
  ['Fed', 'A player with lots of kills/gold. "Don\'t feed" = don\'t die repeatedly to the same person.'],
  ['Squishy', 'A fragile champion that dies fast (most mages, ADCs, assassins).'],
  ['Tank', 'A durable frontline champion who absorbs damage and starts fights.'],
  ['Carry', 'A champion who deals huge damage and can win fights almost alone if protected.'],
  ['Grievous Wounds (anti-heal)', 'A debuff from certain items that cuts all enemy healing by 40%. Buy it when an enemy heals a lot.'],
  ['Armor / Magic Resist', 'Armor reduces physical damage; magic resist (MR) reduces magic damage. Check what\'s killing you and buy accordingly.'],
  ['Recall (backing)', 'Pressing B to return to base. Best done after crashing a wave so you lose nothing.'],
  ['Summoner spells', 'Flash, Ignite, Heal, etc. Long cooldowns — track when enemies use theirs; a laner without Flash is gankable.'],
  ['Minimap ping', 'Alerts you send teammates: danger, on-my-way, missing enemy. Communication without typing.'],
];

function renderGlossaryModal(filter = '') {
  const f = filter.toLowerCase();
  const fromAi = (currentPlan?.glossary || []).map((g) => [g.term, g.definition]);
  const seen = new Set();
  const all = [...fromAi, ...STATIC_GLOSSARY].filter(([term]) => {
    const k = term.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return !f || k.includes(f);
  });
  $('#glossary-list').innerHTML = all.length
    ? all.map(([t, d]) => `<div class="g-term"><b>${esc(t)}</b>${esc(d)}</div>`).join('')
    : '<p class="muted">No matching terms.</p>';
}

// ---------- settings ----------
let settingsModel = MODEL_OPTIONS[0].id;

function renderModelOptions() {
  $('#model-options').innerHTML = MODEL_OPTIONS.map((m) => `
    <button type="button" class="model-option ${m.id === settingsModel ? 'selected' : ''}" data-model="${esc(m.id)}">
      <span class="mark"></span>
      <span style="flex:1"><span class="mo-name">${esc(m.name)}</span><span class="mo-desc">${esc(m.desc)}</span></span>
      <span class="mo-cost">${esc(m.cost)}</span>
    </button>`).join('');
  $$('#model-options .model-option').forEach((el) => {
    el.onclick = () => { settingsModel = el.dataset.model; renderModelOptions(); };
  });
}

async function openSettings() {
  const s = await api('/api/settings');
  $('#set-apikey').value = '';
  $('#set-apikey').placeholder = s.hasApiKey ? '•••••••• key saved — type to replace' : 'sk-ant-…';
  settingsModel = MODEL_OPTIONS.some((m) => m.id === s.model) ? s.model : MODEL_OPTIONS[0].id;
  renderModelOptions();
  $('#set-leaguepath').value = s.leaguePath || '';
  $('#modal-settings').classList.remove('hidden');
}

async function saveSettings() {
  const key = $('#set-apikey').value.trim();
  const body = {
    model: settingsModel,
    leaguePath: $('#set-leaguepath').value.trim(),
  };
  if (key) body.anthropicApiKey = key;
  await api('/api/settings', { method: 'POST', body });
  await loadSettingsInfo();
  $('#modal-settings').classList.add('hidden');
  const st = await api('/api/state');
  onState(st);
}

// ---------- match history ----------
const hist = { page: 0, size: 20, role: '', queue: '', total: 0 };

function fmtDuration(sec) {
  return `${Math.floor((sec || 0) / 60)}m`;
}

function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

// ---------- item index (icons + stat tooltips) ----------
// Coaching plans carry item NAMES (the prompt pins them to exact catalog
// names); this index turns them back into ids for icons and hover stats.
// Loaded once at boot from the same patch data that draws the icons. Until it
// arrives — or for a name the shop doesn't know — items render as plain text.
const itemIndex = { byName: new Map(), byId: new Map() };

async function loadItemIndex() {
  const { items } = await api('/api/items');
  for (const it of items) {
    itemIndex.byName.set(it.name.toLowerCase(), it);
    itemIndex.byId.set(it.id, it);
  }
}

function itemTitle(it) {
  const lines = [`${it.name} — ${it.gold}g`, ...(it.stats || [])];
  if (it.summary) lines.push(it.summary);
  return lines.join('\n');
}

// Icon + name, with the stat tooltip. Falls back to the bare name.
function itemRefHtml(name) {
  if (!name) return '';
  const it = itemIndex.byName.get(String(name).toLowerCase());
  if (!it) return esc(name);
  return `<span class="item-ref" title="${esc(itemTitle(it))}"><img class="item-icon sm" src="/img/item/${it.id}" alt="" loading="lazy" />${esc(name)}</span>`;
}

function itemImg(id) {
  if (!id) return `<span class="item-icon empty"></span>`;
  const it = itemIndex.byId.get(Number(id));
  return `<img class="item-icon" src="/img/item/${id}" alt="${esc(it?.name || '')}"${it ? ` title="${esc(itemTitle(it))}"` : ''} loading="lazy" />`;
}

// How a signed number should read: the class that colours it, the arrow, and an
// explicit "+" so a positive value never looks neutral. Shared by lane
// differentials and baseline trends, which say the same thing two ways.
function deltaParts(n) {
  if (n > 0) return { cls: 'up', sign: '+' };
  if (n < 0) return { cls: 'down', sign: '' };
  return { cls: '', sign: '' };
}

// A signed number, coloured by whether it's good news. Used for lane
// differentials, where "+" and "−" carry the whole message.
function signed(n, suffix = '') {
  if (n === null || n === undefined) return '<span class="muted">—</span>';
  const { cls, sign } = deltaParts(n);
  return `<span class="delta ${cls}">${sign}${n}${suffix}</span>`;
}

function pctText(v) {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

// A remake outranks win/loss: the game carries a win flag but did not really
// happen, so saying "Defeat" would be a lie and "Victory" a worse one.
function outcomeClass(m) {
  if (m?.isRemake) return 'remake';
  return m?.win ? 'win' : 'loss';
}

function outcomeLabel(m) {
  if (m?.isRemake) return 'Remake';
  return m?.win ? 'Victory' : 'Defeat';
}

async function refreshHistory() {
  await Promise.allSettled([loadSummary(), loadMatches(), loadRankChart()]);
}

async function loadSummary() {
  try {
    const s = await api('/api/history/summary?window=20');
    renderSummary(s);
  } catch {
    $('#history-summary').innerHTML = '';
  }
}

function baselineCell(label, b, fmt = (v) => v) {
  if (!b) return '';
  // A trend needs enough games behind it to mean anything; below that the
  // summary reports the value without pretending to know a direction.
  let trend = '';
  if (b.delta !== null && b.delta !== undefined) {
    const d = deltaParts(b.delta);
    trend = `<span class="trend ${d.cls}">${d.sign}${fmt(b.delta)}</span>`;
  }
  const bm = b.benchmark === null || b.benchmark === undefined
    ? ''
    : `<span class="bm">target ${fmt(b.benchmark)}</span>`;
  return `<div class="sum-stat">
    <span class="lbl">${esc(label)}</span>
    <span class="val">${esc(String(fmt(b.current)))}</span>
    ${bm}${trend}
  </div>`;
}

function renderSummary(s) {
  if (!s || s.playableMatches === 0) {
    $('#history-summary').innerHTML = `<p class="muted">No ranked matches recorded yet. They appear here automatically after you play — leave the app running.</p>`;
    return;
  }
  const rankNow = latestRankPoint();
  const champs = s.topChampions.map((c) => `
    <div class="sum-champ" title="${esc(c.championName || '')}">
      ${c.championImage ? `<img src="${esc(c.championImage)}" alt="${esc(c.championName || '')}" />` : ''}
      <div><div class="cn">${esc(c.championName || '?')}</div>
      <div class="cs2">${c.games} games · ${pctText(c.winrate)}</div></div>
    </div>`).join('');

  $('#history-summary').innerHTML = `
    <div class="sum-left">
      <div class="lbl">Last ${Math.min(s.window, s.playableMatches)} ranked games</div>
      <div class="sum-record">
        <span class="wl"><b class="w">${s.record.wins}</b>W <b class="l">${s.record.losses}</b>L</span>
        <span class="wr">${pctText(s.record.winrate)}</span>
        <span class="ctx">${s.role ? `mostly ${esc(s.role)}` : ''}${rankNow ? `${s.role ? ' · ' : ''}${esc(pointLabel(rankNow))}` : ''}</span>
      </div>
    </div>
    <div class="sum-stats">
      ${baselineCell('CS / min', s.baseline.csPerMin)}
      ${baselineCell('Kill participation', s.baseline.killParticipation, pctText)}
      ${baselineCell('Vision score', s.baseline.visionScore, (v) => Math.round(v * 10) / 10)}
      ${s.insufficientData ? `<div class="sum-note muted small">Trends need ${10 - s.playableMatches} more game(s).</div>` : ''}
    </div>
    <div class="spacer"></div>
    <div class="sum-champs">${champs}</div>`;
}

async function loadMatches() {
  const q = new URLSearchParams({ page: hist.page, size: hist.size });
  if (hist.role) q.set('role', hist.role);
  if (hist.queue) q.set('queue', hist.queue);
  try {
    const data = await api(`/api/history/matches?${q}`);
    hist.total = data.total;
    $('#hist-count').textContent = data.total
      ? `${data.total} matches recorded · ${data.rows.length} shown`
      : '';
    renderMatchList(data.rows);
    renderPager();
  } catch (err) {
    $('#history-list').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function matchRowHtml(m) {
  const kdaText = m.kda === null ? 'Perfect' : `${m.kda} KDA`;
  return `<button class="match-row ${outcomeClass(m)}" data-match="${esc(m.matchId)}">
    <span class="stripe"></span>
    ${m.championImage ? `<img class="mr-champ" src="${esc(m.championImage)}" alt="${esc(m.championName || '')}" />` : '<span class="mr-champ"></span>'}
    <span class="mr-main">
      <span class="mr-name">${esc(m.championName || '?')}</span>
      <span class="mr-sub">${esc(m.role || '')}${m.role ? ' · ' : ''}${esc(m.queueLabel)}</span>
    </span>
    <span class="mr-col">
      <b>${m.kills}/${m.deaths}/${m.assists}</b>
      <span class="muted">${esc(kdaText)}</span>
    </span>
    <span class="mr-col">
      <b>${m.cs}</b>
      <span class="muted">${m.csPerMin ?? '—'} / min</span>
    </span>
    <span class="mr-col">
      ${signed(m.csDiffVsLaneOpponent)}
    </span>
    <span class="mr-col right">
      <b>${outcomeLabel(m)}</b>
      <span class="muted">${fmtDuration(m.durationSec)} · ${esc(relTime(m.playedAt))}</span>
    </span>
  </button>`;
}

function renderMatchList(rows) {
  $('#history-list-head').classList.toggle('hidden', !rows.length);
  $('#history-list').innerHTML = rows.length
    ? rows.map(matchRowHtml).join('')
    : `<p class="muted">No matches match those filters.</p>`;
  $$('#history-list .match-row').forEach((el) => {
    el.onclick = () => openMatchDetail(el.dataset.match);
  });
}

function renderPager() {
  const pages = Math.ceil(hist.total / hist.size) || 1;
  if (pages <= 1) { $('#history-pager').innerHTML = ''; return; }
  $('#history-pager').innerHTML = `
    <button class="btn tiny" id="pg-prev" ${hist.page === 0 ? 'disabled' : ''}>Newer</button>
    <span class="muted">Page ${hist.page + 1} of ${pages}</span>
    <button class="btn tiny" id="pg-next" ${hist.page >= pages - 1 ? 'disabled' : ''}>Older</button>`;
  const prev = $('#pg-prev');
  const next = $('#pg-next');
  if (prev) prev.onclick = () => { hist.page--; loadMatches(); };
  if (next) next.onclick = () => { hist.page++; loadMatches(); };
}

// ---------- rank chart ----------
//
// LP over time, from the snapshots Forward Sync records (ADR-0006). Forward-only
// by nature — no Riot API serves historical LP — but externally observed
// snapshots may extend it. A focus + context chart keeps recent movement
// readable while preserving real elapsed time: the main plot opens to the
// latest 14 days and the navigator shows the full timeline.
//
// The horizontal scale follows the range group in use. Time presets measure
// real elapsed time (docs/research/rank-chart-long-range-design.md). Game
// presets measure games, one equal slot each, because "the last 25 games" drawn
// on a time axis is mostly the whitespace between sessions. Day labels stay on
// both scales, so a game-scale window still says which day it covers.
const RANK_SERIES = { 420: { color: '#0b9a8e', label: 'Solo/Duo' }, 440: { color: '#bd8a2e', label: 'Flex' } };
const RANK_TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond'];
const RANK_DIVS = ['IV', 'III', 'II', 'I'];
const RANK_PRESETS = [7, 14, 30, 'all'];
// Game-count presets window to the last N ranked games ('g25' etc.) and put the
// x-axis on the game scale. 'gall' shows every game the same way, but keeps its
// own id so the button you clicked lights up.
const RANK_GAME_PRESETS = ['g10', 'g25', 'g100', 'gall'];

function isGamePreset(preset) {
  return typeof preset === 'string' && preset.startsWith('g');
}

// A button's data-range back into a canonical preset value.
function parseRankRange(value) {
  return value === 'all' || value.startsWith('g') ? value : Number(value);
}

let rankChartInstance = null;
let rankChartResizeObserver = null;
let rankChartLayout = null;
let rankChartPreset = 14;
let rankChartOptionBuilder = null;
let rankChartMode = 'time';

function rankModeOf(preset) {
  return isGamePreset(preset) ? 'games' : 'time';
}

// Inverse of the server's ladderValue: a y-axis position back into words.
// Apex (≥2800) can't distinguish Master/GM/Challenger from the value alone, so
// point labels use the tier recorded on the snapshot; this is for tick marks.
function rankLabel(value) {
  if (value >= 2800) return `Master+ ${value - 2800} LP`;
  const t = Math.floor(value / 400);
  return `${RANK_TIERS[t] || '?'} ${RANK_DIVS[Math.floor((value % 400) / 100)]}`;
}

function pointLabel(p) {
  const tier = p.tier.charAt(0) + p.tier.slice(1).toLowerCase();
  return p.division ? `${tier} ${p.division} · ${p.lp} LP` : `${tier} · ${p.lp} LP`;
}

function rankSource(p) {
  return p.source === 'opgg' ? 'opgg' : 'forward-sync';
}

// Horizontal position of a snapshot or game under the scale currently in use.
function rankX(point) {
  return rankChartMode === 'games' ? point.gameX : point.chartX;
}

function rankDatum(p) {
  return { value: [rankX(p), p.value], snapshot: p };
}

function chartCss(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function rankColors() {
  return {
    text: chartCss('--text', '#d8e1e8'),
    dim: chartCss('--text-dim', '#8998a7'),
    line: chartCss('--hx-line', '#263747'),
    panel: chartCss('--hx-panel', '#111d2a'),
    deep: chartCss('--hx-deep', '#09131d'),
  };
}

// A reliable run is a sequence of Forward Sync observations no more than two
// days apart. Consecutive post-Match standings form the solid trend line;
// OP.GG points and longer observation gaps are deliberately kept outside it.
function rankRuns(points) {
  const runs = [];
  let run = [];
  for (const p of points) {
    const prev = run[run.length - 1];
    const continues = rankSource(p) === 'forward-sync'
      && (!prev || RankChartLayout.isCertainTransition(prev, p));
    if (!continues) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (rankSource(p) === 'forward-sync') run.push(p);
  }
  if (run.length) runs.push(run);
  return runs;
}

function rankGapPairs(points) {
  return points.slice(1).flatMap((p, i) => {
    const prev = points[i];
    const uncertain = !RankChartLayout.isCertainTransition(prev, p);
    return uncertain ? [[prev, p]] : [];
  });
}

function rankAxisBoundary(extent, edge) {
  let low = Number(extent.min);
  let high = Number(extent.max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return edge === 'min' ? 0 : 100;
  const pad = Math.max(25, (high - low) * 0.12);
  low -= pad;
  high += pad;
  if (high - low < 100) {
    const middle = (low + high) / 2;
    low = middle - 50;
    high = middle + 50;
  }
  return edge === 'min' ? Math.floor(low / 100) * 100 : Math.ceil(high / 100) * 100;
}

function rankWindow(preset) {
  if (preset === 'gall') return [...rankChartLayout.gameExtent];
  if (isGamePreset(preset)) {
    return RankChartLayout.windowForGames(rankChartLayout, Number(preset.slice(1)));
  }
  return RankChartLayout.windowForPreset(rankChartLayout, preset);
}

function rankRangeText(start, end) {
  const days = RankChartLayout.daysInWindow(rankChartLayout, start, end, rankChartMode);
  if (!days.length) return '';
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const scope = rankChartPreset === 'all' || rankChartPreset === 'gall'
    ? 'All time'
    : isGamePreset(rankChartPreset)
      ? `Last ${rankChartPreset.slice(1)} games`
      : rankChartPreset
        ? `Last ${rankChartPreset} days`
        : 'Custom range';
  return `${scope} · ${fmt.format(new Date(days[0].at))}–${fmt.format(new Date(days[days.length - 1].at))}`;
}

function detectedRankPreset(start, end) {
  if (!rankChartLayout) return null;
  // Only the live scale's presets are candidates: the two scales share no
  // units, so a millisecond bound would land inside some slot's tolerance.
  // echarts echoes dataZoom values back rounded, so the match needs slack — a
  // second of elapsed time, or a hundredth of a game slot.
  const tolerance = rankChartMode === 'games' ? 0.01 : 1000;
  const candidates = rankChartMode === 'games' ? RANK_GAME_PRESETS : RANK_PRESETS;
  for (const preset of candidates) {
    const [expectedStart, expectedEnd] = rankWindow(preset);
    if (Math.abs(start - expectedStart) < tolerance && Math.abs(end - expectedEnd) < tolerance) return preset;
  }
  return null;
}

function syncRankRangeUi(start, end) {
  rankChartPreset = detectedRankPreset(start, end);
  $$('.rank-range-btn').forEach((button) => {
    const value = parseRankRange(button.dataset.range);
    button.setAttribute('aria-pressed', String(value === rankChartPreset));
    button.classList.toggle('active', value === rankChartPreset);
  });
  const text = rankRangeText(start, end);
  const label = $('#rank-window-label');
  const status = $('#rank-range-status');
  if (label) label.textContent = text;
  if (status) status.textContent = text;
}

function setRankWindow(preset) {
  if (!rankChartInstance || !rankChartLayout) return;
  const mode = rankModeOf(preset);
  rankChartPreset = preset;
  if (mode !== rankChartMode) {
    rankChartMode = mode;
    applyRankChartOption();
    return;
  }
  const [startValue, endValue] = rankWindow(preset);
  rankChartInstance.dispatchAction({ type: 'dataZoom', startValue, endValue });
  syncRankRangeUi(startValue, endValue);
}

function currentRankWindow() {
  const zoom = rankChartInstance?.getModel()?.getComponent('dataZoom', 0);
  const range = zoom?.getValueRange?.();
  return Array.isArray(range) && range.length === 2 ? range.map(Number) : null;
}

function rankTooltip(params) {
  const values = (Array.isArray(params) ? params : [params])
    .filter((p) => p?.data?.snapshot && !String(p.seriesId || '').startsWith('rank-context'));
  const seen = new Set();
  const rows = [];
  for (const item of values) {
    const p = item.data.snapshot;
    const key = `${p.queueId}:${p.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = rankSource(p) === 'opgg' ? 'OP.GG snapshot' : 'Forward Sync';
    const record = p.wins == null || p.losses == null ? '' : ` · ${p.wins}–${p.losses}`;
    rows.push(`<div class="rk-tip-row"><span class="rk-swatch" style="background:${RANK_SERIES[p.queueId]?.color || item.color}"></span>`
      + `<b>${esc(pointLabel(p))}</b><span>${esc(RANK_SERIES[p.queueId]?.label || 'Ranked')}</span></div>`
      + `<div class="rk-tip-source">${esc(source + record)}</div>`);
  }
  if (!rows.length) return '';
  const at = values[0].data.snapshot.at;
  return `${rows.join('')}<div class="rk-tip-when">${esc(new Date(at).toLocaleString())}</div>`;
}

function rankGameTooltip(game) {
  const result = game.win ? 'Victory' : 'Defeat';
  const queue = RANK_SERIES[game.queueId]?.label || 'Ranked';
  const champion = game.championName ? ` · ${game.championName}` : '';
  return `<div class="rk-tip-row"><span class="rk-game-result ${game.win ? 'win' : 'loss'}">${result}</span>`
    + `<b>${esc(queue + champion)}</b></div>`
    + `<div class="rk-tip-when">${esc(new Date(game.at).toLocaleString())}</div>`;
}

function buildRankSeries(queues, colors, games = []) {
  const series = [];

  for (const queue of queues) {
    const meta = RANK_SERIES[queue.queueId];
    const points = [...queue.points].sort((a, b) => a.at - b.at);
    // Invisible full-range series feeds the navigator thumbnail. Main-plot
    // semantics come from the explicit exact, gap, and imported-point series.
    series.push({
      id: `rank-context-${queue.queueId}`,
      name: `${meta.label} context`,
      type: 'line',
      data: points.map(rankDatum),
      showSymbol: false,
      silent: true,
      tooltip: { show: false },
      lineStyle: { opacity: 0 },
      itemStyle: { opacity: 0 },
      emphasis: { disabled: true },
      z: -1,
    });

    rankRuns(points).forEach((run, index) => {
      series.push({
        id: `rank-exact-${queue.queueId}-${index}`,
        name: meta.label,
        type: 'line',
        data: run.map(rankDatum),
        showSymbol: run.length === 1,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: meta.color, width: 2.25 },
        itemStyle: { color: meta.color, borderColor: colors.panel, borderWidth: 2 },
        emphasis: { disabled: true },
        connectNulls: false,
        z: 3,
      });
    });

    rankGapPairs(points).forEach(([from, to], index) => {
      series.push({
        id: `rank-gap-${queue.queueId}-${index}`,
        name: 'Observation gap',
        type: 'line',
        data: [[rankX(from), from.value], [rankX(to), to.value]],
        showSymbol: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { color: meta.color, width: 1.25, type: 'dashed', opacity: 0.55 },
        emphasis: { disabled: true },
        z: 1,
      });
    });

    const imported = points.filter((p) => rankSource(p) === 'opgg');
    if (imported.length) {
      series.push({
        id: `rank-opgg-${queue.queueId}`,
        name: `${meta.label} · OP.GG`,
        type: 'scatter',
        data: imported.map(rankDatum),
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: colors.panel, borderColor: meta.color, borderWidth: 2 },
        emphasis: { scale: 1.25 },
        z: 5,
      });
    }

    const latest = points[points.length - 1];
    series.push({
      id: `rank-now-${queue.queueId}`,
      name: `${meta.label} now`,
      type: 'scatter',
      data: [rankDatum(latest)],
      symbol: 'circle',
      symbolSize: 9,
      silent: true,
      tooltip: { show: false },
      itemStyle: { color: meta.color, borderColor: colors.panel, borderWidth: 2 },
      z: 6,
    });
  }

  for (const result of [
    { win: true, id: 'rank-games-win', color: '#39c98a' },
    { win: false, id: 'rank-games-loss', color: '#e2556f' },
  ]) {
    const resultGames = games.filter((game) => game.win === result.win);
    if (!resultGames.length) continue;
    series.push({
      id: result.id,
      name: result.win ? 'Ranked wins' : 'Ranked losses',
      type: 'scatter',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: resultGames.map((game) => ({ value: [rankX(game), 0.5], game })),
      symbol: 'rect',
      symbolSize: [3, 9],
      itemStyle: { color: result.color, opacity: 0.72 },
      emphasis: { scale: 1.35 },
      tooltip: {
        show: true,
        trigger: 'item',
        formatter: (item) => rankGameTooltip(item.data.game),
      },
      z: 8,
    });
  }

  return series;
}

const RANK_DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const RANK_CLOCK_LABEL = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function rankTimeAxisLabel(value) {
  const at = new Date(Number(value));
  // Time ticks fall on midnight at day resolution and on the hour below it.
  // Dating an hourly tick is what printed "Aug 22" five times in a row.
  return at.getHours() === 0 && at.getMinutes() === 0
    ? RANK_DAY_LABEL.format(at)
    : RANK_CLOCK_LABEL.format(at);
}

// The game scale counts games, so its ticks are game numbers — evenly spaced
// by construction, at whatever whole-game interval fits the window. A window
// edge falls half a slot outside the games it holds, and half a game is not a
// number worth printing, so only whole games are labelled.
function rankGameAxisLabel(value) {
  const game = Number(value);
  return Number.isInteger(game) ? String(game) : '';
}

function rankXAxes(colors) {
  const bySlot = rankChartMode === 'games';
  const [axisMin, axisMax] = bySlot ? rankChartLayout.gameExtent : rankChartLayout.xExtent;
  const type = bySlot ? 'value' : 'time';
  return [
    {
      type,
      gridIndex: 0,
      min: axisMin,
      max: axisMax,
      // Half a game is not a position anything can occupy, so the game scale
      // never subdivides a slot however far the window is zoomed in.
      minInterval: bySlot ? 1 : undefined,
      boundaryGap: false,
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: bySlot
        ? { show: true, length: 4, lineStyle: { color: colors.line } }
        : { show: false },
      axisLabel: {
        color: colors.dim,
        hideOverlap: true,
        formatter: bySlot ? rankGameAxisLabel : rankTimeAxisLabel,
      },
      splitLine: { show: false },
      axisPointer: { lineStyle: { color: colors.dim, width: 1 } },
    },
    { type, gridIndex: 1, min: axisMin, max: axisMax, show: false },
  ];
}

function rankAriaDescription() {
  return rankChartMode === 'games'
    ? 'Rank over ranked games. Every ranked game takes an equal share of the horizontal axis in the order it was played, and axis labels count games rather than dates; the window label above the chart names the dates covered. Each rank snapshot sits on the game it followed. Green and red ticks represent wins and losses. Dashed lines connect snapshots with an unobserved LP path. Use the Games 10, 25, 100, and All buttons to change how many games are shown, or a Time button to return to an elapsed-time axis. Exact snapshot values and dates are also available in the table below.'
    : 'Rank over elapsed time. Rank Snapshots and ranked Matches appear at their actual dates and times. Green and red ticks represent wins and losses. Dashed lines connect snapshots with an unobserved LP path. Use the 7 day, 14 day, 30 day, and All buttons to change the visible time range. Exact snapshot values and dates are also available in the table below.';
}

function applyRankChartOption() {
  if (!rankChartInstance || !rankChartOptionBuilder) return;
  rankChartInstance.setOption(rankChartOptionBuilder(), true);
  const [startValue, endValue] = rankWindow(rankChartPreset);
  syncRankRangeUi(startValue, endValue);
}

function disposeRankChart() {
  rankChartResizeObserver?.disconnect();
  rankChartResizeObserver = null;
  rankChartInstance?.dispose();
  rankChartInstance = null;
  rankChartOptionBuilder = null;
}

async function loadRankChart() {
  try {
    const data = await api('/api/history/rank');
    home.rank = data; // the summary strip and home hero reuse the latest point
    renderRankChart(data.queues || [], data.games || []);
  } catch {
    $('#history-rank').innerHTML = '';
  }
}

function renderRankChart(queues, games = []) {
  const card = $('#history-rank');
  const sourceQueues = queues
    .filter((q) => q.points?.length && RANK_SERIES[q.queueId])
    .map((q) => ({ ...q, points: [...q.points].sort((a, b) => a.at - b.at) }));
  disposeRankChart();

  if (!sourceQueues.length) {
    card.innerHTML = `<div class="rank-head"><span class="lbl">Rank over time</span></div>
      <p class="muted small">No rank recorded yet. Your LP graph starts building the first time the app sees the
      League client — snapshots are taken automatically after each game.</p>`;
    return;
  }

  if (!window.RankChartLayout) {
    card.innerHTML = '<p class="error-box">The rank chart layout could not be loaded.</p>';
    return;
  }

  rankChartLayout = RankChartLayout.layoutQueues(sourceQueues, games);
  const ranked = rankChartLayout.queues;
  const rankedGames = rankChartLayout.games;
  const points = ranked.flatMap((s) => s.points);
  // Opens on the last 25 games: the question this chart answers is "how am I
  // trending", and games are the unit rank moves in. Without any ranked game
  // archived there is no game scale to open on, so fall back to elapsed time.
  rankChartPreset = rankedGames.length
    ? 'g25'
    : (rankChartLayout.lastAt - rankChartLayout.firstAt <= 14 * 24 * 60 * 60 * 1000 ? 'all' : 14);
  rankChartMode = rankModeOf(rankChartPreset);

  const legend = ranked.length > 1
    ? `<span class="rank-legend">${ranked.map((s) =>
        `<span class="rk-key"><span class="rk-swatch" style="background:${RANK_SERIES[s.queueId].color}"></span>${esc(RANK_SERIES[s.queueId].label)}</span>`).join('')}</span>`
    : '';
  const hasImported = points.some((p) => rankSource(p) === 'opgg');
  const sourceKey = hasImported
    ? `<span class="rank-source-key"><span class="rk-source-dot"></span>OP.GG snapshot</span>`
    : '';
  const gameKey = rankedGames.length
    ? `<span class="rank-game-key"><span class="rk-game-tick win"></span><span class="rk-game-tick loss"></span>Ranked matches (win / loss)</span>`
    : '';
  const latest = ranked.map((s) => {
    const p = s.points[s.points.length - 1];
    return `<span class="rk-now"><span class="rk-now-lbl">Now</span><span class="rk-swatch" style="background:${RANK_SERIES[s.queueId].color}"></span><b>${esc(pointLabel(p))}</b></span>`;
  }).join('');
  const table = ranked.flatMap((s) => s.points.map((p) => ({ s, p })))
    .sort((a, b) => b.p.at - a.p.at)
    .map(({ s, p }) => `<tr><td>${esc(new Date(p.at).toLocaleString())}</td><td>${esc(RANK_SERIES[s.queueId].label)}</td><td>${esc(pointLabel(p))}</td><td>${p.wins == null || p.losses == null ? '—' : `${p.wins}–${p.losses}`}</td></tr>`)
    .join('');

  card.innerHTML = `
    <div class="rank-head">
      <span class="lbl">Rank over time</span>${legend}${sourceKey}${gameKey}<span class="spacer"></span>${latest}
    </div>
    <div class="rank-controls">
      <span class="rank-range-title muted small">Time</span>
      <div class="rank-range" role="group" aria-label="Visible rank-history range in days">
        ${RANK_PRESETS.map((preset) => {
          const label = preset === 'all' ? 'All' : `${preset}D`;
          return `<button type="button" class="rank-range-btn" data-range="${preset}" aria-pressed="false">${label}</button>`;
        }).join('')}
      </div>
      ${rankedGames.length ? `
      <span class="rank-range-title muted small">Games</span>
      <div class="rank-range" role="group" aria-label="Visible rank-history range in games">
        ${RANK_GAME_PRESETS.map((preset) => {
          const label = preset === 'gall' ? 'All' : preset.slice(1);
          const title = preset === 'gall' ? 'All ranked games' : `Last ${preset.slice(1)} ranked games`;
          return `<button type="button" class="rank-range-btn" data-range="${preset}" aria-pressed="false" title="${title}">${label}</button>`;
        }).join('')}
      </div>` : ''}
      <span id="rank-window-label" class="rank-window-label muted small"></span>
      <span class="rank-zoom-hint muted small">Dashed = unobserved LP path · Drag navigator · Ctrl+scroll to zoom</span>
    </div>
    <div id="rank-echart" class="rank-echart"></div>
    <span id="rank-range-status" class="sr-only" aria-live="polite"></span>
    <details class="rank-table"><summary class="muted small">View as table</summary>
      <table><thead><tr><th>When</th><th>Queue</th><th>Rank</th><th>W–L</th></tr></thead><tbody>${table}</tbody></table>
    </details>`;

  $$('.rank-range-btn').forEach((button) => {
    button.onclick = () => setRankWindow(parseRankRange(button.dataset.range));
  });

  if (!window.echarts) {
    $('#rank-echart').innerHTML = '<p class="error-box">The chart library could not be loaded.</p>';
    return;
  }

  const container = $('#rank-echart');
  rankChartInstance = echarts.init(container, null, { renderer: 'svg' });
  // Rebuilt whole rather than merged: the two scales share no x values, so
  // changing range group moves every series and both x axes at once.
  rankChartOptionBuilder = () => {
    const colors = rankColors();
    const [startValue, endValue] = rankWindow(rankChartPreset);
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: colors.text, fontFamily: getComputedStyle(document.body).fontFamily },
      aria: {
        enabled: true,
        description: rankAriaDescription(),
      },
      grid: [
        { top: 16, right: 18, bottom: 128, left: 78, containLabel: false },
        { right: 18, bottom: 73, height: 18, left: 78, containLabel: false },
      ],
      xAxis: rankXAxes(colors),
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          scale: true,
          splitNumber: 5,
          minInterval: 100,
          min: (extent) => rankAxisBoundary(extent, 'min'),
          max: (extent) => rankAxisBoundary(extent, 'max'),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: colors.dim, margin: 12, formatter: (value) => rankLabel(Math.round(value)) },
          splitLine: { lineStyle: { color: colors.line, width: 1, type: 'dashed', opacity: 0.8 } },
        },
        {
          type: 'value',
          gridIndex: 1,
          min: 0,
          max: 1,
          show: false,
        },
      ],
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: colors.deep,
        borderColor: colors.line,
        borderWidth: 1,
        padding: [7, 10],
        textStyle: { color: colors.text, fontSize: 12 },
        axisPointer: { type: 'line', snap: true },
        formatter: rankTooltip,
      },
      dataZoom: [
        {
          id: 'rank-inside',
          type: 'inside',
          xAxisIndex: [0, 1],
          filterMode: 'filter',
          startValue,
          endValue,
          zoomOnMouseWheel: 'ctrl',
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          preventDefaultMouseMove: true,
        },
        {
          id: 'rank-slider',
          type: 'slider',
          xAxisIndex: [0, 1],
          filterMode: 'filter',
          startValue,
          endValue,
          bottom: 8,
          height: 34,
          showDetail: false,
          showDataShadow: true,
          brushSelect: false,
          backgroundColor: colors.deep,
          borderColor: colors.line,
          dataBackground: {
            lineStyle: { color: colors.dim, opacity: 0.55 },
            areaStyle: { color: colors.dim, opacity: 0.12 },
          },
          selectedDataBackground: {
            lineStyle: { color: RANK_SERIES[ranked[0].queueId].color, opacity: 0.9 },
            areaStyle: { color: RANK_SERIES[ranked[0].queueId].color, opacity: 0.2 },
          },
          fillerColor: `${RANK_SERIES[ranked[0].queueId].color}20`,
          handleSize: '85%',
          handleStyle: {
            color: colors.panel,
            borderColor: RANK_SERIES[ranked[0].queueId].color,
            borderWidth: 1.5,
          },
          moveHandleStyle: { color: colors.dim, opacity: 0.75 },
          textStyle: { color: colors.dim },
        },
      ],
      graphic: [
        // Names the unit the bare tick numbers are counting, in the margin the
        // win/loss row already labels the same way.
        ...(rankChartMode === 'games' ? [{
          type: 'text',
          left: 20,
          bottom: 110,
          silent: true,
          style: { text: 'GAME #', fill: colors.dim, font: '10px sans-serif' },
        }] : []),
        ...(rankedGames.length ? [{
          type: 'text',
          left: 20,
          bottom: 76,
          silent: true,
          style: { text: 'GAMES', fill: colors.dim, font: '10px sans-serif' },
        }] : []),
      ],
      series: buildRankSeries(ranked, colors, rankedGames),
    };
  };

  applyRankChartOption();

  rankChartInstance.on('datazoom', () => {
    requestAnimationFrame(() => {
      const range = currentRankWindow();
      if (range) syncRankRangeUi(range[0], range[1]);
    });
  });

  if ('ResizeObserver' in window) {
    rankChartResizeObserver = new ResizeObserver(() => rankChartInstance?.resize());
    rankChartResizeObserver.observe(container);
  } else {
    window.addEventListener('resize', () => rankChartInstance?.resize(), { once: true });
  }
}

// ---------- history detail ----------

function benchRow(label, cmp, fmt = (v) => v) {
  if (!cmp) return '';
  const dirCls = cmp.direction === 'above' ? 'up' : 'down';
  return `<div class="bench-row">
    <span class="bl">${esc(label)}</span>
    <span class="bv">${esc(String(fmt(cmp.value)))}</span>
    <span class="bb ${dirCls}">target ${esc(String(fmt(cmp.benchmark)))}</span>
  </div>`;
}

function playerRowHtml(p, mePuuid) {
  return `<div class="pl-row ${p.puuid === mePuuid ? 'me' : ''}">
    ${p.championImage ? `<img src="${esc(p.championImage)}" alt="${esc(p.championName || '')}" />` : '<span class="pl-img"></span>'}
    <span class="pl-who">
      <span class="pl-name">${esc(p.gameName || p.championName || '?')}</span>
      <span class="pl-sub">${esc(p.championName || '')}${p.role ? ' · ' + esc(p.role) : ''}</span>
    </span>
    <span class="pl-kda">${p.kills}/${p.deaths}/${p.assists}</span>
    <span class="pl-cs">${p.cs} CS</span>
    <span class="pl-items">${p.items.map(itemImg).join('')}</span>
  </div>`;
}

const OBJECTIVE_ROWS = [
  ['towerKills', 'Towers', 'castle'],
  ['dragonKills', 'Drakes', 'flame'],
  ['baronKills', 'Barons', 'crown'],
  ['riftHeraldKills', 'Heralds', 'eye'],
];

function objectivesHtml(teams, myTeamId) {
  if (!teams?.length) return '';
  const mine = teams.find((t) => t.teamId === myTeamId);
  const theirs = teams.find((t) => t.teamId !== myTeamId);
  if (!mine || !theirs) return '';
  return `<section class="panel">
    <div class="panel-head">${icon('castle', 15)}<h3>Objectives</h3></div>
    <div class="obj-cols"><span></span><span class="yours">Yours</span><span class="theirs">Theirs</span></div>
    ${OBJECTIVE_ROWS.map(([key, label, ic]) => `
      <div class="obj-row">
        <span class="lbl">${icon(ic, 15)}${label}</span>
        <span class="mine">${mine[key] ?? '—'}</span>
        <span class="theirs">${theirs[key] ?? '—'}</span>
      </div>`).join('')}
  </section>`;
}

function coachingHtml(coaching, players) {
  if (!coaching?.plan) return '';
  const byName = new Map(players.map((p) => [p.championName, p.championImage]));
  const imageFor = (name) => byName.get(name) || null;
  const plan = coaching.plan;
  const when = coaching.generatedAt ? relTime(new Date(coaching.generatedAt).getTime()) : '';
  const quote = plan.overview?.summary || plan.overview?.keyPrinciple || '';
  return `<section class="panel">
    <div class="panel-head">${icon('sparkles', 15)}<h3>What you were told</h3>
      <span class="head-meta" style="margin-left:auto">before the game${coaching.model ? ` · ${esc(modelLabel(coaching.model))}` : ''}${when ? ` · ${esc(when)}` : ''}</span></div>
    ${quote ? `<p class="coaching-quote">“${esc(quote)}”</p>` : ''}
    <details class="coaching-block">
      <summary class="muted small">Read the full plan you were given</summary>
      <div class="coaching-body">
        ${planTabHtml(plan, imageFor)}
        ${matchupTabHtml(plan)}
        ${threatsTabHtml(plan, imageFor)}
        ${itemsTabHtml(plan)}
      </div>
    </details>
  </section>`;
}

async function openMatchDetail(matchId) {
  $('#history-list-view').classList.add('hidden');
  const view = $('#history-detail-view');
  view.classList.remove('hidden');
  view.innerHTML = `<div class="loading"><div class="spinner"></div> Loading match…</div>`;
  try {
    const d = await api(`/api/history/matches/${encodeURIComponent(matchId)}`);
    renderMatchDetail(d);
  } catch (err) {
    view.innerHTML = `<button class="btn secondary" id="btn-hist-back">← Back</button><div class="error-box">${esc(err.message)}</div>`;
    $('#btn-hist-back').onclick = closeMatchDetail;
  }
}

function closeMatchDetail() {
  $('#history-detail-view').classList.add('hidden');
  $('#history-detail-view').innerHTML = '';
  $('#history-list-view').classList.remove('hidden');
}

function renderMatchDetail(d) {
  const m = d.match;
  const me = d.players.find((p) => p.puuid === m?.puuid) || null;
  const myTeamId = me?.teamId ?? d.players[0]?.teamId;
  const allies = d.players.filter((p) => p.teamId === myTeamId);
  const enemies = d.players.filter((p) => p.teamId !== myTeamId);
  const myTeam = (d.teams || []).find((t) => t.teamId === myTeamId);
  const heroSub = [
    `${m?.kills}/${m?.deaths}/${m?.assists}`,
    `${m?.cs} CS`,
    m?.damageShare != null ? `${pctText(m.damageShare)} of team damage` : null,
  ].filter(Boolean).join(' · ');
  // Always render the coaching slot so the page keeps its shape; without a
  // saved plan it explains itself instead of leaving a bare footnote.
  const coachingPanel = coachingHtml(d.coaching, d.players) || `<section class="panel">
    <div class="panel-head">${icon('sparkles', 15)}<h3>What you were told</h3></div>
    <p class="muted" style="margin:0">No coaching was generated for this game. Plans you generate during a game are saved and reviewed here after it ends.</p>
  </section>`;

  $('#history-detail-view').innerHTML = `
    <div class="detail-topline">
      <button class="btn secondary" id="btn-hist-back">${icon('arrow-left', 14)}History</button>
      <span class="meta">${esc(m?.matchId || '')} · patch ${esc(m?.patch || '?')}</span>
    </div>

    <section class="detail-hero ${outcomeClass(m)}" id="detail-hero">
      <div class="dh-inner">
        ${m?.championImage ? `<img class="dh-portrait" src="${esc(m.championImage)}" alt="" />` : ''}
        <div>
          <h2>${esc(m?.championName || '?')}</h2>
          <div class="dh-tags">
            ${m?.role ? `<span class="gold">${esc(m.role)}</span>` : ''}
            <span>${esc(m?.queueLabel || '')}</span>
            <span>${fmtDuration(m?.durationSec)}</span>
            <span>${esc(relTime(m?.playedAt))}</span>
          </div>
        </div>
        <div class="spacer"></div>
        <div class="dh-right">
          <div class="detail-result">${outcomeLabel(m)}</div>
          <div class="dh-sub">${esc(heroSub)}</div>
        </div>
      </div>
    </section>

    ${m?.isRemake ? `<div class="notice-box">This game was a remake, so it's excluded from your winrate and averages.</div>` : ''}

    <div class="detail-cols">
      <div class="dcol">
      <section class="panel">
        <div class="panel-head"><span class="crest">${icon('target', 14)}</span><h3>Against your role</h3></div>
        ${benchRow('CS / min', d.benchmarks.csPerMin)}
        ${m?.csDiffVsLaneOpponent != null ? `<div class="bench-row">
          <span class="bl">CS vs lane opponent</span>
          <span class="bv">${signed(m.csDiffVsLaneOpponent)}</span>
          <span class="bb">${m?.csDiffAt10 != null ? `best lead at 10m: ${esc(String(m.csDiffAt10))}` : ''}</span>
        </div>` : ''}
        ${benchRow('Kill participation', d.benchmarks.killParticipation, pctText)}
        ${benchRow('Vision score', d.benchmarks.visionScore)}
        ${m?.damageShare != null ? `<div class="bench-row">
          <span class="bl">Share of team damage</span>
          <span class="bv">${esc(pctText(m.damageShare))}</span>
          <span class="bb"></span>
        </div>` : ''}
        ${Object.keys(d.benchmarks).length === 0 ? '<p class="muted">No role benchmarks for this match.</p>' : ''}
        <div class="kv-grid" style="margin-top:18px">
          ${kv('Gold earned', (m?.goldEarned ?? '—').toLocaleString?.() ?? String(m?.goldEarned ?? '—'))}
          ${kv('Damage to champions', (m?.damageToChampions ?? '—').toLocaleString?.() ?? String(m?.damageToChampions ?? '—'))}
        </div>
      </section>

      ${objectivesHtml(d.teams, myTeamId)}
      </div>

      <div class="dcol">
      <section class="panel">
        <div class="panel-head">${icon('users', 15)}<h3>Scoreboard</h3></div>
        <div class="pl-team" style="margin-top:0">
          <div class="pl-head ally">Your team · ${myTeam ? (myTeam.win ? 'victory' : 'defeat') : ''}</div>
          ${allies.map((p) => playerRowHtml(p, m?.puuid)).join('')}
        </div>
        <div class="pl-team">
          <div class="pl-head enemy">Enemy team · ${myTeam ? (myTeam.win ? 'defeat' : 'victory') : ''}</div>
          ${enemies.map((p) => playerRowHtml(p, m?.puuid)).join('')}
        </div>
      </section>

      ${coachingPanel}
      </div>
    </div>`;

  if (m?.championId) setSplash($('#detail-hero'), m.championId);
  $('#btn-hist-back').onclick = closeMatchDetail;
}

// ---------- champion database ----------
// Browsable builds for every champion: real global usage and win rates,
// fetched lazily per champion and cached server-side (see /api/builds).
const db = {
  champs: null,  // /api/builds/champions payload
  meta: null,    // /api/builds/meta payload (rune trees, shard rows, labels)
  search: '',
  roleFilter: '',
  current: null, // ddragon id of the open champion
  tier: 'emerald_plus',
  buildSeq: 0,   // request token: only the latest role/tier/champ fetch may render
};

function fmtGames(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : String(n);
}

// One win-rate rule for the whole page: good ≥ 52%, bad < 48%, and muted
// entirely when the sample is under 2% of the champion's games — a 54% item
// on 900 games is noise, and coloring it would actively recommend it.
function wrClass(wr, play, totalPlay) {
  if (totalPlay && play / totalPlay < 0.02) return 'wr-low';
  return wr >= 0.52 ? 'wr-good' : wr < 0.48 ? 'wr-bad' : '';
}

// Section metadata, rendered inline inside the card's header line so label
// and stats share one row. Abbreviated count on screen, exact in the tooltip.
function wrMetaHtml(sec, overallPlay) {
  if (!sec?.play) return '';
  const wr = sec.winRate ?? sec.wins / sec.play;
  const cls = wrClass(wr, sec.play, overallPlay);
  const tip = `${sec.play.toLocaleString()} games${cls === 'wr-low' ? ' — low sample' : ''}`;
  return `<span class="sec-meta" title="${esc(tip)}"><span class="${cls}">${(100 * wr).toFixed(1)}% WR</span> · ${fmtGames(sec.play)} games</span>`;
}

// Compact variant for sub-group headers (Boots, Starting items, Spells):
// rides inline in the h3 so the group is one header line + one icon row.
function subMetaHtml(sec, overallPlay) {
  if (!sec?.play) return '';
  const wr = sec.winRate ?? sec.wins / sec.play;
  const cls = wrClass(wr, sec.play, overallPlay);
  const tip = `${(100 * wr).toFixed(1)}% WR · ${sec.play.toLocaleString()} games${cls === 'wr-low' ? ' — low sample' : ''}`;
  return `<span class="sub-meta" title="${esc(tip)}"><span class="${cls}">${(100 * wr).toFixed(1)}%</span></span>`;
}

function roleLabelOf(id) {
  return db.meta?.roles.find((r) => r.id === id)?.label || id;
}

async function refreshChampions() {
  if (db.champs) return; // grid is static per session; renders stay client-side
  $('#champ-grid').innerHTML = `<div class="loading"><div class="spinner"></div> Loading champions…</div>`;
  try {
    const [champs, meta] = await Promise.all([api('/api/builds/champions'), api('/api/builds/meta')]);
    db.champs = champs;
    db.meta = meta;
    $('#champ-role-filter').innerHTML =
      `<option value="">All roles</option>` +
      meta.roles.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('');
    const note = $('#champ-data-note');
    note.textContent = champs.dataPatch
      ? `Patch ${champs.dataPatch}${champs.matchCount ? ` · ${champs.matchCount.toLocaleString()} ranked games analyzed` : ''}${champs.rosterStale ? ' (cached)' : ''}`
      : `Patch ${champs.patch}`;
  } catch (err) {
    $('#champ-grid').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    db.champs = null;
    return;
  }
  renderChampionGrid();
}

function renderChampionGrid() {
  if (!db.champs) return;
  const needle = db.search.trim().toLowerCase();
  const list = db.champs.champions.filter((c) =>
    (!needle || c.name.toLowerCase().includes(needle)) &&
    (!db.roleFilter || c.roles.includes(db.roleFilter)));
  $('#champ-grid').innerHTML = list.length
    ? list.map((c) => `<button class="champ-card" data-champ="${esc(c.id)}" title="${esc(c.name)} — ${esc(c.title)}">
        <img src="${esc(c.image)}" alt="" loading="lazy" />
        <span class="cc-name">${esc(c.name)}</span>
      </button>`).join('')
    : `<p class="muted">No champions match.</p>`;
  $$('#champ-grid .champ-card').forEach((el) => {
    el.onclick = () => openChampionBuild(el.dataset.champ);
  });
}

async function openChampionBuild(champId, role = null, { refresh = false } = {}) {
  db.current = champId;
  const seq = ++db.buildSeq;
  $('#champ-grid-view').classList.add('hidden');
  const view = $('#champ-detail-view');
  view.classList.remove('hidden');
  // Full spinner only on first open; role/tier switches dim the existing page
  // in place instead of collapsing it (which scroll-jumped to the top).
  if (view.querySelector('.build-grid')) {
    view.classList.add('is-refreshing');
  } else {
    view.innerHTML = `<div class="loading"><div class="spinner"></div> Loading build stats…</div>`;
  }
  const q = new URLSearchParams({ tier: db.tier });
  if (role) q.set('role', role);
  if (refresh) q.set('refresh', '1');
  try {
    const d = await api(`/api/builds/champion/${encodeURIComponent(champId)}?${q}`);
    // Token check covers same-champion role/tier switches too, so two quick
    // tab clicks can't render out of order.
    if (seq !== db.buildSeq || db.current !== champId) return;
    view.classList.remove('is-refreshing');
    renderChampionBuild(d);
  } catch (err) {
    if (seq !== db.buildSeq || db.current !== champId) return;
    view.classList.remove('is-refreshing');
    view.innerHTML = `
      <button class="btn secondary" id="btn-champ-back">${icon('arrow-left', 14)}All champions</button>
      <div class="error-box">${esc(err.message)}</div>
      <button class="btn secondary" id="btn-champ-retry">${icon('refresh-cw', 14)}Try again</button>`;
    $('#btn-champ-back').onclick = closeChampionBuild;
    $('#btn-champ-retry').onclick = () => openChampionBuild(champId, role, { refresh: true });
  }
}

function closeChampionBuild() {
  db.current = null;
  db.buildSeq++; // orphan any in-flight fetch
  $('#champ-detail-view').classList.add('hidden');
  $('#champ-detail-view').classList.remove('is-refreshing');
  $('#champ-detail-view').innerHTML = '';
  $('#champ-grid-view').classList.remove('hidden');
}

// Rich stat tooltip when the ref is an item the index knows; plain name
// otherwise (summoner-spell rows reuse this renderer with item ids absent).
function refTitle(ref, itemStats) {
  const it = itemStats ? itemIndex.byId.get(Number(ref.id)) : null;
  return it ? itemTitle(it) : ref.name;
}

function iconRowHtml(list, { arrows = false, size = '', itemStats = false, labels = false } = {}) {
  return `<div class="build-items ${size}">${list.map((it, i) => {
    const img = `<img src="${esc(it.icon)}" alt="${esc(it.name)}" title="${esc(refTitle(it, itemStats))}" />`;
    const cell = labels ? `<span class="bi">${img}<span class="bi-name">${esc(it.name)}</span></span>` : img;
    return `${i && arrows ? '<span class="bi-arrow">→</span>' : ''}${cell}`;
  }).join('')}</div>`;
}

function lateItemsHtml(items, overallPlay) {
  if (!items?.length) return '<p class="muted small">No data.</p>';
  // Popularity meter: each row's fill is its share of the most-picked item,
  // as a discrete little bar rather than a row-wide wash.
  const maxPlay = Math.max(...items.map((it) => it.play));
  return `<div class="late-items">${items.map((it) => {
    const pct = Math.max(5, Math.round((100 * it.play) / maxPlay));
    const cls = wrClass(it.winRate, it.play, overallPlay);
    const games = `${it.play.toLocaleString()} games`;
    return `
    <div class="late-item">
      <img src="${esc(it.icon)}" alt="" title="${esc(refTitle(it, true))}" />
      <span class="li-name">${esc(it.name)}</span>
      <span class="li-meter" title="${esc(`${games} — share of the most-picked option`)}"><i style="width:${pct}%"></i></span>
      <span class="li-wr ${cls}"${cls === 'wr-low' ? ' title="low sample"' : ''}>${(100 * it.winRate).toFixed(1)}%</span>
      <span class="li-games muted" title="${esc(games)}">${fmtGames(it.play)}</span>
    </div>`;
  }).join('')}</div>`;
}

// The full two-tree rune page: every rune rendered, the picked ones lit.
function runeTreeHtml(style, selectedIds, { withKeystones }) {
  if (!style) return '';
  const slots = withKeystones ? style.slots : style.slots.slice(1);
  return `<div class="rune-tree">
    <div class="rt-head"><img src="${esc(style.icon)}" alt="" /><span>${esc(style.name)}</span></div>
    ${slots.map((slot, i) => {
      const keystoneRow = withKeystones && i === 0;
      // The keystone is the build-defining pick — name it in visible text so
      // the page has a headline readable without hovering.
      const picked = keystoneRow ? slot.find((r) => selectedIds.includes(r.id)) : null;
      return `<div class="rune-slot">
      ${slot.map((r) => `<img class="rune ${keystoneRow ? 'keystone' : ''} ${selectedIds.includes(r.id) ? 'on' : 'dim'}"
        src="${esc(r.icon)}" alt="${esc(r.name)}" title="${esc(r.name)}" />`).join('')}
    </div>${picked ? `<div class="rune-keystone-name">${esc(picked.name)}</div>` : ''}`;
    }).join('')}
  </div>`;
}

function runePageHtml(runes) {
  const styles = db.meta.styles;
  const primary = styles.find((s) => s.id === runes.primaryStyle.id);
  const sub = styles.find((s) => s.id === runes.subStyle.id);
  // Shard picks arrive slot-ordered (offense/flex/defense), matching shardRows.
  const shardRows = db.meta.shardRows.map((row, i) => `<div class="shard-row">
    ${row.map((sh) => `<img class="rune shard ${runes.shards[i]?.id === sh.id ? 'on' : 'dim'}"
      src="${esc(sh.icon)}" alt="${esc(sh.name)}" title="${esc(sh.name)}" />`).join('')}
  </div>`).join('');
  return `<div class="rune-page">
    ${runeTreeHtml(primary, runes.primaryPerks.map((p) => p.id), { withKeystones: true })}
    <div class="rune-side">
      ${runeTreeHtml(sub, runes.subPerks.map((p) => p.id), { withKeystones: false })}
      <div class="rune-tree shards">
        <div class="rt-head"><span>Shards</span></div>
        ${shardRows}
      </div>
    </div>
  </div>`;
}

function skillOrderHtml(skills, abilities) {
  const abilityOf = {};
  for (const a of abilities || []) abilityOf[a.key] = a;
  const cols = Math.max(skills.order.length, 15);
  const haveCds = ['Q', 'W', 'E', 'R'].some((k) => abilityOf[k]?.cooldowns?.length);
  // Every row (axis included) carries the same trailing cooldown box so the
  // flexing cells get identical space and the columns stay aligned.
  const axis = `<div class="skill-row"><span class="skill-key axis">Q</span>${
    Array.from({ length: cols }, (_, lv) => `<span class="skill-cell head">${lv + 1}</span>`).join('')}${
    haveCds ? '<span class="skill-cd axis"></span>' : ''}</div>`;
  const rows = ['Q', 'W', 'E', 'R'].map((k) => {
    const ab = abilityOf[k];
    let cells = '';
    let rank = 0;
    for (let lv = 0; lv < cols; lv++) {
      const on = skills.order[lv] === k;
      if (on) rank++;
      const cd = on ? ab?.cooldowns?.[rank - 1] : undefined;
      const tip = cd === undefined ? '' : ` title="${esc(`${ab.name} rank ${rank}: ${cd}s cooldown`)}"`;
      cells += `<span class="skill-cell ${on ? 'on' : ''}"${tip}></span>`;
    }
    const cdText = cooldownTextOf(ab?.cooldowns);
    const cdCol = haveCds
      ? `<span class="skill-cd"${cdText ? ` title="${esc(`${ab.name} — cooldown per rank, in seconds`)}"` : ''}>${esc(cdText)}</span>` : '';
    return `<div class="skill-row"><span class="skill-key"${ab ? ` title="${esc(ab.name)}"` : ''}>${k}</span>${cells}${cdCol}</div>`;
  }).join('');
  return `<div class="skill-priority">Max order:
      ${skills.priority.map((k) => `<b class="skill-key">${esc(k)}</b>`).join('<span class="bi-arrow">→</span>')}
      ${haveCds ? '<span class="sp-note">cooldowns per rank (s)</span>' : ''}
    </div>
    <div class="skill-grid">${axis}${rows}</div>`;
}

// Base stats table: level 1, growth per level, level 18. Riot's growth curve
// back-loads gains but sums to exactly 17 full increments by level 18, so
// level 18 = base + 17 × growth. Attack speed growth is a percentage of base
// rather than a flat add; range and move speed never grow.
function fmtStat(v) {
  return String(Math.round(v * 1000) / 1000);
}

function baseStatsHtml(s, partype) {
  if (!s) return '';
  const at18 = (base, per) => base + 17 * per;
  const rows = [
    ['Health', s.hp, s.hpperlevel],
    ['Health regen (per 5s)', s.hpregen, s.hpregenperlevel],
  ];
  if (s.mp > 0 && partype) {
    rows.push([partype, s.mp, s.mpperlevel]);
    rows.push([`${partype} regen (per 5s)`, s.mpregen, s.mpregenperlevel]);
  }
  rows.push(
    ['Attack damage', s.attackdamage, s.attackdamageperlevel],
    ['Attack speed', s.attackspeed, s.attackspeedperlevel, {
      growthText: `+${fmtStat(s.attackspeedperlevel)}%`,
      at18: s.attackspeed * (1 + (17 * s.attackspeedperlevel) / 100),
    }],
    ['Attack range', s.attackrange, 0],
    ['Armor', s.armor, s.armorperlevel],
    ['Magic resist', s.spellblock, s.spellblockperlevel],
    ['Move speed', s.movespeed, 0],
  );
  return `<table class="stat-table">
    <thead><tr><th></th><th>Level 1</th><th>Growth / level</th><th>Level 18</th></tr></thead>
    <tbody>${rows.map(([label, base, per, extra]) => `<tr>
      <td>${esc(label)}</td>
      <td>${esc(fmtStat(base))}</td>
      <td>${esc(extra?.growthText ?? (per ? `+${fmtStat(per)}` : '—'))}</td>
      <td>${esc(fmtStat(extra?.at18 ?? at18(base, per)))}</td>
    </tr>`).join('')}
    </tbody>
  </table>`;
}

function renderChampionBuild(d) {
  const tierOpts = db.meta.tiers.map((t) =>
    `<option value="${esc(t.id)}" ${t.id === d.tier ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
  const roleTabs = d.roles.map((r) =>
    `<button class="tab ${r === d.role ? 'active' : ''}" data-role="${esc(r)}">${esc(roleLabelOf(r))}</button>`).join('');
  const tierLabel = db.meta.tiers.find((t) => t.id === d.tier)?.label || d.tier;
  const total = d.overall.play;

  $('#champ-detail-view').innerHTML = `
    <section class="build-hero" id="build-hero">
      <div class="bh-inner">
        <button class="btn secondary" id="btn-champ-back">${icon('arrow-left', 14)}All champions</button>
        <img class="bh-portrait" src="${esc(d.champion.image.square)}" alt="" />
        <div>
          <h2>${esc(d.champion.name)} <span class="bh-title">${esc(d.champion.title)}</span></h2>
          <p class="bh-stats"><span class="${wrClass(d.overall.winRate)}">${(100 * d.overall.winRate).toFixed(1)}% win rate</span><span>${fmtGames(total)} games</span><span>${esc(tierLabel)}</span><span>patch ${esc(d.patch)}</span></p>
        </div>
        <div class="spacer"></div>
        <div class="field inline">
          <select id="build-tier" title="Rank tier">${tierOpts}</select>
        </div>
      </div>
    </section>

    <nav class="tabs build-roles">${roleTabs}</nav>

    ${d.stale ? `<div class="notice-box">Live stats couldn't be refreshed — showing the last saved data (patch ${esc(d.patch)}).
      <button class="btn tiny" id="btn-build-refresh">${icon('refresh-cw', 13)}Retry</button></div>` : ''}

    <div class="build-grid">
      <div class="panel">
        <h3>Runes ${wrMetaHtml(d.runes, total)}</h3>
        ${runePageHtml(d.runes)}
      </div>
      <div class="panel">
        <h3>Core build ${wrMetaHtml(d.coreItems, total)}</h3>
        ${iconRowHtml(d.coreItems.list, { arrows: true, itemStats: true, labels: true })}
        <div class="build-line">
          <h4>Boots</h4>
          ${iconRowHtml(d.boots.list, { itemStats: true })}
          ${subMetaHtml(d.boots, total)}
        </div>
        <div class="build-line">
          <h4>Starting</h4>
          ${iconRowHtml(d.startingItems.list, { itemStats: true })}
          ${subMetaHtml(d.startingItems, total)}
        </div>
        <div class="build-line">
          <h4>Spells</h4>
          ${iconRowHtml(d.spells.list)}
          ${subMetaHtml(d.spells, total)}
        </div>
      </div>
      <div class="panel">
        <h3>Late &amp; situational <span class="sec-meta">share of picks · win rate</span></h3>
        ${lateItemsHtml(d.lateItems, total)}
      </div>
    </div>

    <div class="build-row2${d.baseStats ? '' : ' solo'}">
      <div class="panel">
        <h3>Skill order ${wrMetaHtml(d.skills, total)}</h3>
        ${skillOrderHtml(d.skills, d.abilities)}
      </div>
      ${d.baseStats ? `
      <div class="panel">
        <h3>Base stats <span class="sec-meta">level 1 → 18 · same in every role</span></h3>
        ${baseStatsHtml(d.baseStats, d.champion.partype)}
      </div>` : ''}
    </div>

    <p class="muted small">Aggregated from ranked games worldwide (${esc(tierLabel)}) · data via OP.GG · fetched ${esc(relTime(d.fetchedAt) || 'just now')}</p>`;

  setSplash($('#build-hero'), d.champion.id);

  $('#btn-champ-back').onclick = closeChampionBuild;
  $$('#champ-detail-view .build-roles .tab').forEach((t) => {
    t.onclick = () => openChampionBuild(d.champion.id, t.dataset.role);
  });
  $('#build-tier').onchange = (e) => {
    db.tier = e.target.value;
    openChampionBuild(d.champion.id, d.role);
  };
  const refreshBtn = $('#btn-build-refresh');
  if (refreshBtn) refreshBtn.onclick = () => openChampionBuild(d.champion.id, d.role, { refresh: true });
}

// ---------- wiring ----------
function openGlossary(term = '') {
  renderGlossaryModal(term);
  $('#glossary-search').value = term;
  $('#modal-glossary').classList.remove('hidden');
}

function wire() {
  $('#btn-settings').onclick = openSettings;
  $('#btn-settings-close').onclick = () => $('#modal-settings').classList.add('hidden');
  $('#btn-settings-close-x').onclick = () => $('#modal-settings').classList.add('hidden');
  $('#btn-settings-save').onclick = () => saveSettings().catch((e) => alert(e.message));

  $('#nav-glossary').onclick = () => openGlossary();
  $('#btn-glossary-close').onclick = () => $('#modal-glossary').classList.add('hidden');
  $('#glossary-search').oninput = (e) => renderGlossaryModal(e.target.value);

  $('#btn-generate').onclick = () => generatePlan(false);
  $('#btn-regenerate').onclick = () => generatePlan(true);

  $$('.tab').forEach((t) => (t.onclick = () => selectTab(t.dataset.tab)));

  $('#chat-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendChat(text);
  };

  $$('.navbtn[data-section]').forEach((b) => (b.onclick = () => showSection(b.dataset.section)));
  $('#btn-home-history').onclick = () => showSection('history');
  $('#btn-goto-live').onclick = () => showSection('live');
  $('#btn-dismiss-notice').onclick = hidePhaseNotice;
  $('#btn-hist-sync').onclick = async () => {
    const btn = $('#btn-hist-sync');
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      await api('/api/history/sync', { method: 'POST', body: {} });
      home.loaded = false; // the home screen shares this data
      await refreshHistory();
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('refresh-cw', 14)}Sync now`;
    }
  };
  $('#hist-role').onchange = (e) => { hist.role = e.target.value; hist.page = 0; loadMatches(); };
  $('#hist-queue').onchange = (e) => { hist.queue = e.target.value; hist.page = 0; loadMatches(); };

  let champSearchTimer = null;
  $('#champ-search').oninput = (e) => {
    clearTimeout(champSearchTimer);
    champSearchTimer = setTimeout(() => { db.search = e.target.value; renderChampionGrid(); }, 150);
  };
  $('#champ-role-filter').onchange = (e) => { db.roleFilter = e.target.value; renderChampionGrid(); };

  // Close modals when clicking the backdrop.
  for (const id of ['modal-settings', 'modal-glossary']) {
    $(`#${id}`).addEventListener('click', (e) => {
      if (e.target.id === id) $(`#${id}`).classList.add('hidden');
    });
  }
}

// ---------- boot ----------
wire();
loadItemIndex().catch(() => {}); // icons/tooltips degrade to plain names without it
loadSettingsInfo(); // model name for the sidebar attribution line
api('/api/state').then(onState).catch(() => setPill('waiting', 'Server unreachable'));
connectEvents();
