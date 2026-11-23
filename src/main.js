const {
  app, BrowserWindow, ipcMain, shell, globalShortcut, Tray, Menu, nativeImage,
  dialog, protocol, net, screen, clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { spawn, execFile } = require('child_process');
const scanner = require('./scanner');
const desktop = require('./desktop');
const snap = require('./snap');
const liveMod = require('./live');
const studioMod = require('./studio-main');
const barMod = require('./bar');
const themesMod = require('./themes');
const tilerMod = require('./tiler');
const launcherMod = require('./launcher');
let studio = null, live = null, bar = null, themes = null, tiler = null, launcher = null;
let wallpaper = null;

app.setAppUserModelId('app.haven.organizer');
protocol.registerSchemesAsPrivileged([
  { scheme: 'haven', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------------------------------------------------------------- store
const DATA_DIR = app.getPath('userData');
const STORE_FILE = path.join(DATA_DIR, 'haven.json');
const ICON_DIR = path.join(DATA_DIR, 'icons');
fs.mkdirSync(ICON_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  displayName: (os.userInfo().username || '').replace(/^./, (c) => c.toUpperCase()),
  mode: 'widget',          // 'widget' = lives on the desktop; 'window' = normal app window
  lockPosition: false,
  accent: '#8b5cf6',
  accentMode: 'wallpaper', // 'wallpaper' | 'custom'
  theme: 'wallpaper',      // 'wallpaper' | 'dark' | 'light' | 'system'
  glass: true,
  opacity: 72,             // background opacity %, 0 = fully see-through
  scale: 100,              // whole-UI zoom %, text + icons + buttons
  plates: 'subtle',        // text backing when see-through: 'off' | 'subtle' | 'solid'
  border: 'hover',         // widget outline: 'none' | 'hover' | 'always'
  plateColor: null,        // backing/button color when see-through: null = auto, 'accent', or hex
  tint: null,              // background wash color: null = theme, or hex
  customLooks: [],         // [{id, name, look:{opacity, glass, plates, scale, tileSize}}]
  customLayouts: [],       // [{id, name, widgets:[{view, r:[x,y,w,h] (fractions), look}]}]
  snap: { ...snap.DEFAULTS },
  hubVisible: true,
  tileSize: 92,
  hotkey: 'Ctrl+Alt+Space',
  launchAtStartup: true,
  hideOnLaunch: false,
  hideOnBlur: false,
  alwaysOnTop: false,
  closeToTray: true,
  showHidden: false,
  clock24: false,
  showRecent: true,        // "Jump back in" / "Continue playing" on Home and the Favorites widget
  sort: 'smart',
  sources: { startmenu: true, steam: true, epic: true, store: true, desktop: true, recent: true },
  studioDesigns: [],       // saved Studio widget designs
  customFonts: [],         // [{family, file}] font files added in Studio
  live: { ...liveMod.DEFAULTS },
  bar: { ...barMod.DEFAULTS },
  themeId: 'auto',         // Haven theme: 'auto' follows the wallpaper
  customThemes: [],        // saved themes
  themeOpts: { windowsMode: false },
  desktopThemes: {},       // virtual desktop id -> theme id
  barTaskbar: {},          // remembers the taskbar's auto-hide state while the bar manages it
  hubSolid: true,          // the main Haven window stays opaque even when widgets are see-through
  lookSync: 'off',         // 'off' | 'widgets' (desktop widgets match the bar) | 'bar' (the bar matches the widgets)
  widgetRadius: null,      // corner roundness for widgets (px), set when widgets match the bar
  widgetFont: null,        // font for widgets, set when widgets match the bar
  tiler: { ...tilerMod.DEFAULTS },
  launcher: { ...launcherMod.DEFAULTS },
};

function loadStore() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch {}
  return {
    items: s.items || {},           // user-added items + per-item meta for scanned ones
    favorites: s.favorites || [],   // ordered ids
    groups: s.groups || [],         // [{id,name,emoji,color,items:[ids]}]
    notes: s.notes || '',
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}), sources: { ...DEFAULT_SETTINGS.sources, ...((s.settings || {}).sources || {}) }, snap: { ...snap.DEFAULTS, ...((s.settings || {}).snap || {}) }, live: { ...liveMod.DEFAULTS, ...((s.settings || {}).live || {}) }, bar: { ...barMod.DEFAULTS, ...((s.settings || {}).bar || {}) } },
    window: s.window || null,
    widgetWindow: s.widgetWindow || null,
    widgets: Array.isArray(s.widgets) ? s.widgets : [], // [{id, view, opacity, glass, tileSize, bounds}]
    studio: Array.isArray(s.studio) ? s.studio : [],    // Studio widgets: [{id, design, layer, anchor, size, bounds}]
    onboarded: !!s.onboarded,
  };
}
let store = loadStore();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
    fs.renameSync(tmp, STORE_FILE);
  }, 250);
}
function saveNow() { clearTimeout(saveTimer); try { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 1)); } catch {} }

// ---------------------------------------------------------------- library
let scanned = [];
let library = new Map();
let scanning = false;

const META_KEYS = ['customName', 'hidden', 'launches', 'lastLaunched', 'typeOverride', 'args', 'pinned', 'added'];
function buildLibrary() {
  const lib = new Map();
  for (const it of scanned) lib.set(it.id, { ...it });
  for (const [id, rec] of Object.entries(store.items)) {
    if (rec.user) lib.set(id, { ...(lib.get(id) || {}), ...rec, transient: false });
    else if (lib.has(id)) {
      const base = lib.get(id);
      for (const k of META_KEYS) if (rec[k] !== undefined) base[k] = rec[k];
      if (rec.pinned) base.transient = false;
    }
  }
  library = lib;
  return lib;
}
function publicItems() {
  return [...library.values()].map((it) => ({
    ...it,
    name: it.customName || it.name,
    originalName: it.name,
    type: it.typeOverride || it.type,
    baseType: it.type,
    hasIcon: iconReady.has(it.id),
  }));
}
function meta(id) { return (store.items[id] = store.items[id] || {}); }

async function rescan(notify = true) {
  if (scanning) return;
  scanning = true;
  send('scan:state', true);
  try { scanned = await scanner.scanAll(store.settings.sources); } catch (e) { console.error(e); }
  scanning = false;
  buildLibrary();
  send('scan:state', false);
  if (notify) send('lib:changed', snapshot());
  queueIcons();
}

function snapshot() {
  return {
    items: publicItems(),
    favorites: store.favorites,
    groups: store.groups,
    settings: store.settings,
    notes: store.notes,
    onboarded: store.onboarded,
    scanning,
    wallpaper,
    widgets: store.widgets.map(({ bounds, ...w }) => w),
    version: app.getVersion(),
    packaged: app.isPackaged,
    pinAvailable: desktop.available(),
    platform: process.platform,
  };
}

