// Haven Studio editor: design creative desktop widgets and pick a live wallpaper.
const api = window.haven;
const HS = window.HavenStudio;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const q = new URLSearchParams(location.search);

let ST = null;            // state from main
let tab = q.get('tab') || 'widgets';
let sel = q.get('id') || null; // selected desktop widget id
let cur = null;           // its design (normalized)
let selEl = null;         // selected element id
let history = [];
let systemFonts = [];
const loadedFonts = new Set();
const BUNDLED = ['Segoe UI Variable Display', 'Bebas Neue', 'Space Grotesk', 'Playfair Display', 'Orbitron', 'Righteous', 'Cinzel', 'JetBrains Mono', 'Caveat', 'Pacifico', 'Monoton', 'Major Mono Display', 'Press Start 2P'];
const TYPE_ICON = { time: '🕒', date: '📅', text: '🔤', countdown: '⏳', analog: '🕰️', flip: '🎴', word: '🔠' };

const ctx = () => ({ accent: ST && ST.wallpaper && ST.wallpaper.accent, accent2: ST && ST.wallpaper && (ST.wallpaper.accent2 || ST.wallpaper.accent) });
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}
async function loadFonts(list) {
  for (const f of list || []) {
    if (loadedFonts.has(f.family)) continue;
    loadedFonts.add(f.family);
    try { document.fonts.add(await new FontFace(f.family, `url("${f.url}")`).load()); } catch {}
  }
}

// ================================================================ boot
async function init() {
  ST = await api.studioState();
  applyAccent();
  await loadFonts(ST.customFonts);
  if (sel && !ST.widgets.some((w) => w.id === sel)) sel = null;
  if (!sel && ST.widgets.length) sel = ST.widgets[0].id;
  selectWidget(sel, true);
  setTab(tab);
  api.systemFonts().then((f) => { systemFonts = f || []; if (tab === 'widgets') renderInspector(); });
  $('#bMin').onclick = () => api.minimizeWindow();
  $('#bClose').onclick = () => api.closeWindow();
  $$('#tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $('#bNew').onclick = () => addWidget(HS.PRESETS[0].design);
  $('#bStart').onclick = () => addWidget(HS.PRESETS[0].design);
  $('#bImport').onclick = importDesign;
  window.addEventListener('resize', () => { fitStage(); });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu')) closeMenu(); });
}
function applyAccent() {
  const w = ST.wallpaper;
  if (w && w.accent) { document.documentElement.style.setProperty('--accent', w.accent); document.documentElement.style.setProperty('--accent-2', w.accent2 || w.accent); }
}
function setTab(t) {
  tab = t;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('#pWidgets').hidden = t !== 'widgets';
  $('#pLive').hidden = t !== 'live';
  $('#pBar').hidden = t !== 'bar';
  $('#pThemes').hidden = t !== 'themes';
  $('#pWm').hidden = t !== 'wm';
  $('#pLock').hidden = t !== 'lock';
  if (t === 'widgets') { renderLeft(); renderStage(); renderInspector(); } else stopStage();
  if (t === 'live') renderLive();
  if (t === 'bar' || t === 'themes' || t === 'wm' || t === 'lock') window.BarEditor && window.BarEditor.show(t);
  if (t !== 'live') stopLivePreviews();
}

api.on('studio:state', async (s) => {
  const prevWall = ST && ST.wallpaperURL;
  ST = s;
  applyAccent();
  await loadFonts(s.customFonts);
  if (sel && !s.widgets.some((w) => w.id === sel)) { sel = s.widgets[0] ? s.widgets[0].id : null; selectWidget(sel, true); return; }
  if (tab === 'widgets') {
    renderList(); renderSaved();
    if (prevWall !== s.wallpaperURL) { renderPresets(); renderStage(); }
    renderPlacement();
  } else if (tab === 'live') renderLiveStatus();
});
api.on('studio:select', ({ tab: t, id }) => { if (id) selectWidget(id); if (t) setTab(t); });

// ================================================================ widgets: data
const selected = () => (cur ? cur.elements.find((e) => e.id === selEl) : null);
const selRec = () => ST.widgets.find((w) => w.id === sel);
function selectWidget(id, quiet) {
  sel = id || null;
  const rec = selRec();
  cur = rec ? HS.normalize(rec.design) : null;
  selEl = cur && cur.elements[0] ? cur.elements[0].id : null;
  history = [];
  api.studioEditing(sel);
  if (!quiet || tab === 'widgets') { renderLeft(); renderStage(); renderInspector(); }
}
let pushTimer = null;
function commit(structural) {
  if (!cur || !sel) return;
  const rec = selRec();
  if (rec) rec.design = cur;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => api.studioUpdate(sel, { design: cur }), 40);
  updateStage();
  if (structural) { renderInspector(); renderList(); }
}
let lastSnap = 0;
function snapshot() {
  if (!cur) return;
  const now = Date.now();
  if (now - lastSnap < 600 && history.length) return; // one undo step per burst of edits
  lastSnap = now;
  history.push(JSON.stringify(cur));
  if (history.length > 80) history.shift();
}
function undo() {
  if (!history.length) return toast('Nothing to undo');
  cur = HS.normalize(JSON.parse(history.pop()));
  if (!cur.elements.some((e) => e.id === selEl)) selEl = cur.elements[0] && cur.elements[0].id;
  lastSnap = 0;
  commit(true);
}
async function addWidget(design) {
  const rec = await api.studioAdd({ design: HS.normalize(design) });
  ST = await api.studioState();
  selectWidget(rec.id);
  toast('Added to your desktop — drag it anywhere');
}
function applyDesign(design) {
  if (!sel) return addWidget(design);
  snapshot();
  const keepName = cur && cur.name && !HS.PRESETS.some((p) => p.name === cur.name) ? cur.name : null;
  cur = HS.normalize(design);
  if (keepName && !design.id) cur.name = keepName;
  selEl = cur.elements[0] && cur.elements[0].id;
  commit(true);
  renderStage();
  toast('Look applied — Ctrl+Z to undo');
}
async function importDesign() {
  const r = await api.studioImport();
  if (!r) return;
  if (r.error) return toast(r.error);
  const saved = await api.studioSaveDesign({ ...HS.normalize(r.design), id: undefined });
  ST.designs = [...(ST.designs || []), saved];
  renderSaved();
  toast(`Imported “${saved.name}” into Your designs`);
}

