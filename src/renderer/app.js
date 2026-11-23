/* Haven — renderer */
'use strict';

const api = window.haven || createMockApi();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (id, cls = '') => `<svg class="ico ${cls}"><use href="#i-${id}"/></svg>`;

// A window opened with ?widget=<id> is a split-off desktop widget showing a single tab.
const QS = new URLSearchParams(location.search);
// ?panel=<kind> is a dialog window opened from a widget (so dialogs aren't clipped by the widget's edges).
const PANEL = QS.get('panel');
const IS_PANEL = !!PANEL;
const WID = QS.get('widget') || '';
const IS_WIDGET = !!WID && !IS_PANEL;
// Inside a widget, dialogs open in the panel window instead. Returns true when it handed off.
const toPanel = (kind, arg) => { if (!IS_WIDGET || !window.haven) return false; api.openPanel(kind, arg == null ? '' : String(arg)); return true; };

const S = {
  items: [], byId: new Map(), favorites: [], groups: [], settings: {}, notes: '',
  view: 'home', query: '', sel: 0, results: [], iconVer: 1, scanning: false, onboarded: true,
  widgets: [], wrec: null, filter: '',
};

const VIEWS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'apps', label: 'Apps', icon: 'apps', type: 'app' },
  { id: 'games', label: 'Games', icon: 'game', type: 'game' },
  { id: 'files', label: 'Files', icon: 'file', type: 'file' },
  { id: 'folders', label: 'Folders', icon: 'folder', type: 'folder' },
  { id: 'links', label: 'Links', icon: 'link', type: 'link' },
  { id: 'notes', label: 'Notes', icon: 'note' },
];
const TYPE_LABEL = { app: 'App', game: 'Game', file: 'File', folder: 'Folder', link: 'Link' };
const SOURCE_LABEL = { steam: 'Steam', epic: 'Epic', store: 'Store', startmenu: 'Start', desktop: 'Desktop', recent: 'Recent', user: 'Added', system: 'System' };
const GROUP_COLORS = ['#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#a3e635'];
const EMOJIS = ['📁', '⭐', '🎮', '💼', '🎨', '🎵', '🎬', '📚', '🛠️', '💻', '🌐', '📷', '✍️', '🧪', '💬', '🏠', '🔥', '🚀', '🧠', '💰', '📝', '🎯', '🕹️', '☕'];
const ACCENTS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#ec4899', '#94a3b8'];

// ================================================================ data
function ingest(snap) {
  if (!snap) return;
  S.items = snap.items;
  S.byId = new Map(snap.items.map((i) => [i.id, i]));
  S.favorites = snap.favorites.filter((id) => S.byId.has(id));
  S.groups = snap.groups;
  S.settings = snap.settings;
  if (snap.notes !== undefined && document.activeElement?.id !== 'notesArea') S.notes = snap.notes;
  S.scanning = !!snap.scanning;
  if (snap.wallpaper !== undefined) S.wall = snap.wallpaper;
  if (snap.pinAvailable !== undefined) S.pinAvailable = snap.pinAvailable;
  if (snap.version) { S.version = snap.version; S.packaged = snap.packaged; }
  S.widgets = snap.widgets || [];
  if (WID) {
    S.wrec = S.widgets.find((w) => w.id === WID) || S.wrec;
    if (S.wrec && IS_WIDGET) S.view = S.wrec.view;
  }
  S.onboarded = snap.onboarded !== false;
  applyTheme();
}
const visible = (it) => it && (!it.hidden || S.settings.showHidden) && (!S.filter || !!fuzzy(S.filter.toLowerCase(), it.name));
const isFav = (id) => S.favorites.includes(id);
const listOf = (type) => S.items.filter((i) => i.type === type && !i.transient && visible(i));

function frecency(it) {
  if (!it.launches) return 0;
  const days = (Date.now() - (it.lastLaunched || 0)) / 864e5;
  return it.launches * (1 / (1 + days / 5)) + (days < 1 ? 3 : 0);
}
function sorted(list, mode = S.settings.sort) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const l = [...list];
  if (mode === 'name') return l.sort(byName);
  if (mode === 'recent') return l.sort((a, b) => (b.lastLaunched || 0) - (a.lastLaunched || 0) || byName(a, b));
  if (mode === 'most') return l.sort((a, b) => (b.launches || 0) - (a.launches || 0) || byName(a, b));
  if (mode === 'added') return l.sort((a, b) => (b.added || 0) - (a.added || 0) || byName(a, b));
  return l.sort((a, b) => frecency(b) - frecency(a) || byName(a, b));
}

// ================================================================ icons
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function initials(name) {
  const w = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}
function avatarHTML(it) {
  const h = hue(it.name);
  const bg = `linear-gradient(135deg, hsl(${h} 70% 58%), hsl(${(h + 40) % 360} 75% 45%))`;
  const inner = it.type === 'folder' ? svg('folder') : it.type === 'link' ? svg('link') : esc(initials(it.name));
  return `<div class="avatar" style="background:${bg}">${inner}</div>`;
}
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
function iconSrc(it) {
  if (it.type === 'link' && it.url && /^https?:/i.test(it.url)) {
    try { return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(it.url).hostname)}&sz=128`; } catch {}
  }
  if (it.type === 'file' && it.path && IMG_RE.test(it.path)) return `haven://thumb/?p=${encodeURIComponent(it.path)}`;
  return `haven://icon/${it.id}?v=${it.hasIcon ? 'hd' : S.iconVer}`;
}
function iconHTML(it, { cover = false } = {}) {
  if (cover && it.cover) return `<img class="cover" src="${coverSrc(it.cover)}" data-fb="${it.id}" draggable="false" loading="lazy">`;
  const thumb = it.type === 'file' && IMG_RE.test(it.path || '');
  return `<img ${thumb ? 'class="thumb"' : ''} src="${esc(iconSrc(it))}" data-fb="${it.id}" draggable="false" loading="lazy">`;
}
const coverSrc = (c) => (/^https?:/i.test(c) ? c : `haven://file/?p=${encodeURIComponent(c)}`);
// Any broken image falls back to a generated avatar.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fb) return;
  const it = S.byId.get(img.dataset.fb);
  if (img.dataset.alt) { img.removeAttribute('data-fb'); img.src = img.dataset.alt; img.removeAttribute('data-alt'); return; }
  if (!it) return;
  const card = img.closest('.cover-card');
  const small = `<div style="width:56px;height:56px;--tile:110px">${avatarHTML(it)}</div>`;
  if (card && !img.closest('.fallback')) img.outerHTML = `<div class="fallback">${small}<span>${esc(it.name)}</span></div>`;
  else if (card) img.outerHTML = small;
  else img.outerHTML = avatarHTML(it);
}, true);

// ================================================================ rendering
// quiet = data changed in the background (launch counts, icons, other widgets): redraw without animations.
function render(quiet = false) {
  if (IS_WIDGET) renderWidgetHeader(); else renderSidebar();
  renderContent(quiet);
  if (!IS_WIDGET) renderStatus();
}

function navCount(v) {
  if (!v.type) return '';
  const n = v.type === 'file' ? S.items.filter((i) => i.type === 'file' && visible(i) && !i.transient).length : listOf(v.type).length;
  return n ? n : '';
}

function renderSidebar() {
  const sb = $('#sidebar');
  const nav = VIEWS.map((v, i) => `
    <button class="nav ${S.view === v.id && !S.query ? 'active' : ''}" data-view="${v.id}" title="${v.label} (Ctrl+${i + 1})" ${v.id === 'home' ? 'data-drop="fav"' : ''}>
      ${svg(v.icon)}<span class="label">${v.label}</span><span class="count">${navCount(v)}</span>
    </button>`).join('');
  const groups = S.groups.map((g) => `
    <button class="nav ${S.view === 'group:' + g.id && !S.query ? 'active' : ''}" data-view="group:${g.id}" data-drop="group:${g.id}" data-group="${g.id}" title="${esc(g.name)}">
      <span class="emoji">${esc(g.emoji || '📁')}</span><span class="label">${esc(g.name)}</span>
      <span class="dot" style="background:${g.color}"></span>
    </button>`).join('');
  const fav = S.favorites.length;
  sb.innerHTML = `
    ${nav}
    <div class="side-h"><span>Groups</span><button id="addGroup" title="New group">${svg('plus')}</button></div>
    ${groups || `<button class="nav" id="addGroup2">${svg('plus')}<span class="label">New group</span></button>`}
    <div class="side-spacer"></div>
    <div class="side-card"><b>${fav ? `${fav} favorite${fav > 1 ? 's' : ''}` : 'Tip'}</b>${fav ? 'Drag tiles onto Home or a group to organize them.' : 'Right-click anything and choose <i>Add to Favorites</i>.'}</div>`;
}

function renderStatus() {
  const c = (t) => listOf(t).length;
  const hk = S.settings.hotkey ? `<b>${esc(S.settings.hotkey)}</b> to summon` : '';
  $('#statusbar').innerHTML = `
    <span>${S.scanning ? '<i class="spin"></i>Scanning your PC…' : `${c('app')} apps · ${c('game')} games · ${c('folder')} folders · ${c('link')} links`}</span>
    <span class="grow"></span>
    <span>Drop files anywhere to add</span>${hk ? `<span>${hk}</span>` : ''}`;
  $('#hotkeyHint').textContent = S.settings.hotkey || '';
  $('#btnPin').classList.toggle('on', !!S.settings.alwaysOnTop);
}