// ---------------------------------------------------------------- icons
const iconReady = new Set(fs.readdirSync(ICON_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
const iconFailed = new Set();
let iconJob = null;

function iconSource(it) {
  if (it.iconFile) return null; // steam art handled directly
  if (it.aumid) return 'shell:AppsFolder\\' + it.aumid;
  return it.iconTarget || it.path || null;
}

function queueIcons() {
  if (iconJob) return;
  const todo = [...library.values()].filter((it) => !iconReady.has(it.id) && !iconFailed.has(it.id) && iconSource(it));
  if (!todo.length) return;
  const listFile = path.join(DATA_DIR, 'icon-queue.txt');
  fs.writeFileSync(listFile, todo.map((it) => `${it.id}\t${iconSource(it)}`).join('\n'), 'utf8');
  const script = path.join(__dirname, 'icons.ps1').replace('app.asar', 'app.asar.unpacked');
  iconJob = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-List', listFile, '-Out', ICON_DIR],
    { windowsHide: true, timeout: 240000 }, () => {
      iconJob = null;
      for (const it of todo) {
        if (fs.existsSync(path.join(ICON_DIR, it.id + '.png'))) iconReady.add(it.id);
        else iconFailed.add(it.id);
      }
      send('icons:updated', [...iconReady]);
    });
}

async function serveIcon(id) {
  const it = library.get(id);
  if (!it) return new Response('', { status: 404 });
  if (it.iconFile && fs.existsSync(it.iconFile)) return net.fetch(pathToFileURL(it.iconFile).toString());
  const cached = path.join(ICON_DIR, id + '.png');
  if (iconReady.has(id) && fs.existsSync(cached)) return net.fetch(pathToFileURL(cached).toString());
  const src = iconSource(it);
  if (src && !src.startsWith('shell:')) {
    try {
      const img = await app.getFileIcon(src, { size: 'large' });
      if (!img.isEmpty()) return new Response(img.toPNG(), { headers: { 'content-type': 'image/png' } });
    } catch {}
  }
  return new Response('', { status: 404 });
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;
function registerProtocol() {
  protocol.handle('haven', async (req) => {
    const u = new URL(req.url);
    if (u.hostname === 'icon') return serveIcon(u.pathname.slice(1));
    if (u.hostname === 'file') {
      const p = u.searchParams.get('p');
      if (p && IMG_EXT.test(p) && fs.existsSync(p)) return net.fetch(pathToFileURL(p).toString());
      return new Response('', { status: 404 });
    }
    if (u.hostname === 'font' && studio) {
      const f = path.join(studio.fontDir, path.basename(decodeURIComponent(u.pathname.slice(1))));
      if (fs.existsSync(f)) return net.fetch(pathToFileURL(f).toString());
      return new Response('', { status: 404 });
    }
    if (u.hostname === 'studio-wall' && studio) {
      const f = studio.wallpaperFile();
      if (fs.existsSync(f)) return new Response(fs.readFileSync(f), { headers: { 'content-type': 'image/jpeg' } });
      return new Response('', { status: 404 });
    }
    if (u.hostname === 'thumb') {
      // Image previews for picture files in the Files view.
      const p = u.searchParams.get('p');
      try {
        const img = await nativeImage.createThumbnailFromPath(p, { width: 256, height: 256 });
        return new Response(img.toPNG(), { headers: { 'content-type': 'image/png' } });
      } catch { return new Response('', { status: 404 }); }
    }
    return new Response('', { status: 404 });
  });
}

// ---------------------------------------------------------------- launching
function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

async function launch(id, opts = {}) {
  const it = library.get(id);
  if (!it) return { ok: false, error: 'Item not found' };
  desktop.allowForeground();
  try {
    if (it.url) {
      await shell.openExternal(it.url);
    } else if (it.aumid) {
      spawn('explorer.exe', ['shell:AppsFolder\\' + it.aumid], { detached: true, stdio: 'ignore' }).unref();
    } else if (it.path) {
      if (!fs.existsSync(it.path)) return { ok: false, error: 'That file no longer exists' };
      const args = (it.args || '').trim();
      if (opts.admin || args) {
        let cmd = `Start-Process -FilePath ${psQuote(it.path)}`;
        if (args) cmd += ` -ArgumentList ${psQuote(args)}`;
        if (opts.admin) cmd += ' -Verb RunAs';
        spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } else {
        const err = await shell.openPath(it.path);
        if (err) return { ok: false, error: err };
      }
    } else return { ok: false, error: 'Nothing to launch' };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }

  const m = meta(id);
  m.launches = (m.launches || 0) + 1;
  m.lastLaunched = Date.now();
  if (it.transient) { /* opening a recent file doesn't pin it */ }
  save();
  buildLibrary();
  send('lib:changed', snapshot());
  // Launched apps must open on top: drop every desktop widget beneath them now and again shortly after.
  hubSummoned = false;
  keepWidgetsDown();
  setTimeout(keepWidgetsDown, 700);
  if (store.settings.hideOnLaunch && win) { if (isWidget() && store.settings.hubVisible !== false) desktop.sendToBottom(win); else win.hide(); }
  return { ok: true };
}

// ---------------------------------------------------------------- adding things
function addPaths(paths, opts = {}) {
  const added = [];
  for (const p of paths) {
    if (!p || !fs.existsSync(p)) continue;
    const isDir = fs.statSync(p).isDirectory();
    const it = scanner.fileItem(p, isDir, 'user');
    if (/\.url$/i.test(p)) {
      try {
        const url = (fs.readFileSync(p, 'utf8').match(/^URL=(.+)$/m) || [])[1];
        if (url) { it.url = url.trim(); it.type = /^steam:|^com\.epicgames/i.test(url) ? 'game' : 'link'; it.name = path.basename(p, '.url'); }
      } catch {}
    }
    if (opts.type) it.type = opts.type;
    store.items[it.id] = { ...(store.items[it.id] || {}), ...it, user: true, transient: false, added: Date.now() };
    added.push(it.id);
  }
  finishAdd(added, opts);
  return added;
}
function addLink({ name, url, groupId, favorite }) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  const id = 'u-' + scanner.hash(url + Date.now());
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  store.items[id] = { id, name: name || host || url, type: 'link', url, host, source: 'user', user: true, added: Date.now() };
  finishAdd([id], { groupId, favorite });
  return id;
}
function finishAdd(ids, { groupId, favorite } = {}) {
  if (!ids.length) return;
  if (groupId) {
    const g = store.groups.find((x) => x.id === groupId);
    if (g) for (const id of ids) if (!g.items.includes(id)) g.items.push(id);
  }
  if (favorite) for (const id of ids) if (!store.favorites.includes(id)) store.favorites.push(id);
  save();
  buildLibrary();
  send('lib:changed', snapshot());
  queueIcons();
}

// ---------------------------------------------------------------- window
let win = null;
let tray = null;
let dialogOpen = false;
async function withDialog(fn) { dialogOpen = true; try { return await fn(); } finally { dialogOpen = false; } }
let quitting = false;

const HUB_ONLY = new Set(['focus-search', 'open-settings', 'win:maximized']);
function send(ch, data) {
  if (HUB_ONLY.has(ch)) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); return; }
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, data);
}
const broadcast = () => send('lib:changed', snapshot());

// Desktop widgets always stay beneath normal app windows — even right after you click one.
// The hub is exempt only while summoned with the hotkey.
let hubSummoned = false;
function keepWidgetsDown() {
  for (const w of widgetWins.values()) if (!w.isDestroyed() && w.isVisible()) desktop.sendToBottom(w);
  if (studio) for (const w of studio.wins.values()) if (!w.isDestroyed() && !w.__float && w.isVisible() && !dragging.has(w.id)) desktop.sendToBottom(w);
  if (win && !win.isDestroyed() && isWidget() && !hubSummoned && win.isVisible()) desktop.sendToBottom(win);
}
setInterval(() => { if (!dialogOpen && !dragging.size) keepWidgetsDown(); }, 1200);
const WEB_PREFS = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true };