// ================================================================ widgets: left column
function renderLeft() { renderList(); renderPresets(); renderSaved(); }
function renderList() {
  const box = $('#wList');
  if (!ST.widgets.length) { box.innerHTML = '<div class="empty">Nothing yet — pick a look below to put it on your desktop.</div>'; return; }
  box.innerHTML = ST.widgets.map((w) => {
    const d = w.id === sel && cur ? cur : w.design;
    const first = (d.elements || [])[0];
    const where = w.layer === 'float' ? (w.clickThrough ? 'Above all apps · click-through' : 'Above all apps') : 'Desktop only';
    return `<div class="witem ${w.id === sel ? 'on' : ''}" data-w="${w.id}"><div class="ico">${first ? TYPE_ICON[first.type] || '✨' : '✨'}</div><div><b>${esc(d.name || 'Widget')}</b><span>${where}</span></div></div>`;
  }).join('');
  $$('.witem', box).forEach((el) => (el.onclick = () => selectWidget(el.dataset.w)));
}
function thumbCard(design, label, { del } = {}) {
  const card = document.createElement('div');
  card.className = 'pcard';
  if (ST.wallpaperURL) card.style.backgroundImage = `url("${ST.wallpaperURL}")`;
  card.innerHTML = `<div class="thumb"><div></div></div><div class="lbl">${esc(label)}</div>${del ? '<button class="del" title="Delete">✕</button>' : ''}`;
  const inner = card.querySelector('.thumb > div');
  const view = HS.mount(inner, design, ctx());
  const fit = () => {
    const tw = card.clientWidth - 10, th = card.clientHeight - 28;
    const w = view.root.offsetWidth, h = view.root.offsetHeight; // layout size, unaffected by transforms
    if (!w || !h) return;
    const s = Math.min(1, tw / w, th / h);
    inner.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  requestAnimationFrame(fit);
  document.fonts.ready.then(() => setTimeout(fit, 50));
  return card;
}
function renderPresets() {
  const box = $('#presets');
  box.innerHTML = '';
  for (const p of HS.PRESETS) {
    const c = thumbCard(p.design, p.name);
    c.title = p.desc;
    c.onclick = () => applyDesign(p.design);
    box.appendChild(c);
  }
}
function renderSaved() {
  const box = $('#saved');
  box.innerHTML = '';
  const list = ST.designs || [];
  $('#savedH').querySelector('h4').textContent = `Your designs${list.length ? ' · ' + list.length : ''}`;
  if (!list.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">Designs you save (or import) show up here.</div>'; return; }
  for (const d of list) {
    const c = thumbCard(d, d.name || 'Design', { del: true });
    c.onclick = (e) => { if (e.target.closest('.del')) return; applyDesign(d); };
    c.querySelector('.del').onclick = async (e) => { e.stopPropagation(); await api.studioDeleteDesign(d.id); ST.designs = ST.designs.filter((x) => x.id !== d.id); renderSaved(); };
    box.appendChild(c);
  }
}

// ================================================================ widgets: stage preview
let stageView = null;
function stopStage() { if (stageView) { stageView.destroy(); stageView = null; } }
function renderStage() {
  stopStage();
  $('#stageBg').style.backgroundImage = ST.wallpaperURL ? `url("${ST.wallpaperURL}")` : '';
  $('#stageEmpty').hidden = !!cur;
  $('#stageInner').innerHTML = '';
  if (!cur) return;
  stageView = HS.mount($('#stageInner'), cur, ctx());
  markSelected();
  fitStage();
  document.fonts.ready.then(fitStage);
  $('#stageInner').onclick = (e) => {
    const el = e.target.closest('.hs-el');
    if (el && el.dataset.id !== selEl) { selEl = el.dataset.id; markSelected(); renderInspector(); }
  };
}
function updateStage() {
  if (!stageView) return renderStage();
  stageView.update(cur, ctx());
  markSelected();
  fitStage();
}
function markSelected() { $$('#stageInner .hs-el').forEach((n) => n.classList.toggle('sel', n.dataset.id === selEl && cur.elements.length > 1)); }
function fitStage() {
  const inner = $('#stageInner'), st = $('#stage');
  if (!stageView) return;
  const w = stageView.root.offsetWidth, h = stageView.root.offsetHeight;
  if (!w || !h) return;
  const s = Math.min(1, (st.clientWidth - 60) / w, (st.clientHeight - 90) / h);
  inner.style.transform = `scale(${s})`;
}

// ================================================================ widgets: inspector
function getP(path) {
  const [root, ...ks] = path.split('.');
  let o = root === 'el' ? selected() : cur;
  for (const k of ks) o = o == null ? undefined : o[k];
  return o;
}
function setP(path, v) {
  const [root, ...ks] = path.split('.');
  let o = root === 'el' ? selected() : cur;
  for (const k of ks.slice(0, -1)) o = o[k] = o[k] || {};
  o[ks[ks.length - 1]] = v;
}
const F = (label, ctl, cls = '') => `<div class="f ${cls}"><label>${label}</label><div class="row">${ctl}</div></div>`;
const range = (path, min, max, step = 1, unit = '') => {
  const v = getP(path) ?? min;
  return `<input type="range" data-k="${path}" data-kind="num" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${v}" style="--p:${((v - min) / (max - min)) * 100}%"><span class="val">${v}${unit}</span>`;
};
const sw = (path, struct) => `<button class="switch ${getP(path) ? 'on' : ''}" data-k="${path}" data-kind="bool" ${struct ? 'data-struct' : ''}></button>`;
const seg = (path, opts) => `<div class="seg" data-k="${path}">${opts.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(getP(path)) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const text = (path, ph = '') => `<input type="text" data-k="${path}" data-kind="str" value="${esc(getP(path) ?? '')}" placeholder="${esc(ph)}" spellcheck="false">`;
function splitColor(c) {
  let h = String(c || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return { rgb: '#' + h.slice(0, 6), a: h.length >= 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100) : 100 };
}
const color = (path, alpha = true) => {
  const { rgb, a } = splitColor(getP(path));
  return `<span class="colorpair"><input type="color" data-k="${path}" data-kind="rgb" value="${rgb}">${alpha ? `<input type="range" data-k="${path}" data-kind="alpha" min="0" max="100" value="${a}" style="--p:${a}%" title="Opacity"><span class="val">${a}%</span>` : ''}</span>`;
};
function fontSelect(path) {
  const v = getP(path);
  const custom = (ST.customFonts || []).map((f) => f.family);
  const all = new Set([...BUNDLED, ...custom, ...systemFonts]);
  const opt = (f) => `<option value="${esc(f)}" ${f === v ? 'selected' : ''} style="font-family:'${esc(f)}'">${esc(f)}</option>`;
  return `<select data-k="${path}" data-kind="str" data-struct style="font-family:'${esc(v)}'">`
    + (all.has(v) ? '' : opt(v))
    + `<optgroup label="Haven fonts">${BUNDLED.map(opt).join('')}</optgroup>`
    + (custom.length ? `<optgroup label="Your fonts">${custom.map(opt).join('')}</optgroup>` : '')
    + (systemFonts.length ? `<optgroup label="Installed on this PC">${systemFonts.filter((f) => !BUNDLED.includes(f)).map(opt).join('')}</optgroup>` : '')
    + '</select><button class="btn sm" id="addFont" title="Use a .ttf / .otf font file">+</button>';
}

function renderInspector() {
  const box = $('#inspector');
  if (!cur) { box.innerHTML = '<div class="group"><p class="muted">Add a widget to start customizing it.</p></div>'; return; }
  const el = selected();
  const rec = selRec() || {};
  let h = '';
  // ---- elements
  h += `<div class="group"><h5>Layers<span class="grow"></span><button class="btn sm" id="addEl">+ Add</button></h5><div class="els">${cur.elements.map((e, i) => {
    const sub = e.type === 'text' ? e.text : e.type === 'date' ? e.format : e.type === 'countdown' ? e.format : '';
    return `<div class="elrow ${e.id === selEl ? 'on' : ''}" data-el="${e.id}"><span>${TYPE_ICON[e.type]}</span><span class="t">${HS.TYPE_NAMES[e.type]}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`
      + `<button class="mini" data-mv="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="mini" data-mv="1" title="Move down" ${i === cur.elements.length - 1 ? 'disabled' : ''}>↓</button><button class="mini" data-del title="Remove">✕</button></div>`;
  }).join('') || '<div class="empty">No layers — add one.</div>'}</div></div>`;

  if (el) {
    // ---- content
    let c = '';
    if (el.type === 'time' || el.type === 'flip') {
      c += F('24-hour', sw('el.h24', true)) + F('Seconds', sw('el.seconds')) + (el.h24 ? '' : F('AM / PM', sw('el.ampm')));
      if (el.type === 'time') c += F('Blink colon', sw('el.blink')) + (el.h24 ? '' : F('Leading zero', sw('el.lead0')));
      else c += F('Card color', color('el.card')) + F('Card corners', range('el.cardRadius', 0, 40));
    } else if (el.type === 'date') {
      c += F('Format', text('el.format', 'dddd, MMMM d'))
        + `<div class="chips" style="margin:2px 0 4px 100px">${['dddd, MMMM d', 'ddd d MMM', 'MMMM Do', 'dddd', 'MM/dd/yyyy', 'dd.MM.yyyy', 'yyyy-MM-dd', 'MMM yyyy'].map((f) => `<button class="chip" data-fmt="${esc(f)}">${esc(HS.formatDate(new Date(), f))}</button>`).join('')}</div>`
        + '<p class="hint" style="margin-left:100px">dddd = Saturday · ddd = Sat · MMMM = November · MMM = Nov · d / dd = day · Do = 22nd · yyyy = year · [text] stays as typed</p>';
    } else if (el.type === 'text') {
      c += `<div class="f full"><textarea data-k="el.text" data-kind="str" spellcheck="false">${esc(el.text)}</textarea></div>`;
    } else if (el.type === 'countdown') {
      c += F('Count to', `<input type="datetime-local" data-k="el.target" data-kind="str" value="${esc(el.target)}">`)
        + `<p class="hint" style="margin-left:100px">Leave empty to count down to the weekend.</p>`
        + F('Shows', text('el.format', '{d} days to go'))
        + '<p class="hint" style="margin-left:100px">{d} days · {h} hours · {m} minutes · {s} seconds · {hh}:{mm}:{ss} total</p>';
    } else if (el.type === 'analog') {
      c += F('Face', seg('el.face', [['none', 'Hands only'], ['ring', 'Ring'], ['dots', 'Dots'], ['full', 'Filled']])) + F('Size', range('el.size', 60, 700, 2, 'px'))
        + F('Seconds hand', sw('el.seconds', true)) + F('Numbers', sw('el.numbers', true)) + F('Hand weight', range('el.thick', 2, 14, 0.5))
        + F('Face color', color('el.faceColor')) + F('Ticks', color('el.tickColor')) + (el.fill.mode === 'solid' ? F('Hour hand', color('el.hourColor')) + F('Minute hand', color('el.minColor')) : '')
        + (el.seconds ? F('Second hand', color('el.secColor')) : '');
    } else if (el.type === 'word') {
      c += F('Unlit letters', color('el.dim')) + F('Letter gap', range('el.spacing', 0, 80));
    }
    if (c) h += `<div class="group"><h5>${HS.TYPE_NAMES[el.type]}</h5>${c}</div>`;

    // ---- font
    if (el.type !== 'analog' || el.numbers) {
      h += `<div class="group"><h5>Font</h5>${F('Family', fontSelect('el.font'))}${F('Weight', range('el.weight', 100, 900, 100))}`
        + (el.type === 'analog' ? '' : F('Size', range('el.size', 8, 400, 1, 'px')))
        + (el.type === 'word' ? '' : F('Spacing', range('el.spacing', -10, 80, 1)))
        + F('Italic', sw('el.italic')) + (el.type === 'flip' || el.type === 'word' ? '' : F('ALL CAPS', sw('el.upper'))) + '</div>';
    }
    // ---- color
    const fm = el.fill.mode;
    h += `<div class="group"><h5>Color</h5>${F('Fill', seg('el.fill.mode', [['solid', 'Solid'], ['gradient', 'Gradient'], ['wallpaper', 'Wallpaper']]))}`
      + (fm === 'wallpaper' ? `<p class="hint" style="margin-left:100px">Uses your wallpaper's colors and changes when it does.</p>` : '')
      + (fm !== 'wallpaper' ? F(fm === 'gradient' ? 'From' : 'Color', color('el.fill.c1')) : '')
      + (fm === 'gradient' ? F('To', color('el.fill.c2')) : '')
      + (fm !== 'solid' ? F('Angle', range('el.fill.angle', 0, 360, 5, '°')) : '')
      + F('Opacity', range('el.opacity', 5, 100, 1, '%')) + '</div>';
    // ---- effects
    h += `<div class="group"><h5>Effects</h5>`
      + F('Glow', sw('el.glow.on', true)) + (el.glow.on ? F('Glow color', color('el.glow.color')) + F('Glow size', range('el.glow.blur', 2, 80)) : '')
      + F('Shadow', sw('el.shadow.on', true)) + (el.shadow.on ? F('Shadow color', color('el.shadow.color')) + F('Softness', range('el.shadow.blur', 0, 60)) + F('Offset X', range('el.shadow.x', -30, 30)) + F('Offset Y', range('el.shadow.y', -30, 30)) : '')
      + (el.type === 'analog' ? '' : F('Outline', sw('el.outline.on', true)) + (el.outline.on ? F('Outline color', color('el.outline.color')) + F('Thickness', range('el.outline.width', 0.5, 8, 0.5, 'px')) : ''))
      + '</div>';
  }
  // ---- widget
  const bg = cur.bg.kind;
  h += `<div class="group"><h5>Whole widget</h5>${F('Name', text('d.name', 'My widget'))}${F('Size', range('d.scale', 20, 400, 5, '%'))}`
    + F('Arrange', seg('d.layout', [['stack', 'Stacked'], ['row', 'Side by side']])) + F('Align', seg('d.align', [['start', 'Left'], ['center', 'Center'], ['end', 'Right']]))
    + F('Gap', range('d.gap', 0, 80)) + F('Background', seg('d.bg.kind', [['none', 'None'], ['card', 'Card'], ['glass', 'Frosted']]))
    + (bg !== 'none' ? F('Card color', color('d.bg.color', false)) + F('Card opacity', range('d.bg.opacity', 0, 100, 1, '%')) + F('Corners', range('d.bg.radius', 0, 80)) + F('Padding', range('d.padding', 0, 80)) + F('Border', range('d.bg.border', 0, 6, 0.5, 'px')) + (cur.bg.border ? F('Border color', color('d.bg.borderColor')) : '') : '')
    + '</div>';
  // ---- placement
  h += `<div class="group" id="placeGroup"></div>`;
  // ---- actions
  h += `<div class="group"><h5>Share & save</h5><div class="chips" style="gap:6px">
      <button class="btn sm" id="saveDesign">Save design</button><button class="btn sm" id="exportDesign">Export file…</button>
      <button class="btn sm" id="dupWidget">Duplicate</button><button class="btn sm danger" id="removeWidget">Remove from desktop</button></div>
      <p class="hint">Exported .havenwidget files can be imported by anyone with Haven.</p></div>`;
  box.innerHTML = h;
  renderPlacement();
  bindInspector(box, rec);
}