function tileHTML(it, i = 0, opts = {}) {
  const fav = isFav(it.id);
  const badge = it.type === 'game' && it.source && SOURCE_LABEL[it.source] && ['steam', 'epic', 'store'].includes(it.source) ? `<span class="badge">${SOURCE_LABEL[it.source]}</span>` : '';
  return `<button class="tile" data-id="${it.id}" draggable="true" style="animation-delay:${Math.min(i, 30) * 12}ms" title="${esc(it.name)}${it.hidden ? ' (hidden)' : ''}">
    ${opts.badges ? badge : ''}${fav && !opts.noStar ? svg('star', 'fill star') : ''}
    <div class="ic">${iconHTML(it, { cover: it.type === 'game' })}</div>
    <div class="name">${esc(it.name)}</div>
  </button>`;
}
function gridHTML(list, reorder = '') {
  return `<div class="grid" ${reorder ? `data-reorder="${reorder}"` : ''}>${list.map((it, i) => tileHTML(it, i, { badges: true })).join('')}</div>`;
}
function coverHTML(it, i = 0) {
  const hasArt = !!it.cover;
  const sub = it.lastLaunched ? 'Played ' + ago(it.lastLaunched) : SOURCE_LABEL[it.source] || '';
  const h = hue(it.name);
  return `<button class="cover-card" data-id="${it.id}" draggable="true" style="animation-delay:${Math.min(i, 30) * 15}ms;${hasArt ? '' : `background:linear-gradient(160deg,hsl(${h} 45% 30%),hsl(${(h + 50) % 360} 50% 16%))`}" title="${esc(it.name)}">
    ${hasArt ? `<img src="${esc(coverSrc(it.cover))}" data-fb="${it.id}" ${it.appid ? `data-alt="https://cdn.cloudflare.steamstatic.com/steam/apps/${it.appid}/header.jpg"` : ''} draggable="false" loading="lazy">`
      : `<div class="fallback"><img src="${esc(iconSrc(it))}" data-fb="${it.id}" draggable="false"><span>${esc(it.name)}</span></div>`}
    ${['steam', 'epic', 'store'].includes(it.source) ? `<span class="src">${SOURCE_LABEL[it.source]}</span>` : ''}
    ${isFav(it.id) ? svg('star', 'fill star') : ''}
    <div class="shade"><b>${esc(it.name)}</b><span>${esc(sub)}</span></div>
  </button>`;
}
function rowHTML(it, opts = {}) {
  const sub = opts.sub ?? (it.path || it.url || (it.aumid ? 'Microsoft Store app' : ''));
  return `<button class="row ${opts.sel ? 'sel' : ''}" data-id="${it.id}" draggable="true" title="${esc(it.path || it.url || it.name)}">
    <div class="ic">${iconHTML(it)}</div>
    <div class="meta"><b>${opts.mark ? opts.mark : esc(it.name)}</b>${sub ? `<span>&lrm;${esc(sub)}&lrm;</span>` : ''}</div>
    ${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ''}
    ${opts.kind !== false ? `<span class="kind">${TYPE_LABEL[it.type] || ''}</span>` : ''}
  </button>`;
}
function sectionHTML(title, icon, body, extra = '') {
  return `<section class="section"><div class="section-h"><h2>${icon ? svg(icon) : ''}${title}</h2>${extra}</div>${body}</section>`;
}
function sortSelect() {
  const o = [['smart', 'Smart'], ['name', 'A–Z'], ['recent', 'Recently used'], ['most', 'Most used'], ['added', 'Recently added']];
  return `<select class="pill" id="sortSel" title="Sort">${o.map(([v, l]) => `<option value="${v}" ${S.settings.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
function emptyHTML(icon, title, text, actions = '') {
  return `<div class="empty">${svg(icon)}<b>${title}</b>${text}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function renderContent(quiet = false) {
  const c = $('#content');
  const key = S.query ? 'search' : S.view;
  const same = c.dataset.current === key;
  const keepScroll = same ? c.scrollTop : 0;
  const focusedId = document.activeElement?.closest?.('#content [data-id]')?.dataset.id;
  c.classList.toggle('quiet', quiet && same);
  let html = '';
  if (S.query) html = viewSearch();
  else if (S.view.startsWith('group:')) html = viewGroup(S.view.slice(6));
  else html = ({ home: viewHome, apps: viewApps, games: viewGames, files: viewFiles, folders: viewFolders, links: viewLinks, notes: viewNotes }[S.view] || viewHome)();
  c.innerHTML = `<div class="view">${html}</div>`;
  c.dataset.current = key;
  c.scrollTop = keepScroll;
  if (focusedId) $(`#content [data-id="${focusedId}"]`)?.focus({ preventScroll: true });
  if (S.view === 'notes' && !S.query) bindNotes();
}

function viewHome() {
  const name = S.settings.displayName ? `, <span class="grad">${esc(S.settings.displayName)}</span>` : '';
  const apps = listOf('app').length, games = listOf('game').length;
  const favs = S.favorites.map((id) => S.byId.get(id)).filter(visible);
  const showRecent = S.settings.showRecent !== false;
  const used = showRecent ? S.items.filter((i) => i.lastLaunched && visible(i) && i.type !== 'game').sort((a, b) => b.lastLaunched - a.lastLaunched).slice(0, 12) : [];
  const played = showRecent ? S.items.filter((i) => i.type === 'game' && i.lastLaunched && visible(i)).sort((a, b) => b.lastLaunched - a.lastLaunched).slice(0, 10) : [];
  const recent = S.items.filter((i) => i.source === 'recent' && i.type === 'file').sort((a, b) => (b.recentAt || 0) - (a.recentAt || 0)).slice(0, 6);
  if (IS_WIDGET) {
    // Compact Favorites widget: pinned items first, then whatever you used recently.
    return sectionHTML('Favorites', 'star', favs.length ? gridHTML(favs, 'favorites')
      : emptyHTML('star', 'No favorites yet', 'Right-click anything → <i>Add to Favorites</i>, or drop files here.'))
      + (used.length ? sectionHTML('Jump back in', 'clock', gridHTML(used.slice(0, 8))) : '');
  }
  let h = `<div class="hello"><h1>${greeting()}${name}</h1><p>${S.scanning && !apps ? 'Finding everything on your PC…' : `${apps} apps and ${games} games, all in one place.`}</p></div>`;
  h += sectionHTML('Favorites', 'star', favs.length ? gridHTML(favs, 'favorites')
    : emptyHTML('star', 'Pin what you use most', 'Right-click any app, game, file or folder and choose <b style="display:inline">Add to Favorites</b> — or drag it onto <i>Home</i> in the sidebar.',
      `<button class="pill primary" data-go="apps">${svg('apps')}Browse apps</button><button class="pill" data-go="games">${svg('game')}Browse games</button>`),
    favs.length ? `<span class="sub">Drag to reorder</span>` : '');
  if (played.length) h += sectionHTML('Continue playing', 'game', `<div class="strip">${played.map(coverHTML).join('')}</div>`);
  if (used.length) h += sectionHTML('Jump back in', 'clock', gridHTML(used));
  if (recent.length) h += sectionHTML('Recent files', 'file', `<div class="rows split">${recent.map((it) => rowHTML(it, { hint: ago(it.recentAt), kind: false })).join('')}</div>`, `<span class="grow"></span><button class="pill" data-go="files">See all</button>`);
  return h;
}

function viewApps() {
  const list = sorted(listOf('app'));
  const extra = `<span class="sub">${list.length}</span><span class="grow"></span>${sortSelect()}<button class="pill" data-act="addFiles">${svg('plus')}Add app</button>`;
  return sectionHTML('Apps', 'apps', list.length ? gridHTML(list) : emptyHTML('apps', 'No apps yet', S.scanning ? 'Scanning your Start menu…' : 'Add apps with the button above, or drop shortcuts here.'), extra);
}

function viewGames() {
  const list = sorted(listOf('game'));
  if (!list.length) {
    return sectionHTML('Games', 'game', emptyHTML('game', 'No games found', 'Haven reads your Steam, Epic and Xbox libraries automatically. You can also drop any game shortcut or .exe here.',
      `<button class="pill primary" data-act="addFiles">${svg('plus')}Add a game</button><button class="pill" data-act="rescan">${svg('refresh')}Rescan</button>`));
  }
  const last = [...list].sort((a, b) => (b.lastLaunched || 0) - (a.lastLaunched || 0))[0];
  const heroGame = last.lastLaunched ? last : (list.find((g) => g.hero) || last);
  const heroBg = heroGame.hero || heroGame.cover;
  const total = list.reduce((n, g) => n + (g.launches || 0), 0);
  const hero = `<div class="hero" data-id="${heroGame.id}">
    ${heroBg ? `<div class="bg" style="background-image:url('${esc(coverSrc(heroBg))}')"></div>` : `<div class="bg" style="background:linear-gradient(120deg,var(--accent),var(--accent-2))"></div>`}
    <div class="info"><div class="eyebrow">${heroGame.lastLaunched ? 'Last played · ' + ago(heroGame.lastLaunched) : 'Ready to play'}</div>
    <h2>${esc(heroGame.name)}</h2>
    <div class="stats"><span>${list.length} games in your library</span>${total ? `<span>${total} launches from Haven</span>` : ''}</div>
    <button class="play" data-launch="${heroGame.id}">${svg('play', 'fill')}Play</button></div></div>`;
  const extra = `<span class="sub">${list.length}</span><span class="grow"></span>${sortSelect()}<button class="pill" data-act="addFiles">${svg('plus')}Add game</button>`;
  return (IS_WIDGET ? '' : hero) + sectionHTML('Library', 'game', `<div class="covers">${list.map(coverHTML).join('')}</div>`, extra);
}

function viewFiles() {
  const pinned = sorted(S.items.filter((i) => i.type === 'file' && !i.transient && visible(i)), 'name');
  const recent = S.items.filter((i) => i.source === 'recent' && i.transient).sort((a, b) => (b.recentAt || 0) - (a.recentAt || 0));
  const desk = S.items.filter((i) => i.source === 'desktop' && i.transient && visible(i));
  let h = sectionHTML('Pinned files', 'star', pinned.length ? `<div class="rows split">${pinned.map((it) => rowHTML(it, { kind: false })).join('')}</div>`
    : emptyHTML('file', 'Keep important files one click away', 'Drop files here, or pin something from your recent files below.'),
    `<span class="grow"></span><button class="pill" data-act="addFiles">${svg('plus')}Add files</button>`);
  if (recent.length) h += sectionHTML('Recent on this PC', 'clock', `<div class="rows split">${recent.map((it) => rowHTML(it, { hint: ago(it.recentAt) })).join('')}</div>`, `<span class="sub">From Windows' recent items</span>`);
  if (desk.length) h += sectionHTML('On your Desktop', 'home', `<div class="rows split">${desk.map((it) => rowHTML(it)).join('')}</div>`);
  return h;
}

function viewFolders() {
  const list = sorted(listOf('folder'), S.settings.sort === 'smart' ? 'smart' : S.settings.sort);
  const recent = S.items.filter((i) => i.type === 'folder' && i.transient && i.source === 'recent').slice(0, 12);
  let h = sectionHTML('Folders', 'folder', gridHTML(list), `<span class="sub">${list.length}</span><span class="grow"></span><button class="pill" data-act="addFolders">${svg('plus')}Add folder</button>`);
  if (recent.length) h += sectionHTML('Recently opened folders', 'clock', `<div class="rows split">${recent.map((it) => rowHTML(it, { kind: false, hint: ago(it.recentAt) })).join('')}</div>`);
  return h;
}

function viewLinks() {
  const list = sorted(listOf('link'));
  return sectionHTML('Links', 'link', list.length ? gridHTML(list)
    : emptyHTML('link', 'Your corner of the web', 'Save sites you visit all the time — mail, docs, dashboards, streams.', `<button class="pill primary" data-act="addLink">${svg('plus')}Add a link</button>`),
    `<span class="sub">${list.length || ''}</span><span class="grow"></span><button class="pill" data-act="addLink">${svg('plus')}Add link</button>`);
}

function viewNotes() {
  return `<div class="section-h" style="margin-top:20px"><h2>${svg('note')}Notes</h2><span class="sub">A scratchpad that's always here</span></div>
    <div class="notes"><textarea id="notesArea" placeholder="Jot down anything — todo lists, game codes, ideas…" spellcheck="true">${esc(S.notes)}</textarea>
    <div class="foot"><span id="notesState">Saved automatically</span><span id="notesCount"></span></div></div>`;
}
function bindNotes() {
  const ta = $('#notesArea');
  const count = () => { $('#notesCount').textContent = `${ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0} words`; };
  count();
  let t;
  ta.addEventListener('input', () => {
    S.notes = ta.value; count();
    $('#notesState').textContent = 'Saving…';
    clearTimeout(t);
    t = setTimeout(async () => { await api.setNotes(ta.value); $('#notesState').textContent = 'Saved automatically'; }, 400);
  });
}

function viewGroup(gid) {
  const g = S.groups.find((x) => x.id === gid);
  if (!g) { S.view = 'home'; return viewHome(); }
  const list = g.items.map((id) => S.byId.get(id)).filter(visible);
  const extra = `<span class="sub">${list.length} item${list.length === 1 ? '' : 's'}</span><span class="grow"></span>
    <button class="pill" data-act="addToGroup">${svg('plus')}Add files</button><button class="pill" data-act="editGroup" data-gid="${g.id}">${svg('dots')}Edit</button>`;
  return (IS_WIDGET ? '' : `<div class="hello"><h1><span style="margin-right:10px">${esc(g.emoji || '📁')}</span>${esc(g.name)}</h1></div>`) +
    sectionHTML('', '', list.length ? gridHTML(list, 'group:' + g.id)
      : emptyHTML('folder', 'This group is empty', 'Drag tiles onto this group in the sidebar, drop files here, or right-click anything → <i>Add to group</i>.'), extra);
}

// ================================================================ search
function fuzzy(q, s) {
  s = s.toLowerCase();
  if (!q) return null;
  if (s === q) return { score: 1000, idx: [0, q.length] };
  if (s.startsWith(q)) return { score: 900 - s.length, idx: [0, q.length] };
  const words = s.split(/[\s\-_.:]+/);
  const inits = words.map((w) => w[0] || '').join('');
  const wi = words.findIndex((w) => w.startsWith(q));
  if (wi >= 0) { const at = s.indexOf(words[wi]); return { score: 800 - wi * 10 - s.length, idx: [at, at + q.length] }; }
  if (q.length >= 2 && inits.startsWith(q)) return { score: 750 - s.length, idx: null };
  const at = s.indexOf(q);
  if (at >= 0) return { score: 600 - at - s.length, idx: [at, at + q.length] };
  let j = 0, gaps = 0, last = -1;
  for (let i = 0; i < s.length && j < q.length; i++) if (s[i] === q[j]) { if (last >= 0) gaps += i - last - 1; last = i; j++; }
  if (j === q.length && gaps < 12) return { score: 300 - gaps * 10 - s.length, idx: null };
  return null;
}
function highlight(name, idx) {
  if (!idx) return esc(name);
  return esc(name.slice(0, idx[0])) + '<mark>' + esc(name.slice(idx[0], idx[1])) + '</mark>' + esc(name.slice(idx[1]));
}
function calc(expr) {
  // Tiny safe arithmetic parser: + - * / % ^ ( ) and decimals.
  const t = expr.replace(/\s+/g, '').replace(/x/gi, '*').replace(/,/g, '');
  if (!/^[\d.+\-*/%^()]+$/.test(t) || !/[+\-*/%^]/.test(t.replace(/^-/, ''))) return null;
  let i = 0;
  const peek = () => t[i];
  const num = () => { const m = t.slice(i).match(/^\d*\.?\d+/); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const atom = () => { if (peek() === '(') { i++; const v = add(); if (t[i++] !== ')') throw 0; return v; } if (peek() === '-') { i++; return -atom(); } return num(); };
  const pow = () => { let v = atom(); if (peek() === '^') { i++; v = Math.pow(v, pow()); } return v; };
  const mul = () => { let v = pow(); while ('*/%'.includes(peek()) && peek()) { const o = t[i++]; const r = pow(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; };
  const add = () => { let v = mul(); while ('+-'.includes(peek()) && peek()) { const o = t[i++]; const r = mul(); v = o === '+' ? v + r : v - r; } return v; };
  try { const v = add(); if (i !== t.length || !isFinite(v)) return null; return +v.toPrecision(12); } catch { return null; }
}
const WEB = [
  ['g ', 'Google', 'https://www.google.com/search?q='],
  ['yt ', 'YouTube', 'https://www.youtube.com/results?search_query='],
  ['w ', 'Wikipedia', 'https://en.wikipedia.org/w/index.php?search='],
  ['r ', 'Reddit', 'https://www.reddit.com/search/?q='],
  ['gh ', 'GitHub', 'https://github.com/search?q='],
];
function searchResults() {
  const raw = S.query.trim();
  const q = raw.toLowerCase();
  const out = [];
  const expr = raw.replace(/^=/, '');
  const value = calc(expr);
  if (value !== null) out.push({ kind: 'calc', value, expr });
  const web = WEB.find(([p]) => q.startsWith(p));
  if (web) {
    const term = raw.slice(web[0].length).trim();
    if (term) out.push({ kind: 'web', label: `Search ${web[1]} for “${term}”`, url: web[2] + encodeURIComponent(term) });
  }
  if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(raw) && !raw.includes(' ')) {
    out.push({ kind: 'web', label: `Open ${raw}`, url: /^https?:/i.test(raw) ? raw : 'https://' + raw });
  }
  if (!web && q) {
    const scored = [];
    for (const it of S.items) {
      if (!visible(it)) continue;
      const m = fuzzy(q, it.name) || (it.originalName !== it.name && fuzzy(q, it.originalName));
      if (!m) continue;
      const boost = Math.min(frecency(it) * 8, 120) + (isFav(it.id) ? 60 : 0) - (it.transient ? 40 : 0);
      scored.push({ kind: 'item', it, idx: m.idx, score: m.score + boost });
    }
    scored.sort((a, b) => b.score - a.score);
    out.push(...scored.slice(0, 60));
  }
  if (q && !web && value === null) out.push({ kind: 'web', label: `Search the web for “${raw}”`, url: WEB[0][2] + encodeURIComponent(raw) });
  return out;
}
function viewSearch() {
  S.results = searchResults();
  if (S.sel >= S.results.length) S.sel = Math.max(0, S.results.length - 1);
  const items = S.results.filter((r) => r.kind === 'item');
  let html = `<div class="section-h" style="margin-top:18px"><h2>${svg('search')}Results</h2><span class="sub">${items.length} match${items.length === 1 ? '' : 'es'} · ↑↓ to move · Enter to open · Shift+Enter admin · Ctrl+Enter show in folder</span></div><div class="rows" id="results">`;
  S.results.forEach((r, i) => {
    const sel = i === S.sel;
    if (r.kind === 'calc') {
      html += `<div class="calc ${sel ? 'sel' : ''}" data-ri="${i}">${svg('calc', 'big')}<div><b>${r.value.toLocaleString(undefined, { maximumFractionDigits: 10 })}</b><br><span>${esc(r.expr)} · Enter to copy</span></div></div>`;
    } else if (r.kind === 'web') {
      html += `<button class="row ${sel ? 'sel' : ''}" data-ri="${i}"><div class="ic">${svg('link')}</div><div class="meta"><b>${esc(r.label)}</b><span>${esc(r.url)}</span></div><span class="kind">Web</span></button>`;
    } else {
      const it = r.it;
      const sub = it.type === 'game' && SOURCE_LABEL[it.source] ? `${SOURCE_LABEL[it.source]} game` : it.path || it.url || (it.aumid ? 'Microsoft Store app' : '');
      html += rowHTML(it, { sel, mark: highlight(it.name, r.idx), sub, hint: isFav(it.id) ? '★' : '' }).replace('class="row', `data-ri="${i}" class="row`);
    }
  });
  html += '</div>';
  if (!S.results.length) html += emptyHTML('search', 'Nothing matches', 'Try fewer letters — Haven matches initials too, like “vsc” for Visual Studio Code.');
  return html;
}
function moveSel(d) {
  if (!S.results.length) return;
  S.sel = (S.sel + d + S.results.length) % S.results.length;
  $$('#results [data-ri]').forEach((el) => el.classList.toggle('sel', +el.dataset.ri === S.sel));
  $(`#results [data-ri="${S.sel}"]`)?.scrollIntoView({ block: 'nearest' });
}
async function activateResult(r, e = {}) {
  if (!r) return;
  if (r.kind === 'calc') { navigator.clipboard.writeText(String(r.value)); toast(`Copied ${r.value}`); return; }
  if (r.kind === 'web') { api.openUrl(r.url); clearSearch(); return; }
  if (e.ctrlKey) { reveal(r.it.id); return; }
  await launch(r.it.id, { admin: !!e.shiftKey });
  clearSearch();
}
function clearSearch() { S.query = ''; S.sel = 0; $('#search').value = ''; render(); }

// ================================================================ actions
async function launch(id, opts = {}) {
  const it = S.byId.get(id);
  if (!it) return;
  const tag = it.type === 'game' ? 'Starting' : it.type === 'folder' ? 'Opening' : 'Launching';
  toast(`${tag} ${it.name}${opts.admin ? ' as admin' : ''}…`, { icon: it });
  const r = await api.launch(id, opts);
  if (!r.ok) toast(r.error || 'Could not open that', { err: true });
}
async function reveal(id) { if (!(await api.reveal(id))) toast('No file location for this item', { err: true }); }
async function toggleFav(id) {
  const favs = isFav(id) ? S.favorites.filter((x) => x !== id) : [...S.favorites, id];
  const it = S.byId.get(id);
  if (it && it.transient && !isFav(id)) await api.setMeta(id, { pinned: true });
  ingest(await api.setFavorites(favs));
  render();
  toast(isFav(id) ? `Added ${it?.name} to Favorites` : `Removed from Favorites`);
}
async function saveGroups(groups) { ingest(await api.setGroups(groups)); render(); }
async function toggleInGroup(id, gid, force) {
  const groups = structuredClone(S.groups);
  const g = groups.find((x) => x.id === gid);
  if (!g) return;
  const has = g.items.includes(id);
  if (force === true && has) return toast(`Already in ${g.name}`);
  if (has) g.items = g.items.filter((x) => x !== id); else g.items.push(id);
  const it = S.byId.get(id);
  if (it && it.transient && !has) await api.setMeta(id, { pinned: true });
  await saveGroups(groups);
  toast(has ? `Removed from ${g.name}` : `Added to ${g.emoji || ''} ${g.name}`);
}
async function setMeta(id, patch) { ingest(await api.setMeta(id, patch)); render(); }
async function removeItem(id) {
  const it = S.byId.get(id);
  ingest(await api.remove(id));
  render();
  toast(it?.source === 'user' ? `Removed ${it.name}` : `Hid ${it?.name} — unhide it in Settings › Library`, {
    action: it?.source !== 'user' ? { label: 'Undo', fn: () => setMeta(id, { hidden: null }) } : null,
  });
}
async function addPaths(paths, extra = {}) {
  if (!paths.length) return;
  const opts = { ...extra };
  if (S.view.startsWith('group:') && !opts.groupId) opts.groupId = S.view.slice(6);
  if (S.view === 'home' && !opts.groupId) opts.favorite = true;
  if (S.view === 'games') opts.type = 'game';
  const before = S.items.length;
  ingest(await api.addPaths(paths, opts));
  render();
  toast(`Added ${paths.length} item${paths.length > 1 ? 's' : ''}${opts.groupId ? ' to group' : opts.favorite ? ' to Favorites' : ''}`);
  return S.items.length - before;
}

// ================================================================ context menu
// Native Windows menu (used in widgets so menus can extend past the widget's edges).
function nativeMenu(entries) {
  const acts = new Map();
  let n = 0;
  const conv = (list) => list.filter((e) => e).map((e) => {
    if (e === '-') return { sep: true };
    if (e.header) return { header: e.header };
    const id = 'm' + n++;
    if (!e.sub) acts.set(id, e.action);
    return { id, label: e.label, checked: e.icon === '✓', sub: e.sub ? conv(e.sub) : undefined };
  });
  api.popupMenu(conv(entries)).then((id) => { const fn = acts.get(id); if (fn) fn(); });
  return null;
}
function openMenu(entries, x, y, parent) {
  if (!parent && IS_WIDGET && window.haven && api.popupMenu) return nativeMenu(entries);
  const m = parent ? document.createElement('div') : $('#menu');
  if (parent) { m.className = 'menu sub'; parent.appendChild(m); }
  m.hidden = false;
  m.innerHTML = '';
  entries.forEach((e) => {
    if (!e) return;
    if (e === '-') { m.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); return; }
    if (e.header) { m.insertAdjacentHTML('beforeend', `<div class="mh">${esc(e.header)}</div>`); return; }
    const b = document.createElement('button');
    b.className = 'mi' + (e.danger ? ' danger' : '');
    b.innerHTML = `${e.icon ? (e.icon.length <= 3 ? `<span style="width:15px;text-align:center">${e.icon}</span>` : svg(e.icon)) : '<span style="width:15px"></span>'}<span>${esc(e.label)}</span>${e.k ? `<span class="k">${esc(e.k)}</span>` : ''}${e.sub ? '<span class="k">›</span>' : ''}`;
    if (e.sub) {
      b.addEventListener('mouseenter', () => {
        $$('.menu .sub', m).forEach((s) => s.remove());
        $$('.mi.open', m).forEach((s) => s.classList.remove('open'));
        b.classList.add('open');
        const sm = openMenu(e.sub, 0, 0, b);
        const r = sm.getBoundingClientRect();
        if (r.right > innerWidth - 8) { sm.style.left = 'auto'; sm.style.right = '100%'; }
        if (r.bottom > innerHeight - 8) sm.style.top = `${innerHeight - 8 - r.bottom - 6}px`;
      });
    } else {
      b.addEventListener('mouseenter', () => { if (!parent) { $$('.menu .sub', m).forEach((s) => s.remove()); $$('.mi.open', m).forEach((s) => s.classList.remove('open')); } });
      b.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); e.action && e.action(); });
    }
    m.appendChild(b);
  });
  if (!parent) {
    m.style.left = '0px'; m.style.top = '0px';
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  }
  return m;
}
function closeMenu() { $('#menu').hidden = true; }

