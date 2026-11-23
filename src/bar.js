// Haven Bar (main process): a status bar that reserves its own strip of the screen (like the taskbar),
// with desktop/workspace buttons, open apps, clock, now playing, system stats and quick buttons.
const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

const DEFAULTS = {
  enabled: false,
  position: 'top',          // 'top' | 'bottom'
  style: 'islands',         // 'islands' | 'zones' | 'floating' | 'full'
  height: 34, gap: 8, radius: 12, opacity: 80, glass: true, border: true, shadow: true, glow: false,
  font: 'Space Grotesk', fontSize: 13,
  displays: 'primary',      // 'primary' | 'all'
  hideTaskbar: false,       // (old setting, replaced by taskbar)
  trayHost: false,          // experimental: show real tray icons in the panel (breaks the bar's reserved strip for now)
  taskbar: 'show',          // Windows taskbar while the bar is on: 'show' | 'autohide' | 'hidden'
  look: 'solid',            // see LOOKS in bar.css
  upper: false, sep: '',
  shortcuts: true,          // Ctrl+Alt+1…9 desktops, Ctrl+Alt+B bar, Ctrl+Alt+T next theme
  left: ['launcher', 'workspaces', 'tasks'],
  center: ['clock'],
  right: ['media', 'bgapps', 'system', 'volume', 'network', 'battery', 'notify', 'power'],
  clock: { time: 'h:mm', date: 'ddd MMM d', showDate: true },
  workspaces: { style: 'numbers', labels: [], showAdd: true, highlightOccupied: true },
  tasks: { labels: false, maxLabel: 18 },
  media: { maxWidth: 240 },
  window: { maxWidth: 360 },
};
const MODULES = [
  ['launcher', 'Haven button', 'Opens Haven. Right-click for the Start menu.'],
  ['workspaces', 'Desktops', 'Your virtual desktops as buttons. Scroll to flip between them.'],
  ['tasks', 'Open apps', 'Apps open on this desktop. Click to switch, middle-click to close.'],
  ['window', 'Active window', 'The title of the window you are using.'],
  ['pins', 'Pinned', 'Your Haven favorites, one click to launch.'],
  ['clock', 'Clock', 'Time and date. Click for the calendar.'],
  ['media', 'Now playing', 'Music or video playing anywhere. Click to pause.'],
  ['system', 'CPU & memory', 'How busy your PC is.'],
  ['volume', 'Volume', 'Scroll to change, click to mute.'],
  ['network', 'Network', 'Wi-Fi or Ethernet. Click for quick settings.'],
  ['battery', 'Battery', 'Only shows on laptops.'],
  ['theme', 'Theme', 'Switch themes right from the bar.'],
  ['bgapps', 'Background apps', 'Apps running in the background (like the hidden icons on the taskbar). Click to open or quit them.'],
  ['tray', 'Tray icons', 'Opens the Windows hidden icons.'],
  ['notify', 'Notifications', 'Opens the notification center.'],
  ['quick', 'Quick settings', 'Wi-Fi, Bluetooth, brightness…'],
  ['power', 'Power', 'Lock, sleep, restart or shut down.'],
];
const ZONES = ['left', 'center', 'right'];
const CB_MSG = 0x8000 + 0x2A; // WM_APP + n: app bar notifications
const VK = { ctrl: 0x11, win: 0x5B, alt: 0x12, left: 0x25, right: 0x27, d: 0x44, f4: 0x73, a: 0x41, n: 0x4E, b: 0x42, enter: 0x0D, esc: 0x1B };