function renderPlacement() {
  const g = $('#placeGroup');
  if (!g || !cur) return;
  const rec = selRec() || {};
  const an = rec.anchor || {};
  const spots = [['left', 'top'], ['center', 'top'], ['right', 'top'], ['left', 'middle'], ['center', 'middle'], ['right', 'middle'], ['left', 'bottom'], ['center', 'bottom'], ['right', 'bottom']];
  const names = { 'center:top': 'Top middle', 'center:middle': 'Center', 'center:bottom': 'Bottom middle', 'left:top': 'Top left', 'right:top': 'Top right', 'left:bottom': 'Bottom left', 'right:bottom': 'Bottom right', 'left:middle': 'Left middle', 'right:middle': 'Right middle' };
  const float = rec.layer === 'float';
  g.innerHTML = `<h5>Placement</h5>
    <div class="f"><label>Snap to</label><div class="row" style="align-items:flex-start;gap:12px"><div class="anchors">${spots.map(([h, v]) => `<button data-h="${h}" data-v="${v}" title="${names[h + ':' + v]}" class="${an.h === h && an.v === v && (h === 'center' ? !an.dx : true) && (v === 'middle' ? !an.dy : true) ? 'on' : ''}"></button>`).join('')}</div>
    <span class="hint" style="margin:0">Stays pinned to that spot (or the nearest edge after you drag it), even when the time gets wider or your resolution changes.</span></div></div>
    ${F('Show it', `<div class="seg" id="layerSeg"><button data-v="desktop" class="${!float ? 'on' : ''}">Desktop only</button><button data-v="float" class="${float ? 'on' : ''}">Above all apps</button></div>`)}
    <p class="hint" style="margin-left:100px">${float ? 'Stays on top of every window, even full apps. Switch to Desktop only to keep it behind them.' : 'Lives on the desktop behind your apps, like the other widgets (shows when you minimize or press Win+D).'}</p>
    ${float ? F('Click-through', `<button class="switch ${rec.clickThrough ? 'on' : ''}" id="ctSw"></button>`) + `<p class="hint" style="margin-left:100px">The mouse passes straight through it. Turn it off here or from the tray icon.</p>` : ''}`;
  $$('.anchors button', g).forEach((b) => (b.onclick = async () => { await api.studioPlace(sel, b.dataset.h, b.dataset.v); }));
  $$('#layerSeg button', g).forEach((b) => (b.onclick = () => api.studioUpdate(sel, { layer: b.dataset.v })));
  const ct = $('#ctSw', g);
  if (ct) ct.onclick = () => api.studioUpdate(sel, { clickThrough: !rec.clickThrough });
}