function itemMenu(id, x, y) {
  const it = S.byId.get(id);
  if (!it) return;
  const fav = isFav(id);
  const hasPath = !!it.path;
  const canAdmin = it.type === 'app' && hasPath;
  const groupsSub = [
    ...S.groups.map((g) => ({ label: g.name, icon: g.items.includes(id) ? '✓' : g.emoji || '📁', action: () => toggleInGroup(id, g.id) })),
    S.groups.length ? '-' : null,
    { label: 'New group…', icon: 'plus', action: () => editGroup(null, id) },
  ];
  const typeSub = ['app', 'game', 'file', 'folder', 'link'].map((t) => ({ label: TYPE_LABEL[t] + 's', icon: it.type === t ? '✓' : '', action: () => setMeta(id, { typeOverride: t === it.baseType ? null : t }) }));
  const inGroupView = S.view.startsWith('group:') && !S.query ? S.view.slice(6) : null;
  openMenu([
    { header: it.name },
    { label: it.type === 'game' ? 'Play' : 'Open', icon: it.type === 'game' ? 'play' : 'sparkle', k: 'Enter', action: () => launch(id) },
    canAdmin && { label: 'Run as administrator', icon: 'gear', k: 'Shift+Enter', action: () => launch(id, { admin: true }) },
    hasPath && it.type !== 'link' && { label: it.type === 'folder' ? 'Open folder' : 'Show in folder', icon: 'folder', k: 'Ctrl+Enter', action: () => reveal(id) },
    { label: 'Copy path', icon: 'file', action: async () => { if (await api.copyPath(id)) toast('Copied to clipboard'); } },
    '-',
    { label: fav ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', k: 'F', action: () => toggleFav(id) },
    { label: 'Add to group', icon: 'apps', sub: groupsSub },
    inGroupView && { label: 'Remove from this group', icon: 'x', action: () => toggleInGroup(id, inGroupView) },
    { label: 'Show under', icon: 'sort', sub: typeSub },
    '-',
    { label: 'Rename…', icon: 'note', k: 'F2', action: () => renameItem(id) },
    it.type === 'app' && hasPath && { label: 'Launch options…', icon: 'gear', action: () => editArgs(id) },
    it.hidden ? { label: 'Unhide', icon: 'sparkle', action: () => setMeta(id, { hidden: null }) }
      : { label: it.source === 'user' ? 'Remove from Haven' : 'Hide', icon: 'x', danger: true, k: 'Del', action: () => removeItem(id) },
  ].filter((e) => e !== false && e !== undefined && e !== ''), x, y);
}
function groupMenu(gid, x, y) {
  const g = S.groups.find((x) => x.id === gid);
  if (!g) return;
  const i = S.groups.indexOf(g);
  openMenu([
    { header: g.name },
    { label: 'Edit group…', icon: 'note', action: () => editGroup(gid) },
    { label: 'Pop out as desktop widget', icon: 'layers', action: () => popOut('group:' + gid) },
    i > 0 && { label: 'Move up', icon: 'sort', action: () => { const gs = structuredClone(S.groups); [gs[i - 1], gs[i]] = [gs[i], gs[i - 1]]; saveGroups(gs); } },
    i < S.groups.length - 1 && { label: 'Move down', icon: 'sort', action: () => { const gs = structuredClone(S.groups); [gs[i + 1], gs[i]] = [gs[i], gs[i + 1]]; saveGroups(gs); } },
    '-',
    { label: 'Delete group', icon: 'x', danger: true, action: () => deleteGroup(gid) },
  ].filter(Boolean), x, y);
}

// ================================================================ modals
function modal(html, { wide = false } = {}) {
  const back = $('#modalBack'), m = $('#modal');
  m.className = 'modal' + (wide ? ' wide' : '');
  m.innerHTML = html;
  back.hidden = false;
  setTimeout(() => m.querySelector('input:not([type=color]):not([type=range]), [data-autofocus]')?.focus(), 30);
  return m;
}
function closeModal() {
  $('#modalBack').hidden = true;
  $('#modal').innerHTML = '';
  // In a panel window, closing the last dialog closes the window (unless another dialog opens right after).
  if (IS_PANEL) setTimeout(() => { if ($('#modalBack').hidden) api.closePanel(); }, 80);
}
function prompt({ title, lead = '', fields, ok = 'Save' }) {
  return new Promise((resolve) => {
    const m = modal(`<h3>${esc(title)}</h3>${lead ? `<p class="lead">${lead}</p>` : ''}
      <form id="pform">${fields.map((f) => `<div class="field"><label>${esc(f.label)}</label><input name="${f.name}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" spellcheck="false"></div>`).join('')}
      <div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${esc(ok)}</button></div></form>`);
    m.querySelector('[data-x]').onclick = () => { closeModal(); resolve(null); };
    m.querySelector('#pform').onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); closeModal(); resolve(d); };
  });
}
async function renameItem(id) {
  if (toPanel('rename', id)) return;
  const it = S.byId.get(id);
  const r = await prompt({ title: 'Rename', lead: it.originalName !== it.name ? `Original name: ${esc(it.originalName)}` : '', fields: [{ name: 'name', label: 'Name', value: it.name }] });
  if (r) setMeta(id, { customName: r.name.trim() && r.name.trim() !== it.originalName ? r.name.trim() : null });
}
async function editArgs(id) {
  if (toPanel('args', id)) return;
  const it = S.byId.get(id);
  const r = await prompt({ title: 'Launch options', lead: 'Command-line arguments passed when Haven opens this app.', fields: [{ name: 'args', label: 'Arguments', value: it.args || '', placeholder: 'e.g. --incognito' }] });
  if (r) setMeta(id, { args: r.args.trim() || null });
}
async function addLinkFlow() {
  if (toPanel('link', S.view)) return;
  const r = await prompt({ title: 'Add a link', lead: 'Websites, web apps, or any URL (steam://, spotify:, discord:…).', ok: 'Add link', fields: [{ name: 'url', label: 'URL', placeholder: 'youtube.com' }, { name: 'name', label: 'Name (optional)', placeholder: 'YouTube' }] });
  if (!r || !r.url.trim()) return;
  const opts = { url: r.url.trim(), name: r.name.trim() };
  if (S.view.startsWith('group:')) opts.groupId = S.view.slice(6);
  ingest(await api.addLink(opts));
  render();
  toast('Link added');
}
function editGroup(gid, addItemId) {
  if (toPanel('group', `${gid || ''}|${addItemId || ''}`)) return;
  const g = gid ? S.groups.find((x) => x.id === gid) : { id: 'g' + Date.now().toString(36), name: '', emoji: '📁', color: GROUP_COLORS[S.groups.length % GROUP_COLORS.length], items: [] };
  let emoji = g.emoji, color = g.color;
  const m = modal(`<h3>${gid ? 'Edit group' : 'New group'}</h3><p class="lead">Groups are like desktop fences — collect anything you like.</p>
    <form id="gform"><div class="field"><label>Name</label><input name="name" value="${esc(g.name)}" placeholder="Work, Creative, Shooters…"></div>
    <div class="field"><label>Icon</label><div class="emojis">${EMOJIS.map((e) => `<button type="button" data-e="${e}" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div></div>
    <div class="field"><label>Color</label><div class="swatches">${GROUP_COLORS.map((c) => `<button type="button" data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>
    <div class="actions">${gid ? '<button type="button" class="btn danger" data-del style="margin-right:auto">Delete</button>' : ''}<button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${gid ? 'Save' : 'Create group'}</button></div></form>`);
  m.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => { emoji = b.dataset.e; m.querySelectorAll('[data-e]').forEach((x) => x.classList.toggle('on', x === b)); });
  m.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { color = b.dataset.c; m.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b)); });
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-del]')?.addEventListener('click', () => { closeModal(); deleteGroup(gid); });
  m.querySelector('#gform').onsubmit = async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim() || 'New group';
    const groups = structuredClone(S.groups);
    const existing = groups.find((x) => x.id === g.id);
    if (existing) Object.assign(existing, { name, emoji, color });
    else groups.push({ ...g, name, emoji, color, items: addItemId ? [addItemId] : [] });
    closeModal();
    await saveGroups(groups);
    if (!gid) { go('group:' + g.id); toast(`Created ${emoji} ${name}`); }
  };
}
async function deleteGroup(gid) {
  const g = S.groups.find((x) => x.id === gid);
  if (!g) return;
  const backup = structuredClone(S.groups);
  if (S.view === 'group:' + gid) S.view = 'home';
  await saveGroups(S.groups.filter((x) => x.id !== gid));
  toast(`Deleted ${g.name}`, { action: { label: 'Undo', fn: () => saveGroups(backup) } });
}