// ---------------------------------------------------------------- snapping + smart guides
const snapOpts = () => ({ ...snap.DEFAULTS, ...(store.settings.snap || {}) });
const dragging = new Map(); // window id -> { zone }
let overlay = null;
function ensureOverlay() {
  if (overlay && !overlay.isDestroyed()) return overlay;
  overlay = new BrowserWindow({
    frame: false, transparent: true, show: false, skipTaskbar: true, focusable: false, resizable: false, movable: false,
    alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000', title: 'Haven guides', webPreferences: WEB_PREFS,
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.__ready = false;
  overlay.webContents.once('did-finish-load', () => {
    overlay.__ready = true;
    if (lastOverlay) overlay.webContents.send('overlay:draw', lastOverlay); // replay a frame sent while loading
  });
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  return overlay;
}
let lastOverlay = null;
function accentNow() {
  return store.settings.accentMode !== 'custom' && wallpaper && wallpaper.accent ? wallpaper.accent : store.settings.accent || '#8b5cf6';
}
function drawOverlay(area, data) {
  const ov = ensureOverlay();
  if (!data) { lastOverlay = null; if (ov.isVisible()) { ov.webContents.send('overlay:draw', null); ov.hide(); } return; }
  const b = ov.getBounds();
  if (b.x !== area.x || b.y !== area.y || b.width !== area.width || b.height !== area.height) ov.setBounds(area);
  lastOverlay = { ...data, origin: { x: area.x, y: area.y }, accent: accentNow() };
  if (ov.__ready) ov.webContents.send('overlay:draw', lastOverlay);
  if (!ov.isVisible()) ov.showInactive();
}
// Rects of every other visible desktop widget (and the hub when it lives on the desktop).
function otherRects(self) {
  const list = [...widgetWins.values(), ...(studio ? studio.wins.values() : [])];
  if (win && isWidget()) list.push(win);
  return list.filter((w) => w !== self && !w.isDestroyed() && w.isVisible()).map((w) => w.getBounds());
}
function snapHint(o) { return [o.zones === 'shift' ? 'Hold <b>Shift</b> for zones' : null, 'Hold <b>Alt</b> to place freely'].filter(Boolean).join(' · '); }

// Widgets are dragged by Haven itself (not the Windows move loop): every frame the raw position is
// computed straight from the cursor (cursor − grab offset), then snapped. Because snapping never
// feeds back into the raw position, the widget can't drift away from the cursor or get "stuck".
function startDrag(w) {
  if (!w || w.isDestroyed() || store.settings.lockPosition || dragging.has(w.id)) return;
  const start = w.getBounds(), c0 = screen.getCursorScreenPoint();
  const off = { x: c0.x - start.x, y: c0.y - start.y };
  const st = { zone: null, moved: false, last: null, size: { width: start.width, height: start.height } };
  dragging.set(w.id, st);
  const tick = () => {
    if (w.isDestroyed()) return endDrag(w);
    // Mouse released anywhere (even outside the window) ends the drag.
    if (!desktop.keyDown('lbutton') && st.started) return endDrag(w);
    st.started = true;
    const c = screen.getCursorScreenPoint();
    const raw = { x: c.x - off.x, y: c.y - off.y, width: start.width, height: start.height };
    // Keep a grabbable strip on screen: at least 80px wide and the whole title bar height.
    const vb = screen.getDisplayNearestPoint(c).workArea;
    raw.x = Math.min(Math.max(raw.x, vb.x - start.width + 80), vb.x + vb.width - 80);
    raw.y = Math.min(Math.max(raw.y, vb.y), vb.y + vb.height - 60);
    if (!st.moved && Math.abs(raw.x - start.x) + Math.abs(raw.y - start.y) < 3) return; // ignore clicks
    if (!st.moved) { st.moved = true; w.moveTop(); } // lift above other windows while dragging
    const o = snapOpts();
    const area = screen.getDisplayNearestPoint(c).workArea;
    let target = raw;
    st.zone = null;
    if (!o.enabled || desktop.keyDown('alt')) {
      drawOverlay(area, o.enabled ? { hint: 'Placing freely' } : null);
    } else if (o.zones === 'shift' && desktop.keyDown('shift')) {
      const zones = snap.zoneRects({ x: area.x + o.gap / 2, y: area.y + o.gap / 2, width: area.width - o.gap, height: area.height - o.gap }, o.zoneSet, o.gap);
      const i = snap.zoneAt(c, zones);
      st.zone = i >= 0 ? zones[i] : null;
      drawOverlay(area, { zones, activeZone: i, hint: i >= 0 ? 'Release to drop into this zone' : 'Move over a zone' });
    } else {
      const r = snap.snapMove(raw, otherRects(w), area, o);
      target = r.bounds;
      drawOverlay(area, { guides: o.guides ? r.guides : [], hint: snapHint(o) });
    }
    const key = `${target.x},${target.y}`;
    if (key !== st.last) { st.last = key; desktop.moveTo(w, target.x, target.y); } // position only — size can't drift
  };
  st.timer = setInterval(tick, 8);
}
function endDrag(w) {
  const st = dragging.get(w.id);
  if (!st) return;
  clearInterval(st.timer);
  dragging.delete(w.id);
  drawOverlay(null, null);
  if (w.isDestroyed()) return;
  if (st.zone) w.setBounds(st.zone);
  else if (st.moved) {
    // Belt and braces: if anything nudged the size during the drag, put it back.
    const b = w.getBounds();
    if (b.width !== st.size.width || b.height !== st.size.height) w.setSize(st.size.width, st.size.height);
  }
  if (st.moved) { w.emit('moved'); if (st.zone) w.emit('resized'); }
  setTimeout(() => { if (!w.isDestroyed() && !w.isFocused() && !w.__float) desktop.sendToBottom(w); }, 60);
}
ipcMain.on('drag:start', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && (w !== win || isWidget())) startDrag(w);
});
ipcMain.on('drag:end', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) endDrag(w); });

function attachSnapping() { /* drags are handled by startDrag(); kept for call-site compatibility */ }

// ---------------------------------------------------------------- split widgets
const widgetWins = new Map();
const widgetGlass = (rec) => (rec.glass === null || rec.glass === undefined ? store.settings.glass : rec.glass);

