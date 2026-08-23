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
    renderWaiting();
    if (prevPhase === 'ingame' || prevPhase === 'champselect') {
      currentPlan = null; currentCsAdvice = null; csBriefingKey = null; chatHistory = [];
      resetLaneCompare();
    }
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
  if (state.phase === 'ingame') setPill('ingame', state.mode === 'demo' ? 'Demo game' : 'In game');
  else if (state.phase === 'champselect') setPill('champselect', state.mode === 'demo' ? 'Demo champ select' : 'Champion select');
  else if (state.clientDetected) setPill('waiting', 'League client detected — waiting for a game');
  else setPill('waiting', 'Waiting for League to start');
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

function renderWaiting() {
  setSplash($('.hero-card'), heroChamp);
  const el = $('#detect-status');
  if (state.clientDetected) {
    el.innerHTML = `<span class="ok">✔ League client detected.</span> Queue up — I'll follow you into champ select.`;
  } else {
    el.innerHTML = `<span class="warn">●</span> League client not detected yet. Start League on this computer (or set the install folder in Settings if it never connects).`;
  }
}

// ---------- champ select ----------
function renderChampSelect() {
  const cs = state.champSelect;
  if (!cs) return;
  $('#cs-myteam').innerHTML = cs.myTeam.map(stripChamp).join('');
  $('#cs-theirteam').innerHTML = cs.theirTeam.length
    ? cs.theirTeam.map(stripChamp).join('')
    : '<p class="muted">No enemy picks visible yet.</p>';
  $('#cs-bans').innerHTML = cs.bans.length
    ? cs.bans.map((b) => `<img src="${esc(b.image)}" title="${esc(b.name)}" alt="${esc(b.name)}" />`).join('')
    : '<span class="muted">None yet</span>';
  $('#cs-bans-wrap').classList.toggle('hidden', false);

  setSplash($('#view-champselect .advice-panel'), cs.me?.champion?.id);

  const isDemo = state.mode === 'demo';
  $('#cs-demo-badge').classList.toggle('hidden', !isDemo);
  $('#btn-exit-demo-cs').classList.toggle('hidden', !isDemo);

  if (cs.me?.champion) loadCsBriefing();
  else if (currentCsAdvice) renderCsAdvice(currentCsAdvice);
}

