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
      currentPlan = null; currentCsAdvice = null; chatHistory = [];
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

function showView(name) {
  for (const v of ['waiting', 'champselect', 'ingame']) {
    $(`#view-${v}`).classList.toggle('hidden', v !== name);
  }
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

  if (currentCsAdvice) renderCsAdvice(currentCsAdvice);
}

function renderCsAdvice(advice) {
  currentCsAdvice = advice;
  const yc = advice.yourChampion;
  const parts = [];
  if (advice.basicMode) {
    parts.push(`<div class="notice-box">Basic mode (no API key). This is Riot's official champion data — add an Anthropic API key in ⚙️ Settings for personalized coaching.</div>`);
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

function renderPlanTab(plan) {
  const o = plan.overview || {};
  const gp = plan.gamePlan || {};
  const phase = (label, ph) => ph ? `
    <div class="card">
      <h3>${esc(label)}</h3>
      <p><b>Goal:</b> ${esc(ph.goal || '')}</p>
      ${ph.tips?.length ? `<ul class="tip-list">${ph.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>` : '';
  $('#panel-plan').innerHTML = `
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

function renderMatchupTab(plan) {
  const lm = plan.laneMatchup;
  if (!lm) {
    $('#panel-matchup').innerHTML = `<div class="card"><p class="muted">Lane matchup analysis needs the AI coach — add an Anthropic API key in ⚙️ Settings.</p></div>`;
    return;
  }
  $('#panel-matchup').innerHTML = `
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

function champImageByName(name) {
  const all = [...(state?.game?.enemies || []), ...(state?.game?.allies || [])];
  const found = all.find((p) => p.champion?.name === name);
  return found?.champion?.image || null;
}

function renderThreatsTab(plan) {
  const threats = plan.enemyThreats || [];
  $('#panel-threats').innerHTML = threats.length
    ? `<p class="muted" style="margin-bottom:12px">Ordered by how dangerous they are <b>to you specifically</b>.</p>` +
      threats.map((t) => {
        const img = champImageByName(t.champion);
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

function renderItemsTab(plan) {
  const it = plan.itemization || {};
  const profCls = it.enemyDamageProfile === 'Mostly Physical' ? 'physical' : it.enemyDamageProfile === 'Mostly Magic' ? 'magic' : 'mixed';
  const core = (it.coreBuild || []).map((s, i) => `
    <div class="build-step">
      <div class="idx">${i + 1}</div>
      <div><div class="item-n">${esc(s.item)}</div><div class="item-w">${esc(s.why)}</div></div>
    </div>`).join('');
  $('#panel-items').innerHTML = `
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
async function generatePlan(force = false) {
  const btn = force ? $('#btn-regenerate') : $('#btn-generate');
  btn.disabled = true;
  $('#gen-title').textContent = state?.aiAvailable ? 'Analyzing your matchup…' : 'Building basic guidance…';
  $('#gen-sub').innerHTML = state?.aiAvailable
    ? 'The coach is studying all ten champions. This takes 30–90 seconds — perfect time to buy your starting items.'
    : 'Assembling Riot\'s official data for this game.';
  try {
    const { plan } = await api('/api/coach/gameplan', { method: 'POST', body: { force } });
    renderPlan(plan);
  } catch (err) {
    $('#gen-title').textContent = 'Something went wrong';
    $('#gen-sub').innerHTML = `<span class="error-box" style="display:inline-block">${esc(err.message)}</span>`;
    $('#btn-generate').classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function generateCsAdvice() {
  const btn = $('#btn-cs-generate');
  btn.disabled = true;
  $('#cs-advice').innerHTML = `<div class="loading"><div class="spinner"></div> Preparing your briefing… (~20–40s)</div>`;
  try {
    const { advice } = await api('/api/coach/champselect', { method: 'POST', body: {} });
    renderCsAdvice(advice);
  } catch (err) {
    $('#cs-advice').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
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
  $('#btn-cs-generate').onclick = generateCsAdvice;

  $$('.tab').forEach((t) => (t.onclick = () => selectTab(t.dataset.tab)));

  $('#chat-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendChat(text);
  };

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