function createWidgetWindow(rec) {
  const glass = widgetGlass(rec);
  const bounds = boundsVisible(rec.bounds) ? rec.bounds : cascadeBounds();
  const w = new BrowserWindow({
    ...bounds, minWidth: 260, minHeight: 200, frame: false, show: false, skipTaskbar: true,
    transparent: !glass, backgroundColor: '#00000000', backgroundMaterial: glass ? 'acrylic' : 'none',
    minimizable: false, maximizable: false, icon: makeLogo(64), title: 'Haven widget', webPreferences: WEB_PREFS,
  });
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { widget: rec.id } });
  w.once('ready-to-show', () => { w.showInactive(); desktop.pin(w, true); lockWin(w); const r = store.settings.widgetRadius; if (r != null && r < 8) desktop.setCorners(w, false); });
  const persist = () => { const r = store.widgets.find((x) => x.id === rec.id); if (r && !w.isDestroyed() && !w.__refit) { r.bounds = w.getBounds(); rememberFrac(r, r.bounds); save(); } };
  w.on('moved', persist);
  w.on('resized', persist);
  attachSnapping(w);
  w.on('focus', () => setTimeout(() => { if (!w.isDestroyed() && !dialogOpen && !dragging.has(w.id)) desktop.sendToBottom(w); }, 30));
  w.on('blur', () => setTimeout(() => { if (!w.isDestroyed() && !w.isFocused() && !dialogOpen) desktop.sendToBottom(w); }, 120));
  w.on('minimize', () => setTimeout(() => { if (!w.isDestroyed()) { w.restore(); desktop.sendToBottom(w); } }, 50));
  w.on('close', (e) => { if (!quitting && !w.__removing) e.preventDefault(); });
  w.on('closed', () => { if (widgetWins.get(rec.id) === w) widgetWins.delete(rec.id); });
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  widgetWins.set(rec.id, w);
  return w;
}
function destroyWidgetWindow(id) {
  const w = widgetWins.get(id);
  if (w && !w.isDestroyed()) { w.__removing = true; w.removeAllListeners('close'); w.destroy(); }
  widgetWins.delete(id);
}
function recreateWidget(id) {
  const rec = store.widgets.find((x) => x.id === id);
  const old = widgetWins.get(id);
  if (old && !old.isDestroyed()) rec.bounds = old.getBounds();
  destroyWidgetWindow(id);
  if (rec) createWidgetWindow(rec);
}
function lockWin(w) {
  const lock = !!store.settings.lockPosition;
  w.setMovable(!lock);
  w.setResizable(!lock);
}
function cascadeBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const n = store.widgets.length;
  return { width: 420, height: 460, x: wa.x + 40 + (n % 6) * 36, y: wa.y + 40 + (n % 6) * 36 };
}
// accent: hex | 'wallpaper' | null (inherit); plateColor: hex | 'accent' | null (auto); tint: hex | null (theme)
const LOOK_KEYS = ['opacity', 'glass', 'tileSize', 'scale', 'plates', 'border', 'accent', 'plateColor', 'tint'];
function addWidget(view, bounds, look = {}) {
  const rec = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), view, bounds: bounds || cascadeBounds() };
  for (const k of LOOK_KEYS) rec[k] = look[k] ?? null;
  store.widgets.push(rec);
  createWidgetWindow(rec);
  return rec;
}
// Lay the main tabs out as a tidy grid of widgets across the desktop.
function splitIntoWidgets() { applyLayout(PRESET_LAYOUTS[0]); }
// ---------------------------------------------------------------- layout presets
// Rects are fractions [x, y, w, h] of the desktop's "safe" area (keeps clear of the usual
// desktop-icon columns on the left and right edges).
const PRESET_LAYOUTS = [
  { id: 'grid', name: 'Grid', desc: 'Six tabs in a tidy 3 × 2 grid', widgets: [
    ['home', [0, 0, .32, .48]], ['apps', [.34, 0, .32, .48]], ['games', [.68, 0, .32, .48]],
    ['files', [0, .52, .32, .48]], ['folders', [.34, .52, .32, .48]], ['links', [.68, .52, .32, .48]]] },
  { id: 'column', name: 'Side column', desc: 'Stacked on the right, center stays clear', widgets: [
    ['home', [.7, 0, .3, .3]], ['apps', [.7, .32, .3, .36]], ['games', [.7, .7, .3, .3]]] },
  { id: 'dock', name: 'Bottom dock', desc: 'A row along the bottom of the screen', widgets: [
    ['home', [0, .64, .19, .36]], ['apps', [.2025, .64, .19, .36]], ['games', [.405, .64, .19, .36]], ['folders', [.6075, .64, .19, .36]], ['links', [.81, .64, .19, .36]]] },
  { id: 'gamer', name: 'Gamer', desc: 'Big game library, quick favorites + apps', widgets: [
    ['games', [.22, 0, .5, 1]], ['home', [.74, 0, .26, .48]], ['apps', [.74, .52, .26, .48]]] },
  { id: 'focus', name: 'Focus', desc: 'Favorites, files and notes for getting work done', widgets: [
    ['home', [.62, 0, .38, .32]], ['files', [.62, .34, .38, .34]], ['notes', [.62, .7, .38, .3]]] },
  { id: 'corner', name: 'Corner', desc: 'One compact favorites widget, top right', widgets: [['home', [.72, 0, .28, .42]]] },
  // Edge layouts hug the screen edges and leave the middle of the wallpaper completely clear.
  { id: 'frame', edge: true, name: 'Frame the center', desc: 'Both edges — your wallpaper stays the star', widgets: [
    ['home', [0, 0, .2, .49]], ['apps', [0, .51, .2, .49]], ['games', [.8, 0, .2, .62]], ['files', [.8, .64, .2, .36]]] },
  { id: 'rightRail', edge: true, name: 'Right edge', desc: 'A slim rail down the right side', widgets: [
    ['home', [.79, 0, .21, .31]], ['apps', [.79, .33, .21, .34]], ['games', [.79, .69, .21, .31]]] },
  { id: 'leftRail', edge: true, name: 'Left edge', desc: 'A slim rail down the left side', widgets: [
    ['home', [0, 0, .21, .31]], ['apps', [0, .33, .21, .34]], ['games', [0, .69, .21, .31]]] },
  { id: 'split', edge: true, name: 'Split edges', desc: 'Everyday stuff left, play right', widgets: [
    ['home', [0, 0, .19, .32]], ['folders', [0, .34, .19, .32]], ['links', [0, .68, .19, .32]],
    ['games', [.81, 0, .19, .66]], ['apps', [.81, .68, .19, .32]]] },
  { id: 'cornersEdge', edge: true, name: 'Four corners', desc: 'Small widgets tucked into each corner', widgets: [
    ['home', [0, 0, .2, .36]], ['apps', [.8, 0, .2, .36]], ['folders', [0, .64, .2, .36]], ['games', [.8, .64, .2, .36]]] },
];
// Full screen width minus a small margin (edge layouts sit right at the sides).
function edgeArea() {
  const wa = screen.getPrimaryDisplay().workArea, m = 12;
  return { x: wa.x + m, y: wa.y + m, width: wa.width - m * 2, height: wa.height - m * 2 };
}
function safeArea() {
  const wa = screen.getPrimaryDisplay().workArea;
  const l = Math.round(Math.min(230, wa.width * .12)), r = Math.round(Math.min(170, wa.width * .09)), t = 16, b = 16;
  return { x: wa.x + l, y: wa.y + t, width: wa.width - l - r, height: wa.height - t - b };
}
function applyLayout(def) {
  const a = def.edge ? edgeArea() : safeArea();
  // Carry each tab's look (opacity, scale…) over to its new spot.
  const looks = Object.fromEntries(store.widgets.map((w) => [w.view, Object.fromEntries(LOOK_KEYS.map((k) => [k, w[k]]))]));
  for (const r of [...store.widgets]) destroyWidgetWindow(r.id);
  store.widgets = [];
  for (const w of def.widgets) {
    const [view, rc, look] = Array.isArray(w) ? w : [w.view, w.r, w.look];
    const valid = view.startsWith('group:') ? store.groups.some((g) => 'group:' + g.id === view) : true;
    if (!valid) continue;
    addWidget(view, {
      x: Math.round(a.x + rc[0] * a.width), y: Math.round(a.y + rc[1] * a.height),
      width: Math.max(260, Math.round(rc[2] * a.width)), height: Math.max(200, Math.round(rc[3] * a.height)),
    }, look || looks[view] || {});
  }
  store.settings.hubVisible = false;
  if (win) win.hide();
  save();
  broadcast();
}
function saveLayout(name) {
  const a = safeArea();
  const widgets = store.widgets.map((w) => {
    const b = (widgetWins.get(w.id) && !widgetWins.get(w.id).isDestroyed()) ? widgetWins.get(w.id).getBounds() : w.bounds;
    return { view: w.view, r: [(b.x - a.x) / a.width, (b.y - a.y) / a.height, b.width / a.width, b.height / a.height].map((n) => Math.round(n * 1000) / 1000), look: Object.fromEntries(LOOK_KEYS.map((k) => [k, w[k]])) };
  });
  store.settings.customLayouts = [...(store.settings.customLayouts || []), { id: 'L' + Date.now().toString(36), name: name || 'My layout', widgets }];
  save();
  broadcast();
}

function mergeWidgets() {
  for (const r of [...store.widgets]) destroyWidgetWindow(r.id);
  store.widgets = [];
  store.settings.hubVisible = true;
  save();
  toggleWindow(true);
  broadcast();
}
function recreateHub() {
  const old = win;
  if (old && !old.isDestroyed()) { if (isWidget()) store.widgetWindow = old.getBounds(); else store.window = old.getBounds(); }
  win = null;
  createWindow();
  if (old && !old.isDestroyed()) { old.removeAllListeners(); old.destroy(); }
}

function makeLogo(size) {
  // Procedural app icon: violet→cyan rounded square with a 2×2 tile grid.
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.24;
  const inRound = (x, y, x0, y0, x1, y1, rad) => {
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad), cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  };
  const pad = size * 0.25, gap = size * 0.07, cell = (size - pad * 2 - gap) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (!inRound(x + 0.5, y + 0.5, 0, 0, size, size, r)) continue;
    const t = (x + y) / (2 * size);
    let R = 139 + (34 - 139) * t, G = 92 + (211 - 92) * t, B = 246 + (238 - 246) * t;
    for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
      const x0 = pad + cx * (cell + gap), y0 = pad + cy * (cell + gap);
      if (inRound(x + 0.5, y + 0.5, x0, y0, x0 + cell, y0 + cell, cell * 0.28)) {
        const a = cx === 1 && cy === 1 ? 0.55 : 0.95;
        R = R + (255 - R) * a; G = G + (255 - G) * a; B = B + (255 - B) * a;
      }
    }
    buf[i] = B; buf[i + 1] = G; buf[i + 2] = R; buf[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const isWidget = () => store.settings.mode === 'widget';
function defaultBounds(widget) {
  const wa = screen.getPrimaryDisplay().workArea;
  if (widget) {
    const width = Math.min(820, wa.width - 48), height = Math.min(700, wa.height - 48);
    return { width, height, x: wa.x + wa.width - width - 24, y: wa.y + 24 };
  }
  const width = Math.min(1180, wa.width - 80), height = Math.min(760, wa.height - 80);
  return { width, height, x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2) };
}
function boundsVisible(b) {
  return b && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 10 && b.y < a.y + a.height - 60;
  });
}
function savedBounds(widget) {
  const b = widget ? store.widgetWindow : store.window;
  return boundsVisible(b) ? b : defaultBounds(widget);
}