function setup(d) {
  const { store, save, desktop, webPrefs, makeLogo, themes, wallpaperURL, customFonts, launchItem, toggleHub, openStudio, favorites, onTaskbar, onReserved, log } = d;
  const S = () => store.settings;
  const cfg = () => {
    const b = { ...DEFAULTS, ...(S().bar || {}) };
    if (!(S().bar || {}).taskbar && b.hideTaskbar) b.taskbar = 'autohide';
    for (const k of ['clock', 'workspaces', 'tasks', 'media', 'window']) b[k] = { ...DEFAULTS[k], ...((S().bar || {})[k] || {}) };
    for (const z of ZONES) b[z] = (Array.isArray(b[z]) ? b[z] : DEFAULTS[z]).filter((m) => MODULES.some(([id]) => id === m));
    return b;
  };
  const wins = new Map(); // display id -> window
  let helper = null, helperBuf = '', helperRestart = null, lastLine = '';
  let sys = { windows: [], desktops: { list: [], current: null }, volume: null, media: null };
  let stats = { cpu: 0, mem: 0, net: { online: true, kind: 'ethernet', ssid: null, signal: null } };
  const icons = new Map(); // exe path -> data URL ('' while loading)
  let statTimer = null, netTimer = null, fsTimer = null, lastDesktop = null;

  // ------------------------------------------------------------ system helper (windows, desktops, volume, media)
  function startHelper() {
    if (helper) return;
    const script = path.join(__dirname, 'native', 'sysinfo.ps1').replace('app.asar', 'app.asar.unpacked');
    try {
      helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) { log && log('bar helper failed: ' + e.message); helper = null; return; }
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', (chunk) => {
      helperBuf += chunk;
      let i;
      while ((i = helperBuf.indexOf('\n')) >= 0) {
        const line = helperBuf.slice(0, i).trim();
        helperBuf = helperBuf.slice(i + 1);
        if (!line) continue;
        if (line.startsWith('{"reply"')) {
          try { const o = JSON.parse(line); const ws = waiters[o.reply] || []; waiters[o.reply] = []; ws.forEach((f) => f(o.data)); } catch {}
          continue;
        }
        if (line !== lastLine) { lastLine = line; try { ingest(JSON.parse(line)); } catch {} }
      }
    });
    helper.on('exit', () => {
      helper = null;
      if (wins.size || keepHelper) { clearTimeout(helperRestart); helperRestart = setTimeout(startHelper, 3000); }
    });
  }
  function stopHelper() {
    clearTimeout(helperRestart);
    if (helper) { try { helper.stdin.end(); } catch {} const h = helper; setTimeout(() => { try { h.kill(); } catch {} }, 800); helper = null; }
  }
  const tell = (cmd) => { if (helper && helper.stdin.writable) helper.stdin.write(cmd + '\n'); };
  const waiters = {};
  // The tiler also uses the helper (to give a window its own desktop), even while the bar is off.
  let keepHelper = false;
  function vdMove(h) { keepHelper = true; startHelper(); return ask('vdnew ' + Math.round(+h), 'vd', 15000); }
  function vdHome(h) { keepHelper = true; startHelper(); return ask('vdhome ' + Math.round(+h), 'vdhome', 8000); }
  function vdClean(id) { keepHelper = true; startHelper(); tell('vdclean ' + String(id).replace(/[^0-9a-f-]/gi, '')); }
  function ask(cmd, key, ms = 6000) {
    return new Promise((res) => {
      if (!helper) return res(null);
      let done = false;
      const fin = (v) => { if (!done) { done = true; res(v); } };
      (waiters[key] = waiters[key] || []).push(fin);
      tell(cmd);
      setTimeout(() => fin(null), ms);
    });
  }

  const me = process.pid;
  function ingest(s) {
    const list = Array.isArray(s.desktops && s.desktops.list) ? s.desktops.list : [];
    sys = {
      windows: (s.windows || []).filter((w) => w.pid !== me || !/^Haven (Bar|widget|Studio widget|live wallpaper|guides)$/.test(w.t)),
      desktops: { list, current: s.desktops && s.desktops.current },
      volume: s.volume || null,
      media: s.media && s.media.title ? s.media : null,
      notes: +s.notes || 0,
    };
    for (const w of sys.windows) if (w.exe && !icons.has(w.exe)) loadIcon(w.exe);
    const cur = sys.desktops.current;
    if (cur && cur !== lastDesktop) {
      const first = lastDesktop === null;
      lastDesktop = cur;
      const map = S().desktopThemes || {};
      if (!first && map[cur] && map[cur] !== themes.currentId()) themes.apply(map[cur]);
    }
    push();
  }
  function loadIcon(exe) {
    icons.set(exe, '');
    app.getFileIcon(exe, { size: 'large' }).then((img) => { icons.set(exe, img.isEmpty() ? '' : img.toDataURL()); push(); }).catch(() => {});
  }

  // CPU / memory / network
  let lastCpu = null;
  function sampleStats() {
    const cpus = os.cpus();
    const t = cpus.reduce((a, c) => { const x = c.times; a.idle += x.idle; a.total += x.user + x.nice + x.sys + x.idle + x.irq; return a; }, { idle: 0, total: 0 });
    if (lastCpu) { const dt = t.total - lastCpu.total; stats.cpu = dt > 0 ? Math.round(100 * (1 - (t.idle - lastCpu.idle) / dt)) : stats.cpu; }
    lastCpu = t;
    stats.mem = Math.round(100 * (1 - os.freemem() / os.totalmem()));
    stats.memUsed = Math.round(((os.totalmem() - os.freemem()) / 1073741824) * 10) / 10;
    stats.memTotal = Math.round(os.totalmem() / 1073741824);
    const ifs = os.networkInterfaces();
    const up = Object.entries(ifs).filter(([, a]) => (a || []).some((x) => !x.internal && x.family === 'IPv4' && !x.address.startsWith('169.254')));
    const wifi = up.find(([n]) => /wi-?fi|wlan|wireless/i.test(n));
    stats.net = { ...stats.net, online: up.length > 0, kind: wifi ? 'wifi' : up.length ? 'ethernet' : 'none' };
  }
  function sampleWifi() {
    if (stats.net.kind !== 'wifi') { stats.net.ssid = null; stats.net.signal = null; return; }
    execFile('netsh.exe', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err || !out) return;
      const ssid = /^\s*SSID\s*:\s*(.+)$/m.exec(out), sig = /^\s*Signal\s*:\s*(\d+)%/m.exec(out);
      stats.net.ssid = ssid ? ssid[1].trim() : null;
      stats.net.signal = sig ? +sig[1] : null;
    });
  }

  // ------------------------------------------------------------ windows
  function physOf(disp) { return screen.dipToScreenRect(null, disp.bounds); }
  const thicknessDip = (c) => (c.style === 'full' ? c.height : c.height + c.gap * 2);
  function targets() {
    const c = cfg();
    const prim = screen.getPrimaryDisplay();
    return c.displays === 'all' ? screen.getAllDisplays() : [prim];
  }
  function create(disp) {
    const c = cfg();
    const th = thicknessDip(c);
    const b = disp.bounds;
    const w = new BrowserWindow({
      x: b.x, y: c.position === 'bottom' ? b.y + b.height - th : b.y, width: b.width, height: th,
      frame: false, show: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, skipTaskbar: true,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false,
      alwaysOnTop: true, icon: makeLogo(64), title: 'Haven Bar', webPreferences: { ...webPrefs, backgroundThrottling: false },
    });
    w.__display = disp.id;
    w.loadFile(path.join(__dirname, 'renderer', 'bar.html'), { query: { display: String(disp.id) } });
    w.once('ready-to-show', () => {
      desktop.setToolWindow(w);
      reserve(w);
      w.showInactive();
      w.setAlwaysOnTop(true, 'pop-up-menu');
      sendConfig(w);
    });
    w.hookWindowMessage(CB_MSG, (wp, lp) => {
      const code = wp.length >= 8 ? Number(wp.readBigUInt64LE()) : wp.readUInt32LE();
      // Our own reservation also triggers this; only react to other app bars (e.g. the taskbar moving).
      if (code === 1 /* ABN_POSCHANGED */ && Date.now() - (w.__reservedAt || 0) > 1500) setTimeout(() => !w.isDestroyed() && reserve(w), 50);
      if (code === 2 /* ABN_FULLSCREENAPP */) checkFullscreen();
    });
    w.on('move', () => { clearTimeout(w.__holdT); w.__holdT = setTimeout(() => { if (!w.isDestroyed() && w.__want) desktop.holdRect(w, w.__want); }, 60); });
    w.on('closed', () => { if (wins.get(disp.id) === w) wins.delete(disp.id); });
    wins.set(disp.id, w);
    return w;
  }
  function reserve(w) {
    if (w.isDestroyed()) return;
    const c = cfg();
    const disp = screen.getAllDisplays().find((x) => x.id === w.__display) || screen.getPrimaryDisplay();
    const phys = physOf(disp);
    const th = Math.round(thicknessDip(c) * disp.scaleFactor);
    w.__reservedAt = Date.now();
    const r = desktop.appbarSet(w, c.position, phys, th, CB_MSG);
    // Remember our handle so a strip left behind by a crash can be cleaned up next time.
    const hw = desktop.hwndOf(w);
    if (!(S().barAppbars || []).includes(hw)) { S().barAppbars = [...(S().barAppbars || []), hw].slice(-8); save(); }
    // Windows sometimes shoves the bar into the strip it just reserved; keep it on the screen edge.
    if (r) {
      w.__want = r;
      for (const ms of [120, 450, 1200, 2500]) setTimeout(() => { if (!w.isDestroyed() && w.__want === r) desktop.holdRect(w, r); }, ms);
    }
    const sig = r ? [r.x, r.y, r.width, r.height].join() : '';
    if (sig !== w.__resSig) { w.__resSig = sig; if (onReserved) onReserved(); }
    if (!r) {
      const b = disp.bounds, t = thicknessDip(c);
      w.setBounds({ x: b.x, y: c.position === 'bottom' ? b.y + b.height - t : b.y, width: b.width, height: t });
    }
  }
  function destroyAll() {
    for (const w of wins.values()) if (!w.isDestroyed()) { desktop.appbarRemove(w); w.destroy(); }
    wins.clear();
  }

  // Hide the bar while a fullscreen app (a game, a video) covers that screen.
  function checkFullscreen() {
    if (!wins.size) return;
    const fg = desktop.foregroundState(screen.getAllDisplays().map(physOf));
    for (const w of wins.values()) {
      if (w.isDestroyed()) continue;
      const disp = screen.getAllDisplays().find((x) => x.id === w.__display);
      if (!disp) continue;
      const p = physOf(disp);
      const covered = !!(fg && !fg.desktop && fg.pid !== process.pid && fg.rect && fg.rect.x <= p.x && fg.rect.y <= p.y && fg.rect.x + fg.rect.width >= p.x + p.width && fg.rect.y + fg.rect.height >= p.y + p.height);
      if (covered && w.isVisible()) w.hide();
      else if (!covered && !w.isVisible()) { w.showInactive(); w.setAlwaysOnTop(true, 'pop-up-menu'); }
    }
  }

  // ------------------------------------------------------------ state to the page
  function configPayload(w) {
    const disp = screen.getAllDisplays().find((x) => x.id === (w && w.__display)) || screen.getPrimaryDisplay();
    const winB = w && !w.isDestroyed() ? w.getBounds() : disp.bounds;
    return {
      config: cfg(), modules: MODULES, palette: themes.palette(), themeId: themes.currentId(),
      themes: themes.all().map((t) => ({ id: t.id, name: t.name, palette: themes.palette(t.id) })),
      wallpaperURL: wallpaperURL(), display: { bounds: disp.bounds, win: winB, primary: disp.id === screen.getPrimaryDisplay().id },
      pins: favorites(), customFonts: customFonts ? customFonts() : [],
    };
  }
  function sendConfig(w) { if (w && !w.isDestroyed()) w.webContents.send('bar:config', configPayload(w)); }
  const listeners = new Set(); // extra webContents (Studio's bar preview)
  function statePayload() {
    const cur = sys.desktops.current;
    const occupied = {};
    for (const w of sys.windows) if (w.d) occupied[w.d] = (occupied[w.d] || 0) + 1;
    const here = sys.windows.filter((w) => !w.d || w.d === cur).filter((w) => !w.cl || w.d === cur);
    const fgw = sys.windows.find((w) => w.fg);
    return {
      desktops: sys.desktops.list.map((x, i) => ({ id: x.id, name: x.name, index: i, current: x.id === cur, windows: occupied[x.id] || 0 })),
      tasks: here.map((w) => ({ h: w.h, title: w.t, exe: w.exe, icon: icons.get(w.exe) || '', active: !!w.fg, min: !!w.min, name: exeName(w.exe) })),
      active: fgw ? { title: fgw.t, name: exeName(fgw.exe), icon: icons.get(fgw.exe) || '' } : null,
      volume: sys.volume, media: sys.media, stats, notes: sys.notes || 0,
    };
  }
  let pushTimer = null, lastState = '';
  function push(force) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const st = statePayload();
      const json = JSON.stringify(st);
      if (!force && json === lastState) return;
      lastState = json;
      for (const w of wins.values()) if (!w.isDestroyed()) w.webContents.send('bar:state', st);
      for (const wc of listeners) if (!wc.isDestroyed()) wc.send('bar:state', st); else listeners.delete(wc);
    }, 30);
  }
  function exeName(p) {
    if (!p) return '';
    const n = path.basename(p).replace(/\.exe$/i, '');
    const known = { msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', opera: 'Opera', explorer: 'File Explorer', code: 'VS Code', discord: 'Discord', spotify: 'Spotify', steam: 'Steam', steamwebhelper: 'Steam', systemsettings: 'Settings', windowsterminal: 'Terminal', claude: 'Claude', notepad: 'Notepad', electron: 'Haven' };
    return known[n.toLowerCase()] || n.charAt(0).toUpperCase() + n.slice(1);
  }

  // ------------------------------------------------------------ actions from the bar
  function currentIndex() { return sys.desktops.list.findIndex((x) => x.id === sys.desktops.current); }
  let switching = Promise.resolve();
  function switchDesktop(target) {
    switching = switching.then(async () => {
      const n = sys.desktops.list.length;
      const cur = currentIndex();
      if (cur < 0 || target < 0 || target >= n || target === cur) return;
      const steps = target - cur;
      // Show the new desktop as current right away; the helper confirms it a moment later.
      sys.desktops.current = sys.desktops.list[target].id; push(true);
      for (let i = 0; i < Math.abs(steps); i++) {
        desktop.keyCombo([VK.ctrl, VK.win, steps > 0 ? VK.right : VK.left]);
        await new Promise((r) => setTimeout(r, 90));
      }
    });
  }
  function relDesktop(dir) {
    const cur = currentIndex(), n = sys.desktops.list.length;
    if (cur < 0 || n < 2) return;
    const t = cur + dir;
    if (t >= 0 && t < n) switchDesktop(t);
  }
  const WIN_KEYS = { notify: [VK.win, VK.n], quick: [VK.win, VK.a] };
  async function action(kind, arg, sender) {
    switch (kind) {
      case 'ws': return switchDesktop(+arg);
      case 'wsRel': return relDesktop(+arg);
      case 'wsNew': return desktop.keyCombo([VK.ctrl, VK.win, VK.d]);
      case 'wsClose': {
        const i = +arg;
        if (i !== currentIndex()) { switchDesktop(i); await switching; await new Promise((r) => setTimeout(r, 350)); }
        return desktop.keyCombo([VK.ctrl, VK.win, VK.f4]);
      }
      case 'task': {
        const t = sys.windows.find((w) => w.h === +arg);
        if (!t) return;
        if (t.fg && !t.min) desktop.minimizeWindow(t.h); else desktop.focusWindow(t.h);
        return;
      }
      case 'taskClose': return desktop.closeWindow(+arg);
      case 'taskMin': return desktop.minimizeWindow(+arg);
      case 'launcher': return toggleHub();
      case 'start': return desktop.keyCombo([VK.win]);
      case 'notify': case 'quick': return desktop.keyCombo(WIN_KEYS[kind]);
      case 'tray': desktop.keyCombo([VK.win, VK.b]); setTimeout(() => desktop.keyCombo([VK.enter]), 160); return;
      case 'pin': return launchItem(arg);
      case 'vol': { const v = Math.round(Math.max(0, Math.min(100, +arg))); tell('vol ' + v); if (sys.volume) sys.volume.level = v; push(true); return; }
      case 'volStep': { const v = Math.max(0, Math.min(100, ((sys.volume && sys.volume.level) || 0) + +arg)); tell('vol ' + v); if (sys.volume) sys.volume.level = v; push(true); return; }
      case 'mute': tell('mute ' + (sys.volume && sys.volume.muted ? '0' : '1')); if (sys.volume) sys.volume.muted = !sys.volume.muted; push(true); return;
      case 'media': return tell('media ' + (['toggle', 'next', 'prev'].includes(arg) ? arg : 'toggle'));
      case 'theme': return themes.apply(arg);
      case 'themeNext': return themes.next(+arg || 1);
      case 'settings': return openStudio('bar');
      case 'themes': return openStudio('themes');
      case 'hide': return set({ enabled: false });
      case 'power': return power(arg, sender);
    }
  }
  async function power(what, sender) {
    if (what === 'lock') return desktop.lockWorkstation();
    if (what === 'sleep') return execFile('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)'], { windowsHide: true });
    const words = { restart: ['Restart', '/r'], shutdown: ['Shut down', '/s'], signout: ['Sign out', '/l'] }[what];
    if (!words) return;
    const r = await dialog.showMessageBox({ type: 'question', buttons: [words[0], 'Cancel'], defaultId: 1, cancelId: 1, title: 'Haven', message: `${words[0]} now?`, detail: 'Save anything you are working on first.' });
    if (r.response === 0) execFile('shutdown.exe', what === 'signout' ? ['/l'] : [words[1], '/t', '0'], { windowsHide: true });
  }

  // ------------------------------------------------------------ shortcuts + taskbar
  let shortcutsOn = false;
  function applyShortcuts() {
    const want = cfg().enabled && cfg().shortcuts;
    if (want === shortcutsOn) return;
    const keys = [...Array(9)].map((_, i) => 'Ctrl+Alt+' + (i + 1));
    if (want) {
      keys.forEach((k, i) => { try { globalShortcut.register(k, () => switchDesktop(i)); } catch {} });
      try { globalShortcut.register('Ctrl+Alt+T', () => themes.next(1)); } catch {}
    } else {
      for (const k of [...keys, 'Ctrl+Alt+T']) { try { globalShortcut.unregister(k); } catch {} }
    }
    shortcutsOn = want;
  }
  try { globalShortcut.register('Ctrl+Alt+B', () => set({ enabled: !cfg().enabled })); } catch {}

  // The Windows taskbar while the bar is on: shown, auto-hidden, or fully hidden. Haven remembers how it
  // was and always puts it back when the bar is turned off or Haven quits.
  let tbTimer = null;
  function applyTaskbar() {
    if (onReserved) onReserved();
    const c = cfg();
    const mode = c.enabled ? c.taskbar : 'show';
    const st = S().barTaskbar || {};
    clearInterval(tbTimer);
    if (mode !== 'show') {
      if (!st.managed) {
        const was = desktop.taskbarAutoHide();
        if (was === null) return;
        S().barTaskbar = { managed: true, was };
        save();
      }
      desktop.taskbarAutoHide(true);
      desktop.showTaskbars(mode !== 'hidden');
      // Explorer can bring it back (e.g. after the Start menu): keep it hidden.
      if (mode === 'hidden') tbTimer = setInterval(() => desktop.showTaskbars(false), 1500);
    } else if (st.managed) {
      desktop.showTaskbars(true);
      desktop.taskbarAutoHide(!!st.was);
      S().barTaskbar = {};
      save();
    }
  }

  // ------------------------------------------------------------ lifecycle
  function start() {
    destroyAll();
    // Clear reservations from an earlier Haven that didn't shut down cleanly.
    const stale = (S().barAppbars || []).filter((h) => !desktop.isWindowAlive(h));
    if (stale.length) { stale.forEach((h) => desktop.appbarRemoveHandle(h)); S().barAppbars = (S().barAppbars || []).filter((h) => !stale.includes(h)); save(); }
    const c = cfg();
    applyShortcuts();
    applyTaskbar();
    if (!c.enabled) { if (!keepHelper) stopHelper(); clearInterval(statTimer); clearInterval(netTimer); clearInterval(fsTimer); onTaskbar && onTaskbar(); return status(); }
    for (const disp of targets()) create(disp);
    startHelper();
    // The tray stand-in only runs while the bar shows the background apps button.
    if (c.trayHost && [...c.left, ...c.center, ...c.right].includes('bgapps')) tell('trayon'); // off by default: it interferes with the bar's reserved strip
    sampleStats(); sampleWifi();
    clearInterval(statTimer); statTimer = setInterval(() => { sampleStats(); push(); }, 2000);
    clearInterval(netTimer); netTimer = setInterval(sampleWifi, 20000);
    clearInterval(fsTimer); fsTimer = setInterval(checkFullscreen, 1000);
    onTaskbar && onTaskbar();
    return status();
  }
  function stop() {
    clearInterval(statTimer); clearInterval(netTimer); clearInterval(fsTimer);
    destroyAll();
    stopHelper();
    clearInterval(tbTimer);
    const st = S().barTaskbar || {};
    if (st.managed) { desktop.showTaskbars(true); desktop.taskbarAutoHide(!!st.was); S().barTaskbar = {}; save(); }
    if (fly && !fly.isDestroyed()) fly.destroy();
  }
  const GEOMETRY = ['enabled', 'position', 'style', 'height', 'gap', 'displays'];

  // ------------------------------------------------------------ flyout panels (calendar, notifications, Wi-Fi…)
  const FLY_W = { bgapps: 320, calendar: 340, notify: 380, network: 340, volume: 340, battery: 320, quick: 380, power: 260, system: 320, themes: 360 };
  const PAD = 14; // transparent margin around the panel for its shadow
  let fly = null, flyKind = null, flyAnchor = null, flyClosedAt = 0, flyClosedKind = null;
  function ensureFly() {
    if (fly && !fly.isDestroyed()) return fly;
    fly = new BrowserWindow({
      width: 380, height: 300, frame: false, show: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      skipTaskbar: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true,
      title: 'Haven panel', icon: makeLogo(64), webPreferences: { ...webPrefs, backgroundThrottling: false },
    });
    fly.loadFile(path.join(__dirname, 'renderer', 'flyout.html'));
    fly.on('blur', () => { if (!menuMode) hideFly(); });
    fly.on('focus', () => endMenuMode(false));
    fly.webContents.on('did-finish-load', () => { desktop.setToolWindow(fly); listeners.add(fly.webContents); });
    return fly;
  }
  // While an app's tray menu is open (right-click in the Hidden icons panel), the panel stays open behind it,
  // like Windows' own hidden icons. It closes once you click somewhere else (anything but the panel or that menu).
  let menuMode = null;
  function startMenuMode(pid) {
    endMenuMode(false);
    if (!fly || fly.isDestroyed()) return;
    fly.setAlwaysOnTop(false);
    const t0 = Date.now();
    menuMode = { pid, timer: setInterval(() => {
      if (!fly || fly.isDestroyed() || !fly.isVisible()) return endMenuMode(false);
      const fg = desktop.foregroundState([]);
      const cls = fg && fg.cls;
      if (fg && fg.pid === process.pid) return endMenuMode(false);           // back in the panel
      if (cls === '#32768' || (fg && fg.pid === pid) || Date.now() - t0 < 600) return; // the app's menu is up
      // The menu closed. If you clicked back into the panel, keep it (and give it focus again); otherwise close it.
      const c = screen.getCursorScreenPoint(), b = fly.getBounds();
      if (c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height) { endMenuMode(false); fly.focus(); desktop.focusWindow(desktop.hwndOf(fly)); return; }
      endMenuMode(true);
    }, 250) };
  }
  function endMenuMode(close) {
    if (!menuMode) return;
    clearInterval(menuMode.timer);
    menuMode = null;
    if (fly && !fly.isDestroyed()) { fly.setAlwaysOnTop(true, 'pop-up-menu'); if (close) hideFly(); }
  }
  function hideFly() {
    if (!fly || fly.isDestroyed() || !fly.isVisible()) return;
    flyClosedAt = Date.now(); flyClosedKind = flyKind;
    fly.webContents.send('flyout:close');
    fly.hide();
    flyKind = null;
  }
  function openFly(kind, rect, sender) {
    if (fly && !fly.isDestroyed() && fly.isVisible() && flyKind === kind) return hideFly();
    if (flyClosedKind === kind && Date.now() - flyClosedAt < 350) return; // that click is what closed it
    const bw = BrowserWindow.fromWebContents(sender);
    if (!bw) return;
    const wb = bw.getBounds();
    const c = cfg();
    flyAnchor = { cx: wb.x + rect.x + rect.width / 2, top: c.position !== 'bottom', y: c.position === 'bottom' ? wb.y - 4 : wb.y + wb.height + 4, display: screen.getDisplayMatching(wb) };
    flyKind = kind;
    const f = ensureFly();
    const send = () => f.webContents.send('flyout:open', { kind, ...configPayload(null), state: statePayload(), live: !!(S().live && S().live.enabled) });
    if (f.webContents.isLoading()) f.webContents.once('did-finish-load', send); else send();
  }
  function placeFly(h) {
    if (!fly || fly.isDestroyed() || !flyAnchor || !flyKind) return;
    const W = (FLY_W[flyKind] || 360) + PAD * 2, H = Math.min(Math.round(h) + PAD * 2, flyAnchor.display.workArea.height - 10);
    const wa = flyAnchor.display.workArea;
    const x = Math.round(Math.max(wa.x + 4 - PAD, Math.min(flyAnchor.cx - W / 2, wa.x + wa.width - W + PAD - 4)));
    const y = Math.round(flyAnchor.top ? flyAnchor.y - PAD + 4 : flyAnchor.y - H + PAD - 4);
    fly.setBounds({ x, y, width: W, height: H });
    if (!fly.isVisible()) { fly.show(); fly.setAlwaysOnTop(true, 'pop-up-menu'); fly.focus(); desktop.focusWindow(desktop.hwndOf(fly)); }
  }
  ipcMain.handle('bar:flyout', (e, kind, rect) => openFly(kind, rect || { x: 0, y: 0, width: 0, height: 0 }, e.sender));
  ipcMain.on('flyout:size', (_, h) => placeFly(h));
  ipcMain.on('flyout:close', () => hideFly());
  let lastBg = new Map(); // pid -> app, from the last scan (actions only work on apps from that list)
  ipcMain.handle('flyout:ask', async (_, what) => {
    if (what === 'notes') return ask('notes', 'notes');
    if (what === 'net') return ask('net', 'net', 9000);
    if (what === 'bright') return ask('bright', 'bright');
    if (what === 'procs') return ask('procs', 'procs');
    if (what === 'tray') return (await ask('tray', 'tray', 6000)) || [];
    if (what === 'bgapps') {
      const list = (await ask('bgapps', 'bgapps', 9000)) || [];
      lastBg = new Map(list.map((a) => [a.pid, a]));
      await Promise.all(list.map(async (a) => { try { const img = await app.getFileIcon(a.path, { size: 'large' }); a.icon = img.isEmpty() ? '' : img.toDataURL(); } catch { a.icon = ''; } }));
      return list;
    }
    if (what === 'uptime') return os.uptime();
    return null;
  });
  ipcMain.handle('flyout:do', async (e, kind, arg) => {
    switch (kind) {
      case 'noteRemove': return ask('noteRemove ' + (+arg), 'notes', 15000);
      case 'noteClear': return ask('noteClear', 'notes', 20000);
      case 'bright': tell('setBright ' + Math.round(Math.max(0, Math.min(100, +arg)))); return true;
      case 'wifiConnect': return new Promise((r) => execFile('netsh.exe', ['wlan', 'connect', 'name=' + String(arg)], { windowsHide: true }, (err, out) => r(err ? String(out || err.message) : 'ok')));
      case 'wifiDisconnect': return new Promise((r) => execFile('netsh.exe', ['wlan', 'disconnect'], { windowsHide: true }, () => r('ok')));
      case 'open': {
        hideFly();
        const a = String(arg || '');
        if (/^(ms-settings:|ms-screenclip:|ms-actioncenter:)/.test(a)) return shell.openExternal(a);
        if (a === 'taskmgr') return execFile('taskmgr.exe', [], { windowsHide: false }, () => {});
        if (a === 'explorer') return execFile('explorer.exe', [], () => {});
        return;
      }
      case 'powerNow': {
        hideFly();
        if (arg === 'lock' || arg === 'sleep') return power(arg);
        const flag = { restart: ['/r', '/t', '0'], shutdown: ['/s', '/t', '0'], signout: ['/l'] }[arg];
        if (flag) execFile('shutdown.exe', flag, { windowsHide: true });
        return;
      }
      case 'live': return d.setLive && d.setLive(!!arg);
      // Background apps: open (most tray apps show their window when started again), quit, or force quit.
      case 'trayClick': {
        // Haven is in front right now (the panel has focus), so it can let the app come forward and show its menu.
        desktop.allowForeground();
        const id = String((arg && arg.id) || '').replace(/[^0-9:]/g, ''), btn = arg && arg.button === 'right' ? 'right' : 'left';
        // Right-click keeps the panel open behind the app's menu; left-click (usually opens the app) closes it.
        if (btn === 'right') startMenuMode(+(arg && arg.pid) || 0); else hideFly();
        if (id) setTimeout(() => tell('trayclick ' + id + ' ' + btn), 120);
        return true;
      }
      case 'bgOpen': { const a = lastBg.get(+arg); if (!a) return false; hideFly(); desktop.allowForeground(); shell.openPath(a.path); return true; }
      case 'bgQuit': case 'bgForce': {
        const a = lastBg.get(+arg); if (!a) return false;
        const args = kind === 'bgForce' ? ['/PID', String(a.pid), '/T', '/F'] : ['/PID', String(a.pid), '/T'];
        await new Promise((r) => execFile('taskkill.exe', args, { windowsHide: true }, () => r()));
        await new Promise((r) => setTimeout(r, 900));
        const still = await new Promise((r) => execFile('tasklist.exe', ['/FI', 'PID eq ' + a.pid, '/NH'], { windowsHide: true }, (e, out) => r(String(out || '').includes(String(a.pid)))));
        return still ? 'running' : 'closed';
      }
      case 'bar': return set(arg || {});
      default: if (['settings', 'themes', 'launcher', 'notify', 'quick', 'tray'].includes(kind)) hideFly(); return action(kind, arg, e.sender);
    }
  });
  function set(patch, { fromSync } = {}) {
    const prev = cfg();
    S().bar = { ...prev, ...patch };
    save();
    if (!fromSync && d.onLook) d.onLook(patch);
    if (cfg().trayHost && ['left', 'center', 'right'].some((z) => z in patch) && [...cfg().left, ...cfg().center, ...cfg().right].includes('bgapps')) tell('trayon');
    if (GEOMETRY.some((k) => k in patch && patch[k] !== prev[k])) start();
    else { applyShortcuts(); applyTaskbar(); refresh(); }
    return cfg();
  }
  function refresh() {
    for (const w of wins.values()) sendConfig(w);
    for (const wc of listeners) if (!wc.isDestroyed()) wc.send('bar:config', configPayload(null));
    push(true);
  }
  function status() { return { running: wins.size > 0 }; }

  ipcMain.handle('bar:get', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || !w.__display) listeners.add(e.sender);
    return { ...configPayload(w && w.__display ? w : null), state: statePayload() };
  });
  ipcMain.handle('bar:set', (_, patch) => set(patch || {}));
  ipcMain.handle('bar:action', (e, kind, arg) => action(kind, arg, e.sender));
  ipcMain.handle('bar:menu', async (e, where) => {
    const c = cfg();
    const cur = themes.currentId();
    const tpl = [
      { label: 'Bar settings…', click: () => openStudio('bar') },
      { label: 'Theme', submenu: [...themes.all().map((t) => ({ label: t.name, type: 'radio', checked: t.id === cur, click: () => themes.apply(t.id) })), { type: 'separator' }, { label: 'Manage themes…', click: () => openStudio('themes') }] },
      { label: 'Position', submenu: [['top', 'Top'], ['bottom', 'Bottom']].map(([v, l]) => ({ label: l, type: 'radio', checked: c.position === v, click: () => set({ position: v }) })) },
      { label: 'Style', submenu: [['islands', 'Islands'], ['zones', 'Three pills'], ['floating', 'Floating bar'], ['full', 'Edge to edge']].map(([v, l]) => ({ label: l, type: 'radio', checked: c.style === v, click: () => set({ style: v }) })) },
      { label: 'Windows taskbar', submenu: [['show', 'Show it'], ['autohide', 'Auto-hide (shows at the screen edge)'], ['hidden', 'Hide it completely']].map(([v, l]) => ({ label: l, type: 'radio', checked: c.taskbar === v, click: () => set({ taskbar: v }) })) },
      { type: 'separator' },
      d.getTiler && d.getTiler() ? { label: 'Tile windows (beta)', type: 'checkbox', checked: !!d.getTiler().cfg().enabled, click: (m) => d.getTiler().set({ enabled: m.checked }) } : null,
      d.getTiler && d.getTiler() && d.getTiler().cfg().enabled ? { label: 'Focus the active window   (Ctrl+Alt+Z)', type: 'checkbox', checked: d.getTiler().focused(), click: () => d.getTiler().toggleFocus() } : null,
      d.getTiler && d.getTiler() && d.getTiler().movedAway() ? { label: 'Bring back windows Haven moved', click: () => d.getTiler().bringBack() } : null,
      { label: 'Tiling settings…', click: () => openStudio('wm') },
      { type: 'separator' },
      { label: 'Turn off the bar   (Ctrl+Alt+B)', click: () => set({ enabled: false }) },
    ];
    if (where && where.desktop) {
      const dk = sys.desktops.list[+where.desktop];
      if (dk) {
        const map = S().desktopThemes || {};
        tpl.unshift(
          { label: `Desktop ${+where.desktop + 1}`, enabled: false },
          { label: 'Theme for this desktop', submenu: [{ label: 'Keep whatever is on', type: 'radio', checked: !map[dk.id], click: () => { const m = { ...map }; delete m[dk.id]; S().desktopThemes = m; save(); } }, { type: 'separator' }, ...themes.all().map((t) => ({ label: t.name, type: 'radio', checked: map[dk.id] === t.id, click: () => { S().desktopThemes = { ...map, [dk.id]: t.id }; save(); if (dk.id === sys.desktops.current) themes.apply(t.id); } }))] },
          sys.desktops.list.length > 1 ? { label: 'Close this desktop', click: () => action('wsClose', where.desktop) } : null,
          { label: 'New desktop', click: () => action('wsNew') },
          { type: 'separator' },
        );
      }
    }
    if (where && where.task) {
      const t = sys.windows.find((w) => w.h === +where.task);
      if (t) tpl.unshift({ label: t.t.length > 50 ? t.t.slice(0, 48) + '…' : t.t, enabled: false }, { label: 'Minimize', click: () => desktop.minimizeWindow(t.h) }, { label: 'Close window', click: () => desktop.closeWindow(t.h) }, { type: 'separator' });
    }
    if (where && where.power) {
      return Menu.buildFromTemplate([['lock', 'Lock'], ['sleep', 'Sleep'], ['signout', 'Sign out…'], ['restart', 'Restart…'], ['shutdown', 'Shut down…']].map(([v, l]) => ({ label: l, click: () => power(v) }))).popup({ window: BrowserWindow.fromWebContents(e.sender) });
    }
    Menu.buildFromTemplate(tpl.filter(Boolean)).popup({ window: BrowserWindow.fromWebContents(e.sender) });
  });

  screen.on('display-added', () => cfg().enabled && setTimeout(start, 600));
  screen.on('display-removed', () => cfg().enabled && setTimeout(start, 600));
  screen.on('display-metrics-changed', (_, disp, changed) => {
    if (!cfg().enabled) return;
    if (changed.includes('scaleFactor') || changed.includes('bounds')) setTimeout(start, 600);
  });

  return { start, stop, set, refresh, cfg, status, DEFAULTS, MODULES, wins, statePayload, relDesktop, switchDesktop, vdMove, vdClean, vdHome };
}

module.exports = { setup, DEFAULTS, MODULES };