function bindInspector(box) {
  // layers
  $$('.elrow', box).forEach((row) => {
    row.onclick = (e) => {
      const id = row.dataset.el, i = cur.elements.findIndex((x) => x.id === id);
      if (e.target.closest('[data-mv]')) {
        const d = +e.target.closest('[data-mv]').dataset.mv, j = i + d;
        if (j < 0 || j >= cur.elements.length) return;
        snapshot();
        [cur.elements[i], cur.elements[j]] = [cur.elements[j], cur.elements[i]];
        return commit(true);
      }
      if (e.target.closest('[data-del]')) {
        snapshot();
        cur.elements.splice(i, 1);
        if (selEl === id) selEl = cur.elements[Math.max(0, i - 1)] && cur.elements[Math.max(0, i - 1)].id;
        return commit(true);
      }
      selEl = id; markSelected(); renderInspector();
    };
  });
  $('#addEl', box).onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(Object.entries(HS.TYPE_NAMES).map(([t, n]) => ({ label: `${TYPE_ICON[t]}  ${n}`, action: () => {
      snapshot();
      const base = selected();
      const over = base && !['analog', 'word', 'flip'].includes(t) && !['analog', 'word', 'flip'].includes(base.type) ? { font: base.font, fill: base.fill } : {};
      const el = HS.makeElement(t, over);
      cur.elements.push(el); selEl = el.id; commit(true);
    } })), r.right - 190, r.bottom + 4);
  };
  // generic controls
  $$('[data-k]', box).forEach((ctl) => {
    const path = ctl.dataset.k, kind = ctl.dataset.kind;
    if (ctl.classList.contains('seg')) {
      $$('button', ctl).forEach((b) => (b.onclick = () => {
        snapshot();
        let v = b.dataset.v;
        if (path === 'el.fill.mode' && v === 'gradient') { const f = selected().fill; if (f.c1 === f.c2 || !f.c2) f.c2 = '#a78bfa'; }
        setP(path, v);
        commit(true);
      }));
      return;
    }
    if (kind === 'bool') { ctl.onclick = () => { snapshot(); setP(path, !getP(path)); ctl.classList.toggle('on', !!getP(path)); commit(ctl.hasAttribute('data-struct')); }; return; }
    const ev = ctl.tagName === 'SELECT' ? 'change' : 'input';
    ctl.addEventListener(ev, () => {
      snapshot();
      if (kind === 'num') {
        const v = parseFloat(ctl.value);
        setP(path, v);
        ctl.style.setProperty('--p', ((v - ctl.min) / (ctl.max - ctl.min)) * 100 + '%');
        const lab = ctl.nextElementSibling; if (lab && lab.classList.contains('val')) lab.textContent = v + (ctl.dataset.unit || '');
      } else if (kind === 'rgb' || kind === 'alpha') {
        const now = splitColor(getP(path));
        const rgb = kind === 'rgb' ? ctl.value : now.rgb, a = kind === 'alpha' ? +ctl.value : now.a;
        setP(path, rgb + (a >= 100 ? '' : Math.round((a / 100) * 255).toString(16).padStart(2, '0')));
        if (kind === 'alpha') { ctl.style.setProperty('--p', a + '%'); ctl.nextElementSibling.textContent = a + '%'; }
      } else {
        setP(path, ctl.value);
        if (ctl.tagName === 'SELECT') ctl.style.fontFamily = `'${ctl.value}'`;
      }
      commit(ctl.hasAttribute('data-struct'));
      if (path === 'd.name' || path === 'el.text' || path === 'el.format') renderList();
    });
  });
  $$('[data-fmt]', box).forEach((b) => (b.onclick = () => { snapshot(); setP('el.format', b.dataset.fmt); commit(true); }));
  const af = $('#addFont', box);
  if (af) af.onclick = async () => {
    const r = await api.addFont();
    if (!r || !r.added.length) return;
    await loadFonts(r.customFonts);
    ST.customFonts = r.customFonts;
    snapshot();
    setP('el.font', r.added[0]);
    commit(true);
    toast(`Added ${r.added.join(', ')}`);
  };
  $('#saveDesign', box).onclick = async () => {
    const list = ST.designs || [];
    const same = list.find((d) => d.name === cur.name);
    const saved = await api.studioSaveDesign({ ...cur, id: same ? same.id : undefined });
    ST.designs = same ? list.map((d) => (d.id === saved.id ? saved : d)) : [...list, saved];
    renderSaved();
    toast(same ? `Updated “${saved.name}”` : `Saved “${saved.name}” to Your designs`);
  };
  $('#exportDesign', box).onclick = async () => { if (await api.studioExport(cur)) toast('Exported'); };
  $('#dupWidget', box).onclick = async () => { const rec = await api.studioAdd({ design: cur, layer: (selRec() || {}).layer }); ST = await api.studioState(); selectWidget(rec.id); toast('Duplicated'); };
  $('#removeWidget', box).onclick = async () => { await api.studioRemove(sel); ST = await api.studioState(); selectWidget(ST.widgets[0] && ST.widgets[0].id); };
}