function welcome() {
  const m = modal(`<div style="text-align:center;padding:8px 6px 0">
    <div class="logo" style="width:64px;height:64px;border-radius:18px;padding:14px;gap:5px;margin:0 auto 18px"><i style="border-radius:4px"></i><i style="border-radius:4px"></i><i style="border-radius:4px"></i><i style="border-radius:4px"></i></div>
    <h3 style="font-size:26px">Welcome to Haven</h3>
    <p class="lead">Everything on your PC, beautifully organized. Here's how to get the most out of it:</p></div>
    <div class="rows" style="gap:6px;margin:8px 0 4px">
      ${[['search', 'Summon it anywhere', `Press <b>${esc(S.settings.hotkey)}</b> from any app, then just start typing.`],
         ['game', 'Your games are already here', 'Steam, Epic and Xbox/Store libraries are detected automatically — with cover art.'],
         ['star', 'Favorites and groups', 'Right-click anything to favorite it, or drag tiles onto a group in the sidebar.'],
         ['plus', 'Drop to add', 'Drag files, folders, shortcuts or .exe files from Explorer straight into the window.'],
         ['calc', 'Quick tools in search', 'Type <b>=24*7</b> for math, <b>g</b> / <b>yt</b> / <b>w</b> + words to search the web.']]
        .map(([i, t, d]) => `<div class="row" style="cursor:default"><div class="ic" style="color:var(--accent)">${svg(i)}</div><div class="meta"><b>${t}</b><span style="direction:ltr;white-space:normal">${d}</span></div></div>`).join('')}
    </div>
    <div class="actions"><button class="btn primary" data-autofocus data-go style="width:100%;height:42px">Let's go</button></div>`);
  m.querySelector('[data-go]').onclick = () => { closeModal(); api.setOnboarded(); S.onboarded = true; };
}

