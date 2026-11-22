// Haven Studio (main process): creative desktop widgets (clocks, dates, text…) + the Studio editor window.
const { BrowserWindow, ipcMain, screen, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

function setup(d) {
  const { store, save, desktop, webPrefs, makeLogo, dataDir, getWallpaper, live, withDialog } = d;
  const wins = new Map();
  const FONT_DIR = path.join(dataDir, 'fonts');
  let editor = null, editingId = null;
  store.studio = Array.isArray(store.studio) ? store.studio : [];
  const S = () => store.settings;
  const recOf = (id) => store.studio.find((r) => r.id === id);
  const fontsList = () => (S().customFonts || []).map((f) => ({ family: f.family, url: 'haven://font/' + encodeURIComponent(f.file) }));
  const stateFor = (rec) => ({ rec: pub(rec), wallpaper: getWallpaper(), customFonts: fontsList(), locked: !!S().lockPosition, editing: editingId === rec.id });
  const pub = ({ bounds, ...r }) => r;

  // ------------------------------------------------------------ placement
  // Anchors keep a widget pinned relative to the nearest screen edge (or the exact center), so it stays
  // put when its content grows, when you change resolution, or when scaling changes.
  const MARGIN = 10; // + the page's own 14px padding ≈ 24px from the edge
  function displayFor(rec, b) {
    const all = screen.getAllDisplays();
    return all.find((x) => x.id === rec.display) || (b ? screen.getDisplayMatching(b) : screen.getPrimaryDisplay());
  }
  function anchorFrom(b, a) {
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, ax = a.x + a.width / 2, ay = a.y + a.height / 2;
    const h = Math.abs(cx - ax) <= 4 ? { h: 'center', dx: 0 } : cx < ax ? { h: 'left', dx: b.x - a.x } : { h: 'right', dx: a.x + a.width - (b.x + b.width) };
    const v = Math.abs(cy - ay) <= 4 ? { v: 'middle', dy: 0 } : cy < ay ? { v: 'top', dy: b.y - a.y } : { v: 'bottom', dy: a.y + a.height - (b.y + b.height) };
    return { ...h, ...v };
  }
  function boundsFor(rec, size) {
    const disp = displayFor(rec, rec.bounds);
    const a = disp.workArea, an = rec.anchor || { h: 'center', dx: 0, v: 'top', dy: 40 };
    const x = an.h === 'left' ? a.x + an.dx : an.h === 'right' ? a.x + a.width - an.dx - size.width : a.x + (a.width - size.width) / 2 + an.dx;
    const y = an.v === 'top' ? a.y + an.dy : an.v === 'bottom' ? a.y + a.height - an.dy - size.height : a.y + (a.height - size.height) / 2 + an.dy;
    return { x: Math.round(x), y: Math.round(y), width: Math.round(size.width), height: Math.round(size.height) };
  }
  function place(rec) {
    const w = wins.get(rec.id);
    if (!w || w.isDestroyed()) return;
    const b = w.getBounds();
    const nb = boundsFor(rec, { width: rec.size ? rec.size.width : b.width, height: rec.size ? rec.size.height : b.height });
    w.__placing = true;
    w.setBounds(nb);
    w.__placing = false;
    rec.bounds = nb;
    save();
  }

  // ------------------------------------------------------------ windows
  function create(rec) {
    const float = rec.layer === 'float';
    const size = rec.size || { width: 360, height: 200 };
    const b = rec.bounds && rec.size ? rec.bounds : boundsFor(rec, size);
    const w = new BrowserWindow({
      ...b, frame: false, show: false, skipTaskbar: true, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: float,
      icon: makeLogo(64), title: 'Haven Studio widget', webPreferences: webPrefs,
    });
    w.__float = float;
    w.__studio = rec.id;
    w.loadFile(path.join(__dirname, 'renderer', 'studio.html'), { query: { sid: rec.id } });
    w.once('ready-to-show', () => {
      w.showInactive();
      if (float) { w.setAlwaysOnTop(true, 'floating'); if (rec.clickThrough) w.setIgnoreMouseEvents(true); }
      else desktop.pin(w, true);
      w.setMovable(!S().lockPosition);
    });
    w.on('moved', () => {
      if (w.__placing || w.isDestroyed()) return;
      const nb = w.getBounds();
      const disp = screen.getDisplayMatching(nb);
      rec.display = disp.id;
      rec.anchor = anchorFrom(nb, disp.workArea);
      rec.bounds = nb;
      save();
    });
    if (!float) {
      w.on('focus', () => setTimeout(() => { if (!w.isDestroyed() && !d.isDragging(w)) desktop.sendToBottom(w); }, 30));
      w.on('blur', () => setTimeout(() => { if (!w.isDestroyed() && !w.isFocused()) desktop.sendToBottom(w); }, 120));
    }
    w.on('minimize', () => setTimeout(() => { if (!w.isDestroyed()) { w.restore(); if (!float) desktop.sendToBottom(w); } }, 50));
    w.on('close', (e) => { if (!d.isQuitting() && !w.__removing) e.preventDefault(); });
    w.on('closed', () => { if (wins.get(rec.id) === w) wins.delete(rec.id); });
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    wins.set(rec.id, w);
    return w;
  }
  function destroy(id) {
    const w = wins.get(id);
    if (w && !w.isDestroyed()) { w.__removing = true; w.destroy(); }
    wins.delete(id);
  }
  function recreate(id) { const rec = recOf(id); destroy(id); if (rec) create(rec); }
  function push(rec) {
    const w = wins.get(rec.id);
    if (w && !w.isDestroyed()) w.webContents.send('studio:design', stateFor(rec));
  }
  const pushAll = () => store.studio.forEach(push);
  function notifyEditor() { if (editor && !editor.isDestroyed()) editor.webContents.send('studio:state', editorState()); }

  function add({ design, layer, anchor } = {}) {
    const rec = {
      id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      design, layer: layer === 'float' ? 'float' : 'desktop', clickThrough: false,
      anchor: anchor || { h: 'center', dx: (store.studio.length % 4) * 30, v: 'top', dy: 40 + (store.studio.length % 4) * 30 },
      display: screen.getPrimaryDisplay().id,
    };
    store.studio.push(rec);
    create(rec);
    save();
    notifyEditor();
    return rec;
  }
  function remove(id) {
    destroy(id);
    store.studio = store.studio.filter((r) => r.id !== id);
    if (editingId === id) editingId = null;
    save();
    notifyEditor();
  }

  // ------------------------------------------------------------ editor window
  function editorState() {
    return {
      widgets: store.studio.map(pub), designs: S().studioDesigns || [], customFonts: fontsList(), wallpaper: getWallpaper(),
      wallpaperURL: wallpaperPreviewURL(), live: { ...live.DEFAULTS, ...(S().live || {}) }, liveStatus: live.status(), editingId,
    };
  }
  function wallpaperPreviewURL() {
    const f = desktop.wallpaperFile();
    if (!f) return null;
    try { const copy = path.join(dataDir, 'studio-wallpaper.img'); fs.copyFileSync(f, copy); return 'haven://studio-wall/' + fs.statSync(f).mtimeMs; } catch { return null; }
  }
  function openEditor({ tab, id } = {}) {
    if (editor && !editor.isDestroyed()) {
      editor.show(); editor.focus();
      editor.webContents.send('studio:select', { tab, id });
      return;
    }
    const a = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1240, a.width - 60), height = Math.min(820, a.height - 60);
    editor = new BrowserWindow({
      width, height, x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2), minWidth: 900, minHeight: 600,
      frame: false, show: false, backgroundColor: '#0e0e16', icon: makeLogo(256), title: 'Haven Studio', webPreferences: webPrefs,
    });
    editor.loadFile(path.join(__dirname, 'renderer', 'studio-editor.html'), { query: { tab: tab || 'widgets', id: id || '' } });
    editor.once('ready-to-show', () => { editor.show(); editor.focus(); });
    editor.on('closed', () => { editor = null; const was = editingId; editingId = null; const r = recOf(was); if (r) push(r); });
    editor.webContents.on('will-navigate', (e) => e.preventDefault());
    editor.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  }

  // ------------------------------------------------------------ fonts
  let systemFonts = null;
  function listSystemFonts() {
    if (systemFonts) return Promise.resolve(systemFonts);
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "Add-Type -AssemblyName System.Drawing; [Console]::OutputEncoding=[Text.Encoding]::UTF8; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }"],
      { windowsHide: true, timeout: 20000, maxBuffer: 4 << 20 }, (err, out) => {
        systemFonts = err ? [] : [...new Set(String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y));
        resolve(systemFonts);
      });
    });
  }

  // ------------------------------------------------------------ IPC
  ipcMain.handle('studio:get', (_, id) => { const r = recOf(id); return r ? stateFor(r) : null; });
  ipcMain.handle('studio:state', () => editorState());
  ipcMain.handle('studio:add', (_, opts) => pub(add(opts || {})));
  ipcMain.handle('studio:remove', (_, id) => { remove(id); return true; });
  ipcMain.handle('studio:update', (_, id, patch = {}) => {
    const rec = recOf(id);
    if (!rec) return null;
    let rebuild = false;
    if (patch.design) rec.design = patch.design;
    if (patch.layer && patch.layer !== rec.layer) { rec.layer = patch.layer; if (rec.layer !== 'float') rec.clickThrough = false; rebuild = true; }
    if ('clickThrough' in patch) {
      rec.clickThrough = !!patch.clickThrough && rec.layer === 'float';
      const w = wins.get(id);
      if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(rec.clickThrough);
    }
    save();
    if (rebuild) recreate(id); else push(rec);
    notifyEditor();
    return pub(rec);
  });
  ipcMain.handle('studio:place', (_, id, h, v) => {
    const rec = recOf(id);
    if (!rec) return null;
    rec.anchor = { h, v, dx: h === 'center' ? 0 : MARGIN + 14, dy: v === 'middle' ? 0 : v === 'top' ? MARGIN + 30 : MARGIN + 14 };
    if (!rec.display) rec.display = screen.getPrimaryDisplay().id;
    place(rec);
    notifyEditor();
    return pub(rec);
  });
  // The page measured its content: size the window to it, keeping the anchor.
  ipcMain.handle('studio:fit', (_, id, w, h) => {
    const rec = recOf(id);
    if (!rec || !(w > 0 && h > 0)) return;
    const size = { width: Math.max(40, Math.min(4000, w)), height: Math.max(30, Math.min(3000, h)) };
    if (rec.size && rec.size.width === size.width && rec.size.height === size.height && rec.bounds) return;
    rec.size = size;
    place(rec);
  });
  ipcMain.handle('studio:editing', (_, id) => {
    const prev = editingId;
    editingId = id || null;
    for (const x of [prev, editingId]) { const r = recOf(x); if (r) push(r); }
  });
  ipcMain.on('studio:open', (_, opts) => openEditor(opts || {}));
  ipcMain.handle('studio:saveDesign', (_, design) => {
    const list = S().studioDesigns || [];
    const i = list.findIndex((x) => x.id === design.id);
    const item = { ...design, id: design.id || 'D' + Date.now().toString(36) };
    if (i >= 0) list[i] = item; else list.push(item);
    S().studioDesigns = list;
    save();
    notifyEditor();
    return item;
  });
  ipcMain.handle('studio:deleteDesign', (_, id) => { S().studioDesigns = (S().studioDesigns || []).filter((x) => x.id !== id); save(); notifyEditor(); return true; });
  ipcMain.handle('studio:export', async (_, design) => {
    const r = await withDialog(() => dialog.showSaveDialog(editor, { defaultPath: (design.name || 'widget').replace(/[^\w -]+/g, '') + '.havenwidget', filters: [{ name: 'Haven widget', extensions: ['havenwidget'] }] }));
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, JSON.stringify({ haven: 'widget', version: 1, design }, null, 1));
    return true;
  });
  ipcMain.handle('studio:import', async () => {
    const r = await withDialog(() => dialog.showOpenDialog(editor, { filters: [{ name: 'Haven widget', extensions: ['havenwidget', 'json'] }], properties: ['openFile'] }));
    if (r.canceled) return null;
    try {
      const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const design = data && data.design;
      if (!design || !Array.isArray(design.elements)) throw new Error('Not a Haven widget file');
      return { design };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('studio:systemFonts', () => listSystemFonts());
  ipcMain.handle('studio:addFont', async () => {
    const r = await withDialog(() => dialog.showOpenDialog(editor, { title: 'Add a font file', filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }], properties: ['openFile', 'multiSelections'] }));
    if (r.canceled) return null;
    fs.mkdirSync(FONT_DIR, { recursive: true });
    const list = S().customFonts || [];
    const added = [];
    for (const p of r.filePaths) {
      const file = path.basename(p).replace(/[^\w.\- ]+/g, '_');
      fs.copyFileSync(p, path.join(FONT_DIR, file));
      const family = path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').replace(/\b(Regular|Normal)\b/i, '').trim();
      if (!list.some((f) => f.family === family)) list.push({ family, file });
      added.push(family);
    }
    S().customFonts = list;
    save();
    pushAll();
    notifyEditor();
    return { added, customFonts: fontsList() };
  });
  // Live wallpaper
  ipcMain.handle('live:set', (_, patch) => {
    S().live = { ...live.DEFAULTS, ...(S().live || {}), ...patch };
    save();
    const st = live.update();
    notifyEditor();
    d.onLiveChanged && d.onLiveChanged();
    return { live: S().live, status: st };
  });
  ipcMain.handle('live:pick', async (_, kind) => {
    const filters = kind === 'video' ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv'] }] : [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'] }];
    const r = await withDialog(() => dialog.showOpenDialog(editor, { title: kind === 'video' ? 'Choose a video' : 'Choose an image or GIF', filters, properties: ['openFile'] }));
    return r.canceled ? null : r.filePaths[0];
  });

  return {
    wins, create, destroy, recreate, pushAll, openEditor, notifyEditor,
    createAll() { for (const r of store.studio) create(r); },
    replaceAll() { for (const r of store.studio) place(r); },
    lockAll(lock) { for (const w of wins.values()) if (!w.isDestroyed()) w.setMovable(!lock); pushAll(); },
    fontDir: FONT_DIR,
    wallpaperFile: () => path.join(dataDir, 'studio-wallpaper.img'),
    stopClickThrough() { for (const r of store.studio) if (r.clickThrough) { r.clickThrough = false; const w = wins.get(r.id); if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(false); } save(); notifyEditor(); },
    hasClickThrough: () => store.studio.some((r) => r.clickThrough),
  };
}

module.exports = { setup };
