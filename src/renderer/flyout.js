// HavenBar panels: one window, re-filled for whichever bar button was clicked.
const api = window.haven;
const panel = document.getElementById('panel');
const ic = (n) => HavenBar.icon(n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (s) => panel.querySelector(s);
const $$ = (s) => [...panel.querySelectorAll(s)];
const fmt = (d, f) => HavenStudio.formatDate(d, f);
const hexRgb = (h) => { const n = parseInt(String(h || '#888').replace('#', '').slice(0, 6).padEnd(6, '0'), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(' '); };
let P = null, ST = {}, kind = null, calMonth = null, armed = null, extra = {}, tick = null;

// Extra icons the panels use (same style as the bar's).
const X = {
  x: '<path d="M6 6l12 12M18 6 6 18"/>', chevL: '<path d="m15 6-6 6 6 6"/>', chevR: '<path d="m9 6 6 6-6 6"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>', out: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 16l-4-4 4-4M5 12h11"/>',
  restart: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  shot: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 1.2 14H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 1.2V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 4.6a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 22.8 10h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" transform="scale(.83) translate(2.4 2.4)"/>',
  task: '<path d="M3 12h4l3 8 4-16 3 8h4"/>', folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  bar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/>', play2: '<path d="M8 5v14l11-7z"/>',
};
const icx = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${X[n] || ''}</svg>`;

function applyPalette() {
  const p = P.palette, r = document.documentElement.style;
  for (const k of ['base', 'mantle', 'surface', 'text', 'subtext', 'accent', 'accent2', 'red', 'green', 'yellow']) { r.setProperty('--' + k, p[k]); r.setProperty('--' + k + '-rgb', hexRgb(p[k])); }
  r.setProperty('--font', `"${P.config.font}", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`);
  document.body.classList.toggle('bottom', P.config.position === 'bottom');
  const rad = P.config.style === 'full' ? 0 : P.config.radius;
  r.setProperty('--pr', Math.min(18, rad + 4) + 'px');
  document.body.classList.toggle('square', rad <= 4);
}
const fit = () => requestAnimationFrame(() => api.flyoutSize(panel.scrollHeight));
new ResizeObserver(fit).observe(panel);
new MutationObserver(fit).observe(panel, { childList: true, subtree: true, characterData: true });

// ------------------------------------------------------------------ shared bits
function slider(id, icon, val, cls = '') { return `<div class="sl"><button class="ib ${cls}" data-ib="${id}">${icon}</button><input type="range" id="${id}" min="0" max="100" value="${val}" style="--p:${val}%"><span class="v" id="${id}V">${val}%</span></div>`; }
function bindSlider(id, onSet) {
  const r = $('#' + id);
  if (!r) return;
  let t = 0;
  r.addEventListener('input', () => {
    r.style.setProperty('--p', r.value + '%'); $('#' + id + 'V').textContent = r.value + '%';
    const now = Date.now(); if (now - t > 60) { t = now; onSet(+r.value); }
  });
  r.addEventListener('change', () => onSet(+r.value));
}
function mediaCard() {
  const m = ST.media;
  if (!m) return '';
  const playing = m.status === 'Playing';
  return `<div class="media"><div class="art">${ic('music')}</div><div class="tx"><b>${esc(m.title)}</b><span>${esc(m.artist || (playing ? 'Playing' : 'Paused'))}</span></div>
    <div class="ctl"><button data-media="prev">${ic('prev')}</button><button class="pp" data-media="toggle">${ic(playing ? 'pause' : 'play')}</button><button data-media="next">${ic('next')}</button></div></div>`;
}
const links = (l) => `<div class="links">${l.map(([t, u]) => `<button class="link" data-open="${u}">${t} ›</button>`).join('')}</div>`;
const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };

// ------------------------------------------------------------------ panels
const R = {
  calendar() {
    const d = new Date();
    if (!calMonth) calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    return `<div class="big" id="clk"></div><div class="muted" style="margin-top:6px">${esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div>
      <div class="cal" id="cal"></div>
      ${ST.media ? `<div class="sec" id="med">${mediaCard()}</div>` : '<div id="med"></div>'}
      ${links([['Notifications', 'notifyPanel'], ['Date & time settings', 'ms-settings:dateandtime']])}`;
  },
  notify() {
    return `<div class="hd"><h3>Notifications</h3><span class="grow"></span><button class="btn sm" id="clr" hidden>Clear all</button></div>
      <div class="notes" id="notes"><div class="empty muted small">Loading…</div></div>
      ${links([['Notification settings', 'ms-settings:notifications']])}`;
  },
  network() {
    const n = (ST.stats && ST.stats.net) || {};
    return `<div class="hero"><div class="ico">${ic(!n.online ? 'wifiOff' : n.kind === 'wifi' ? 'wifi' : 'lan')}</div><div><b id="netName">${!n.online ? 'Offline' : n.kind === 'wifi' ? 'Wi-Fi' : 'Ethernet'}</b><span class="muted small" id="netSub">${n.online ? 'Checking…' : 'Not connected'}</span></div></div>
      <div class="sec"><div class="lbl">Your Wi-Fi networks</div><div class="rows" id="wifi"><div class="muted small">Loading…</div></div>
      <p class="muted small" style="margin:8px 2px 0">These are networks you've joined before. To join a new one, open Wi-Fi settings.</p></div>
      ${links([['Wi-Fi settings', 'ms-settings:network-wifi'], ['Network settings', 'ms-settings:network']])}`;
  },
  volume() {
    const v = ST.volume || { level: 0, muted: false };
    return `<div class="hd"><h3>Sound</h3></div>${slider('vol', ic(v.muted ? 'mute' : 'vol'), v.level, v.muted ? 'off' : '')}
      ${ST.media ? `<div class="sec" id="med">${mediaCard()}</div>` : '<div id="med"></div>'}
      ${links([['Sound settings', 'ms-settings:sound'], ['Volume mixer', 'ms-settings:apps-volume']])}`;
  },
  battery() {
    return `<div class="batbig"><div class="cell" id="bcell"><i></i></div><div><div class="big" id="bpct" style="font-size:30px"></div><div class="muted small" id="bsub"></div></div></div>
      <div class="sec" id="brightSec" hidden><div class="lbl">Brightness</div>${slider('bri', icx('sun'), 50)}</div>
      ${links([['Power & battery', 'ms-settings:powersleep']])}`;
  },
  quick() {
    const v = ST.volume || { level: 0, muted: false }, c = P.config;
    const tb = { show: 'Shown', autohide: 'Auto-hide', hidden: 'Hidden' }[c.taskbar] || 'Shown';
    return `<div id="briWrap" hidden>${slider('bri', icx('sun'), 50)}</div>${slider('vol', ic(v.muted ? 'mute' : 'vol'), v.level, v.muted ? 'off' : '')}
      <div class="tiles" style="margin-top:10px">
        <button class="tile ${P.live ? 'on' : ''}" data-q="live">${icx('play2')}<span>Live wallpaper<small>${P.live ? 'On' : 'Off'}</small></span></button>
        <button class="tile ${c.taskbar !== 'show' ? 'on' : ''}" data-q="taskbar">${icx('bar')}<span>Taskbar<small>${tb}</small></span></button>
        <button class="tile" data-q="pos">${ic('up')}<span>Bar position<small>${c.position === 'top' ? 'Top' : 'Bottom'}</small></span></button>
        <button class="tile" data-open="ms-screenclip:">${icx('shot')}<span>Screenshot<small>Snip</small></span></button>
        <button class="tile" data-open="taskmgr">${icx('task')}<span>Task Manager</span></button>
        <button class="tile" data-open="explorer">${icx('folder')}<span>Files</span></button>
      </div>
      ${ST.media ? `<div class="sec" id="med">${mediaCard()}</div>` : '<div id="med"></div>'}
      <div class="sec"><div class="lbl">Theme</div>${themeChips(true)}</div>
      ${links([['All settings', 'ms-settings:'], ['Bar settings', 'barSettings'], ['Windows quick settings', 'winQuick']])}`;
  },
  power() {
    const lk = !!P.lockOn;
    const b = (id, icon, label) => `<button data-pw="${id}" class="${armed === id ? 'arm' : ''}">${icon}<span>${armed === id ? 'Click again to ' + label.toLowerCase() : label}</span></button>`;
    return `<div class="pw">
      ${b('lock', icx('lock'), lk ? 'Lock (Haven)' : 'Lock')}
      ${lk ? b('winLock', icx('lock'), 'Windows lock') : ''}
      ${b('sleep', icx('moon'), 'Sleep')}
      ${b('signout', icx('out'), 'Sign out')}
      ${b('restart', icx('restart'), 'Restart')}
      ${b('shutdown', ic('power'), 'Shut down')}
    </div>
    <div class="sec pw-lk">
      <button class="pw-tog ${lk ? 'on' : ''}" data-locktog="1"><span>Custom lockscreen</span><i class="pill">${lk ? 'On' : 'Off'}</i></button>
    </div>
    ${links([['Lockscreen settings', 'lockSettings']])}`;
  },
  system() {
    return `<div class="hd"><h3>System</h3><span class="grow"></span><span class="muted small" id="up"></span></div><div id="meters"></div>
      <div class="sec"><div class="lbl">Using the most memory</div><div class="rows" id="procs"><div class="muted small">Loading…</div></div></div>
      ${links([['Task Manager', 'taskmgr']])}`;
  },
  themes() { return `<div class="hd"><h3>Theme</h3></div>${themeChips(false)}${links([['Manage themes', 'themesTab']])}`; },
  bgapps() {
    return `<div class="hd"><h3>Hidden icons</h3></div>
      <div class="trayg" id="tray"><div class="muted small">Looking…</div></div>
      <div class="sec"><div class="lbl">Also running in the background</div><div class="rows bg" id="bg"><div class="muted small">Looking…</div></div></div>
      ${links([['Windows hidden icons', 'winTray'], ['Task Manager', 'taskmgr']])}`;
  },
};
function themeChips(compact) {
  return `<div class="${compact ? 'swr' : 'tgrid'}">${(P.themes || []).map((t) => {
    const p = t.palette || {};
    return `<button class="th ${t.id === P.themeId ? 'on' : ''}" data-theme="${t.id}" title="${esc(t.name)}"><span class="dots">${[p.base, p.accent, p.accent2].map((c) => `<i style="background:${c || '#888'}"></i>`).join('')}</span>${compact ? '' : esc(t.name)}</button>`;
  }).join('')}</div>`;
}

// ------------------------------------------------------------------ live parts
function renderCal() {
  const box = $('#cal');
  if (!box) return;
  const now = new Date(), y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), prevDays = new Date(y, m, 0).getDate();
  let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w) => `<span class="wd">${w}</span>`).join('');
  for (let i = first - 1; i >= 0; i--) cells += `<span class="o">${prevDays - i}</span>`;
  for (let d = 1; d <= days; d++) cells += `<span class="d ${d === now.getDate() && m === now.getMonth() && y === now.getFullYear() ? 't' : ''}">${d}</span>`;
  const rest = (7 - ((first + days) % 7)) % 7;
  for (let d = 1; d <= rest; d++) cells += `<span class="o">${d}</span>`;
  box.innerHTML = `<div class="nav"><b>${calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button data-cal="-1">${icx('chevL')}</button><button data-cal="0" class="btn sm" style="width:auto;padding:0 8px">Today</button><button data-cal="1">${icx('chevR')}</button></div><div class="g">${cells}</div>`;
}
function renderClock() {
  const el = $('#clk');
  if (!el) return;
  const d = new Date();
  el.innerHTML = `${esc(fmt(d, (P.config.clock && P.config.clock.time) || 'h:mm'))}<small>${String(d.getSeconds()).padStart(2, '0')}</small>`;
}
// Notifications slide away one after another, then their space folds up.
function bye(notes) {
  return new Promise((done) => {
    if (!notes.length) return done();
    notes.forEach((n, i) => { n.style.animationDelay = Math.min(i, 12) * 35 + 'ms'; n.classList.add('bye'); });
    const last = notes[Math.min(notes.length - 1, 12)];
    let fin = false;
    const end = () => { if (!fin) { fin = true; done(); } };
    last.addEventListener('animationend', (e) => { if (e.animationName === 'fold') end(); });
    setTimeout(end, 900);
  });
}
function renderNotes(list, cleared) {
  const box = $('#notes');
  if (!box) return;
  list = (list || []).slice().sort((a, b) => b.time - a.time);
  $('#clr').hidden = !list.length;
  box.innerHTML = list.length ? list.map((n) => `<div class="note"><div class="meta"><b>${esc(n.app || 'App')}</b><span>${ago(n.time)}</span></div>${n.title ? `<div class="tt">${esc(n.title)}</div>` : ''}${n.body ? `<div class="bd">${esc(n.body)}</div>` : ''}<button class="x" data-nx="${n.id}" title="Dismiss">${icx('x')}</button></div>`).join('')
    : `<div class="empty ${cleared ? 'cleared' : ''}">${ic('bell')}<b>You're all caught up</b><div class="small">New notifications will show up here.</div></div>`;
}
let trayNames = new Set();
function renderTray(list) {
  const box = $('#tray');
  if (!box) return;
  list = (list || []).filter((t) => t.icon || t.tip);
  trayNames = new Set(list.map((t) => (t.name || '').toLowerCase()));
  box.innerHTML = list.length ? list.map((t) => `<button class="ti" data-tray="${esc(t.id)}" data-pid="${t.pid}" data-owner="${esc((t.name || '').toLowerCase())}" title="${esc(t.tip || t.name)}">${t.icon ? `<img src="data:image/png;base64,${t.icon}" alt="">` : `<span class="bgl">${esc((t.tip || t.name || '?').charAt(0))}</span>`}</button>`).join('')
    : '<div class="muted small">No tray icons yet. Apps add theirs as they start.</div>';
  // Apps already shown as tray icons don't need repeating in the list below.
  $$('#bg .bgr').forEach((r) => { const n = (r.dataset.exe || '').toLowerCase(); if (n && trayNames.has(n)) r.remove(); });
}
// Windows' own tray icons (sound, network, battery, Bluetooth) only respond inside Windows itself. Left-click
// opens the matching Haven panel; right-click shows the same menu the taskbar does. Returns true when handled.
function windowsIcon(el, right) {
  if (el.dataset.owner !== 'explorer') return false;
  const tip = el.title || '';
  const type = /speaker|headphone|volume|sound|audio|muted/i.test(tip) ? 'volume'
    : /battery|charging|remaining|plugged/i.test(tip) ? 'battery'
    : /internet|wi-?fi|network|ethernet|connected/i.test(tip) ? 'network'
    : /bluetooth/i.test(tip) ? 'bluetooth'
    : /safely remove|eject/i.test(tip) ? null : 'other';
  if (!type) return false; // its own menu works
  if (right || type === 'bluetooth') { api.flyoutDo('sysMenu', type); return true; } // Bluetooth's left-click is its menu too
  if (type === 'other') { api.flyoutDo('quick'); return true; }
  kind = type; render();
  if (type === 'battery') { renderBattery(); loadBright('#brightSec'); }
  if (type === 'network') open({ ...P, kind: 'network', state: ST });
  return true;
}
function renderBg(list) {
  const box = $('#bg');
  if (!box) return;
  list = list || [];
  box.innerHTML = list.length ? list.map((a) => `<div class="r bgr" data-bg="${a.pid}" title="${esc(a.path)}">${a.icon ? `<img src="${a.icon}" alt="">` : `<span class="bgl">${esc(a.name.charAt(0))}</span>`}<span class="nm">${esc(a.name)}</span><button class="x" data-bgq="${a.pid}" title="Quit">${icx('x')}</button></div>`).join('')
    : '<div class="empty small">Nothing else is running in the background.</div>';
  $$('#bg .bgr').forEach((r, i) => { const a = list[i]; if (a) r.dataset.exe = (a.path || '').split('\\').pop().replace(/\.exe$/i, ''); if (trayNames.has((r.dataset.exe || '').toLowerCase())) r.remove(); });
}
function renderMeters() {
  const box = $('#meters');
  if (!box) return;
  const s = ST.stats || {};
  const lv = (v) => (v >= 90 ? 'hot' : v >= 70 ? 'warm' : '');
  box.innerHTML = `<div class="meter ${lv(s.cpu)}"><div class="top"><span>Processor</span><b>${s.cpu ?? 0}%</b></div><div class="bar"><i style="width:${s.cpu ?? 0}%"></i></div></div>
    <div class="meter ${lv(s.mem)}"><div class="top"><span>Memory</span><b>${s.memUsed ?? '?'} / ${s.memTotal ?? '?'} GB</b></div><div class="bar"><i style="width:${s.mem ?? 0}%"></i></div></div>`;
}
let battery = null;
async function renderBattery() {
  if (!navigator.getBattery) return;
  const b = battery || (battery = await navigator.getBattery());
  const pct = Math.round(b.level * 100);
  const cell = $('#bcell');
  if (!cell) return;
  cell.classList.toggle('low', pct <= 15 && !b.charging);
  cell.firstChild.style.width = pct + '%';
  $('#bpct').textContent = pct + '%';
  const t = b.charging ? b.chargingTime : b.dischargingTime;
  const hm = isFinite(t) && t > 0 ? ` · ${Math.floor(t / 3600)}h ${Math.round((t % 3600) / 60)}m ${b.charging ? 'until full' : 'left'}` : '';
  $('#bsub').textContent = (b.charging ? 'Charging' : 'On battery') + hm;
}
async function loadBright(wrapSel) {
  const v = await api.flyoutAsk('bright');
  if (v === null || v < 0) return;
  const w = $(wrapSel);
  if (!w) return;
  w.hidden = false;
  const r = $('#bri');
  r.value = v; r.style.setProperty('--p', v + '%'); $('#briV').textContent = v + '%';
}

// ------------------------------------------------------------------ open / update
async function open(p) {
  P = p; ST = p.state || {}; kind = p.kind; armed = null; extra = {};
  if (kind !== 'calendar') calMonth = null;
  applyPalette();
  panel.classList.remove('in');
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('in')));
  clearInterval(tick);
  if (kind === 'calendar') tick = setInterval(renderClock, 1000);
  if (kind === 'system') tick = setInterval(async () => { const t = await api.flyoutAsk('uptime'); const el = $('#up'); if (el) el.textContent = 'Up ' + Math.floor(t / 86400) + 'd ' + Math.floor((t % 86400) / 3600) + 'h'; }, 5000);
  // Data that has to be fetched
  if (kind === 'notify') renderNotes(await api.flyoutAsk('notes'));
  if (kind === 'network') {
    const n = await api.flyoutAsk('net');
    if (n && kind === 'network') {
      const cur = n.current || [];
      const wifiNow = cur.find((c) => /wi-?fi|wlan|wireless/i.test(c.alias));
      if (cur.length) { $('#netName').textContent = wifiNow ? wifiNow.name : cur[0].name; $('#netSub').textContent = (cur.some((c) => c.internet) ? 'Connected to the internet' : 'No internet') + (n.ip && n.ip[0] ? ' · ' + n.ip[0].split(': ')[1] : ''); }
      const saved = n.saved || [];
      $('#wifi').innerHTML = saved.length ? saved.map((s) => { const on = wifiNow && wifiNow.name === s; return `<div class="r ${on ? 'on' : ''}">${ic('wifi')}<span class="nm">${esc(s)}</span>${on ? '<button class="btn sm" data-wdis>Disconnect</button>' : `<button class="btn sm" data-wcon="${esc(s)}">Connect</button>`}</div>`; }).join('') : '<div class="muted small">No saved Wi-Fi networks.</div>';
    }
  }
  if (kind === 'battery') { renderBattery(); loadBright('#brightSec'); }
  if (kind === 'bgapps') { if (P.config.trayIcons) api.flyoutAsk('tray').then(renderTray); else { const tb = $('#tray'); if (tb) tb.innerHTML = '<button class="btn" data-open="winTray">Open Windows hidden icons</button>'; } renderBg(await api.flyoutAsk('bgapps')); }
  if (kind === 'quick') loadBright('#briWrap');
  if (kind === 'system') {
    const t = await api.flyoutAsk('uptime'); const el = $('#up'); if (el) el.textContent = 'Up ' + Math.floor(t / 86400) + 'd ' + Math.floor((t % 86400) / 3600) + 'h';
    const pr = await api.flyoutAsk('procs');
    const box = $('#procs');
    if (box) box.innerHTML = (pr || []).map((x) => `<div class="r"><span class="nm">${esc(x.name)}</span><span class="muted">${x.mb >= 1024 ? (x.mb / 1024).toFixed(1) + ' GB' : x.mb + ' MB'}</span></div>`).join('') || '<div class="muted small">Unavailable</div>';
  }
}
function render() {
  panel.innerHTML = (R[kind] || (() => ''))();
  renderCal(); renderClock(); renderMeters();
  bindSlider('vol', (v) => api.barAction('vol', v));
  bindSlider('bri', (v) => api.flyoutDo('bright', v));
  fit();
}
function update(s) {
  ST = s;
  const med = $('#med');
  if (med) { const h = mediaCard(); med.className = h ? 'sec' : ''; if (med.dataset.h !== h) { med.dataset.h = h; med.innerHTML = h; } }
  renderMeters();
  const r = $('#vol');
  if (r && s.volume && document.activeElement !== r) {
    r.value = s.volume.level; r.style.setProperty('--p', s.volume.level + '%'); $('#volV').textContent = s.volume.level + '%';
    const b = $('[data-ib="vol"]'); b.classList.toggle('off', !!s.volume.muted); b.innerHTML = ic(s.volume.muted ? 'mute' : 'vol');
  }
}

panel.addEventListener('click', async (e) => {
  const t = (sel) => e.target.closest(sel);
  let el;
  if ((el = t('[data-cal]'))) { const v = +el.dataset.cal; const d = new Date(); calMonth = v === 0 ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(calMonth.getFullYear(), calMonth.getMonth() + v, 1); renderCal(); fit(); return; }
  if ((el = t('[data-media]'))) return api.barAction('media', el.dataset.media);
  if ((el = t('[data-ib="vol"]'))) return api.barAction('mute');
  if ((el = t('[data-nx]'))) {
    const note = el.closest('.note');
    const req = api.flyoutDo('noteRemove', el.dataset.nx);
    await bye([note]);
    note.remove();
    const left = await req;
    if (!(left || []).length) renderNotes([], true);
    return;
  }
  if ((el = t('#clr'))) {
    el.disabled = true;
    const req = api.flyoutDo('noteClear');
    await bye($$('.note'));
    renderNotes(await req, true);
    return;
  }
  if ((el = t('[data-wcon]'))) { el.textContent = 'Connecting…'; await api.flyoutDo('wifiConnect', el.dataset.wcon); setTimeout(() => open(P), 2500); return; }
  if ((el = t('[data-wdis]'))) { await api.flyoutDo('wifiDisconnect'); setTimeout(() => open(P), 1500); return; }
  if ((el = t('[data-tray]'))) { if (windowsIcon(el)) return; return api.flyoutDo('trayClick', { id: el.dataset.tray, button: 'left' }); }
  if ((el = t('[data-bgq]'))) {
    const row = el.closest('.bgr'), pid = el.dataset.bgq;
    if (el.dataset.force) { row.style.opacity = '.4'; await api.flyoutDo('bgForce', pid); row.classList.add('gone'); setTimeout(() => row.remove(), 260); return; }
    row.style.opacity = '.5';
    const r = await api.flyoutDo('bgQuit', pid);
    if (r === 'closed') { row.classList.add('gone'); setTimeout(() => row.remove(), 260); return; }
    // Some apps ignore a normal close request: offer to force it.
    row.style.opacity = '';
    el.outerHTML = `<button class="btn sm danger" data-bgq="${pid}" data-force="1">Force quit</button>`;
    return;
  }
  if ((el = t('[data-bg]'))) return api.flyoutDo('bgOpen', el.dataset.bg);
  if ((el = t('[data-theme]'))) { await api.barAction('theme', el.dataset.theme); return; }
  if ((el = t('[data-pw]'))) {
    const id = el.dataset.pw;
    if (id === 'lock' || id === 'winLock' || id === 'sleep' || armed === id) return api.flyoutDo('powerNow', id);
    armed = id; render(); return;
  }
  if ((el = t('[data-locktog]'))) {
    P.lockOn = await api.flyoutDo('lockToggle', !P.lockOn);
    render();
    return;
  }
  if ((el = t('[data-q]'))) {
    const q = el.dataset.q, c = P.config;
    if (q === 'live') { P.live = !P.live; await api.flyoutDo('live', P.live); }
    if (q === 'taskbar') { c.taskbar = { show: 'autohide', autohide: 'hidden', hidden: 'show' }[c.taskbar] || 'autohide'; await api.flyoutDo('bar', { taskbar: c.taskbar }); }
    if (q === 'pos') { api.flyoutDo('bar', { position: c.position === 'top' ? 'bottom' : 'top' }); return api.flyoutClose(); }
    render(); loadBright('#briWrap'); return;
  }
  if ((el = t('[data-open]'))) {
    const u = el.dataset.open;
    if (u === 'notifyPanel') { kind = 'notify'; render(); renderNotes(await api.flyoutAsk('notes')); return; }
    if (u === 'barSettings') return api.flyoutDo('settings');
    if (u === 'lockSettings') return api.flyoutDo('lockSettings');
    if (u === 'themesTab') return api.flyoutDo('themes');
    if (u === 'winQuick') return api.flyoutDo('quick');
    if (u === 'winTray') return api.flyoutDo('tray');
    return api.flyoutDo('open', u);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.flyoutClose(); });
// Right-click a tray icon: the app's own menu, just like on the taskbar.
panel.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-tray]');
  if (!el) return;
  e.preventDefault();
  if (windowsIcon(el, true)) return;
  api.flyoutDo('trayClick', { id: el.dataset.tray, button: 'right', pid: +el.dataset.pid });
});

api.on('flyout:open', open);
api.on('flyout:close', () => { clearInterval(tick); panel.classList.remove('in'); });
api.on('bar:state', (s) => { if (kind) update(s); });
api.on('bar:config', (p) => {
  if (!P) return;
  P = { ...P, ...p, kind, state: ST };
  applyPalette();
  if (kind === 'themes' || kind === 'quick') { render(); if (kind === 'quick') loadBright('#briWrap'); }
});