// ---------------------------------------------------------------- settings
let settingsTab = 'general';
function openSettings(tab) {
  if (toPanel('settings', tab || '')) return;
  if (tab) settingsTab = tab;
  const s = S.settings;
  const sw = (k, on) => `<button class="switch ${on ? 'on' : ''}" data-toggle="${k}"></button>`;
  const row = (title, sub, ctl) => `<div class="setting"><div class="txt"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ctl}</div>`;
  const tabs = { general: 'General', look: 'Appearance', widgets: 'Widgets', library: 'Library', data: 'Backup & data', keys: 'Shortcuts', about: 'About' };
  let body = '';
  if (settingsTab === 'general') {
    const widget = s.mode === 'widget';
    body = row('Desktop widget', 'Lives on your desktop behind your windows, survives Win+D, no taskbar button', `<button class="switch ${widget ? 'on' : ''}" data-mode></button>`)
      + (widget ? row('Lock position and size', 'Stops accidental dragging — unlock here or from the tray icon', sw('lockPosition', s.lockPosition)) : '')
      + row('Start with Windows', widget ? 'The widget is waiting on your desktop after you sign in' : 'Starts quietly in the tray', sw('launchAtStartup', s.launchAtStartup))
      + row('Summon hotkey', widget ? 'Brings the widget to the front from anywhere; press again to send it back' : 'Show or hide Haven from anywhere', `<button class="keycap" id="setHotkey">${esc(s.hotkey || 'None')}</button>`)
      + row('Your name', 'Used in the greeting on Home', `<input class="keycap" id="setName" value="${esc(s.displayName)}" style="user-select:text">`)
      + row('Hide after launching something', widget ? 'Sends the widget back to the desktop after a launch' : 'Great for using Haven as a launcher', sw('hideOnLaunch', s.hideOnLaunch))
      + (widget ? '' : row('Hide when clicking away', 'Behaves like a pop-up launcher', sw('hideOnBlur', s.hideOnBlur))
        + row('Always on top', 'Keep Haven above other windows', sw('alwaysOnTop', s.alwaysOnTop))
        + row('Close button hides to tray', 'Keeps the hotkey working', sw('closeToTray', s.closeToTray)))
      + row('Show recently used', '"Jump back in" and "Continue playing" on Home and the Favorites widget', sw('showRecent', s.showRecent !== false))
      + row('24-hour clock', '', sw('clock24', s.clock24));
  } else if (settingsTab === 'look') {
    const w = S.wall;
    const wallChips = w ? `<span style="display:inline-flex;gap:6px;vertical-align:middle;margin-left:6px"><i class="dot" style="width:12px;height:12px;background:${w.accent}"></i>${w.accent2 ? `<i class="dot" style="width:12px;height:12px;background:${w.accent2}"></i>` : ''}</span>` : '';
    const custom = s.accentMode === 'custom';
    body = row('Theme', 'Wallpaper picks light or dark from how bright your wallpaper is', `<div class="seg">${[['wallpaper', 'Wallpaper'], ['dark', 'Dark'], ['light', 'Light'], ['system', 'System']].map(([t, l]) => `<button data-theme-set="${t}" class="${s.theme === t ? 'on' : ''}">${l}</button>`).join('')}</div>`)
      + row(`Match accent to wallpaper${wallChips}`, w ? 'Colors update automatically whenever your wallpaper changes' : "Couldn't read your wallpaper — using your custom accent", `<button class="switch ${!custom ? 'on' : ''}" data-accentmode></button>`)
      + row('Custom accent', custom ? '' : 'Picking one turns off wallpaper matching', `<div class="swatches">${ACCENTS.map((c) => `<button data-accent="${c}" class="${custom && c === s.accent ? 'on' : ''}" style="background:${c}"></button>`).join('')}<input type="color" id="accentCustom" value="${esc(s.accent)}" title="Custom color"></div>`)
      + row('Transparency', `Opacity ${s.opacity ?? 72}% · ${s.glass ? 'frosted blur' : 'clear, no blur'} — widgets can override this`, `<button class="btn" id="openTransparency">Adjust…</button>`)
      + row('Solid Haven window', 'Keeps the main Haven window opaque, even when your desktop widgets are see-through', sw('hubSolid', s.hubSolid !== false))
      + row('Tile size', '', `<input type="range" min="64" max="140" step="4" value="${s.tileSize}" id="tileSize">`);
  } else if (settingsTab === 'widgets') {
    const list = S.widgets;
    body = row('Haven Studio', 'Design your own clocks, dates, countdowns and text for the desktop', `<button class="btn primary" id="doStudio">Open Studio</button>`)
      + row('Live wallpaper', 'Animated scenes, videos or GIFs behind your desktop icons', `<button class="btn" id="doLive">Set up…</button>`)
      + row('Haven Bar', 'A status bar with desktop buttons, open apps, music and system stats (Ctrl+Alt+B)', `<button class="btn" id="doBar">Set up…</button>`)
      + row('Themes', 'Switch the whole look in one click, or match your wallpaper', `<button class="btn" id="doThemes">Choose…</button>`)
      + row('Split into widgets', 'Puts Favorites, Apps, Games, Files, Folders and Links on your desktop as separate widgets in a tidy grid', `<button class="btn" id="doSplit">Split</button>`)
      + row('Pop out one tab', 'Add a single widget for any tab or group', `<button class="btn" id="doPop">Choose…</button>`)
      + row('Show main Haven window', 'Keep the full window alongside your widgets', sw('hubVisible', s.hubVisible !== false))
      + row('Lock widgets in place', 'No accidental dragging or resizing', sw('lockPosition', s.lockPosition))
      + snapSettingsHTML(s, sw, row)
      + `<div class="section-h" style="margin:18px 0 8px"><h2 style="font-size:14px">Your widgets</h2><span class="sub">${list.length}</span><span class="grow"></span>${list.length ? '<button class="btn" id="doMerge">Merge all back</button>' : ''}</div>`
      + (list.length ? `<div class="rows">${list.map((w) => {
        const v = viewLabel(w.view);
        const look = [w.opacity != null ? `${w.opacity}% opacity` : null, w.glass != null ? (w.glass ? 'blur' : 'no blur') : null].filter(Boolean).join(' · ') || 'Matches main look';
        return `<div class="row" style="cursor:default"><div class="ic" style="color:var(--accent)">${v.emoji ? `<span style="font-size:18px">${esc(v.emoji)}</span>` : svg(v.icon)}</div><div class="meta"><b>${esc(v.label)}</b><span style="direction:ltr">${esc(look)}</span></div><button class="btn danger" data-wremove="${w.id}">Remove</button></div>`;
      }).join('')}</div>` : '<p class="lead" style="font-size:12.5px">No widgets yet. Split everything at once, or right-click any tab in the sidebar → Pop out.</p>');
  } else if (settingsTab === 'library') {
    const src = s.sources;
    const hidden = S.items.filter((i) => i.hidden);
    body = row('Start menu apps', 'Everything installed on Windows', sw('src.startmenu', src.startmenu))
      + row('Steam games', 'Including cover art from your Steam library', sw('src.steam', src.steam))
      + row('Epic Games', '', sw('src.epic', src.epic))
      + row('Microsoft Store & Xbox apps', '', sw('src.store', src.store))
      + row('Desktop shortcuts and files', '', sw('src.desktop', src.desktop))
      + row('Recent files', "Shows Windows' recent items in Files", sw('src.recent', src.recent))
      + row('Show hidden items', 'Display hidden items (dimmed) in all views', sw('showHidden', s.showHidden))
      + row('Rescan now', 'Pick up newly installed apps and games', `<button class="btn" data-act="rescan">${svg('refresh')} Rescan</button>`)
      + `<div class="section-h" style="margin:18px 0 8px"><h2 style="font-size:14px">Hidden items</h2><span class="sub">${hidden.length}</span></div>`
      + (hidden.length ? `<div class="rows">${hidden.map((it) => `<div class="row" style="cursor:default"><div class="ic">${iconHTML(it)}</div><div class="meta"><b>${esc(it.name)}</b></div><button class="btn" data-unhide="${it.id}">Unhide</button></div>`).join('')}</div>` : '<p class="lead" style="font-size:12.5px">Nothing hidden. Right-click → Hide removes clutter from scans.</p>');
  } else if (settingsTab === 'data') {
    body = row('Export backup', 'Favorites, groups, links, notes and settings', `<button class="btn" id="doExport">Export…</button>`)
      + row('Import backup', 'Replaces your current setup', `<button class="btn" id="doImport">Import…</button>`)
      + row('Open data folder', 'Where Haven keeps its files', `<button class="btn" id="doFolder">Open</button>`)
      + row('Show welcome tour', '', `<button class="btn" id="doTour">Show</button>`);
  } else if (settingsTab === 'about') {
    body = `<div style="display:flex;align-items:center;gap:16px;padding:8px 0 18px">
        <div class="logo" style="width:56px;height:56px;border-radius:16px;padding:12px;gap:4px"><i style="border-radius:4px"></i><i style="border-radius:4px"></i><i style="border-radius:4px"></i><i style="border-radius:4px"></i></div>
        <div><b style="font:600 22px var(--font-display)">Haven</b><div style="color:var(--text-2)">Version ${esc(S.version || '—')}${S.packaged ? '' : ' · development build'}</div></div></div>`
      + row('Your data', 'Favorites, groups, layouts and settings live in your user folder and survive updates and uninstalls', `<button class="btn" id="doFolder2">Open</button>`)
      + row('Welcome tour', '', `<button class="btn" id="doTour2">Show</button>`);
  } else {
    const k = [['Summon / hide Haven', s.hotkey], ['Search', 'Just start typing'], ['Open selection', 'Enter'], ['Run as administrator', 'Shift+Enter'], ['Show in folder', 'Ctrl+Enter'],
      ['Favorite selection', 'F'], ['Rename selection', 'F2'], ['Hide selection', 'Delete'], ['Switch views', 'Ctrl+1 … Ctrl+7'], ['Settings', 'Ctrl+,'], ['Add link', 'Ctrl+L'], ['Add files', 'Ctrl+O'], ['New group', 'Ctrl+G'], ['Rescan', 'F5'], ['Clear search / hide', 'Esc']];
    body = k.map(([a, b]) => row(a, '', `<span class="kind" style="font-size:12px;padding:4px 10px;border-radius:7px;background:var(--panel-2)">${esc(b)}</span>`)).join('');
  }
  const m = modal(`<div style="display:flex;align-items:center;margin-bottom:16px"><h3 style="flex:1">Settings</h3><button class="tb" data-x>${svg('x')}</button></div>
    <div class="settings"><nav>${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${k === settingsTab ? 'on' : ''}">${v}</button>`).join('')}</nav><div>${body}</div></div>`, { wide: true });
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => openSettings(b.dataset.tab));
  const set = async (patch, reopen = true) => { const r = await api.setSettings(patch); ingest(r); render(); if (reopen) openSettings(); return r; };
  m.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => {
    const k = b.dataset.toggle;
    if (k.startsWith('src.')) { const key = k.slice(4); set({ sources: { ...S.settings.sources, [key]: !S.settings.sources[key] } }); }
    else if (k.startsWith('snap.')) { const key = k.slice(5); set({ snap: { ...S.settings.snap, [key]: !S.settings.snap[key] } }); }
    else set({ [k]: !S.settings[k] });
  });
  m.querySelectorAll('[data-theme-set]').forEach((b) => b.onclick = () => set({ theme: b.dataset.themeSet }));
  m.querySelectorAll('[data-accent]').forEach((b) => b.onclick = () => set({ accent: b.dataset.accent, accentMode: 'custom' }));
  m.querySelector('[data-accentmode]')?.addEventListener('click', () => set({ accentMode: S.settings.accentMode === 'custom' ? 'wallpaper' : 'custom' }));
  m.querySelector('[data-mode]')?.addEventListener('click', () => set({ mode: S.settings.mode === 'widget' ? 'window' : 'widget' }));
  m.querySelectorAll('[data-unhide]').forEach((b) => b.onclick = async () => { await setMeta(b.dataset.unhide, { hidden: null }); openSettings(); });
  $('#accentCustom', m)?.addEventListener('change', (e) => set({ accent: e.target.value, accentMode: 'custom' }));
  $('#tileSize', m)?.addEventListener('input', (e) => { document.documentElement.style.setProperty('--tile', e.target.value + 'px'); });
  $('#tileSize', m)?.addEventListener('change', (e) => set({ tileSize: +e.target.value }, false));
  $('#setName', m)?.addEventListener('change', (e) => set({ displayName: e.target.value.trim() }, false));
  $('#doExport', m)?.addEventListener('click', async () => { if (await api.exportData()) toast('Backup saved'); });
  $('#doImport', m)?.addEventListener('click', async () => { const r = await api.importData(); if (!r) return; if (r.error) return toast(r.error, { err: true }); ingest(r); render(); toast('Backup restored'); openSettings(); });
  $('#doFolder', m)?.addEventListener('click', () => api.openDataFolder());
  $('#doTour', m)?.addEventListener('click', welcome);
  $('#doTour2', m)?.addEventListener('click', welcome);
  $('#doFolder2', m)?.addEventListener('click', () => api.openDataFolder());
  $('#openTransparency', m)?.addEventListener('click', () => transparencyPanel());
  // Snapping controls
  const setSnap = (patch) => set({ snap: { ...S.settings.snap, ...patch } });
  m.querySelectorAll('[data-snapzones]').forEach((b) => b.onclick = () => setSnap({ zones: b.dataset.snapzones }));
  m.querySelectorAll('[data-zoneset]').forEach((b) => b.onclick = () => setSnap({ zoneSet: b.dataset.zoneset }));
  for (const [id, key] of [['#snapGap', 'gap'], ['#snapDist', 'distance']]) {
    const el = $(id, m);
    if (!el) continue;
    el.addEventListener('input', () => { $(id + 'V', m).textContent = el.value + 'px'; });
    el.addEventListener('change', () => setSnap({ [key]: +el.value }));
  }
  $('#doSplit', m)?.addEventListener('click', async () => { closeModal(); await splitAll(); });
  $('#doStudio', m)?.addEventListener('click', () => { closeModal(); api.studioOpen({ tab: 'widgets' }); });
  $('#doLive', m)?.addEventListener('click', () => { closeModal(); api.studioOpen({ tab: 'live' }); });
  $('#doBar', m)?.addEventListener('click', () => { closeModal(); api.studioOpen({ tab: 'bar' }); });
  $('#doThemes', m)?.addEventListener('click', () => { closeModal(); api.studioOpen({ tab: 'themes' }); });
  $('#doMerge', m)?.addEventListener('click', async () => { ingest(await api.mergeWidgets()); openSettings(); });
  $('#doPop', m)?.addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(viewChoices(null, async (v) => { await popOut(v); openSettings(); }), r.left - 120, r.bottom + 4); });
  m.querySelectorAll('[data-wremove]').forEach((b) => b.onclick = async () => { ingest(await api.removeWidget(b.dataset.wremove)); openSettings(); });
  const hk = $('#setHotkey', m);
  hk?.addEventListener('click', () => {
    hk.classList.add('rec'); hk.textContent = 'Press keys… (Esc to clear)';
    const onKey = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      window.removeEventListener('keydown', onKey, true);
      if (e.key === 'Escape') { await set({ hotkey: '' }); return; }
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl'); if (e.altKey) parts.push('Alt'); if (e.shiftKey) parts.push('Shift'); if (e.metaKey) parts.push('Super');
      let key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!parts.length) { toast('Use at least one modifier (Ctrl, Alt, Shift or Win)', { err: true }); openSettings(); return; }
      parts.push(key);
      const r = await set({ hotkey: parts.join('+') });
      if (r && r.hotkeyOk === false) toast('That shortcut is taken by another app', { err: true });
    };
    window.addEventListener('keydown', onKey, true);
  });
}

// ================================================================ split widgets
function viewLabel(view) {
  if (view.startsWith('group:')) { const g = S.groups.find((x) => 'group:' + x.id === view); return g ? { label: g.name, emoji: g.emoji || '📁' } : { label: 'Group', icon: 'folder' }; }
  const v = VIEWS.find((x) => x.id === view) || VIEWS[0];
  return { label: v.id === 'home' ? 'Favorites' : v.label, icon: v.id === 'home' ? 'star' : v.icon };
}
function viewChoices(current, onPick) {
  return [
    ...VIEWS.map((v) => ({ label: v.id === 'home' ? 'Favorites' : v.label, icon: current === v.id ? '✓' : v.icon, action: () => onPick(v.id) })),
    S.groups.length ? '-' : null,
    ...S.groups.map((g) => ({ label: g.name, icon: current === 'group:' + g.id ? '✓' : g.emoji || '📁', action: () => onPick('group:' + g.id) })),
  ].filter(Boolean);
}
async function popOut(view) {
  ingest(await api.addWidget(view));
  render(true);
  toast(`${viewLabel(view).label} is now its own widget — drag it anywhere on your desktop`);
}
async function splitAll() {
  await api.splitWidgets();
  toast('Split into widgets');
}
function widgetsMenu(x, y) {
  openMenu([
    { header: 'Desktop widgets' },
    { label: 'Layouts…', icon: 'layers', action: () => layoutsPanel() },
    { label: 'Split into widgets', icon: 'apps', action: splitAll },
    { label: 'Pop out a tab…', icon: 'plus', sub: viewChoices(null, popOut) },
    S.widgets.length ? { label: `Merge ${S.widgets.length} widget${S.widgets.length > 1 ? 's' : ''} back`, icon: 'home', action: () => api.mergeWidgets() } : null,
    '-',
    { label: 'Customize look…', icon: 'sparkle', action: () => customizePanel() },
    { label: 'Haven Studio — clocks & more…', icon: 'clock', action: () => api.studioOpen({ tab: 'widgets' }) },
    { label: 'Live wallpaper…', icon: 'play', action: () => api.studioOpen({ tab: 'live' }) },
    { label: 'Haven Bar & themes…', icon: 'layers', action: () => api.studioOpen({ tab: 'bar' }) },
    { label: S.settings.lockPosition ? 'Unlock positions' : 'Lock positions', icon: 'pin', action: () => api.setSettings({ lockPosition: !S.settings.lockPosition }) },
  ].filter(Boolean), x, y);
}

function renderWidgetHeader() {
  const tb = $('.titlebar');
  const { label, icon, emoji } = viewLabel(S.view);
  if (!tb.dataset.built) {
    tb.dataset.built = '1';
    tb.innerHTML = `
      <div class="wtitle" id="wTitle"></div>
      <div class="wsearch"><svg class="ico"><use href="#i-search"/></svg><input id="wFilter" placeholder="Filter" spellcheck="false" autocomplete="off"></div>
      <button class="tb" id="wView" title="Change what this widget shows"><svg class="ico"><use href="#i-sort"/></svg></button>
      <button class="tb" id="wMore" title="Widget options"><svg class="ico"><use href="#i-dots"/></svg></button>`;
    const f = $('#wFilter');
    f.addEventListener('input', () => { S.filter = f.value; renderContent(true); });
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { f.value = ''; S.filter = ''; renderContent(true); f.blur(); }
      if (e.key === 'Enter') { const first = $('#content [data-id]'); if (first) launch(first.dataset.id, { admin: e.shiftKey }); }
    });
    $('#wView').onclick = (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu([{ header: 'Show in this widget' }, ...viewChoices(S.view, (v) => setWidget({ view: v }))], r.left - 160, r.bottom + 4); };
    $('#wMore').onclick = (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); widgetOptions(r.left - 190, r.bottom + 4); };
  }
  $('#wTitle').innerHTML = `${emoji ? `<span class="emoji">${esc(emoji)}</span>` : svg(icon)}<span>${esc(label)}</span>`;
}
async function setWidget(patch) {
  ingest(await api.updateWidget(WID, patch));
  render();
}
function widgetOptions(x, y) {
  openMenu([
    { header: 'This widget' },
    { label: 'Customize look…', icon: 'sparkle', action: () => customizePanel() },
    { label: 'Layouts…', icon: 'layers', action: () => layoutsPanel() },
    { label: S.settings.lockPosition ? 'Unlock all widgets' : 'Lock all widgets in place', icon: 'pin', action: () => api.setSettings({ lockPosition: !S.settings.lockPosition }) },
    { label: S.settings.snap?.enabled === false ? 'Turn snapping on' : 'Turn snapping off', icon: 'layers', action: async () => { const on = S.settings.snap?.enabled === false; ingest(await api.setSettings({ snap: { ...S.settings.snap, enabled: on } })); toast(on ? 'Snapping on' : 'Snapping off — widgets move freely'); } },
    { label: 'Snapping settings…', icon: 'gear', action: () => openSettings('widgets') },
    { label: 'Add another widget', icon: 'plus', sub: viewChoices(null, popOut) },
    { label: 'Haven Studio — clocks & more…', icon: 'clock', action: () => api.studioOpen({ tab: 'widgets' }) },
    { label: 'Live wallpaper…', icon: 'play', action: () => api.studioOpen({ tab: 'live' }) },
    { label: 'Haven Bar & themes…', icon: 'layers', action: () => api.studioOpen({ tab: 'bar' }) },
    '-',
    { label: 'Open main Haven', icon: 'home', action: () => api.showHub() },
    { label: 'Settings', icon: 'gear', action: () => openSettings() },
    '-',
    { label: 'Remove this widget', icon: 'x', danger: true, action: () => api.removeWidget(WID) },
  ], x, y);
}

// ---------------------------------------------------------------- looks (style presets)
const LOOKS = [
  { id: 'glass', name: 'Glass', look: { opacity: 72, glass: true, plates: 'off' } },
  { id: 'frosted', name: 'Frosted', look: { opacity: 38, glass: true, plates: 'subtle' } },
  { id: 'clear', name: 'Clear', look: { opacity: 0, glass: false, plates: 'subtle' } },
  { id: 'outline', name: 'Outline', look: { opacity: 0, glass: false, plates: 'off' } },
  { id: 'bold', name: 'Bold', look: { opacity: 0, glass: false, plates: 'solid', scale: 112 } },
  { id: 'tinted', name: 'Tinted', look: { opacity: 30, glass: false, plates: 'subtle' } },
  { id: 'midnight', name: 'Midnight', look: { opacity: 94, glass: false, plates: 'off' } },
  { id: 'neon', name: 'Neon', look: { opacity: 0, glass: false, plates: 'subtle', plateColor: 'accent' } },
];
const PLATE_COLORS = ['#0b0b12', '#ffffff', '#1e293b', '#1e3a8a', '#3b0764', '#831843', '#7c2d12', '#064e3b'];
const TINT_COLORS = ['#0e0e16', '#f6f6fa', '#1e1b4b', '#0c2a2a', '#3f1d0b', '#2a0f1f'];
function lookCard(l, active, custom) {
  const o = l.look.opacity ?? 72, plate = l.look.plates || 'off';
  const pc = l.look.plateColor === 'accent' ? S.curAccent : l.look.plateColor;
  const pcRgb = pc ? hexToRgb(pc).join(' ') : null;
  const plateCss = plate === 'off' ? '' : pcRgb ? `background:rgb(${pcRgb} / ${plate === 'solid' ? .86 : .55});` : plate === 'solid' ? 'background:rgba(10,10,16,.72);' : 'background:rgba(0,0,0,.4);';
  return `<button class="look ${active ? 'on' : ''}" data-look="${l.id}" title="${esc(l.name)}">
    <div class="look-prev"><div class="look-tint" style="background:rgb(var(--bg-rgb) / ${o / 100});${l.look.glass ? 'backdrop-filter:blur(6px);' : ''}"></div>
      <span class="look-icon">${svg('star')}</span><span class="look-text" style="${plateCss}">Aa Steam</span></div>
    <b>${esc(l.name)}</b>${custom ? `<span class="look-del" data-dellook="${l.id}" title="Delete">×</span>` : ''}</button>`;
}

// One place to restyle: preset looks, scale, opacity, tile size, blur, text backing.
function customizePanel(scope) {
  if (toPanel('customize', scope || '')) return;
  const forWidget = !!WID && S.wrec;
  scope = scope || (forWidget ? 'this' : 'all');
  const s = S.settings;
  const src = scope === 'this' && forWidget ? S.wrec : s;
  const val = (k, d) => (src[k] !== null && src[k] !== undefined ? src[k] : s[k] ?? d);
  const cur = { opacity: val('opacity', 72), glass: !!val('glass', true), plates: val('plates', 'subtle'), scale: val('scale', 100), tileSize: val('tileSize', 92), border: val('border', 'hover'),
    plateColor: val('plateColor', null), tint: val('tint', null) };
  // Which accent choice is selected: 'wallpaper' or a hex.
  const accSel = scope === 'this' && forWidget && S.wrec.accent ? S.wrec.accent : (s.accentMode === 'custom' ? s.accent : 'wallpaper');
  const custom = s.customLooks || [];
  const isActive = (l) => ['opacity', 'glass', 'plates'].every((k) => l.look[k] === undefined || l.look[k] === cur[k]) && (l.look.plateColor ?? null) === (cur.plateColor ?? null);
  const swatchRow = (attr, colors, selected, chips) => `<div class="swatches">${chips.map(([v, label]) => `<button class="chip ${selected === v ? 'on' : ''}" data-${attr}="${v}">${label}</button>`).join('')}
    ${colors.map((c) => `<button data-${attr}="${c}" class="${String(selected).toLowerCase() === c ? 'on' : ''}" style="background:${c}" title="${c}"></button>`).join('')}
    <input type="color" data-${attr}-custom value="${/^#/.test(selected || '') ? selected : S.curAccent || '#8b5cf6'}" title="Pick any color"></div>`;
  const m = modal(`<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><h3 style="flex:1">Customize</h3>
      ${forWidget ? `<div class="seg"><button data-scope="this" class="${scope === 'this' ? 'on' : ''}">This widget</button><button data-scope="all" class="${scope === 'all' ? 'on' : ''}">All widgets</button></div>` : ''}
      <button class="tb" data-x>${svg('x')}</button></div>
    <div class="field"><label>Looks</label><div class="looks">${LOOKS.map((l) => lookCard(l, isActive(l))).join('')}${custom.map((l) => lookCard(l, isActive(l), true)).join('')}
      <button class="look add" id="saveLook" title="Save the current settings as a look"><div class="look-prev">${svg('plus')}</div><b>Save look</b></button></div></div>
    <div class="colors">
      <div class="crow"><div class="txt"><b>Accent</b><span>Icons, highlights and selection</span></div>${swatchRow('acc', ACCENTS, accSel, [['wallpaper', 'Wallpaper']])}</div>
      <div class="crow"><div class="txt"><b>Buttons &amp; backing</b><span>Plates behind buttons and labels while see-through</span></div>${swatchRow('pc', PLATE_COLORS, cur.plateColor || 'auto', [['auto', 'Auto'], ['accent', 'Accent']])}</div>
      <div class="crow"><div class="txt"><b>Tint</b><span>Background color when opacity is above 0%</span></div>${swatchRow('tint', TINT_COLORS, cur.tint || 'theme', [['theme', 'Theme']])}</div>
    </div>
    <div class="setting"><div class="txt"><b>Scale</b><span>Text, icons and buttons together</span></div><input type="range" min="60" max="180" step="5" value="${cur.scale}" id="cScale"><span class="kind val" id="cScaleV">${cur.scale}%</span></div>
    <div class="setting"><div class="txt"><b>Opacity</b><span>0% is fully see-through</span></div><input type="range" min="0" max="100" step="1" value="${cur.opacity}" id="cOpacity"><span class="kind val" id="cOpacityV">${cur.opacity}%</span></div>
    <div class="setting"><div class="txt"><b>Tile size</b></div><input type="range" min="64" max="150" step="4" value="${cur.tileSize}" id="cTile"><span class="kind val" id="cTileV">${cur.tileSize}</span></div>
    <div class="setting"><div class="txt"><b>Text backing</b><span>Soft plates behind labels and buttons when see-through</span></div><div class="seg">${['off', 'subtle', 'solid'].map((p) => `<button data-plates="${p}" class="${cur.plates === p ? 'on' : ''}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div></div>
    <div class="setting"><div class="txt"><b>Blur behind</b><span>Frosted glass over your wallpaper</span></div><button class="switch ${cur.glass ? 'on' : ''}" id="cGlass"></button></div>
    <div class="setting"><div class="txt"><b>Window border</b><span>An outline around the widget</span></div><div class="seg">${[['none', 'Never'], ['hover', 'On hover'], ['always', 'Always']].map(([v, l]) => `<button data-border="${v}" class="${cur.border === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="actions">${scope === 'this' && forWidget ? '<button class="btn" id="cReset" style="margin-right:auto">Match all widgets</button>' : '<span style="margin-right:auto"></span>'}
      <button class="btn" id="cLayouts">${svg('layers')} Layouts…</button><button class="btn primary" data-x>Done</button></div>`, { wide: true });
  m.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  m.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => customizePanel(b.dataset.scope));
  const save = async (patch, reopen = false) => {
    const r = scope === 'this' && forWidget ? await api.updateWidget(WID, patch) : await api.lookAll(patch);
    ingest(r); applyTheme();
    if (reopen) customizePanel(scope);
  };
  m.querySelectorAll('[data-look]').forEach((b) => b.onclick = (e) => {
    if (e.target.closest('[data-dellook]')) return;
    const l = [...LOOKS, ...custom].find((x) => x.id === b.dataset.look);
    if (l) save({ scale: cur.scale, tileSize: cur.tileSize, plateColor: null, ...l.look }, true);
  });
  // Colors: swatches/chips apply instantly; the color pickers apply live as you drag.
  const colorKey = { acc: 'accent', pc: 'plateColor', tint: 'tint' };
  const norm = (attr, v) => (attr === 'pc' && v === 'auto') || (attr === 'tint' && v === 'theme') ? null : v;
  for (const attr of Object.keys(colorKey)) {
    m.querySelectorAll(`[data-${attr}]`).forEach((b) => b.onclick = () => save({ [colorKey[attr]]: norm(attr, b.dataset[attr]) }, true));
    const picker = m.querySelector(`[data-${attr}-custom]`);
    if (picker) {
      picker.addEventListener('input', () => {
        // live preview without saving on every tick
        if (attr === 'acc') document.documentElement.style.setProperty('--accent', picker.value);
        if (attr === 'pc') { document.documentElement.style.setProperty('--pc', hexToRgb(picker.value).join(' ')); document.body.classList.add('custom-plate'); S.plateL = hexLum(picker.value); applyInk(); }
        if (attr === 'tint') { document.documentElement.style.setProperty('--bg-rgb', hexToRgb(picker.value).join(' ')); S.tintL = hexLum(picker.value); applyInk(); }
      });
      picker.addEventListener('change', () => save({ [colorKey[attr]]: picker.value }, true));
    }
  }
  m.querySelectorAll('[data-dellook]').forEach((x) => x.onclick = async (e) => {
    e.stopPropagation();
    ingest(await api.setSettings({ customLooks: custom.filter((l) => l.id !== x.dataset.dellook) }));
    customizePanel(scope);
  });
  $('#saveLook', m).onclick = async () => {
    const r = await prompt({ title: 'Save look', fields: [{ name: 'name', label: 'Name', placeholder: 'Sunset clear' }] });
    if (!r) return customizePanel(scope);
    ingest(await api.setSettings({ customLooks: [...custom, { id: 'k' + Date.now().toString(36), name: r.name.trim() || 'My look', look: { ...cur } }] }));
    toast('Look saved');
    customizePanel(scope);
  };
  const live = (id, label, fn, saveFn) => {
    const el = $(id, m);
    let t = 0;
    el.addEventListener('input', () => {
      $(id + 'V', m).textContent = el.value + label;
      // In the panel window the widget is a different window: preview by saving (throttled).
      if (IS_PANEL) { clearTimeout(t); t = setTimeout(() => saveFn(+el.value), 90); } else fn(+el.value);
    });
    el.addEventListener('change', () => saveFn(+el.value));
  };
  live('#cScale', '%', (v) => api.setZoom && api.setZoom(v / 100), (v) => save({ scale: v }));
  live('#cOpacity', '%', (v) => {
    document.documentElement.style.setProperty('--bg-a', String(v / 100));
    document.body.classList.toggle('see-through', v < 60);
    applyInk();
  }, (v) => save({ opacity: v }));
  live('#cTile', '', (v) => document.documentElement.style.setProperty('--tile', v + 'px'), (v) => save({ tileSize: v }));
  m.querySelectorAll('[data-plates]').forEach((b) => b.onclick = () => save({ plates: b.dataset.plates }, true));
  $('#cGlass', m).onclick = () => save({ glass: !cur.glass }, true);
  m.querySelectorAll('[data-border]').forEach((b) => b.onclick = () => save({ border: b.dataset.border }, true));
  $('#cReset', m)?.addEventListener('click', async () => { ingest(await api.updateWidget(WID, { opacity: null, glass: null, plates: null, scale: null, tileSize: null, border: null, accent: null, plateColor: null, tint: null })); applyTheme(); customizePanel('this'); });
  $('#cLayouts', m).onclick = () => layoutsPanel();
}
const transparencyPanel = () => customizePanel();

// ---------------------------------------------------------------- layouts
async function layoutsPanel() {
  if (toPanel('layouts')) return;
  const presets = await api.layoutPresets();
  const custom = S.settings.customLayouts || [];
  const mini = (l) => `<svg viewBox="0 0 100 62" class="lay-svg"><rect x="0" y="0" width="100" height="62" rx="4" class="lay-desk"/>${l.widgets.map((w) => {
    const [x, y, ww, hh] = w.r;
    return `<rect x="${6 + x * 88}" y="${3 + y * 56}" width="${Math.max(2, ww * 88 - 1)}" height="${Math.max(2, hh * 56 - 1)}" rx="2" class="lay-w"/>`;
  }).join('')}</svg>`;
  const card = (l, isCustom) => `<button class="layout" data-layout="${l.id}">${mini(l)}<b>${esc(l.name)}</b><span>${esc(l.desc || `${l.widgets.length} widgets`)}</span>${isCustom ? `<span class="look-del" data-dellayout="${l.id}" title="Delete">×</span>` : ''}</button>`;
  const m = modal(`<div style="display:flex;align-items:center;margin-bottom:6px"><h3 style="flex:1">Widget layouts</h3><button class="tb" data-x>${svg('x')}</button></div>
    <p class="lead">Pick an arrangement — your widgets keep their looks.</p>
    <div class="lay-group"><b>Keep the center clear</b><span>Pinned to the screen edges, so your wallpaper shows in the middle</span></div>
    <div class="layouts">${presets.filter((l) => l.edge).map((l) => card(l)).join('')}</div>
    <div class="lay-group"><b>Everywhere</b><span>Leave room for desktop icons on the edges</span></div>
    <div class="layouts">${presets.filter((l) => !l.edge).map((l) => card(l)).join('')}</div>
    ${custom.length ? `<div class="lay-group"><b>Saved layouts</b></div><div class="layouts">${custom.map((l) => card(l, true)).join('')}</div>` : ''}
    <div class="actions"><button class="btn" id="lMerge" style="margin-right:auto">Back to one window</button><button class="btn" id="lSave">Save current layout…</button><button class="btn primary" data-x>Done</button></div>`, { wide: true });
  m.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  m.querySelectorAll('[data-layout]').forEach((b) => b.onclick = async (e) => {
    if (e.target.closest('[data-dellayout]')) return;
    closeModal();
    await api.applyLayout(b.dataset.layout);
    toast('Layout applied');
  });
  m.querySelectorAll('[data-dellayout]').forEach((x) => x.onclick = async (e) => { e.stopPropagation(); ingest(await api.deleteLayout(x.dataset.dellayout)); layoutsPanel(); });
  $('#lSave', m).onclick = async () => {
    if (!S.widgets.length) return toast('Split into widgets first, then arrange them how you like', { err: true });
    const r = await prompt({ title: 'Save layout', lead: 'Saves where every widget is, what it shows, and how it looks.', fields: [{ name: 'name', label: 'Name', placeholder: 'Gaming night' }] });
    if (r) { ingest(await api.saveLayout(r.name.trim())); toast('Layout saved'); }
    layoutsPanel();
  };
  $('#lMerge', m).onclick = async () => { closeModal(); await api.mergeWidgets(); };
}

// Opacity / blur / tile size — for this widget (or the main hub when opened there).
function legacyTransparencyPanel() {
  const forWidget = IS_WIDGET && S.wrec;
  const src = forWidget ? S.wrec : S.settings;
  const s = S.settings;
  const val = (k, d) => (src[k] !== null && src[k] !== undefined ? src[k] : s[k] ?? d);
  const inherits = forWidget && ['opacity', 'glass', 'tileSize'].every((k) => src[k] === null || src[k] === undefined);
  const m = modal(`<div style="display:flex;align-items:center;margin-bottom:6px"><h3 style="flex:1">${forWidget ? 'Widget look' : 'Transparency'}</h3><button class="tb" data-x>${svg('x')}</button></div>
    <p class="lead">${forWidget ? 'Just for this widget.' + (inherits ? ' Currently matching your main settings.' : '') : 'For the main Haven window. Each split widget can override these.'}</p>
    <div class="setting"><div class="txt"><b>Background opacity</b><span>0% is fully see-through</span></div><input type="range" min="0" max="100" step="1" value="${val('opacity', 72)}" id="tOpacity"><span class="kind" id="tOpacityV" style="min-width:44px;text-align:center">${val('opacity', 72)}%</span></div>
    <div class="setting"><div class="txt"><b>Blur behind (acrylic)</b><span>Frosted glass over your wallpaper. Off = clear transparency.</span></div><button class="switch ${val('glass', true) ? 'on' : ''}" id="tGlass"></button></div>
    <div class="setting"><div class="txt"><b>Tile size</b></div><input type="range" min="64" max="140" step="4" value="${val('tileSize', 92)}" id="tTile"></div>
    <div class="actions">${forWidget && !inherits ? '<button class="btn" id="tReset" style="margin-right:auto">Match main settings</button>' : ''}<button class="btn primary" data-x>Done</button></div>`);
  m.querySelectorAll('[data-x]').forEach((b) => b.onclick = closeModal);
  const save = (patch) => (forWidget ? api.updateWidget(WID, patch) : api.setSettings(patch)).then((r) => { ingest(r); applyTheme(); });
  const op = $('#tOpacity', m);
  op.addEventListener('input', () => {
    $('#tOpacityV', m).textContent = op.value + '%';
    document.documentElement.style.setProperty('--bg-a', String(op.value / 100));
    document.body.classList.toggle('see-through', op.value < 60);
    applyInk(); // live: text flips light/dark as you drag
  });
  op.addEventListener('change', () => save({ opacity: +op.value }));
  $('#tGlass', m).onclick = async (e) => { e.currentTarget.classList.toggle('on'); await save({ glass: e.currentTarget.classList.contains('on') }); };
  const tile = $('#tTile', m);
  tile.addEventListener('input', () => document.documentElement.style.setProperty('--tile', tile.value + 'px'));
  tile.addEventListener('change', () => save({ tileSize: +tile.value }));
  $('#tReset', m)?.addEventListener('click', async () => { await save({ opacity: null, glass: null, tileSize: null }); closeModal(); });
}

// Title-bar drag for desktop widgets: main process moves the window from the cursor position.
function bindDrag() {
  const tb = $('.titlebar');
  tb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !document.body.classList.contains('widget') || S.settings.lockPosition) return;
    if (e.target.closest('button, input, select, textarea, a, .search, .wsearch')) return;
    e.preventDefault();
    tb.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    api.dragStart();
    const up = () => {
      document.body.classList.remove('dragging');
      api.dragEnd();
      tb.removeEventListener('pointerup', up);
      tb.removeEventListener('lostpointercapture', up);
    };
    tb.addEventListener('pointerup', up);
    tb.addEventListener('lostpointercapture', up);
  });
}

// Corner grip — resizing works even for fully transparent windows.
function bindGrip() {
  const g = document.createElement('div');
  g.className = 'grip';
  g.title = 'Resize';
  document.body.appendChild(g);
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    api.resizeStart(); // main process follows the cursor until release
    const up = () => { api.resizeEnd(); g.removeEventListener('pointerup', up); g.removeEventListener('lostpointercapture', up); };
    g.addEventListener('pointerup', up);
    g.addEventListener('lostpointercapture', up);
  });
}

// ---------------------------------------------------------------- snapping settings
const ZONE_SETS = {
  grid2x2: { name: 'Quarters', zones: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
  columns3: { name: 'Three columns', zones: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  halves: { name: 'Halves', zones: [[0, 0, .5, 1], [.5, 0, .5, 1]] },
  rightStack: { name: 'Right stack', zones: [[0, 0, .66, 1], [.66, 0, .34, 1 / 3], [.66, 1 / 3, .34, 1 / 3], [.66, 2 / 3, .34, 1 / 3]] },
  priority: { name: 'Focus center', zones: [[0, 0, .25, 1], [.25, 0, .5, 1], [.75, 0, .25, 1]] },
  grid3x2: { name: 'Six grid', zones: [[0, 0, 1 / 3, .5], [1 / 3, 0, 1 / 3, .5], [2 / 3, 0, 1 / 3, .5], [0, .5, 1 / 3, .5], [1 / 3, .5, 1 / 3, .5], [2 / 3, .5, 1 / 3, .5]] },
};
function snapSettingsHTML(s, sw, row) {
  const o = s.snap || {};
  const on = o.enabled !== false;
  const mini = (z) => `<svg viewBox="0 0 100 62" class="lay-svg"><rect width="100" height="62" rx="4" class="lay-desk"/>${z.zones.map(([x, y, w, h]) => `<rect x="${3 + x * 94}" y="${3 + y * 56}" width="${w * 94 - 2}" height="${h * 56 - 2}" rx="2" class="lay-w"/>`).join('')}</svg>`;
  let h = `<div class="section-h" style="margin:22px 0 4px"><h2 style="font-size:14px">${svg('layers')}Snapping</h2></div>`
    + row('Snap while dragging', 'Widgets jump into alignment, like shapes in Word and PowerPoint. Hold Alt to place freely.', sw('snap.enabled', on));
  if (!on) return h;
  h += row('Screen edges and center', 'Snap to the edges and middle of the screen', sw('snap.edges', o.edges !== false))
    + row('Other widgets', 'Line up edges and centers, and keep an even gap between widgets', sw('snap.widgets', o.widgets !== false))
    + row('Smart guides', 'Show alignment lines and gap sizes while you drag', sw('snap.guides', o.guides !== false))
    + row('Gap between widgets', '', `<input type="range" min="0" max="40" step="2" value="${o.gap ?? 12}" id="snapGap"><span class="kind val" id="snapGapV">${o.gap ?? 12}px</span>`)
    + row('Snap distance', 'How close before it snaps', `<input type="range" min="4" max="32" step="1" value="${o.distance ?? 14}" id="snapDist"><span class="kind val" id="snapDistV">${o.distance ?? 14}px</span>`)
    + row('Snap zones', 'Hold Shift while dragging to drop a widget into a preset area', `<div class="seg"><button data-snapzones="off" class="${o.zones === 'off' ? 'on' : ''}">Off</button><button data-snapzones="shift" class="${o.zones !== 'off' ? 'on' : ''}">Hold Shift</button></div>`);
  if (o.zones !== 'off') h += `<div class="layouts" style="margin-top:10px">${Object.entries(ZONE_SETS).map(([id, z]) => `<button class="layout ${(o.zoneSet || 'grid2x2') === id ? 'on' : ''}" data-zoneset="${id}">${mini(z)}<b>${z.name}</b></button>`).join('')}</div>`;
  return h;
}

// ================================================================ toast
function toast(text, { err = false, icon = null, action = null } = {}) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.innerHTML = `${icon ? iconHTML(icon) : ''}<span>${esc(text)}</span>${action ? `<button class="pill" style="height:26px">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { action.fn(); t.remove(); };
  const box = $('#toasts');
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, action ? 5000 : 2400);
}

// ================================================================ helpers
function ago(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l * 100];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexLum(hex) { // WCAG relative luminance
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function applyTheme() {
  const s = S.settings;
  const root = document.documentElement;
  const wall = S.wall;
  const theme = s.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : s.theme === 'wallpaper' ? (wall && wall.brightness > 0.62 ? 'light' : 'dark') : s.theme || 'dark';
  root.dataset.theme = theme;
  const w = S.wrec;
  const pick = (k, d) => (IS_WIDGET && w && w[k] !== null && w[k] !== undefined ? w[k] : s[k] ?? d);
  // Accent: per-widget override ('wallpaper' or hex) beats the global setting.
  const wAcc = IS_WIDGET && w ? w.accent : null;
  const useWall = wAcc ? wAcc === 'wallpaper' && wall && wall.accent : s.accentMode !== 'custom' && wall && wall.accent;
  const accent = useWall ? wall.accent : (wAcc && wAcc !== 'wallpaper' ? wAcc : s.accent || '#8b5cf6');
  root.style.setProperty('--accent', accent);
  const [h, sat, l] = hexToHsl(accent);
  root.style.setProperty('--accent-2', useWall && wall.accent2 ? wall.accent2 : `hsl(${(h + 70) % 360} ${Math.max(sat, 55)}% ${Math.min(Math.max(l, 50), 62)}%)`);
  S.curAccent = accent;
  // Tint (background wash) and backing/button color while see-through.
  const tint = pick('tint', null);
  if (tint) root.style.setProperty('--bg-rgb', hexToRgb(tint).join(' ')); else root.style.removeProperty('--bg-rgb');
  S.tintL = tint ? hexLum(tint) : null;
  let pc = pick('plateColor', null);
  if (pc === 'accent') pc = accent;
  if (pc) {
    root.style.setProperty('--pc', hexToRgb(pc).join(' '));
    S.plateL = hexLum(pc);
  } else { root.style.removeProperty('--pc'); S.plateL = null; }
  document.body.classList.toggle('custom-plate', !!pc);
  // The main Haven window can stay solid while desktop widgets are see-through.
  const opacity = !IS_WIDGET && !IS_PANEL && s.hubSolid !== false ? 1 : pick('opacity', 72) / 100;
  root.style.setProperty('--tile', pick('tileSize', 96) + 'px');
  root.style.setProperty('--bg-a', String(opacity));
  document.body.classList.toggle('glass', !!pick('glass', true) && !!window.haven);
  document.body.classList.toggle('see-through', opacity < 0.6);
  const plates = pick('plates', 'subtle');
  document.body.dataset.plates = plates;
  document.body.dataset.border = pick('border', 'hover');
  if (api.setZoom && !IS_PANEL) api.setZoom(pick('scale', 100) / 100);
  document.body.classList.toggle('is-panel', IS_PANEL);
  document.body.classList.toggle('widget', IS_WIDGET || s.mode === 'widget');
  document.body.classList.toggle('is-widget', IS_WIDGET);
  document.body.classList.toggle('locked', (IS_WIDGET || s.mode === 'widget') && !!s.lockPosition);
  applyInk();
}
// ---------------------------------------------------------------- adaptive ink (text + icon color)
// The real background of a see-through window is "our tint at opacity a" over the patch of
// wallpaper behind it. Estimate that luminance and pick the text color with the best contrast.
let winBounds = null; // screen DIPs from the main process (immune to zoom)
// Every wallpaper cell under the window, already blended with our tint at the current cover.
function cellsBehind(cover, tintL) {
  const g = S.wall && S.wall.grid, b = winBounds;
  if (!g || !b) return null;
  const d = b.display, sw = d.width, sh = d.height;
  // Windows' default "Fill": scale to cover the display, centered.
  const k = Math.max(sw / g.w, sh / g.h);
  const ox = (g.w * k - sw) / 2, oy = (g.h * k - sh) / 2;
  const x0 = b.x - d.x, y0 = b.y - d.y, x1 = x0 + b.width, y1 = y0 + b.height;
  const cx0 = Math.max(0, Math.floor((x0 + ox) / k)), cx1 = Math.min(g.w - 1, Math.floor((x1 + ox) / k));
  const cy0 = Math.max(0, Math.floor((y0 + oy) / k)), cy1 = Math.min(g.h - 1, Math.floor((y1 + oy) / k));
  const out = [];
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) out.push(cover * tintL + (1 - cover) * g.data[y * g.w + x]);
  return out.length ? out : null;
}
let inkState = null;
function applyInk() {
  const app = $('#app');
  if (!app) return;
  const root = document.documentElement;
  const a = parseFloat(getComputedStyle(root).getPropertyValue('--bg-a'));
  const op = isNaN(a) ? 0.72 : a;
  const glass = document.body.classList.contains('glass');
  const tintL = S.tintL ?? (root.dataset.theme === 'light' ? 0.92 : 0.005);
  // Acrylic adds its own frosted tint on top of the wallpaper, so it hides more of it.
  const cover = glass ? op + (1 - op) * 0.35 : op;
  const cells = cellsBehind(cover, tintL);
  let ink, mixed = false, eff = tintL;
  if (cells) {
    const n = cells.length;
    eff = cells.reduce((s, v) => s + v, 0) / n;
    const bright = cells.filter((v) => v > 0.3).length / n, dark = cells.filter((v) => v < 0.1).length / n;
    // Both very bright and very dark patches behind us (sunsets, photos): no single text color
    // wins, so use white text with a dark outline + label backing, which reads on anything.
    mixed = bright > 0.08 && dark > 0.08;
    if (mixed) ink = bright > 0.7 ? 'dark' : 'light';
    else ink = inkState === 'dark' ? (eff > 0.15 ? 'dark' : 'light') : inkState === 'light' ? (eff > 0.22 ? 'dark' : 'light') : (eff > 0.18 ? 'dark' : 'light');
  } else ink = tintL > 0.5 ? 'dark' : 'light';
  // A custom backing color decides the text color: text sits on the plates, so it must contrast with them.
  const platesOn = document.body.dataset.plates !== 'off' || mixed;
  if (S.plateL != null && platesOn && cover < 0.62) ink = S.plateL > 0.3 ? 'dark' : 'light';
  inkState = ink;
  app.classList.toggle('ink-dark', ink === 'dark');
  app.classList.toggle('ink-light', ink === 'light');
  app.classList.toggle('mixed', mixed);
  // "halo" = we're see-through enough that the wallpaper competes with the text.
  app.classList.toggle('halo', cover < 0.62);
  app.dataset.lum = eff.toFixed(3);
}
function watchGeometry() {
  let last = '';
  const tick = async () => {
    try {
      const b = await api.bounds();
      const key = b && `${b.x},${b.y},${b.width},${b.height}`;
      if (key && key !== last) { last = key; winBounds = b; applyInk(); }
    } catch {}
  };
  tick();
  setInterval(tick, 600);
}

function tickClock() {
  if (!$('#clock')) return;
  const d = new Date();
  $('#clock b').textContent = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !S.settings.clock24 });
  $('#clock span').textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function go(view) {
  if (IS_WIDGET) return setWidget({ view });
  S.view = view;
  if (S.query) { S.query = ''; $('#search').value = ''; }
  $('#content').scrollTop = 0;
  render();
}
const selectedId = () => document.activeElement?.closest?.('[data-id]')?.dataset.id || (S.query && S.results[S.sel]?.it?.id);

// ================================================================ events
function bind() {
  $('#btnMin').onclick = () => api.minimize();
  $('#btnClose').onclick = () => api.hide();
  $('#btnSettings').onclick = () => openSettings();
  $('#btnWidgets').onclick = (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); widgetsMenu(r.left - 180, r.bottom + 4); };
  $('#btnPin').onclick = async () => { ingest(await api.setSettings({ alwaysOnTop: !S.settings.alwaysOnTop })); renderStatus(); toast(S.settings.alwaysOnTop ? 'Pinned on top' : 'Unpinned'); };
  $('.titlebar').addEventListener('dblclick', (e) => { if (!IS_WIDGET && S.settings.mode !== 'widget' && !e.target.closest('button,input')) api.maximize(); });

  const search = $('#search');
  search.addEventListener('input', () => { S.query = search.value; S.sel = 0; render(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter' && S.query) { e.preventDefault(); activateResult(S.results[S.sel], e); }
    else if (e.key === 'Escape') { e.preventDefault(); if (S.query) clearSearch(); else { search.blur(); api.hide(); } }
  });

  // Clicks
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu')) closeMenu();
    const t = e.target;
    const nav = t.closest('#sidebar [data-view]');
    if (nav) return go(nav.dataset.view);
    if (t.closest('#addGroup, #addGroup2')) return editGroup(null);
    const goBtn = t.closest('[data-go]');
    if (goBtn && !t.closest('.modal')) return go(goBtn.dataset.go);
    const act = t.closest('[data-act]');
    if (act) return doAct(act.dataset.act, act);
    const l = t.closest('[data-launch]');
    if (l) { e.stopPropagation(); return launch(l.dataset.launch); }
    const ri = t.closest('[data-ri]');
    if (ri) return activateResult(S.results[+ri.dataset.ri], e);
    const item = t.closest('#content [data-id]');
    if (item && !t.closest('.hero')) {
      if (e.ctrlKey) return reveal(item.dataset.id);
      return launch(item.dataset.id, { admin: e.shiftKey });
    }
  });
  $('#modalBack').addEventListener('mousedown', (e) => { if (e.target.id === 'modalBack') closeModal(); });
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'sortSel') { ingest(await api.setSettings({ sort: e.target.value })); render(); }
  });
  document.addEventListener('contextmenu', (e) => {
    const it = e.target.closest('[data-id]');
    const g = e.target.closest('[data-group]');
    if (e.target.closest('input, textarea')) return;
    e.preventDefault();
    if (it && !e.target.closest('.modal')) { itemMenu(it.dataset.id, e.clientX, e.clientY); return; }
    if (g) { groupMenu(g.dataset.group, e.clientX, e.clientY); return; }
    const navEl = e.target.closest('#sidebar [data-view]');
    if (navEl) {
      const v = navEl.dataset.view;
      openMenu([{ header: viewLabel(v).label }, { label: 'Pop out as desktop widget', icon: 'layers', action: () => popOut(v) }, { label: 'Split all tabs into widgets', icon: 'apps', action: splitAll }], e.clientX, e.clientY);
      return;
    }
    if (IS_WIDGET && e.target.closest('.titlebar')) { widgetOptions(e.clientX, e.clientY); return; }
    if (e.target.closest('#content')) {
      openMenu([
        { label: 'Add apps or files…', icon: 'plus', k: 'Ctrl+O', action: () => doAct('addFiles') },
        { label: 'Add folder…', icon: 'folder', action: () => doAct('addFolders') },
        { label: 'Add link…', icon: 'link', k: 'Ctrl+L', action: addLinkFlow },
        { label: 'New group…', icon: 'apps', k: 'Ctrl+G', action: () => editGroup(null) },
        '-',
        { label: 'Rescan library', icon: 'refresh', k: 'F5', action: () => doAct('rescan') },
        { label: 'Settings', icon: 'gear', k: 'Ctrl+,', action: () => openSettings() },
      ], e.clientX, e.clientY);
    }
  });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (!$('#modalBack').hidden) { if (e.key === 'Escape') closeModal(); return; }
    if (!$('#menu').hidden && e.key === 'Escape') return closeMenu();
    const inField = e.target.matches('input, textarea, select');
    if (e.ctrlKey && /^[1-7]$/.test(e.key)) { e.preventDefault(); return go(VIEWS[+e.key - 1].id); }
    if (e.ctrlKey && e.key === ',') { e.preventDefault(); return openSettings(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); return addLinkFlow(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); return doAct('addFiles'); }
    if (e.ctrlKey && e.key.toLowerCase() === 'g') { e.preventDefault(); return editGroup(null); }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); search.focus(); search.select(); return; }
    if (e.key === 'F5') { e.preventDefault(); return doAct('rescan'); }
    if (inField) return;
    const id = selectedId();
    if (id) {
      if (e.key === 'Enter') { e.preventDefault(); return e.ctrlKey ? reveal(id) : launch(id, { admin: e.shiftKey }); }
      if (e.key === 'F2') { e.preventDefault(); return renameItem(id); }
      if (e.key === 'Delete') { e.preventDefault(); return removeItem(id); }
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey) { e.preventDefault(); return toggleFav(id); }
      if (e.key === 'ContextMenu') { const r = document.activeElement.getBoundingClientRect(); return itemMenu(id, r.left + 20, r.top + 20); }
    }
    if (e.key.startsWith('Arrow')) { e.preventDefault(); return arrowNav(e.key); }
    if (e.key === 'Escape') { if (S.query) clearSearch(); else if (!IS_WIDGET) api.hide(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== ' ') {
      (IS_WIDGET ? $('#wFilter') : search)?.focus(); // the keystroke lands in the search box
    }
  });

  // Drag & drop: files from Explorer, and tiles onto groups / reorder.
  let dragDepth = 0;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!isFiles(e)) return;
    dragDepth++;
    const label = S.view.startsWith('group:') ? `to ${S.groups.find((g) => 'group:' + g.id === S.view)?.name || 'group'}` : S.view === 'home' ? 'to Favorites' : S.view === 'games' ? 'as games' : 'to your library';
    $('#dropTarget').textContent = label;
    $('#dropzone').classList.add('on');
  });
  document.addEventListener('dragleave', (e) => { if (isFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.remove('on'); } });
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const nav = e.target.closest('[data-drop]');
    $$('.drop-hover').forEach((n) => n !== nav && n.classList.remove('drop-hover'));
    if (nav && !isFiles(e)) nav.classList.add('drop-hover');
    const tile = e.target.closest('[data-reorder] [data-id]');
    $$('.drop-before').forEach((n) => n !== tile && n.classList.remove('drop-before'));
    if (tile && dragId && tile.dataset.id !== dragId) tile.classList.add('drop-before');
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropzone').classList.remove('on');
    $$('.drop-hover, .drop-before').forEach((n) => n.classList.remove('drop-hover', 'drop-before'));
    if (isFiles(e) && e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
      const nav = e.target.closest('[data-drop]');
      const extra = nav && nav.dataset.drop.startsWith('group:') ? { groupId: nav.dataset.drop.slice(6) } : {};
      return addPaths(paths, extra);
    }
    const id = e.dataTransfer.getData('text/haven-id');
    if (!id) return;
    const nav = e.target.closest('[data-drop]');
    if (nav) {
      if (nav.dataset.drop === 'fav') { if (!isFav(id)) toggleFav(id); else toast('Already a favorite'); }
      else toggleInGroup(id, nav.dataset.drop.slice(6), true);
      return;
    }
    const tile = e.target.closest('[data-reorder] [data-id]');
    const grid = e.target.closest('[data-reorder]');
    if (tile && grid && tile.dataset.id !== id) reorder(grid.dataset.reorder, id, tile.dataset.id);
  });
  let dragId = null;
  document.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('[data-id]');
    if (!el) return;
    dragId = el.dataset.id;
    e.dataTransfer.setData('text/haven-id', dragId);
    e.dataTransfer.effectAllowed = 'copyMove';
    el.classList.add('dragging');
  });
  document.addEventListener('dragend', (e) => { e.target.classList?.remove('dragging'); dragId = null; $$('.drop-hover, .drop-before').forEach((n) => n.classList.remove('drop-hover', 'drop-before')); });

  api.on('lib:changed', (snap) => {
    ingest(snap);
    if (!document.querySelector('.menu:not([hidden])') && document.activeElement?.id !== 'notesArea') render(true);
    else if (!IS_WIDGET) { renderSidebar(); renderStatus(); }
  });
  api.on('notes:changed', (text) => {
    S.notes = text;
    const ta = $('#notesArea');
    if (ta && document.activeElement !== ta) ta.value = text;
  });
  api.on('icons:updated', () => {
    S.iconVer++;
    S.items.forEach((i) => { i.hasIcon = true; });
    $$('img[src^="haven://icon/"]').forEach((img) => { img.src = img.src.replace(/\?v=.*/, '?v=hd'); });
  });
  api.on('scan:state', (on) => { S.scanning = on; renderStatus(); });
  api.on('theme:wallpaper', (p) => {
    S.wall = p;
    applyTheme();
    if (S.settings.accentMode !== 'custom') toast('New wallpaper — colors updated');
  });
  api.on('focus-search', () => { closeMenu(); if ($('#modalBack').hidden) { search.focus(); search.select(); } });
  api.on('open-settings', () => openSettings());
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
}

async function reorder(target, id, beforeId) {
  const move = (arr) => {
    const a = arr.filter((x) => x !== id);
    a.splice(Math.max(0, a.indexOf(beforeId)), 0, id);
    return a;
  };
  if (target === 'favorites') { ingest(await api.setFavorites(move(S.favorites))); render(); }
  else if (target.startsWith('group:')) {
    const groups = structuredClone(S.groups);
    const g = groups.find((x) => x.id === target.slice(6));
    if (g) { g.items = move(g.items); await saveGroups(groups); }
  }
}

function arrowNav(key) {
  const els = $$('#content [data-id], #content [data-ri]');
  if (!els.length) return;
  const cur = document.activeElement?.closest?.('#content [data-id], #content [data-ri]');
  if (!cur) return els[0].focus();
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestD = Infinity;
  for (const el of els) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const dx = x - cx, dy = y - cy;
    const ok = key === 'ArrowRight' ? dx > 4 && Math.abs(dy) < r.height / 2 : key === 'ArrowLeft' ? dx < -4 && Math.abs(dy) < r.height / 2
      : key === 'ArrowDown' ? dy > 4 : dy < -4;
    if (!ok) continue;
    const d = key === 'ArrowDown' || key === 'ArrowUp' ? Math.abs(dy) * 3 + Math.abs(dx) : Math.abs(dx);
    if (d < bestD) { bestD = d; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
}

async function doAct(act, el) {
  if (act === 'addFiles' || act === 'addToGroup') addPaths(await api.pick('file'));
  else if (act === 'addFolders') addPaths(await api.pick('folder'));
  else if (act === 'addLink') addLinkFlow();
  else if (act === 'editGroup') editGroup(el.dataset.gid);
  else if (act === 'rescan') { toast('Rescanning your PC…'); ingest(await api.rescan()); render(); toast(`Library updated · ${S.items.filter((i) => !i.transient).length} items`); }
}

// Panel window: show just the requested dialog, filling the window.
function openPanelDialog() {
  applyTheme();
  const arg = QS.get('arg') || '';
  if (S.wrec) S.view = S.wrec.view; // so "add link" etc. target the widget's group
  const open = {
    settings: () => openSettings(arg || undefined),
    customize: () => customizePanel(arg || undefined),
    layouts: () => layoutsPanel(),
    rename: () => renameItem(arg),
    args: () => editArgs(arg),
    link: () => { if (arg) S.view = arg; addLinkFlow(); },
    group: () => { const [g, item] = arg.split('|'); editGroup(g || null, item || undefined); },
  }[PANEL];
  if (open) open(); else api.closePanel();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modalBack').hidden) api.closePanel(); });
}

// ================================================================ boot
(async function boot() {
  bind();
  ingest(await api.get());
  if (IS_PANEL) { openPanelDialog(); return; }
  render();
  watchGeometry();
  bindDrag();
  window.addEventListener('resize', applyInk);
  if (IS_WIDGET) { bindGrip(); return; }
  bindGrip();
  tickClock();
  setInterval(tickClock, 5000);
  if (!S.onboarded) setTimeout(welcome, 400);
  $('#search').focus();
})();

// ================================================================ browser preview (no Electron)
function createMockApi() {
  const games = [[1245620, 'ELDEN RING'], [1091500, 'Cyberpunk 2077'], [413150, 'Stardew Valley'], [292030, 'The Witcher 3: Wild Hunt'], [730, 'Counter-Strike 2'], [1145360, 'Hades'], [367520, 'Hollow Knight'], [1086940, "Baldur's Gate 3"]];
  const now = Date.now();
  const items = [
    ...['Spotify', 'Discord', 'Visual Studio Code', 'Google Chrome', 'Firefox', 'OBS Studio', 'Notion', 'Figma', 'Blender', 'Photoshop', 'Steam', 'Epic Games Launcher', 'Calculator', 'Terminal', 'Settings', 'File Explorer', 'Slack', 'Zoom', 'VLC media player', 'Paint', 'Microsoft Word', 'Excel', 'Audacity', '7-Zip']
      .map((n, i) => ({ id: 'a' + i, name: n, originalName: n, type: 'app', source: 'startmenu', path: `C:\\Program Files\\${n}\\${n}.exe`, launches: i < 6 ? 10 - i : 0, lastLaunched: i < 6 ? now - i * 3e6 : 0 })),
    ...games.map(([id, n], i) => ({ id: 'steam-' + id, name: n, originalName: n, type: 'game', source: 'steam', appid: String(id), cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`, hero: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`, launches: i < 3 ? 5 : 0, lastLaunched: i < 3 ? now - (i + 1) * 864e5 : 0 })),
    { id: 'xg', name: 'Minecraft Launcher', originalName: 'Minecraft Launcher', type: 'game', source: 'store' },
    ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'].map((n) => ({ id: 'f-' + n, name: n, originalName: n, type: 'folder', source: 'system', path: 'C:\\Users\\you\\' + n })),
    ...['Q4 Report.docx', 'budget-2026.xlsx', 'trip-itinerary.pdf', 'resume_final_v3.pdf', 'notes.md', 'invoice-1042.pdf'].map((n, i) => ({ id: 'r' + i, name: n, originalName: n, type: 'file', source: 'recent', transient: true, recentAt: now - i * 7e6, path: 'C:\\Users\\you\\Documents\\' + n })),
    ...[['YouTube', 'https://youtube.com'], ['Gmail', 'https://mail.google.com'], ['GitHub', 'https://github.com'], ['Reddit', 'https://reddit.com']].map(([n, u], i) => ({ id: 'l' + i, name: n, originalName: n, type: 'link', source: 'user', url: u })),
  ];
  const st = { items, favorites: ['a0', 'a1', 'a2', 'steam-1245620', 'l0', 'f-Downloads'], groups: [{ id: 'g1', name: 'Creative', emoji: '🎨', color: '#f472b6', items: ['a7', 'a8', 'a9', 'a5'] }, { id: 'g2', name: 'Work', emoji: '💼', color: '#60a5fa', items: ['a6', 'a16', 'a17', 'a20', 'a21'] }], notes: '', onboarded: true, settings: { displayName: 'Alex', accent: '#8b5cf6', theme: 'dark', glass: false, tileSize: 96, hotkey: 'Ctrl+Alt+Space', sort: 'smart', sources: {}, clock24: false } };
  const snap = () => structuredClone(st);
  const ok = async () => snap();
  return {
    get: ok, rescan: ok, launch: async () => ({ ok: true }), reveal: async () => true, copyPath: async () => true,
    setMeta: async (id, p) => { const it = st.items.find((i) => i.id === id); Object.assign(it, p); if (p.customName) it.name = p.customName; return snap(); },
    remove: async (id) => { st.items.find((i) => i.id === id).hidden = true; return snap(); },
    addPaths: ok, addLink: async (d) => { st.items.push({ id: 'l' + Date.now(), name: d.name || d.url, type: 'link', url: d.url, source: 'user' }); return snap(); },
    setFavorites: async (f) => { st.favorites = f; return snap(); }, setGroups: async (g) => { st.groups = g; return snap(); },
    setNotes: async (n) => { st.notes = n; }, setSettings: async (p) => { Object.assign(st.settings, p); return snap(); }, setOnboarded: async () => {},
    pick: async () => [], exportData: async () => true, importData: async () => null, openDataFolder: () => {}, openUrl: (u) => window.open(u),
    pathForFile: () => '', minimize() {}, maximize() {}, hide() {}, quit() {}, on() {},
  };
}