function renderCsAdvice(advice) {
  currentCsAdvice = advice;
  const yc = advice.yourChampion;
  const parts = [];
  if (advice.basicMode) {
    parts.push(`<div class="notice-box">This champion isn't in the built-in briefing library yet (probably a brand-new release) — showing Riot's official data instead.</div>`);
  }
  if (yc) {
    parts.push(`<h4>How your champion works</h4><p>${esc(yc.playstyleSummary)}</p>`);
    if (yc.strengths?.length) parts.push(`<p><b style="color:var(--green)">Strengths:</b> ${esc(yc.strengths.join(' · '))}</p>`);
    if (yc.weaknesses?.length) parts.push(`<p><b style="color:var(--red)">Weaknesses:</b> ${esc(yc.weaknesses.join(' · '))}</p>`);
    if (yc.abilities?.length) {
      parts.push(yc.abilities.map((a) => `
        <div class="ability-row">
          <div class="ability-key">${esc(a.key)}</div>
          <div class="ability-body"><span class="an">${esc(a.name)}</span> — ${esc(a.howToUseIt)}</div>
        </div>`).join(''));
    }
  }
  if (advice.earlyGamePlan) parts.push(`<h4>Your first few minutes</h4><p>${esc(advice.earlyGamePlan)}</p>`);
  if (advice.knownEnemies?.length) {
    parts.push(`<h4>Known enemies</h4>` + advice.knownEnemies.map((e) =>
      `<p><b>${esc(e.champion)}:</b> ${esc(e.whatToExpect)}</p>`).join(''));
  }
  if (advice.quickTips?.length) {
    parts.push(`<h4>Quick tips</h4><ul class="tip-list">${advice.quickTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
  }
  parts.push(glossaryDetails(advice.glossary));
  if (advice.briefingPatch) {
    parts.push(`<p class="muted" style="font-size:0.85em">Briefing from the built-in library (generated on patch ${esc(advice.briefingPatch)}).</p>`);
  }
  $('#cs-advice').innerHTML = parts.join('');
}

// ---------- broadcast-style champion cards (live game + champ select) ----------
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
      ${p.role ? `<span class="rl">${esc(p.role)}</span>` : ''}
    </span>
  </div>`;
}

function renderGameHeader() {
  const g = state.game;
  if (!g) return;
  const mins = Math.floor((g.gameTime || 0) / 60);
  $('#game-meta').textContent = `${g.gameMode === 'CLASSIC' ? "Summoner's Rift" : g.gameMode} · ${mins} min · you: ${g.me?.champion?.name || '?'}${g.me?.role ? ' (' + g.me.role + ')' : ''}`;
  $('#game-teams').innerHTML = `
    <div class="team-side ally">${g.allies.map(stripChamp).join('')}</div>
    <div class="vs">VS</div>
    <div class="team-side enemy">${g.enemies.map(stripChamp).join('')}</div>`;
  setSplash($('#game-teams'), g.me?.champion?.id);
  const isDemo = state.mode === 'demo';
  $('#game-demo-badge').classList.toggle('hidden', !isDemo);
  $('#btn-exit-demo-game').classList.toggle('hidden', !isDemo);
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
    ? 'Generates a matchup breakdown, a plan for your role, and an item path — tailored to all ten champions.'
    : 'No API key set — you\'ll get basic mode (Riot data only). Add a key in ⚙️ Settings for full coaching.';
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

function laneVerdictHtml(lane) {
  const v = lane.verdict;
  if (v.side === 'even') return badge('Even at level 1', 'neutral');
  const winner = v.side === 'ally' ? lane.ally : lane.enemy;
  return badge(`${winner.champion.name}: ${v.label.toLowerCase()}`, v.side === 'ally' ? 'low' : 'high');
}

function laneSpellCell(side) {
  if (!side.spells?.length) return '<span class="muted">—</span>';
  return side.spells.map((s) => {
    const cd = s.cooldown === null ? '?' : `${s.cooldown}s`;
    const title = `${s.name} — rank 1: ${s.cooldown ?? '?'}s cooldown${s.cost ? `, costs ${s.cost}` : ''}`;
    return `<span class="lc-cd" title="${esc(title)}">${esc(s.key)} ${esc(cd)}</span>`;
  }).join(' ');
}

function laneTableHtml(lane) {
  const cell = (row, side) => `<td class="${row.better === side ? 'win' : ''}">${esc(row[side])}</td>`;
  return `<table class="stat-table">
    <thead><tr><th></th><th>${esc(lane.ally.champion.name)}</th><th>${esc(lane.enemy.champion.name)}</th></tr></thead>
    <tbody>
      ${lane.rows.map((r) => `<tr><td>${esc(r.label)}</td>${cell(r, 'ally')}${cell(r, 'enemy')}</tr>`).join('')}
      <tr><td>Resource</td><td>${esc(lane.ally.resource)}</td><td>${esc(lane.enemy.resource)}</td></tr>
      <tr><td>Ability cooldowns (rank 1)</td><td>${laneSpellCell(lane.ally)}</td><td>${laneSpellCell(lane.enemy)}</td></tr>
    </tbody>
  </table>`;
}

function laneRowHtml(lane) {
  const champCell = (side, cls) => `<span class="lc-champ ${cls}">
      <img src="${esc(side.champion.image)}" alt="" loading="lazy" />
      <span>${esc(side.champion.name)}</span>
    </span>`;
  const drivers = lane.verdict.drivers.length
    ? lane.verdict.drivers.map((d) => {
        const who = d.side === 'ally' ? lane.ally : lane.enemy;
        return `<span class="lc-driver ${d.side}">${esc(who.champion.name)}: ${esc(d.text)}</span>`;
      }).join(' <span class="lc-sep">·</span> ')
    : '<span class="lc-driver">stat sheets are nearly identical</span>';
  return `<div class="lane-row ${lane.isMyLane ? 'me' : ''}">
    <div class="lc-head">
      <span class="lc-role">${esc(lane.role || '—')}${lane.isMyLane ? ' <b class="lc-you">· you</b>' : ''}</span>
      ${champCell(lane.ally, 'ally')}
      <span class="lc-vs">vs</span>
      ${champCell(lane.enemy, 'enemy')}
      <span class="spacer"></span>
      ${laneVerdictHtml(lane)}
    </div>
    <div class="lc-drivers">${drivers}</div>
    <details class="lc-details">
      <summary>Full level-1 stat sheet</summary>
      ${laneTableHtml(lane)}
    </details>
  </div>`;
}

function renderLaneCompare(data) {
  const box = $('#lane-compare');
  if (!data?.lanes?.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<div class="card lane-cmp">
    <h3>⚖️ Level-1 lane check <span class="wr-note">Riot base stats · no AI</span></h3>
    <p class="muted small lc-intro">Who starts ahead, lane by lane, from the stat sheet alone — health, damage,
    resists, range. Abilities, passives, and runes aren't counted (Riot doesn't publish ability damage numbers
    for most champions), so read an edge as a head start, not a verdict.</p>
    ${data.lanes.map(laneRowHtml).join('')}
  </div>`;
  box.classList.remove('hidden');
}

// ---------- game plan rendering ----------
function glossaryDetails(glossary) {
  if (!glossary?.length) return '';
  return `<details class="glossary-inline"><summary>📖 Terms used (${glossary.length})</summary>
    ${glossary.map((g) => `<p class="g-term"><b>${esc(g.term)}</b> — ${esc(g.definition)}</p>`).join('')}
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
  return `<span class="cd-chip" title="${esc(`Cooldown by rank: ${cooldownTextOf(cooldowns)}`)}">⏱ ${esc(String(cooldowns[0]))}s CD</span>`;
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
        <div class="react">↳ ${esc(t.play)}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// The *Html builders below are shared by the live tabs and the history detail
// view, so coaching renders identically whether you're mid-game or reviewing.
function planTabHtml(plan, imageFor = champImageByName) {
  const o = plan.overview || {};
  const gp = plan.gamePlan || {};
  const phase = (label, ph) => ph ? `
    <div class="card">
      <h3>${esc(label)}</h3>
      <p><b>Goal:</b> ${esc(ph.goal || '')}</p>
      ${ph.tips?.length ? `<ul class="tip-list">${ph.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>` : '';
  const eg = gp.earlyGame;
  const roleOf = new Map((plan.enemyThreats || []).map((t) => [t.champion, t.role || '']));
  const early = eg ? `
    <div class="card">
      <h3>🌅 Early game (0–14 min)</h3>
      <p><b>Goal:</b> ${esc(eg.goal || '')}</p>
      ${eg.threats?.length ? `<h4 class="et-h">⚠️ Abilities that can kill you</h4>${earlyThreatsHtml(eg.threats, imageFor, roleOf)}` : ''}
      ${eg.tips?.length ? `<h4 class="et-h">✅ How to win the lane</h4><ul class="tip-list">${eg.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>` : '';
  return `
    ${plan.basicMode ? `<div class="notice-box">Basic mode (no API key) — showing Riot's official data. Add an Anthropic API key in ⚙️ Settings for a personalized plan.</div>` : ''}
    <div class="card">
      <h3>The shape of this game</h3>
      <p>${esc(o.summary || '')}</p>
      <div class="kv-grid">
        ${kv('Matchup difficulty', o.matchupDifficulty ? '' : '—', o.matchupDifficulty ? levelBadge(o.matchupDifficulty) : '')}
        ${kv('The one thing to remember', o.keyPrinciple || '—')}
        ${kv('How your team wins', o.winCondition || '—')}
      </div>
    </div>
    ${early}
    ${phase('⚔️ Mid game (14–25 min)', gp.midGame)}
    ${phase('🏰 Late game (25+ min)', gp.lateGame)}
    ${gp.teamfightRole ? `<div class="card"><h3>Your job in teamfights</h3><p>${esc(gp.teamfightRole)}</p></div>` : ''}
    ${glossaryDetails(plan.glossary)}`;
}
function renderPlanTab(plan) { $('#panel-plan').innerHTML = planTabHtml(plan); }

function matchupTabHtml(plan) {
  const lm = plan.laneMatchup;
  if (!lm) {
    return `<div class="card"><p class="muted">Lane matchup analysis needs the AI coach — add an Anthropic API key in ⚙️ Settings.</p></div>`;
  }
  return `
    <div class="card">
      <h3>How this lane plays out</h3>
      <p>${esc(lm.analysis || '')}</p>
      <div class="kv-grid">
        ${kv('Stronger early', lm.whoIsStrongerEarly || '—', lm.whoIsStrongerEarly === 'You' ? badge('You', 'low') + ' ' : lm.whoIsStrongerEarly === 'Enemy' ? badge('Enemy', 'high') + ' ' : '')}
        ${kv('When to trade damage', lm.tradingPattern || '—')}
        ${kv('Danger windows', lm.dangerWindows || '—')}
      </div>
      ${lm.tips?.length ? `<h4>Lane tips</h4><ul class="tip-list">${lm.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>`;
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
    ? `<p class="muted" style="margin-bottom:12px">Ordered by how dangerous they are <b>to you specifically</b>.</p>` +
      threats.map((t) => {
        const img = imageFor(t.champion);
        return `<div class="card threat-card">
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
                ${a.howToReact ? `<div class="react">↳ ${esc(a.howToReact)}</div>` : ''}
              </div>
            </div>`).join('')}
          ${t.howToPlayAgainst ? `<p><b>How to play against ${esc(t.champion)}:</b> ${esc(t.howToPlayAgainst)}</p>` : ''}
        </div>`;
      }).join('')
    : `<div class="card"><p class="muted">No threat data.</p></div>`;
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
  return `
    ${plan.basicMode ? `<div class="notice-box">Basic mode can only analyze the enemy damage profile. Add an Anthropic API key in ⚙️ Settings to get a full build path — starting items, core build order, boots, and situational swaps with reasons.</div>` : ''}
    ${it.startingItems?.items?.length ? `
    <div class="card">
      <h3>🛒 Start with</h3>
      <p><b>${it.startingItems.items.map(itemRefHtml).join(' + ')}</b></p>
      <p class="muted">${esc(it.startingItems.why || '')}</p>
    </div>` : ''}
    ${core ? `<div class="card"><h3>🧱 Core build (in order)</h3>${core}</div>` : ''}
    ${it.boots?.item ? `<div class="card"><h3>👢 Boots</h3><p><b>${itemRefHtml(it.boots.item)}</b> — ${esc(it.boots.why || '')}</p></div>` : ''}
    ${it.situational?.length ? `
    <div class="card">
      <h3>🔀 Situational swaps</h3>
      ${it.situational.map((s) => `<div class="build-step"><div class="idx">→</div><div><div class="item-n">${itemRefHtml(s.item)}</div><div class="item-w">Buy when: ${esc(s.buyWhen)}</div></div></div>`).join('')}
    </div>` : ''}
    <div class="card">
      <h3>🛡️ Defending against this team</h3>
      <p>Enemy damage profile: ${badge(it.enemyDamageProfile || 'Mixed', profCls)}</p>
      <p>${esc(it.defensiveAdvice || '')}</p>
    </div>`;
}
function renderItemsTab(plan) { $('#panel-items').innerHTML = itemsTabHtml(plan); }

function renderPlan(plan) {
  currentPlan = plan;
  renderPlanTab(plan);
  renderMatchupTab(plan);
  renderThreatsTab(plan);
  renderItemsTab(plan);
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
    ? all.map(([t, d]) => `<p class="g-term"><b>${esc(t)}</b> — ${esc(d)}</p>`).join('')
    : '<p class="muted">No matching terms.</p>';
}

// ---------- settings ----------
async function openSettings() {
  const s = await api('/api/settings');
  $('#set-apikey').value = '';
  $('#set-apikey').placeholder = s.hasApiKey ? '•••••••• (key saved — type to replace)' : 'sk-ant-…';
  $('#set-model').value = s.model;
  $('#set-leaguepath').value = s.leaguePath || '';
  $('#modal-settings').classList.remove('hidden');
}

async function saveSettings() {
  const key = $('#set-apikey').value.trim();
  const body = {
    model: $('#set-model').value,
    leaguePath: $('#set-leaguepath').value.trim(),
  };
  if (key) body.anthropicApiKey = key;
  await api('/api/settings', { method: 'POST', body });
  $('#modal-settings').classList.add('hidden');
  const st = await api('/api/state');
  onState(st);
}

// ---------- demo ----------
async function loadScenarios() {
  const list = await api('/api/demo/scenarios');
  $('#demo-scenario').innerHTML = list.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
}

async function startDemo(phase) {
  const scenario = $('#demo-scenario').value;
  await api('/api/demo/start', { method: 'POST', body: { scenario, phase } });
}
async function stopDemo() {
  await api('/api/demo/stop', { method: 'POST' });
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
  if (n > 0) return { cls: 'up', arrow: '▲', sign: '+' };
  if (n < 0) return { cls: 'down', arrow: '▼', sign: '' };
  return { cls: '', arrow: '', sign: '' };
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
    trend = `<span class="trend ${d.cls}">${d.arrow} ${d.sign}${fmt(b.delta)}</span>`;
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
  const champs = s.topChampions.map((c) => `
    <div class="sum-champ" title="${esc(c.championName || '')}">
      ${c.championImage ? `<img src="${esc(c.championImage)}" alt="${esc(c.championName || '')}" />` : ''}
      <div><div class="cn">${esc(c.championName || '?')}</div>
      <div class="cs2">${c.games}g · ${pctText(c.winrate)}</div></div>
    </div>`).join('');

  $('#history-summary').innerHTML = `
    <div class="sum-left">
      <div class="sum-record">
        <b class="w">${s.record.wins}</b>W <b class="l">${s.record.losses}</b>L
        <span class="wr">${pctText(s.record.winrate)}</span>
      </div>
      <div class="muted small">Last ${Math.min(s.window, s.playableMatches)} ranked games${s.role ? ` · mostly ${esc(s.role)}` : ''}</div>
    </div>
    <div class="sum-stats">
      ${baselineCell('CS / min', s.baseline.csPerMin)}
      ${baselineCell('Kill participation', s.baseline.killParticipation, pctText)}
      ${baselineCell('Vision score', s.baseline.visionScore, (v) => Math.round(v * 10) / 10)}
      ${s.insufficientData ? `<div class="sum-note muted small">Trends need ${10 - s.playableMatches} more game(s).</div>` : ''}
    </div>
    <div class="sum-champs">${champs}</div>`;
}

async function loadMatches() {
  const q = new URLSearchParams({ page: hist.page, size: hist.size });
  if (hist.role) q.set('role', hist.role);
  if (hist.queue) q.set('queue', hist.queue);
  try {
    const data = await api(`/api/history/matches?${q}`);
    hist.total = data.total;
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
      <b>${m.cs} CS</b>
      <span class="muted">${m.csPerMin ?? '—'}/min</span>
    </span>
    <span class="mr-col">
      ${signed(m.csDiffVsLaneOpponent)}
      <span class="muted">vs lane</span>
    </span>
    <span class="mr-col right">
      <b>${outcomeLabel(m)}</b>
      <span class="muted">${fmtDuration(m.durationSec)} · ${esc(relTime(m.playedAt))}</span>
    </span>
  </button>`;
}

function renderMatchList(rows) {
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
    <button class="btn tiny" id="pg-prev" ${hist.page === 0 ? 'disabled' : ''}>← Newer</button>
    <span class="muted">Page ${hist.page + 1} of ${pages} · ${hist.total} matches</span>
    <button class="btn tiny" id="pg-next" ${hist.page >= pages - 1 ? 'disabled' : ''}>Older →</button>`;
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
const RANK_SERIES = { 420: { color: '#0b9a8e', label: 'Solo/Duo' }, 440: { color: '#bd8a2e', label: 'Flex' } };
const RANK_TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond'];
const RANK_DIVS = ['IV', 'III', 'II', 'I'];
const RANK_PRESETS = [7, 14, 30, 'all'];

let rankChartInstance = null;
let rankChartResizeObserver = null;
let rankChartLayout = null;
let rankChartPreset = 14;

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

function rankDatum(p) {
  return { value: [p.chartX, p.value], snapshot: p };
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
  return RankChartLayout.windowForPreset(rankChartLayout, preset);
}

function rankRangeText(start, end) {
  const days = RankChartLayout.daysInWindow(rankChartLayout, start, end);
  if (!days.length) return '';
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const scope = rankChartPreset === 'all'
    ? 'All time'
    : rankChartPreset
      ? `Last ${rankChartPreset} days`
      : 'Custom range';
  return `${scope} · ${fmt.format(new Date(days[0].at))}–${fmt.format(new Date(days[days.length - 1].at))}`;
}

function detectedRankPreset(start, end) {
  if (!rankChartLayout) return null;
  const tolerance = 0.01;
  const candidates = [rankChartPreset, 'all', 7, 14]
    .filter((value, index, values) => value != null && values.indexOf(value) === index);
  for (const preset of candidates) {
    const [expectedStart, expectedEnd] = rankWindow(preset);
    if (Math.abs(start - expectedStart) < tolerance && Math.abs(end - expectedEnd) < tolerance) return preset;
  }
  return null;
}

function syncRankRangeUi(start, end) {
  rankChartPreset = detectedRankPreset(start, end);
  $$('.rank-range-btn').forEach((button) => {
    const value = button.dataset.range === 'all' ? 'all' : Number(button.dataset.range);
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
  rankChartPreset = preset;
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
        data: [[from.chartX, from.value], [to.chartX, to.value]],
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
      data: resultGames.map((game) => ({ value: [game.chartX, 0.5], game })),
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

function disposeRankChart() {
  rankChartResizeObserver?.disconnect();
  rankChartResizeObserver = null;
  rankChartInstance?.dispose();
  rankChartInstance = null;
}

async function loadRankChart() {
  try {
    const data = await api('/api/history/rank');
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
  rankChartPreset = rankChartLayout.lastAt - rankChartLayout.firstAt <= 14 * 24 * 60 * 60 * 1000
    ? 'all'
    : 14;

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
      <div class="rank-range" role="group" aria-label="Visible rank-history range">
        ${RANK_PRESETS.map((preset) => {
          const label = preset === 'all' ? 'All' : `${preset}D`;
          return `<button type="button" class="rank-range-btn" data-range="${preset}" aria-pressed="false">${label}</button>`;
        }).join('')}
      </div>
      <span id="rank-window-label" class="rank-window-label muted small"></span>
      <span class="rank-zoom-hint muted small">Dashed = unobserved LP path · Drag navigator · Ctrl+scroll to zoom</span>
    </div>
    <div id="rank-echart" class="rank-echart"></div>
    <span id="rank-range-status" class="sr-only" aria-live="polite"></span>
    <details class="rank-table"><summary class="muted small">View as table</summary>
      <table><thead><tr><th>When</th><th>Queue</th><th>Rank</th><th>W–L</th></tr></thead><tbody>${table}</tbody></table>
    </details>`;

  $$('.rank-range-btn').forEach((button) => {
    button.onclick = () => setRankWindow(button.dataset.range === 'all' ? 'all' : Number(button.dataset.range));
  });

  if (!window.echarts) {
    $('#rank-echart').innerHTML = '<p class="error-box">The chart library could not be loaded.</p>';
    return;
  }

  const colors = rankColors();
  const [startValue, endValue] = rankWindow(rankChartPreset);
  const container = $('#rank-echart');
  const [axisMin, axisMax] = rankChartLayout.xExtent;
  const dayLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  rankChartInstance = echarts.init(container, null, { renderer: 'svg' });
  rankChartInstance.setOption({
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: colors.text, fontFamily: getComputedStyle(document.body).fontFamily },
    aria: {
      enabled: true,
      description: 'Rank over elapsed time. Rank Snapshots and ranked Matches appear at their actual dates and times. Green and red ticks represent wins and losses. Dashed lines connect snapshots with an unobserved LP path. Use the 7 day, 14 day, 30 day, and All buttons to change the visible time range. Exact snapshot values and dates are also available in the table below.',
    },
    grid: [
      { top: 16, right: 18, bottom: 128, left: 78, containLabel: false },
      { right: 18, bottom: 73, height: 18, left: 78, containLabel: false },
    ],
    xAxis: [
      {
        type: 'time',
        gridIndex: 0,
        min: axisMin,
        max: axisMax,
        boundaryGap: false,
        axisLine: { lineStyle: { color: colors.line } },
        axisTick: { show: false },
        axisLabel: {
          color: colors.dim,
          hideOverlap: true,
          formatter: (value) => dayLabel.format(new Date(Number(value))),
        },
        splitLine: { show: false },
        axisPointer: { lineStyle: { color: colors.dim, width: 1 } },
      },
      {
        type: 'time',
        gridIndex: 1,
        min: axisMin,
        max: axisMax,
        show: false,
      },
    ],
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
    graphic: rankedGames.length ? [{
      type: 'text',
      left: 20,
      bottom: 76,
      silent: true,
      style: { text: 'GAMES', fill: colors.dim, font: '10px sans-serif' },
    }] : [],
    series: buildRankSeries(ranked, colors, rankedGames),
  });

  syncRankRangeUi(startValue, endValue);
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
  const arrow = cmp.direction === 'above' ? '▲' : '▼';
  return `<div class="bench-row">
    <span class="bl">${esc(label)}</span>
    <span class="bv">${esc(String(fmt(cmp.value)))}</span>
    <span class="bb ${dirCls}">${arrow} target ${esc(String(fmt(cmp.benchmark)))}</span>
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

function objectivesHtml(teams, myTeamId) {
  if (!teams?.length) return '';
  const cell = (t) => `<div class="obj-col ${t.teamId === myTeamId ? 'mine' : ''}">
    <div class="obj-title">${t.teamId === myTeamId ? 'Your team' : 'Enemy team'} — ${t.win ? 'Victory' : 'Defeat'}</div>
    <div class="obj-grid">
      <span>🏰 ${t.towerKills} towers</span>
      <span>🐉 ${t.dragonKills} drakes</span>
      <span>🦀 ${t.baronKills} barons</span>
      <span>👁 ${t.riftHeraldKills} heralds</span>
    </div>
  </div>`;
  return `<div class="card"><h3>Objectives</h3><div class="obj-wrap">${teams.map(cell).join('')}</div></div>`;
}

function coachingHtml(coaching, players) {
  if (!coaching?.plan) return '';
  const byName = new Map(players.map((p) => [p.championName, p.championImage]));
  const imageFor = (name) => byName.get(name) || null;
  const plan = coaching.plan;
  const when = coaching.generatedAt ? new Date(coaching.generatedAt).toLocaleString() : '';
  return `<details class="card coaching-block">
    <summary><b>💬 What you were told before this game</b> <span class="muted small">${esc(when)}${coaching.model ? ' · ' + esc(coaching.model) : ''}</span></summary>
    <div class="coaching-body">
      ${planTabHtml(plan, imageFor)}
      ${matchupTabHtml(plan)}
      ${threatsTabHtml(plan, imageFor)}
      ${itemsTabHtml(plan)}
    </div>
  </details>`;
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

  $('#history-detail-view').innerHTML = `
    <button class="btn secondary" id="btn-hist-back">← Back to history</button>

    <div class="card detail-head ${outcomeClass(m)}">
      ${m?.championImage ? `<img src="${esc(m.championImage)}" alt="" />` : ''}
      <div>
        <h2>${esc(m?.championName || '?')} <span class="muted">${esc(m?.role || '')}</span></h2>
        <p class="muted">${esc(m?.queueLabel || '')} · ${fmtDuration(m?.durationSec)} · ${esc(relTime(m?.playedAt))} · patch ${esc(m?.patch || '?')}</p>
      </div>
      <div class="spacer"></div>
      <div class="detail-result">${outcomeLabel(m)}</div>
    </div>

    ${m?.isRemake ? `<div class="notice-box">This game was a remake, so it's excluded from your winrate and averages.</div>` : ''}

    <div class="detail-grid">
      <div class="card">
        <h3>Your performance</h3>
        <div class="kv-grid">
          ${kv('Score', `${m?.kills}/${m?.deaths}/${m?.assists}`)}
          ${kv('Creep score', `${m?.cs} (${m?.csPerMin ?? '—'}/min)`)}
          ${kv('Gold earned', String(m?.goldEarned ?? '—'))}
          ${kv('Damage to champions', String(m?.damageToChampions ?? '—'))}
        </div>
        <h4>Against your role</h4>
        ${benchRow('CS / min', d.benchmarks.csPerMin)}
        ${benchRow('Vision score', d.benchmarks.visionScore)}
        ${benchRow('Kill participation', d.benchmarks.killParticipation, pctText)}
        ${Object.keys(d.benchmarks).length === 0 ? '<p class="muted">No role benchmarks for this match.</p>' : ''}
        <h4>Lane &amp; team</h4>
        <div class="kv-grid">
          ${kv('CS vs lane opponent', '', signed(m?.csDiffVsLaneOpponent))}
          ${kv('Share of team damage', pctText(m?.damageShare))}
          ${m?.csDiffAt10 !== null && m?.csDiffAt10 !== undefined ? kv('Best CS lead at 10m', String(m.csDiffAt10)) : ''}
        </div>
      </div>

      <div class="card">
        <h3>All players</h3>
        <div class="pl-team">
          <div class="pl-head">Your team</div>
          ${allies.map((p) => playerRowHtml(p, m?.puuid)).join('')}
        </div>
        <div class="pl-team">
          <div class="pl-head">Enemy team</div>
          ${enemies.map((p) => playerRowHtml(p, m?.puuid)).join('')}
        </div>
      </div>
    </div>

    ${objectivesHtml(d.teams, myTeamId)}
    ${coachingHtml(d.coaching, d.players)}
    ${!d.coaching ? `<p class="muted small">No coaching was generated for this game.</p>` : ''}`;

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
      <button class="btn secondary" id="btn-champ-back">← All champions</button>
      <div class="error-box">${esc(err.message)}</div>
      <button class="btn secondary" id="btn-champ-retry">↻ Try again</button>`;
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
    <div class="card build-head">
      <button class="btn secondary" id="btn-champ-back">← All champions</button>
      <img class="bh-portrait" src="${esc(d.champion.image.square)}" alt="" />
      <div>
        <h2>${esc(d.champion.name)} <span class="muted">${esc(d.champion.title)}</span></h2>
        <p class="bh-stats"><span class="${wrClass(d.overall.winRate)}">${(100 * d.overall.winRate).toFixed(1)}% WR</span> · ${fmtGames(total)} games · ${esc(tierLabel)} · patch ${esc(d.patch)}</p>
      </div>
      <div class="spacer"></div>
      <div class="field inline">
        <label for="build-tier">Rank</label>
        <select id="build-tier">${tierOpts}</select>
      </div>
    </div>

    <nav class="tabs build-roles">${roleTabs}</nav>

    ${d.stale ? `<div class="notice-box">Live stats couldn't be refreshed — showing the last saved data (patch ${esc(d.patch)}).
      <button class="btn tiny" id="btn-build-refresh">↻ Retry</button></div>` : ''}

    <div class="build-grid">
      <div class="card">
        <h3>Runes ${wrMetaHtml(d.runes, total)}</h3>
        ${runePageHtml(d.runes)}
      </div>
      <div class="card">
        <h3>Core build ${wrMetaHtml(d.coreItems, total)}</h3>
        ${iconRowHtml(d.coreItems.list, { arrows: true, itemStats: true, labels: true })}
        <div class="build-line">
          <h4>Boots</h4>
          ${iconRowHtml(d.boots.list, { itemStats: true })}
          ${subMetaHtml(d.boots, total)}
        </div>
        <div class="build-line">
          <h4>Starting items</h4>
          ${iconRowHtml(d.startingItems.list, { itemStats: true })}
          ${subMetaHtml(d.startingItems, total)}
        </div>
        <div class="build-line">
          <h4>Spells</h4>
          ${iconRowHtml(d.spells.list)}
          ${subMetaHtml(d.spells, total)}
        </div>
      </div>
      <div class="card">
        <h3>Late &amp; situational</h3>
        ${lateItemsHtml(d.lateItems, total)}
      </div>
    </div>

    <div class="build-row2${d.baseStats ? '' : ' solo'}">
      <div class="card">
        <h3>Skill order ${wrMetaHtml(d.skills, total)}</h3>
        ${skillOrderHtml(d.skills, d.abilities)}
      </div>
      ${d.baseStats ? `
      <div class="card">
        <h3>Base stats <span class="sec-meta">level 1 → 18 · same in every role</span></h3>
        ${baseStatsHtml(d.baseStats, d.champion.partype)}
      </div>` : ''}
    </div>

    <p class="muted small">Aggregated from ranked games worldwide (${esc(tierLabel)}) · data via OP.GG · fetched ${esc(relTime(d.fetchedAt) || 'just now')}</p>`;

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
function wire() {
  $('#btn-settings').onclick = openSettings;
  $('#btn-settings-close').onclick = () => $('#modal-settings').classList.add('hidden');
  $('#btn-settings-save').onclick = () => saveSettings().catch((e) => alert(e.message));

  $('#btn-open-glossary').onclick = () => { renderGlossaryModal(); $('#modal-glossary').classList.remove('hidden'); };
  $('#btn-glossary-close').onclick = () => $('#modal-glossary').classList.add('hidden');
  $('#glossary-search').oninput = (e) => renderGlossaryModal(e.target.value);

  $('#btn-demo-game').onclick = () => startDemo('game').catch((e) => alert(e.message));
  $('#btn-demo-cs').onclick = () => startDemo('champselect').catch((e) => alert(e.message));
  $('#btn-exit-demo-cs').onclick = () => stopDemo();
  $('#btn-exit-demo-game').onclick = () => stopDemo();

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

  $$('.navbtn').forEach((b) => (b.onclick = () => showSection(b.dataset.section)));
  $('#btn-goto-live').onclick = () => showSection('live');
  $('#btn-dismiss-notice').onclick = hidePhaseNotice;
  $('#btn-hist-sync').onclick = async () => {
    const btn = $('#btn-hist-sync');
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      await api('/api/history/sync', { method: 'POST', body: {} });
      await refreshHistory();
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Sync now';
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
loadScenarios().catch(() => {});
loadItemIndex().catch(() => {}); // icons/tooltips degrade to plain names without it
api('/api/state').then(onState).catch(() => setPill('waiting', 'Server unreachable'));
connectEvents();