// ================================================================ menu
function openMenu(items, x, y) {
  const m = $('#menu');
  m.innerHTML = items.map((it, i) => `<button data-i="${i}">${esc(it.label)}</button>`).join('');
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  $$('button', m).forEach((b) => (b.onclick = () => { closeMenu(); items[+b.dataset.i].action(); }));
}
function closeMenu() { $('#menu').hidden = true; }

// ================================================================ live wallpaper
let livePrev = null;
const cardEngines = [];
function liveColors(L) {
  const w = ST.wallpaper || {};
  return L.colors === 'wallpaper' && w.accent ? [w.accent, w.accent2 || w.accent] : [L.c1, L.c2];
}
function stopLivePreviews() {
  for (const e of cardEngines) e.destroy();
  cardEngines.length = 0;
  if (livePrev) { livePrev.destroy(); livePrev = null; }
  const v = $('#livePrevVid'); v.pause();
}
async function setLive(patch, rerender = true) {
  const r = await api.liveSet(patch);
  ST.live = r.live;
  ST.liveStatus = r.status;
  if (rerender) renderLive(); else { renderLiveStatus(); updateLivePreview(); }
}
function renderLiveStatus() {
  const L = ST.live, s = ST.liveStatus || {};
  $('#liveOn').classList.toggle('on', !!L.enabled);
  const el = $('#liveStatus');
  el.textContent = !L.enabled ? 'Off — your normal wallpaper is showing.'
    : s.error ? `Couldn't attach to the desktop (${s.error}).`
      : s.paused ? 'Paused while a game or fullscreen app is in front.'
        : s.running ? 'Running behind your desktop icons.' : 'Starting…';
}
function renderLive() {
  stopLivePreviews();
  const L = ST.live;
  renderLiveStatus();
  $('#liveOn').onclick = () => setLive({ enabled: !L.enabled }, false);
  $$('#liveSource button').forEach((b) => { b.classList.toggle('on', b.dataset.v === L.source); b.onclick = () => setLive({ source: b.dataset.v }); });
  // scenes
  const box = $('#liveScenes');
  box.hidden = L.source !== 'scene';
  box.innerHTML = '';
  if (L.source === 'scene') {
    const [c1, c2] = liveColors(L);
    for (const s of HavenScenes.LIST) {
      const card = document.createElement('div');
      card.className = 'scard' + (L.scene === s.id ? ' on' : '');
      card.innerHTML = `<div class="cv"><canvas></canvas>${s.wall ? '<span class="tag">Uses your wallpaper</span>' : ''}</div><div class="t"><b>${esc(s.name)}</b><span>${esc(s.desc)}</span></div>`;
      box.appendChild(card);
      const eng = HavenScenes.create(card.querySelector('canvas'), { scene: s.id, c1, c2, speed: L.speed, intensity: L.intensity, fps: 30, wallpaperURL: ST.wallpaperURL });
      eng.pause(true);
      cardEngines.push(eng);
      card.onmouseenter = () => eng.pause(false);
      card.onmouseleave = () => eng.pause(true);
      card.onclick = () => setLive({ scene: s.id, source: 'scene' });
    }
  }
  // files
  const fp = $('#liveFile');
  fp.hidden = L.source === 'scene';
  if (L.source !== 'scene') {
    const p = L.source === 'video' ? L.video : L.image;
    fp.innerHTML = `<div style="font-size:26px">${L.source === 'video' ? '🎬' : '🖼️'}</div><div class="nm">${p ? esc(p) : L.source === 'video' ? 'Pick an .mp4 or .webm video. It loops silently behind your icons.' : 'Pick a picture or an animated GIF.'}</div><button class="btn primary" id="pickFile">${p ? 'Change…' : 'Choose…'}</button>`;
    $('#pickFile').onclick = async () => { const f = await api.livePick(L.source); if (f) setLive({ [L.source]: f }); };
  }
  renderLiveOpts();
  updateLivePreview();
}
function updateLivePreview() {
  const L = ST.live;
  const cv = $('#livePrev') || (livePrev && livePrev.canvas), vid = $('#livePrevVid'), img = $('#livePrevImg');
  const [c1, c2] = liveColors(L);
  const file = L.source === 'video' ? L.video : L.source === 'image' ? L.image : null;
  vid.hidden = !(L.source === 'video' && file);
  img.hidden = !(L.source === 'image' && file);
  if (L.source === 'scene' || !file) {
    const opts = { scene: L.scene, c1, c2, speed: L.speed, intensity: L.intensity, fps: L.fps, wallpaperURL: ST.wallpaperURL };
    if (!livePrev) livePrev = HavenScenes.create(cv, opts); else livePrev.set(opts);
    livePrev.canvas.id = 'livePrev';
    livePrev.canvas.hidden = false;
    vid.pause();
    return;
  }
  if (livePrev) { livePrev.destroy(); livePrev.canvas.hidden = true; livePrev = null; }
  const url = 'file:///' + file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
  if (L.source === 'video') { if (vid.dataset.u !== url) { vid.src = url; vid.dataset.u = url; } vid.playbackRate = Math.max(0.25, L.speed / 100); vid.play().catch(() => {}); }
  else img.src = url;
}
function renderLiveOpts() {
  const L = ST.live;
  const box = $('#liveOpts');
  const segL = (k, opts) => `<div class="seg" data-lk="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(L[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const swL = (k) => `<button class="switch ${L[k] ? 'on' : ''}" data-lsw="${k}"></button>`;
  const rangeL = (k, min, max, step, unit) => `<input type="range" data-lr="${k}" min="${min}" max="${max}" step="${step}" value="${L[k]}" style="--p:${((L[k] - min) / (max - min)) * 100}%"><span class="val">${L[k]}${unit}</span>`;
  const isScene = L.source === 'scene';
  box.innerHTML = `
    ${isScene ? `<div class="group"><h5>Colors</h5>${F('Palette', segL('colors', [['wallpaper', 'From wallpaper'], ['custom', 'Custom']]))}
      ${L.colors === 'custom' ? F('Main', `<input type="color" data-lc="c1" value="${L.c1}">`) + F('Second', `<input type="color" data-lc="c2" value="${L.c2}">`) : '<p class="hint" style="margin-left:100px">Matches your wallpaper and changes with it.</p>'}</div>` : ''}
    <div class="group"><h5>Motion</h5>${F('Speed', rangeL('speed', 10, 300, 5, '%'))}${isScene ? F('Amount', rangeL('intensity', 20, 200, 5, '%')) : ''}
      ${isScene ? F('Frame rate', segL('fps', [[24, '24'], [30, '30'], [60, '60']])) : ''}
      ${!isScene ? F('Fit', segL('fit', [['cover', 'Fill screen'], ['contain', 'Whole picture']])) : ''}</div>
    <div class="group"><h5>Screens</h5>${F('Show on', segL('displays', [['all', 'All screens'], ['primary', 'Main screen']]))}</div>
    <div class="group"><h5>Save power</h5>
      ${F('Pause for fullscreen', swL('pauseFullscreen'))}<p class="hint" style="margin-left:100px">Games, videos and presentations get the whole GPU.</p>
      ${F('Pause for maximized', swL('pauseMaximized'))}<p class="hint" style="margin-left:100px">When a maximized window covers the desktop anyway.</p>
      ${F('Pause on battery', swL('pauseOnBattery'))}</div>
    <div class="group"><p class="hint">The live wallpaper sits behind your desktop icons, and your Haven widgets stay on top of it. Turning it off brings your normal wallpaper straight back.</p></div>`;
  $$('[data-lk]', box).forEach((s) => $$('button', s).forEach((b) => (b.onclick = () => { const v = b.dataset.v; setLive({ [s.dataset.lk]: isNaN(+v) ? v : +v }); })));
  $$('[data-lsw]', box).forEach((b) => (b.onclick = () => setLive({ [b.dataset.lsw]: !L[b.dataset.lsw] })));
  $$('[data-lc]', box).forEach((c) => c.addEventListener('change', () => setLive({ [c.dataset.lc]: c.value })));
  $$('[data-lr]', box).forEach((r) => {
    r.addEventListener('input', () => { r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'); r.nextElementSibling.textContent = r.value + '%'; });
    r.addEventListener('change', () => setLive({ [r.dataset.lr]: +r.value }));
  });
}

init();
