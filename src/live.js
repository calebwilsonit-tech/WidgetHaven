// Live wallpaper: one window per display, parented behind the desktop icons, running an animated
// scene, a looping video, or an image/GIF. Pauses itself when a game/fullscreen app is in front.
const { BrowserWindow, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const DEFAULTS = {
  enabled: false,
  source: 'scene',      // 'scene' | 'video' | 'image'
  scene: 'aurora',
  video: null,          // file path
  image: null,          // file path
  fit: 'cover',         // 'cover' | 'contain'
  colors: 'wallpaper',  // 'wallpaper' | 'custom'
  c1: '#7c3aed', c2: '#22d3ee',
  speed: 100, intensity: 100, fps: 30,
  displays: 'all',      // 'all' | 'primary'
  pauseFullscreen: true, pauseMaximized: false, pauseOnBattery: true,
  muted: true,
};

function setup({ getSettings, getWallpaper, desktop, webPrefs, dataDir, log }) {
  const wins = new Map(); // display id -> window
  let paused = false, pollTimer = null, retryTimer = null, lastError = null, mode = null;

  const cfg = () => ({ ...DEFAULTS, ...(getSettings().live || {}) });
  function wallpaperURL() {
    const f = desktop.wallpaperFile();
    if (!f) return null;
    try {
      const copy = path.join(dataDir, 'live-wallpaper.img');
      fs.copyFileSync(f, copy);
      return pathToFileURL(copy).toString() + '?t=' + fs.statSync(f).mtimeMs;
    } catch { return null; }
  }
  function payload() {
    const c = cfg(), w = getWallpaper() || {};
    return {
      ...c,
      c1: c.colors === 'wallpaper' && w.accent ? w.accent : c.c1,
      c2: c.colors === 'wallpaper' && (w.accent2 || w.accent) ? (w.accent2 || w.accent) : c.c2,
      videoURL: c.video && fs.existsSync(c.video) ? pathToFileURL(c.video).toString() : null,
      imageURL: c.image && fs.existsSync(c.image) ? pathToFileURL(c.image).toString() : null,
      wallpaperURL: wallpaperURL(),
      paused,
    };
  }

  // Physical-pixel rects relative to the virtual screen origin (what the wallpaper host uses).
  function physDisplays() {
    const ds = screen.getAllDisplays().map((d) => ({ d, p: screen.dipToScreenRect(null, d.bounds) }));
    const ox = Math.min(...ds.map((x) => x.p.x)), oy = Math.min(...ds.map((x) => x.p.y));
    return ds.map(({ d, p }) => ({ id: d.id, primary: d.id === screen.getPrimaryDisplay().id, dip: d.bounds, abs: p, rel: { x: p.x - ox, y: p.y - oy, width: p.width, height: p.height } }));
  }

  function start() {
    stopWindows();
    const c = cfg();
    if (!c.enabled) return status();
    lastError = null;
    const targets = physDisplays().filter((d) => c.displays === 'all' || d.primary);
    for (const t of targets) {
      const w = new BrowserWindow({
        x: t.dip.x, y: t.dip.y, width: t.dip.width, height: t.dip.height, frame: false, show: false, skipTaskbar: true, focusable: false,
        resizable: false, movable: false, minimizable: false, maximizable: false, hasShadow: false, backgroundColor: '#000000',
        title: 'Haven live wallpaper', webPreferences: { ...webPrefs, backgroundThrottling: false },
      });
      w.setIgnoreMouseEvents(true);
      w.loadFile(path.join(__dirname, 'renderer', 'live.html'), { query: { display: String(t.id) } });
      w.once('ready-to-show', () => {
        const r = desktop.attachToWallpaper(w, t.rel);
        if (!r.ok) { lastError = r.error; log && log('live wallpaper attach failed: ' + r.error); w.destroy(); return; }
        mode = r.mode;
        w.__host = r.parent;
        w.showInactive();
        w.webContents.send('live:config', payload());
      });
      // Explorer restarting destroys the wallpaper host (and our window with it): bring it back.
      w.on('closed', () => {
        if (wins.get(t.id) === w) { wins.delete(t.id); if (!w.__stopping && cfg().enabled) { clearTimeout(retryTimer); retryTimer = setTimeout(start, 3000); } }
      });
      wins.set(t.id, w);
    }
    startPolling();
    return status();
  }
  function stopWindows() {
    const had = wins.size > 0;
    for (const w of wins.values()) if (!w.isDestroyed()) { w.__stopping = true; w.destroy(); }
    wins.clear();
    if (had) setTimeout(() => desktop.refreshWallpaper(), 150);
  }
  function stop() { clearInterval(pollTimer); pollTimer = null; stopWindows(); }

  // ------------------------------------------------------------ pausing
  function setPaused(p) {
    if (p === paused) return;
    paused = p;
    for (const w of wins.values()) if (!w.isDestroyed()) w.webContents.send('live:pause', paused);
  }
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      const c = cfg();
      if (!wins.size) return;
      // A dead host (Explorer restarted) → rebuild.
      for (const w of wins.values()) if (w.__host && !desktop.isWindowAlive(w.__host)) { start(); return; }
      let p = false;
      if (c.pauseOnBattery && powerMonitor.isOnBatteryPower && powerMonitor.isOnBatteryPower()) p = true;
      const fg = desktop.foregroundState(physDisplays().map((d) => d.abs));
      if (fg && !fg.desktop && fg.pid !== process.pid) {
        if (c.pauseFullscreen && fg.fullscreen) p = true;
        if (c.pauseMaximized && fg.maximized) p = true;
      }
      setPaused(p);
    }, 1500);
  }
  powerMonitor.on('lock-screen', () => setPaused(true));
  powerMonitor.on('unlock-screen', () => setPaused(false));

  function update() {
    const c = cfg();
    if (!c.enabled) { stop(); return status(); }
    // Display choice changed or nothing running → rebuild; otherwise just push the new config.
    const want = physDisplays().filter((d) => c.displays === 'all' || d.primary).length;
    if (wins.size !== want) return start();
    const p = payload();
    for (const w of wins.values()) if (!w.isDestroyed()) w.webContents.send('live:config', p);
    return status();
  }
  // The page also asks for its config once it has loaded (a message sent while attaching can be lost).
  require('electron').ipcMain.handle('live:get', () => payload());

  function status() { return { running: wins.size > 0, paused, mode, error: lastError }; }

  screen.on('display-added', () => cfg().enabled && start());
  screen.on('display-removed', () => cfg().enabled && start());
  screen.on('display-metrics-changed', () => cfg().enabled && setTimeout(start, 500));

  return { start, stop, update, status, payload, DEFAULTS };
}

module.exports = { setup, DEFAULTS };
