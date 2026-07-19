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
  } else {
    showView('waiting');
    renderWaiting();
    if (prevPhase === 'ingame' || prevPhase === 'champselect') {
      currentPlan = null; currentCsAdvice = null; csBriefingKey = null; chatHistory = [];
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
  $$('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
  if (name === 'live') {
    hidePhaseNotice();
    applyCurrentPhase();
  } else {
    refreshHistory();
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
function memberRow(m) {
  const img = m.champion
    ? `<img src="${esc(m.champion.image)}" alt="${esc(m.champion.name)}" />`
    : `<div class="champ-placeholder">?</div>`;
  const name = m.champion ? m.champion.name : (m.locked ? 'Unknown' : 'Picking…');
  return `<div class="team-member ${m.isMe ? 'me' : ''}">
    ${img}
    <div class="who"><div class="nm">${esc(name)}${m.isMe ? ' (you)' : ''}</div>
    <div class="rl">${esc(m.role || '')}</div></div>
  </div>`;
}

function renderChampSelect() {
  const cs = state.champSelect;
  if (!cs) return;
  $('#cs-myteam').innerHTML = cs.myTeam.map(memberRow).join('');
  $('#cs-theirteam').innerHTML = cs.theirTeam.length
    ? cs.theirTeam.map(memberRow).join('')
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

// ---------- in-game header ----------
function stripChamp(p) {
  if (!p.champion) return '';
  return `<div class="strip-champ ${p.isMe ? 'me' : ''}" title="${esc(p.champion.name)}${p.role ? ' — ' + esc(p.role) : ''}">
    <img src="${esc(p.champion.image)}" alt="${esc(p.champion.name)}" />
    <span class="cn">${esc(p.champion.name)}</span>
  </div>`;
}

function renderGameHeader() {
  const g = state.game;
  if (!g) return;
  const mins = Math.floor((g.gameTime || 0) / 60);
  $('#game-meta').textContent = `${g.gameMode === 'CLASSIC' ? "Summoner's Rift" : g.gameMode} · ${mins} min · you: ${g.me?.champion?.name || '?'}${g.me?.role ? ' (' + g.me.role + ')' : ''}`;
  $('#game-teams').innerHTML = `
    <div class="team-side">${g.allies.map(stripChamp).join('')}</div>
    <div class="vs">VS</div>
    <div class="team-side">${g.enemies.map(stripChamp).join('')}</div>`;
  setSplash($('#game-teams'), g.me?.champion?.id);
  const isDemo = state.mode === 'demo';
  $('#game-demo-badge').classList.toggle('hidden', !isDemo);
  $('#btn-exit-demo-game').classList.toggle('hidden', !isDemo);
}

function resetGamePanels() {
  currentPlan = null;
  chatHistory = [];
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

// The *Html builders below are shared by the live tabs and the history detail
// view, so coaching renders identically whether you're mid-game or reviewing.
function planTabHtml(plan) {
  const o = plan.overview || {};
  const gp = plan.gamePlan || {};
  const phase = (label, ph) => ph ? `
    <div class="card">
      <h3>${esc(label)}</h3>
      <p><b>Goal:</b> ${esc(ph.goal || '')}</p>
      ${ph.tips?.length ? `<ul class="tip-list">${ph.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>` : '';
  return `
    ${plan.basicMode ? `<div class="notice-box">Basic mode (no API key) — showing Riot's official data. Add an Anthropic API key in ⚙️ Settings for a personalized plan.</div>` : ''}
    <div class="card">
      <h3>The shape of this game</h3>
      <p>${esc(o.summary || '')}</p>
      <div class="kv-grid">
        ${kv('Matchup difficulty', o.matchupDifficulty || '—', o.matchupDifficulty ? levelBadge(o.matchupDifficulty) + ' ' : '')}
        ${kv('The one thing to remember', o.keyPrinciple || '—')}
        ${kv('How your team wins', o.winCondition || '—')}
      </div>
    </div>
    ${phase('🌅 Early game (0–14 min)', gp.earlyGame)}
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
              <div class="ability-key">${esc(a.key)}</div>
              <div class="ability-body">
                <span class="an">${esc(a.name)}</span> — ${esc(a.whatItDoes)}
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
      <div><div class="item-n">${esc(s.item)}</div><div class="item-w">${esc(s.why)}</div></div>
    </div>`).join('');
  return `
    ${plan.basicMode ? `<div class="notice-box">Basic mode can only analyze the enemy damage profile. Add an Anthropic API key in ⚙️ Settings to get a full build path — starting items, core build order, boots, and situational swaps with reasons.</div>` : ''}
    ${it.startingItems?.items?.length ? `
    <div class="card">
      <h3>🛒 Start with</h3>
      <p><b>${esc(it.startingItems.items.join(' + '))}</b></p>
      <p class="muted">${esc(it.startingItems.why || '')}</p>
    </div>` : ''}
    ${core ? `<div class="card"><h3>🧱 Core build (in order)</h3>${core}</div>` : ''}
    ${it.boots?.item ? `<div class="card"><h3>👢 Boots</h3><p><b>${esc(it.boots.item)}</b> — ${esc(it.boots.why || '')}</p></div>` : ''}
    ${it.situational?.length ? `
    <div class="card">
      <h3>🔀 Situational swaps</h3>
      ${it.situational.map((s) => `<div class="build-step"><div class="idx">→</div><div><div class="item-n">${esc(s.item)}</div><div class="item-w">Buy when: ${esc(s.buyWhen)}</div></div></div>`).join('')}
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

function itemImg(id) {
  return id ? `<img class="item-icon" src="/img/item/${id}" alt="" loading="lazy" />` : `<span class="item-icon empty"></span>`;
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
// by nature — no API serves historical LP — so the graph grows from the day
// tracking started. Vanilla SVG: 2px lines, 8px markers ringed in the surface
// color, hairline solid gridlines, a crosshair + one tooltip listing every
// series at the hovered time. Series colors are validated steps of the app's
// teal and gold (CVD ΔE 11.9, both ≥3:1 on the panel surface) — don't swap in
// the raw brand hexes, they fail the lightness/chroma checks.
const RANK_SERIES = { 420: { color: '#0b9a8e', label: 'Solo/Duo' }, 440: { color: '#bd8a2e', label: 'Flex' } };
const RANK_TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond'];
const RANK_DIVS = ['IV', 'III', 'II', 'I'];

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

async function loadRankChart() {
  try {
    const data = await api('/api/history/rank');
    renderRankChart(data.queues || []);
  } catch {
    $('#history-rank').innerHTML = '';
  }
}

function renderRankChart(queues) {
  const card = $('#history-rank');
  const series = queues.filter((q) => q.points?.length && RANK_SERIES[q.queueId]);
  if (!series.length) {
    card.innerHTML = `<div class="rank-head"><span class="lbl">Rank over time</span></div>
      <p class="muted small">No rank recorded yet. Your LP graph starts building the first time the app sees the
      League client — snapshots are taken automatically after each game.</p>`;
    return;
  }

  const W = 640, H = 220, PAD = { t: 14, r: 16, b: 26, l: 66 };
  const pts = series.flatMap((s) => s.points);
  let tMin = Math.min(...pts.map((p) => p.at));
  let tMax = Math.max(...pts.map((p) => p.at));
  if (tMax - tMin < 36e5) { tMin -= 432e5; tMax += 432e5; } // <1h of data: pad ±12h so lone points sit mid-chart
  let vMin = Math.min(...pts.map((p) => p.value));
  let vMax = Math.max(...pts.map((p) => p.value));
  vMin = Math.floor((vMin - 25) / 100) * 100; // snap to division boundaries
  vMax = Math.ceil((vMax + 25) / 100) * 100;

  const x = (t) => PAD.l + ((t - tMin) / (tMax - tMin)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - ((v - vMin) / (vMax - vMin)) * (H - PAD.t - PAD.b);

  // Gridlines on division boundaries, thinned to ≤5 labeled ticks.
  const step = 100 * Math.max(1, Math.ceil((vMax - vMin) / 100 / 5));
  let grid = '';
  for (let v = vMin; v <= vMax; v += step) {
    grid += `<line class="rk-grid" x1="${PAD.l}" y1="${y(v)}" x2="${W - PAD.r}" y2="${y(v)}"/>
      <text class="rk-tick" x="${PAD.l - 8}" y="${y(v) + 3}" text-anchor="end">${esc(rankLabel(v))}</text>`;
  }
  const day = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  grid += `<text class="rk-tick" x="${PAD.l}" y="${H - 8}">${esc(day(tMin))}</text>
    <text class="rk-tick" x="${W - PAD.r}" y="${H - 8}" text-anchor="end">${esc(day(tMax))}</text>`;

  const marks = series.map((s) => {
    const c = RANK_SERIES[s.queueId].color;
    const line = s.points.length > 1
      ? `<polyline class="rk-line" stroke="${c}" points="${s.points.map((p) => `${x(p.at)},${y(p.value)}`).join(' ')}"/>`
      : '';
    const dots = s.points.map((p) =>
      `<circle class="rk-dot" cx="${x(p.at)}" cy="${y(p.value)}" r="4" fill="${c}"/>`).join('');
    return line + dots;
  }).join('');

  // Legend only when both queues are present — one series is named by the title.
  const legend = series.length > 1
    ? `<span class="rank-legend">${series.map((s) =>
        `<span class="rk-key"><span class="rk-swatch" style="background:${RANK_SERIES[s.queueId].color}"></span>${esc(RANK_SERIES[s.queueId].label)}</span>`).join('')}</span>`
    : '';
  const latest = series.map((s) => {
    const p = s.points[s.points.length - 1];
    return `<span class="rk-now"><span class="rk-swatch" style="background:${RANK_SERIES[s.queueId].color}"></span><b>${esc(pointLabel(p))}</b></span>`;
  }).join('');

  card.innerHTML = `
    <div class="rank-head">
      <span class="lbl">Rank over time</span>${legend}<span class="spacer"></span>${latest}
    </div>
    <div class="rank-plot">
      <svg viewBox="0 0 ${W} ${H}" tabindex="0" role="img" aria-label="LP and rank over time">
        ${grid}
        <line class="rk-cross hidden" y1="${PAD.t}" y2="${H - PAD.b}"/>
        ${marks}
      </svg>
      <div class="rank-tip hidden"></div>
    </div>
    <details class="rank-table"><summary class="muted small">View as table</summary>
      <table><thead><tr><th>When</th><th>Queue</th><th>Rank</th><th>W–L</th></tr></thead><tbody>${
        series.flatMap((s) => s.points.map((p) => ({ s, p })))
          .sort((a, b) => b.p.at - a.p.at)
          .map(({ s, p }) => `<tr><td>${esc(new Date(p.at).toLocaleString())}</td><td>${esc(RANK_SERIES[s.queueId].label)}</td><td>${esc(pointLabel(p))}</td><td>${p.wins}–${p.losses}</td></tr>`).join('')
      }</tbody></table>
    </details>`;

  attachRankHover(card, series, x, tMin, tMax);
}

// Crosshair + one tooltip for all series: the hairline snaps to the nearest
// snapshot time, and the readout lists every queue's standing at that moment —
// nobody has to land a pointer on a 2px line. Focus shows the newest point, so
// the same details are reachable from the keyboard.
function attachRankHover(card, series, x, tMin, tMax) {
  const svg = card.querySelector('svg');
  const cross = card.querySelector('.rk-cross');
  const tip = card.querySelector('.rank-tip');
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.at)))].sort((a, b) => a - b);

  const show = (t) => {
    cross.setAttribute('x1', x(t)); cross.setAttribute('x2', x(t));
    cross.classList.remove('hidden');
    tip.replaceChildren(...series.map((s) => {
      // Standing "as of" the crosshair time: the latest snapshot at or before it.
      const p = [...s.points].reverse().find((q) => q.at <= t) || s.points[0];
      const row = document.createElement('div');
      row.className = 'rk-tip-row';
      const key = document.createElement('span');
      key.className = 'rk-swatch';
      key.style.background = RANK_SERIES[s.queueId].color;
      const val = document.createElement('b');
      val.textContent = pointLabel(p); // LCU strings are untrusted — textContent, never innerHTML
      const lbl = document.createElement('span');
      lbl.className = 'muted';
      lbl.textContent = ` ${RANK_SERIES[s.queueId].label}`;
      row.append(key, val, lbl);
      return row;
    }));
    const when = document.createElement('div');
    when.className = 'rk-tip-when muted';
    when.textContent = new Date(t).toLocaleString();
    tip.append(when);
    tip.classList.remove('hidden');
    const box = svg.getBoundingClientRect();
    const px = ((x(t)) / 640) * box.width;
    tip.style.left = `${Math.min(Math.max(px, 70), box.width - 70)}px`;
  };
  const hide = () => { cross.classList.add('hidden'); tip.classList.add('hidden'); };

  svg.addEventListener('pointermove', (ev) => {
    const box = svg.getBoundingClientRect();
    const t = tMin + ((ev.clientX - box.left) / box.width) * (tMax - tMin);
    show(times.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a)));
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(times[times.length - 1]));
  svg.addEventListener('blur', hide);
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
      ${planTabHtml(plan)}
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
api('/api/state').then(onState).catch(() => setPill('waiting', 'Server unreachable'));
connectEvents();