function applyMode() {
  if (!win) return;
  const widget = isWidget();
  win.setSkipTaskbar(widget);
  win.setMinimizable(!widget);
  win.setMovable(!(widget && store.settings.lockPosition));
  win.setResizable(!(widget && store.settings.lockPosition));
  if (widget) win.setAlwaysOnTop(false);
  desktop.pin(win, widget);
}
function setMode(mode) {
  if (!win) return;
  const prevWidget = isWidget();
  store.settings.mode = mode;
  if (prevWidget !== isWidget()) {
    if (!win.isMaximized()) { if (prevWidget) store.widgetWindow = win.getBounds(); else store.window = win.getBounds(); }
    if (win.isMaximized()) win.unmaximize();
    win.setBounds(savedBounds(isWidget()));
  }
  applyMode();
}

function createWindow() {
  const s = store.settings;
  const b = savedBounds(isWidget());
  win = new BrowserWindow({
    ...b,
    minWidth: 520,
    minHeight: 420,
    frame: false,
    show: false,
    skipTaskbar: isWidget(),
    transparent: !s.glass,
    backgroundColor: '#00000000',
    backgroundMaterial: s.glass ? 'acrylic' : 'none',
    alwaysOnTop: s.alwaysOnTop,
    icon: makeLogo(256),
    title: 'Haven',
    webPreferences: WEB_PREFS,
  });
  const me = win;
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    // Widget mode always shows (it lives on the desktop); window mode respects --hidden at login.
    if (me !== win) return;
    if (s.hubVisible === false) { applyMode(); return; }
    if (isWidget()) { win.showInactive(); applyMode(); }
    else if (!process.argv.includes('--hidden')) { win.show(); win.focus(); }
  });
  const persist = () => {
    if (win.isMaximized() || win.isMinimized()) return;
    if (isWidget()) store.widgetWindow = win.getBounds(); else store.window = win.getBounds();
    save();
  };
  win.on('moved', persist);
  win.on('resized', persist);
  attachSnapping(win, () => isWidget());
  win.on('maximize', () => send('win:maximized', true));
  win.on('unmaximize', () => send('win:maximized', false));
  win.on('blur', () => {
    if (dialogOpen || win.webContents.isDevToolsOpened()) return;
    hubSummoned = false;
    if (isWidget()) { setTimeout(() => { if (win && !win.isFocused()) desktop.sendToBottom(win); }, 120); return; }
    if (store.settings.hideOnBlur) win.hide();
  });
  win.on('close', (e) => {
    if (!quitting && (store.settings.closeToTray || isWidget())) { e.preventDefault(); if (!isWidget()) win.hide(); }
  });
  // Show Desktop (Win+D) can still minimize some windows — a widget should never stay minimized.
  win.on('minimize', () => { if (isWidget()) setTimeout(() => { win.restore(); desktop.sendToBottom(win); }, 50); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function toggleWindow(force) {
  if (!win) return;
  const show = force !== undefined ? force : !(win.isVisible() && win.isFocused());
  if (show) {
    if (win.isMinimized()) win.restore();
    hubSummoned = true;
    win.show();
    win.moveTop();
    win.focus();
    send('focus-search');
  } else if (isWidget() && store.settings.hubVisible !== false) {
    win.blur();
    desktop.sendToBottom(win); // widget goes back to the desktop instead of disappearing
  } else win.hide();
}

let currentHotkey = null;
function applyHotkey(acc) {
  if (currentHotkey) { try { globalShortcut.unregister(currentHotkey); } catch {} currentHotkey = null; }
  if (!acc) return true;
  try {
    const ok = globalShortcut.register(acc, () => toggleWindow());
    if (ok) currentHotkey = acc;
    return ok;
  } catch { return false; }
}

function applySettings(prev) {
  const s = store.settings;
  // Square widgets (matching a square bar) also lose Windows 11's rounded window corners.
  const roundCorners = s.widgetRadius == null || s.widgetRadius >= 8; // Windows rounds by 8px; smaller corners need it off
  for (const w of widgetWins.values()) if (!w.isDestroyed()) desktop.setCorners(w, roundCorners);
  if (!win) return;
  if (prev && (prev.mode !== s.mode || prev.lockPosition !== s.lockPosition)) {
    const next = s.mode;
    s.mode = prev.mode;
    setMode(next);
  }
  win.setAlwaysOnTop(!isWidget() && !!s.alwaysOnTop);
  if (prev && prev.lockPosition !== s.lockPosition) { for (const w of widgetWins.values()) if (!w.isDestroyed()) lockWin(w); if (studio) studio.lockAll(!!s.lockPosition); }
  // Blur on/off needs a new native window (acrylic vs. truly transparent).
  if (prev && prev.glass !== s.glass) {
    recreateHub();
    for (const r of store.widgets) if (r.glass === null || r.glass === undefined) recreateWidget(r.id);
  }
  if (prev && prev.hubVisible !== s.hubVisible) { if (s.hubVisible === false) win.hide(); else toggleWindow(true); }
  if (app.isPackaged || !prev || prev.launchAtStartup !== s.launchAtStartup) {
    try {
      app.setLoginItemSettings({ openAtLogin: !!s.launchAtStartup, args: app.isPackaged ? ['--hidden'] : [path.resolve(process.argv[1] || '.'), '--hidden'] });
    } catch {}
  }
}

function buildTray() {
  tray = new Tray(makeLogo(32));
  tray.setToolTip('Haven');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Haven', click: () => toggleWindow(true) },
    { label: 'Rescan library', click: () => rescan() },
    { label: 'Settings', click: () => { toggleWindow(true); send('open-settings'); } },
    { type: 'separator' },
    { label: 'Haven Studio…', click: () => studio.openEditor({ tab: 'widgets' }) },
    { label: 'Haven Bar   (Ctrl+Alt+B)', type: 'checkbox', checked: !!(store.settings.bar && store.settings.bar.enabled), click: (m) => bar.set({ enabled: m.checked }) },
    { label: 'Tile windows (beta)   Ctrl+Alt+P pauses', type: 'checkbox', checked: !!(tiler && tiler.cfg().enabled), click: (m) => tiler.set({ enabled: m.checked }) },
    tiler && tiler.movedAway() ? { label: 'Bring back windows Haven moved', click: () => tiler.bringBack() } : null,
    tiler && tiler.cfg().enabled ? { label: 'Focus mode   Ctrl+Alt+Z', type: 'checkbox', checked: tiler.focused(), click: () => tiler.toggleFocus() } : null,
    { label: 'App launcher (Win+S)', type: 'checkbox', checked: !!(launcher && launcher.cfg().enabled), click: (m) => launcher.set({ enabled: m.checked }) },
    { label: 'Theme', submenu: [...themes.all().map((t) => ({ label: t.name, type: 'radio', checked: t.id === themes.currentId(), click: () => themes.apply(t.id) })), { type: 'separator' }, { label: 'Themes…', click: () => studio.openEditor({ tab: 'themes' }) }] },
    { label: 'Live wallpaper', type: 'checkbox', checked: !!(store.settings.live && store.settings.live.enabled), click: (m) => { store.settings.live = { ...liveMod.DEFAULTS, ...store.settings.live, enabled: m.checked }; save(); live.update(); studio.notifyEditor(); } },
    studio.hasClickThrough() ? { label: 'Make floating widgets clickable again', click: () => studio.stopClickThrough() } : null,
    store.settings.bar && store.settings.bar.enabled && bar.cfg().taskbar !== 'show' ? { label: 'Show the Windows taskbar again', click: () => bar.set({ taskbar: 'show' }) } : null,
    { type: 'separator' },
    { label: 'Split into widgets', click: () => splitIntoWidgets() },
    { label: 'Merge widgets back', enabled: store.widgets.length > 0, click: () => mergeWidgets() },
    { label: 'Desktop widget', type: 'checkbox', checked: isWidget(), click: (m) => { setMode(m.checked ? 'widget' : 'window'); applySettings(); save(); send('lib:changed', snapshot()); } },
    { label: 'Lock widget positions', type: 'checkbox', checked: !!store.settings.lockPosition, click: (m) => { store.settings.lockPosition = m.checked; applyMode(); for (const w of widgetWins.values()) if (!w.isDestroyed()) lockWin(w); save(); broadcast(); } },
    { label: 'Always on top', type: 'checkbox', enabled: !isWidget(), checked: !!store.settings.alwaysOnTop, click: (m) => { store.settings.alwaysOnTop = m.checked; applySettings(); save(); send('lib:changed', snapshot()); } },
    { type: 'separator' },
    { label: 'Quit Haven', click: () => { quitting = true; app.quit(); } },
  ].filter(Boolean));
  tray.on('click', () => toggleWindow());
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('lib:get', () => snapshot());
ipcMain.handle('lib:rescan', async () => { await rescan(); return snapshot(); });
ipcMain.handle('item:launch', (_, id, opts) => launch(id, opts));
ipcMain.handle('item:reveal', (_, id) => {
  const it = library.get(id);
  if (!it) return false;
  const p = it.path || it.target;
  if (p && fs.existsSync(p)) { fs.statSync(p).isDirectory() && it.type === 'folder' ? shell.openPath(p) : shell.showItemInFolder(p); return true; }
  return false;
});
ipcMain.handle('item:copyPath', (_, id) => {
  const it = library.get(id);
  const v = it && (it.path || it.url || (it.aumid && 'shell:AppsFolder\\' + it.aumid));
  if (v) clipboard.writeText(v);
  return !!v;
});
ipcMain.handle('item:meta', (_, id, patch) => {
  const m = meta(id);
  for (const [k, v] of Object.entries(patch || {})) {
    if (!META_KEYS.includes(k)) continue;
    if (v === null || v === '' || v === false) delete m[k]; else m[k] = v;
  }
  if (!Object.keys(m).length) delete store.items[id];
  return changed();
});
// Persist, rebuild, and push the new state to every window (hub + all widgets).
function changed() { save(); buildLibrary(); broadcast(); return snapshot(); }
ipcMain.handle('item:remove', (_, id) => {
  const rec = store.items[id];
  if (rec && rec.user) delete store.items[id];
  else meta(id).hidden = true;
  store.favorites = store.favorites.filter((x) => x !== id);
  for (const g of store.groups) g.items = g.items.filter((x) => x !== id);
  return changed();
});
ipcMain.handle('item:addPaths', (_, paths, opts) => { addPaths(paths, opts); return snapshot(); });
ipcMain.handle('item:addLink', (_, data) => { addLink(data); return snapshot(); });
ipcMain.handle('favorites:set', (_, ids) => { store.favorites = ids; return changed(); });
ipcMain.handle('groups:set', (_, groups) => {
  store.groups = groups;
  // A widget showing a deleted group falls back to Favorites.
  for (const w of store.widgets) if (w.view.startsWith('group:') && !groups.some((g) => 'group:' + g.id === w.view)) w.view = 'home';
  return changed();
});
ipcMain.handle('notes:set', (e, text) => {
  store.notes = text;
  save();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('notes:changed', text);
  return true;
});
ipcMain.handle('widgets:add', (_, view) => { addWidget(view || 'home'); return changed(); });
ipcMain.handle('widgets:update', (_, id, patch) => {
  const rec = store.widgets.find((x) => x.id === id);
  if (!rec) return snapshot();
  const glassBefore = widgetGlass(rec);
  for (const k of ['view', ...LOOK_KEYS]) if (k in (patch || {})) rec[k] = patch[k];
  if (widgetGlass(rec) !== glassBefore) recreateWidget(id);
  return changed();
});
ipcMain.handle('widgets:remove', (_, id) => {
  destroyWidgetWindow(id);
  store.widgets = store.widgets.filter((x) => x.id !== id);
  if (!store.widgets.length && store.settings.hubVisible === false) { store.settings.hubVisible = true; toggleWindow(true); }
  return changed();
});
ipcMain.handle('widgets:split', () => { splitIntoWidgets(); return snapshot(); });
ipcMain.handle('widgets:merge', () => { mergeWidgets(); return snapshot(); });
ipcMain.handle('hub:show', () => { store.settings.hubVisible = true; save(); toggleWindow(true); broadcast(); });
// ---------------------------------------------------------------- menus + panels for widgets
// Widgets are small windows, and HTML menus/dialogs get clipped at their edges. So widgets use
// native Windows context menus, and open dialogs in a separate, properly sized panel window.
ipcMain.handle('menu:popup', (e, items) => new Promise((resolve) => {
  const bw = BrowserWindow.fromWebContents(e.sender);
  let done = false;
  const pick = (id) => { if (!done) { done = true; resolve(id); } };
  const build = (list) => list.map((it) => {
    if (it.sep) return { type: 'separator' };
    if (it.header) return { label: it.header, enabled: false };
    const m = { label: it.label.replace(/&/g, '&&') };
    if (it.checked) { m.type = 'checkbox'; m.checked = true; }
    if (it.sub) m.submenu = build(it.sub);
    else m.click = () => pick(it.id);
    return m;
  });
  try {
    Menu.buildFromTemplate(build(items)).popup({ window: bw, callback: () => setTimeout(() => pick(null), 50) });
  } catch { pick(null); }
}));
let panelWin = null;
ipcMain.on('panel:open', (e, kind, arg) => {
  const src = BrowserWindow.fromWebContents(e.sender);
  if (!src) return;
  const wid = (src.webContents.getURL().match(/widget=([^&]+)/) || [])[1] || '';
  if (panelWin && !panelWin.isDestroyed()) panelWin.destroy();
  const area = screen.getDisplayMatching(src.getBounds()).workArea;
  const width = Math.min(820, area.width - 40), height = Math.min(780, area.height - 40);
  panelWin = new BrowserWindow({
    width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2),
    frame: false, show: false, resizable: true, minimizable: false, maximizable: false, alwaysOnTop: true, skipTaskbar: false,
    backgroundColor: '#14141c', icon: makeLogo(64), title: 'Haven', webPreferences: WEB_PREFS,
  });
  panelWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { widget: wid, panel: kind, arg: arg || '' } });
  panelWin.once('ready-to-show', () => { panelWin.show(); panelWin.focus(); });
  panelWin.on('blur', () => { /* stay open while e.g. a color picker or file dialog is used */ });
  panelWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  panelWin.webContents.on('will-navigate', (ev) => ev.preventDefault());
});
ipcMain.on('panel:close', (e) => { const bw = BrowserWindow.fromWebContents(e.sender); if (bw && bw === panelWin) { bw.destroy(); panelWin = null; } });

ipcMain.handle('layouts:presets', () => PRESET_LAYOUTS.map(({ id, name, desc, edge, widgets }) => ({ id, name, desc, edge: !!edge, widgets: widgets.map(([view, r]) => ({ view, r })) })));
ipcMain.handle('layouts:apply', (_, id) => {
  const def = PRESET_LAYOUTS.find((l) => l.id === id) || (store.settings.customLayouts || []).find((l) => l.id === id);
  if (def) applyLayout(def);
  return snapshot();
});
ipcMain.handle('layouts:save', (_, name) => { saveLayout(name); return snapshot(); });
ipcMain.handle('layouts:delete', (_, id) => { store.settings.customLayouts = (store.settings.customLayouts || []).filter((l) => l.id !== id); return changed(); });
// Apply a look everywhere: it becomes the global default and per-widget overrides are cleared.
ipcMain.handle('look:all', (_, look) => {
  const prev = { ...store.settings };
  for (const k of LOOK_KEYS) {
    if (look[k] === undefined) continue;
    if (k === 'accent') {
      // 'wallpaper' switches everything back to wallpaper-matched accents.
      if (look.accent === 'wallpaper' || look.accent === null) store.settings.accentMode = 'wallpaper';
      else { store.settings.accent = look.accent; store.settings.accentMode = 'custom'; }
    } else if (k === 'plateColor' || k === 'tint' || look[k] !== null) store.settings[k] = look[k];
  }
  for (const w of store.widgets) {
    const glassBefore = widgetGlass(w);
    for (const k of LOOK_KEYS) w[k] = null;
    if (widgetGlass(w) !== glassBefore) recreateWidget(w.id);
  }
  applySettings(prev);
  if (store.settings.lookSync === 'bar') syncLooks();
  return changed();
});
// Window geometry in screen DIPs, so the renderer can tell which patch of wallpaper is behind it.
ipcMain.handle('win:bounds', (e) => {
  const bw = BrowserWindow.fromWebContents(e.sender);
  if (!bw) return null;
  const b = bw.getBounds();
  return { ...b, display: screen.getDisplayMatching(b).bounds };
});
// Resizing is driven from here (cursor polling) so it's smooth at any zoom and for transparent windows.
const resizing = new Map();
ipcMain.on('resize:start', (e) => {
  const bw = BrowserWindow.fromWebContents(e.sender);
  if (!bw || store.settings.lockPosition) return;
  const start = screen.getCursorScreenPoint(), b = bw.getBounds();
  clearInterval(resizing.get(bw.id));
  dragging.set(bw.id, { resize: true }); // keeps the watchdog from pushing it under other windows
  bw.moveTop();
  let started = false;
  resizing.set(bw.id, setInterval(() => {
    if (bw.isDestroyed()) return clearInterval(resizing.get(bw.id));
    // Released anywhere → finish (the page may never see pointerup if released outside it).
    if (started && !desktop.keyDown('lbutton')) { finishResize(bw); return; }
    started = true;
    const p = screen.getCursorScreenPoint();
    let nb = { x: b.x, y: b.y, width: Math.max(260, b.width + p.x - start.x), height: Math.max(200, b.height + p.y - start.y) };
    const o = snapOpts();
    const isDesktop = bw !== win || isWidget();
    if (o.enabled && isDesktop && !desktop.keyDown('alt')) {
      const area = screen.getDisplayMatching(nb).workArea;
      const r = snap.snapResize(nb, 'bottom-right', otherRects(bw), area, o);
      nb = r.bounds;
      drawOverlay(area, { guides: o.guides ? r.guides : [] });
    } else drawOverlay(null, null);
    bw.setBounds(nb);
  }, 16));
});
function finishResize(bw) {
  if (!resizing.has(bw.id)) return;
  clearInterval(resizing.get(bw.id));
  resizing.delete(bw.id);
  dragging.delete(bw.id);
  drawOverlay(null, null);
  if (bw.isDestroyed()) return;
  bw.emit('resized');
  setTimeout(() => { if (!bw.isDestroyed() && !bw.isFocused()) desktop.sendToBottom(bw); }, 60);
}
ipcMain.on('resize:end', (e) => { const bw = BrowserWindow.fromWebContents(e.sender); if (bw) finishResize(bw); });
ipcMain.handle('onboarded', () => { store.onboarded = true; save(); return true; });
ipcMain.handle('settings:set', async (_, patch) => {
  const prev = { ...store.settings };
  store.settings = { ...store.settings, ...patch };
  if (patch.snap && (patch.snap.gap ?? null) !== ((prev.snap || {}).gap ?? null)) setTimeout(refitToWorkAreas, 50);
  let hotkeyOk = true;
  if (patch.hotkey !== undefined && patch.hotkey !== prev.hotkey) {
    hotkeyOk = applyHotkey(patch.hotkey);
    if (!hotkeyOk) { store.settings.hotkey = prev.hotkey; applyHotkey(prev.hotkey); }
  }
  applySettings(prev);
  save();
  if (patch.lookSync !== undefined || (store.settings.lookSync === 'bar' && ['opacity', 'glass', 'border'].some((k) => k in patch))) syncLooks();
  if (patch.sources) rescan();
  broadcast();
  return { ...snapshot(), hotkeyOk };
});
ipcMain.handle('dialog:pick', async (_, kind) => {
  const r = await withDialog(() => dialog.showOpenDialog(win, {
    title: kind === 'folder' ? 'Add folders' : 'Add apps or files',
    properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
  }));
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('data:export', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: `haven-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Haven backup', extensions: ['json'] }] });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, JSON.stringify(store, null, 1));
  return true;
});
ipcMain.handle('data:import', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Haven backup', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!data || typeof data !== 'object' || !data.settings) throw new Error('Not a Haven backup');
    fs.writeFileSync(STORE_FILE, JSON.stringify(data));
    store = loadStore();
    applyHotkey(store.settings.hotkey);
    applySettings();
    buildLibrary();
    queueIcons();
    return snapshot();
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('data:openFolder', () => shell.openPath(DATA_DIR));
ipcMain.handle('open:url', (_, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:hide', () => win && win.hide());
ipcMain.on('win:closeSelf', (e) => { const bw = BrowserWindow.fromWebContents(e.sender); if (bw && bw !== win) bw.close(); });
ipcMain.on('win:minimizeSelf', (e) => { const bw = BrowserWindow.fromWebContents(e.sender); if (bw) bw.minimize(); });
ipcMain.on('win:quit', () => { quitting = true; app.quit(); });

// ---------------------------------------------------------------- lifecycle
app.on('second-instance', () => toggleWindow(true));
app.on('before-quit', () => { quitting = true; if (live) live.stop(); if (bar) bar.stop(); if (tiler) tiler.stop(); if (launcher) launcher.stop(); saveNow(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  registerProtocol();
  wallpaper = desktop.watchWallpaper((p) => { wallpaper = p; send('theme:wallpaper', themes.themedWallpaper()); if (live) live.update(); if (studio) studio.notifyEditor(); if (bar) bar.refresh(); });
  themes = themesMod.setup({ store, save, desktop, getWallpaper: () => wallpaper, dataDir: DATA_DIR, onApplied: themeApplied, log: console.warn });
  live = liveMod.setup({ getSettings: () => store.settings, getWallpaper: () => themes.themedWallpaper(), desktop, webPrefs: WEB_PREFS, dataDir: DATA_DIR, log: console.warn });
  studio = studioMod.setup({
    store, save, desktop, webPrefs: WEB_PREFS, makeLogo, dataDir: DATA_DIR, getWallpaper: () => themes.themedWallpaper(), live, withDialog,
    isDragging: (w) => dragging.has(w.id), isQuitting: () => quitting,
  });
  bar = barMod.setup({
    store, save, desktop, webPrefs: WEB_PREFS, makeLogo, themes, log: console.warn,
    wallpaperURL: () => studio.wallpaperURL(), customFonts: () => studio.fontsList(),
    launchItem: (id) => launch(id), toggleHub: () => toggleWindow(), openStudio: (tab) => studio.openEditor({ tab }),
    getTiler: () => tiler,
    onLook: (patch) => {
      if (store.settings.lookSync === 'widgets' && LOOK_FROM_BAR.some((k) => k in patch)) syncLooks();
      if (tiler && (store.settings.tiler || {}).corners === 'bar' && ('radius' in patch || 'style' in patch)) tiler.applyCorners();
    },
    setLive: (on) => { store.settings.live = { ...liveMod.DEFAULTS, ...store.settings.live, enabled: on }; save(); live.update(); studio.notifyEditor(); },
    // Windows shoves windows out of the bar's strip a moment after it's reserved; refit after that.
    onReserved: (() => { let ts = []; return () => { ts.forEach(clearTimeout); ts = [250, 1000, 2200].map((ms) => setTimeout(refitToWorkAreas, ms)); }; })(),
    favorites: () => store.favorites.map((id) => library.get(id)).filter(Boolean).map((it) => ({ id: it.id, name: it.customName || it.name, icon: 'haven://icon/' + encodeURIComponent(it.id) + '?v=hd' })),
  });
  screen.on('display-metrics-changed', () => {
    refitToWorkAreas();
    if (win && isWidget() && !boundsVisible(win.getBounds())) win.setBounds(defaultBounds(true));
    setTimeout(() => studio.replaceAll(), 300);
  });
  buildLibrary();
  refitToWorkAreas(); // the usable area may have changed while Haven was closed (e.g. the bar was on)
  createWindow();
  for (const rec of store.widgets) createWidgetWindow(rec);
  if (store.settings.tiler && store.settings.tiler.floatApps === 'steamwebhelper, Steam') store.settings.tiler.floatApps = '';
  tiler = tilerMod.setup({ store, save, palette: () => themes.palette(), log: console.warn, vd: { move: (h) => bar.vdMove(h), clean: (id) => bar.vdClean(id), home: (h) => bar.vdHome(h) }, barRadius: () => { const b = bar.cfg(); return b.style === 'full' ? 0 : b.radius; } });
  launcher = launcherMod.setup({
    store, save, webPrefs: WEB_PREFS, makeLogo, palette: () => themes.palette(), getFont: () => bar.cfg().font, log: console.warn,
    focusWin: (w) => desktop.focusWindow(desktop.hwndOf(w)),
    getRadius: () => { const b = bar.cfg(); return b.style === 'full' ? 0 : b.radius; },
    launchItem: (id) => launch(id),
    items: () => publicItems().filter((it) => !it.hidden).map((it) => ({ id: it.id, name: it.name, type: it.type, launches: it.launches || 0, lastLaunched: it.lastLaunched || 0, icon: 'haven://icon/' + encodeURIComponent(it.id) + '?v=hd' })),
  });
  ipcMain.handle('wm:get', () => ({ tiler: tiler.cfg(), launcher: launcher.cfg(), keys: tiler.KEYS, available: tiler.available() }));
  ipcMain.handle('wm:focus', () => tiler.toggleFocus());
  ipcMain.handle('wm:bringBack', () => tiler.bringBack());
  ipcMain.handle('wm:set', (_, which, patch) => (which === 'launcher' ? launcher.set(patch || {}) : tiler.set(patch || {})));
  studio.createAll();
  live.start();
  bar.start();
  tiler.apply();
  launcher.apply();
  ensureOverlay(); // preload the guide layer so the first drag draws instantly
  buildTray();
  applyHotkey(store.settings.hotkey);
  applySettings();
  await rescan();
  if (bar) bar.refresh();
});

// When a screen's usable area changes (the Haven Bar or the taskbar reserves or frees a strip), Windows
// shoves windows out of the way without resizing them, so tiles end up overlapping. Instead, scale every
// widget's position and size from the old usable area to the new one, keeping the layout intact.
function refitToWorkAreas() {
  // Each widget remembers where it sits as a share of its screen's usable area (rec.frac), set whenever
  // you move or resize it. When the usable area changes (the bar, the taskbar), every widget is placed from
  // that share, then the gaps are evened out: the space to the screen edges matches the space between
  // widgets (your "Gap between widgets" setting). Repeated changes never drift or overlap.
  const displays = screen.getAllDisplays();
  const dispOf = (b) => displays.find((d) => { const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height; });
  const G = Math.max(0, Math.round((snapOpts().gap ?? 12)));
  let changed = false;
  const plan = new Map(); // display id -> [{rec, r:{l,t,r,b}}]
  for (const rec of store.widgets) {
    const b = rec.bounds;
    if (!b) continue;
    const d = (rec.fracDisplay && displays.find((x) => x.id === rec.fracDisplay)) || dispOf(b);
    if (!d) continue;
    if (!rec.frac) { rememberFrac(rec, b); changed = true; }
    const a = d.workArea, f = rec.frac;
    const x = a.x + f.x * a.width, y = a.y + f.y * a.height;
    if (!plan.has(d.id)) plan.set(d.id, { a, items: [] });
    plan.get(d.id).items.push({ rec, r: { l: x, t: y, r: x + f.w * a.width, b: y + f.h * a.height } });
  }
  for (const { a, items } of plan.values()) {
    const NEAR = 48; // within this, an edge counts as "against the screen edge" or "next to a neighbour"
    const A = { l: a.x, t: a.y, r: a.x + a.width, b: a.y + a.height };
    for (const { r } of items) {
      if (Math.abs(r.l - A.l) < NEAR) r.l = A.l + G;
      if (Math.abs(r.t - A.t) < NEAR) r.t = A.t + G;
      if (Math.abs(A.r - r.r) < NEAR) r.r = A.r - G;
      if (Math.abs(A.b - r.b) < NEAR) r.b = A.b - G;
    }
    const overlap = (p, q, a1, a2) => Math.min(p[a2], q[a2]) - Math.max(p[a1], q[a1]);
    for (const p of items) for (const q of items) {
      if (p === q) continue;
      // q directly below p (sharing a column): even gap between them
      if (overlap(p.r, q.r, 'l', 'r') > 40 && q.r.t >= p.r.t && Math.abs(q.r.t - p.r.b) < NEAR) { const mid = (p.r.b + q.r.t) / 2; p.r.b = mid - G / 2; q.r.t = mid + G / 2; }
      // q directly right of p (sharing a row)
      if (overlap(p.r, q.r, 't', 'b') > 40 && q.r.l >= p.r.l && Math.abs(q.r.l - p.r.r) < NEAR) { const mid = (p.r.r + q.r.l) / 2; p.r.r = mid - G / 2; q.r.l = mid + G / 2; }
    }
    for (const { rec, r } of items) {
      const nb = { x: Math.round(r.l), y: Math.round(r.t), width: Math.max(260, Math.round(r.r - r.l)), height: Math.max(200, Math.round(r.b - r.t)) };
      const w = widgetWins.get(rec.id);
      // Compare with where the window really is: Windows may have shoved it since we last placed it.
      const cur = w && !w.isDestroyed() ? desktop.realBounds(w) : rec.bounds;
      const near = (p, q) => Math.abs(p.x - q.x) <= 1 && Math.abs(p.y - q.y) <= 1 && Math.abs(p.width - q.width) <= 2 && Math.abs(p.height - q.height) <= 2;
      if (near(nb, cur) && near(nb, rec.bounds)) continue;
      rec.bounds = nb; changed = true;
      if (w && !w.isDestroyed()) { w.__refit = true; desktop.placeNative(w, nb); setTimeout(() => { w.__refit = false; }, 400); }
    }
  }
  if (changed) save();
}
function rememberFrac(rec, b) {
  const d = screen.getDisplayMatching(b);
  const a = d.workArea;
  rec.frac = { x: (b.x - a.x) / a.width, y: (b.y - a.y) / a.height, w: b.width / a.width, h: b.height / a.height };
  rec.fracDisplay = d.id;
}

// Matching looks between the Haven Bar and the desktop widgets (colors already match through the theme).
const LOOK_FROM_BAR = ['opacity', 'glass', 'border', 'radius', 'font', 'style', 'look'];
function syncLooks() {
  const mode = store.settings.lookSync;
  if (!bar || mode === 'off' || !mode) return;
  const b = bar.cfg();
  if (mode === 'widgets') {
    // Desktop widgets take the bar's look: opacity, frosted glass, outline, corner roundness and font.
    const prev = { ...store.settings };
    Object.assign(store.settings, {
      opacity: b.opacity, glass: !!b.glass, border: b.border ? 'always' : 'none',
      widgetRadius: b.style === 'full' ? 0 : Math.min(24, b.radius), widgetFont: b.font,
    });
    for (const w of store.widgets) { const g = widgetGlass(w); for (const k of ['opacity', 'glass', 'border']) w[k] = null; if (widgetGlass(w) !== g) recreateWidget(w.id); }
    applySettings(prev);
    save();
    broadcast();
  } else if (mode === 'bar') {
    // The bar takes the widgets' look.
    const s = store.settings;
    bar.set({ opacity: Math.max(15, s.opacity ?? 72), glass: !!s.glass, border: s.border !== 'none', radius: s.widgetRadius ?? 14, font: s.widgetFont || 'Segoe UI Variable Display' }, { fromSync: true });
  }
}

// A theme was picked: recolor everything Haven draws.
function themeApplied(prev) {
  applySettings(prev);
  save();
  broadcast();
  send('theme:wallpaper', themes.themedWallpaper());
  if (studio) { studio.pushAll(); studio.notifyEditor(); }
  if (live) live.update();
  if (bar) bar.refresh();
  if (tiler) tiler.retile();
  send('theme:changed', themes.list());
}
