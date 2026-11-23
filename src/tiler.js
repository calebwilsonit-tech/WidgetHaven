// Haven Tiling (beta): Hyprland-style automatic window tiling for Windows.
// Event driven (Windows tells us when windows open, close, move or change focus), so it costs nothing
// while nothing is happening. Animations use one batched move per frame and stop as soon as they land.
const { screen, globalShortcut } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

const DEFAULTS = {
  enabled: false,
  layout: 'dwindle',      // 'dwindle' | 'master'
  inner: 8, outer: 10,    // gaps (px)
  master: 55,             // master width %
  animate: true, speed: 'smooth', // 'fast' | 'smooth'
  border: true,           // accent border on the active window (Windows 11)
  ignore: 'Taskmgr.exe, Calculator, PowerToys',
  floatApps: 'steamwebhelper, Steam', // open floating (centered); the rest tile around them
  followMouse: true,      // hovering a tiled window focuses it (Hyprland's default)
};
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', '#32770', 'Windows.UI.Core.CoreWindow',
  'TopLevelWindowForOverflowXamlIsland', 'XamlExplorerHostIslandWindow', 'ApplicationManager_ImmersiveShellWindow', 'ForegroundStaging',
  'MultitaskingViewFrame', 'NotifyIconOverflowWindow', 'Windows.UI.Composition.DesktopWindowContentBridge', 'TaskManagerWindow_Mini', 'tooltips_class32']);

function setup({ store, save, palette, log }) {
  const S = () => ({ ...DEFAULTS, ...(store.settings.tiler || {}) });
  let k = null;
  try {
    const koffi = require('koffi');
    const u = koffi.load('user32.dll'), dwm = koffi.load('dwmapi.dll'), kern = koffi.load('kernel32.dll');
    const RECT = koffi.struct('TILER_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const POINT = koffi.struct('TILER_POINT', { x: 'long', y: 'long' });
    const EnumProc = koffi.proto('bool __stdcall TilerEnumProc(intptr_t h, intptr_t l)');
    const WinEventProc = koffi.proto('void __stdcall TilerWinEventProc(intptr_t hook, uint32_t ev, intptr_t hwnd, long idObj, long idChild, uint32_t thread, uint32_t time)');
    k = {
      koffi, RECT, EnumProc, WinEventProc,
      EnumWindows: u.func('bool __stdcall EnumWindows(TilerEnumProc *cb, intptr_t l)'),
      IsWindowVisible: u.func('bool __stdcall IsWindowVisible(intptr_t h)'),
      IsIconic: u.func('bool __stdcall IsIconic(intptr_t h)'),
      IsZoomed: u.func('bool __stdcall IsZoomed(intptr_t h)'),
      ShowWindow: u.func('bool __stdcall ShowWindow(intptr_t h, int cmd)'),
      WindowFromPoint: u.func('intptr_t __stdcall WindowFromPoint(TILER_POINT p)'),
      GetAncestor: u.func('intptr_t __stdcall GetAncestor(intptr_t h, uint32_t flags)'),
      GetAsyncKeyState: u.func('int16_t __stdcall GetAsyncKeyState(int vk)'),
      IsWindow: u.func('bool __stdcall IsWindow(intptr_t h)'),
      GetWindow: u.func('intptr_t __stdcall GetWindow(intptr_t h, uint32_t cmd)'),
      GetWindowLongPtrW: u.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t h, int i)'),
      GetWindowTextLengthW: u.func('int __stdcall GetWindowTextLengthW(intptr_t h)'),
      GetClassNameW: u.func('int __stdcall GetClassNameW(intptr_t h, void *buf, int max)'),
      GetWindowRect: u.func('bool __stdcall GetWindowRect(intptr_t h, _Out_ TILER_RECT *r)'),
      GetForegroundWindow: u.func('intptr_t __stdcall GetForegroundWindow()'),
      SetForegroundWindow: u.func('bool __stdcall SetForegroundWindow(intptr_t h)'),
      GetWindowThreadProcessId: u.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t h, _Out_ uint32_t *pid)'),
      GetCursorPos: u.func('bool __stdcall GetCursorPos(_Out_ TILER_POINT *p)'),
      PostMessageW: u.func('bool __stdcall PostMessageW(intptr_t h, uint32_t m, uintptr_t w, intptr_t l)'),
      keybd_event: u.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
      BeginDeferWindowPos: u.func('intptr_t __stdcall BeginDeferWindowPos(int n)'),
      DeferWindowPos: u.func('intptr_t __stdcall DeferWindowPos(intptr_t hdwp, intptr_t h, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
      EndDeferWindowPos: u.func('bool __stdcall EndDeferWindowPos(intptr_t hdwp)'),
      SetWindowPos: u.func('bool __stdcall SetWindowPos(intptr_t h, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
      SetWinEventHook: u.func('intptr_t __stdcall SetWinEventHook(uint32_t min, uint32_t max, intptr_t mod, TilerWinEventProc *cb, uint32_t pid, uint32_t tid, uint32_t flags)'),
      UnhookWinEvent: u.func('bool __stdcall UnhookWinEvent(intptr_t h)'),
      DwmGetWindowAttribute: dwm.func('int32_t __stdcall DwmGetWindowAttribute(intptr_t h, uint32_t attr, void *out, uint32_t size)'),
      DwmSetWindowAttribute: dwm.func('int32_t __stdcall DwmSetWindowAttribute(intptr_t h, uint32_t attr, _In_ uint32_t *v, uint32_t size)'),
      QueryFullProcessImageNameW: kern.func('bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t f, void *buf, _Inout_ uint32_t *n)'),
      OpenProcess: kern.func('intptr_t __stdcall OpenProcess(uint32_t a, bool i, uint32_t pid)'),
      CloseHandle: kern.func('bool __stdcall CloseHandle(intptr_t h)'),
    };
  } catch (e) { log && log('tiling unavailable: ' + e.message); }

  // ------------------------------------------------------------ window facts
  const clsBuf = Buffer.alloc(512);
  const cls = (h) => { const n = k.GetClassNameW(h, clsBuf, 256); return clsBuf.toString('utf16le', 0, n * 2); };
  const rect = (h) => { const r = {}; k.GetWindowRect(h, r); return r; };
  const extBuf = Buffer.alloc(16);
  // The visible frame (without Windows' invisible resize borders).
  const ext = (h) => {
    if (k.DwmGetWindowAttribute(h, 9, extBuf, 16) !== 0) return rect(h);
    return { left: extBuf.readInt32LE(0), top: extBuf.readInt32LE(4), right: extBuf.readInt32LE(8), bottom: extBuf.readInt32LE(12) };
  };
  const cloakBuf = Buffer.alloc(4);
  const cloaked = (h) => k.DwmGetWindowAttribute(h, 14, cloakBuf, 4) === 0 && cloakBuf.readUInt32LE(0) !== 0;
  const exeCache = new Map();
  function exeOf(h) {
    const pid = [0];
    k.GetWindowThreadProcessId(h, pid);
    if (exeCache.has(pid[0])) return { pid: pid[0], exe: exeCache.get(pid[0]) };
    let exe = '';
    const ph = k.OpenProcess(0x1000, false, pid[0]);
    if (ph) { const b = Buffer.alloc(2048); const n = [1024]; if (k.QueryFullProcessImageNameW(ph, 0, b, n)) exe = path.basename(b.toString('utf16le', 0, n[0] * 2)); k.CloseHandle(ph); }
    if (exeCache.size > 300) exeCache.clear();
    exeCache.set(pid[0], exe);
    return { pid: pid[0], exe };
  }
  const floating = new Set();     // windows you've floated (or that float on their own)
  const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase().replace(/\.exe$/, '')).filter(Boolean);
  const ignored = () => list(S().ignore);
  const matches = (exe, names) => exe && names.some((x) => exe.toLowerCase().startsWith(x));
  const toCenter = [];             // newly seen "always float" windows, centered after the pass

  function tileable(h) {
    if (!k.IsWindowVisible(h) || k.IsIconic(h)) return false;
    if (floating.has(h)) return false;
    if (Number(k.GetWindow(h, 4)) !== 0) return false; // owned: dialogs and popups float
    const style = Number(k.GetWindowLongPtrW(h, -16)), ex = Number(k.GetWindowLongPtrW(h, -20));
    if ((style & 0x00C00000) !== 0x00C00000 || !(style & 0x00040000)) return false; // needs a caption and a resizable frame
    if ((ex & 0x80) || (ex & 0x08000000)) return false;                                // tool / no-activate windows
    if (!k.GetWindowTextLengthW(h)) return false;
    if (SKIP_CLASSES.has(cls(h))) return false;
    if (cloaked(h)) return false;                                                       // on another desktop
    const { pid, exe } = exeOf(h);
    if (pid === process.pid) return false;
    if (matches(exe, ignored())) return false;
    if (matches(exe, list(S().floatApps))) { floating.add(h); toCenter.push(h); return false; }
    return true;
  }

  // ------------------------------------------------------------ layout
  const displays = () => screen.getAllDisplays().map((d) => ({ id: d.id, area: screen.dipToScreenRect(null, d.workArea), bounds: screen.dipToScreenRect(null, d.bounds), scale: d.scaleFactor }));
  const order = new Map(); // display id -> [hwnd] (stable tiling order)
  function displayOf(h, ds) {
    const r = ext(h), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    return ds.find((d) => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height) || ds[0];
  }
  function split(area, n, inner, cfg) {
    const out = [];
    if (cfg.layout === 'master' && n > 1) {
      const mw = Math.round(area.width * cfg.master / 100);
      out.push({ x: area.x, y: area.y, width: mw - inner / 2, height: area.height });
      const sh = (area.height - inner * (n - 2)) / (n - 1);
      for (let i = 0; i < n - 1; i++) out.push({ x: area.x + mw + inner / 2, y: area.y + i * (sh + inner), width: area.width - mw - inner / 2, height: sh });
      return out;
    }
    // dwindle: each new window halves the last space, alternating with the space's shape
    let rest = { ...area };
    for (let i = 0; i < n; i++) {
      if (i === n - 1) { out.push(rest); break; }
      if (rest.width >= rest.height) {
        const w = (rest.width - inner) / 2;
        out.push({ x: rest.x, y: rest.y, width: w, height: rest.height });
        rest = { x: rest.x + w + inner, y: rest.y, width: w, height: rest.height };
      } else {
        const hh = (rest.height - inner) / 2;
        out.push({ x: rest.x, y: rest.y, width: rest.width, height: hh });
        rest = { x: rest.x, y: rest.y + hh + inner, width: rest.width, height: hh };
      }
    }
    return out;
  }

  let paused = false, dragging = 0;
  const known = new Set();      // windows we've placed before (new ones get the pop-in)
  const tiledNow = new Set();
  function collect() {
    const list = [];
    const cb = k.koffi.register((h) => { if (tileable(h)) list.push(Number(h)); return true; }, k.koffi.pointer(k.EnumProc));
    try { k.EnumWindows(cb, 0); } finally { k.koffi.unregister(cb); }
    return list;
  }
  // Focus mode (like Hyprland's fake fullscreen): one window fills the tiled area; the rest wait behind it.
  let focusWin = 0, settled = false;
  function centerFloat(h) {
    const ds = displays();
    const d = displayOf(h, ds), e = ext(h);
    const w = Math.min(e.right - e.left, d.area.width - 40), hh = Math.min(e.bottom - e.top, d.area.height - 40);
    // Placed directly (not animated) so it never interrupts the tiling animation running for the others.
    const wr = rect(h), off = { l: e.left - wr.left, t: e.top - wr.top, r: wr.right - e.right, b: wr.bottom - e.bottom };
    place([{ h, off, r: { x: d.area.x + Math.round((d.area.width - w) / 2), y: d.area.y + Math.round((d.area.height - hh) / 2), width: w, height: hh } }]);
    try { k.DwmSetWindowAttribute(h, 34, [0xFFFFFFFF], 4); } catch {}
  }
  function retile() {
    if (!k || !S().enabled || paused || dragging) return;
    const cfg = S();
    const ds = displays();
    toCenter.length = 0;
    const wins = collect();
    // Maximized windows join the layout. Maximizing one while tiling runs puts it in focus mode instead
    // (it fills the tiled area, like Hyprland's fake fullscreen); Ctrl+Alt+Z brings the layout back.
    const fg = Number(k.GetForegroundWindow());
    for (const h of wins) if (k.IsZoomed(h)) { if (settled && h === fg) focusWin = h; k.ShowWindow(h, 9 /* SW_RESTORE */); }
    settled = true;
    for (const h of toCenter.splice(0)) centerFloat(h);
    if (focusWin && !wins.includes(focusWin)) focusWin = 0;
    const byDisp = new Map(ds.map((d) => [d.id, []]));
    for (const h of wins) byDisp.get(displayOf(h, ds).id).push(h);
    const moves = [];
    tiledNow.clear();
    for (const d of ds) {
      const now = byDisp.get(d.id);
      const prev = (order.get(d.id) || []).filter((h) => now.includes(h));
      for (const h of now) if (!prev.includes(h)) prev.push(h);
      order.set(d.id, prev);
      if (!prev.length) continue;
      const g = Math.round(cfg.outer * d.scale), gi = Math.round(cfg.inner * d.scale);
      const area = { x: d.area.x + g, y: d.area.y + g, width: d.area.width - g * 2, height: d.area.height - g * 2 };
      split(area, prev.length, gi, cfg).forEach((r, i) => {
        let to = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        if (prev[i] === focusWin) to = { ...area };
        moves.push({ h: prev[i], to, fresh: !known.has(prev[i]) });
        tiledNow.add(prev[i]);
      });
      if (focusWin && prev.includes(focusWin)) { try { k.SetWindowPos(focusWin, 0, 0, 0, 0, 0, 0x1 | 0x2 | 0x10); } catch {} }
    }
    for (const m of moves) known.add(m.h);
    animate(moves);
    borders();
  }

  // ------------------------------------------------------------ animation
  let anim = null;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function place(list) {
    // One batched move for every window this frame.
    let hdwp = k.BeginDeferWindowPos(list.length);
    for (const { h, r, off } of list) {
      if (!hdwp) break;
      hdwp = k.DeferWindowPos(hdwp, h, 0, r.x - off.l, r.y - off.t, r.width + off.l + off.r, r.height + off.t + off.b, 0x4 | 0x10 | 0x200);
    }
    if (hdwp) k.EndDeferWindowPos(hdwp);
  }
  // Some apps (Steam, for one) refuse to shrink below their own minimum size. If a window ends up bigger
  // than its slot, float it centered and tile everything else around it, so nothing overlaps.
  function checkFit(jobs) {
    let changed = false;
    for (const j of jobs) {
      if (j.h === focusWin || floating.has(j.h) || !k.IsWindow(j.h)) continue;
      const e = ext(j.h);
      if (e.right - e.left > j.to.width + 12 || e.bottom - e.top > j.to.height + 12) { floating.add(j.h); centerFloat(j.h); changed = true; }
    }
    if (changed) setTimeout(retile, 30);
  }
  function animate(moves, noFit) {
    if (anim) { clearInterval(anim.timer); anim = null; }
    const jobs = [];
    for (const m of moves) {
      if (!k.IsWindow(m.h)) continue;
      const w = rect(m.h), e = ext(m.h);
      const off = { l: e.left - w.left, t: e.top - w.top, r: w.right - e.right, b: w.bottom - e.bottom };
      let from = { x: e.left, y: e.top, width: e.right - e.left, height: e.bottom - e.top };
      if (m.fresh) { const s = 0.9; from = { x: m.to.x + m.to.width * (1 - s) / 2, y: m.to.y + m.to.height * (1 - s) / 2, width: m.to.width * s, height: m.to.height * s }; }
      const same = Math.abs(from.x - m.to.x) < 2 && Math.abs(from.y - m.to.y) < 2 && Math.abs(from.width - m.to.width) < 2 && Math.abs(from.height - m.to.height) < 2;
      if (same) continue;
      jobs.push({ h: m.h, from, to: m.to, off });
    }
    if (!jobs.length) return;
    const cfg = S();
    const ms = !cfg.animate ? 0 : cfg.speed === 'fast' ? 120 : 200;
    if (!ms) { place(jobs.map((j) => ({ h: j.h, r: j.to, off: j.off }))); if (!noFit) setTimeout(() => checkFit(jobs), 150); return; }
    const t0 = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / ms), e = ease(t);
      place(jobs.map((j) => ({ h: j.h, off: j.off, r: { x: Math.round(j.from.x + (j.to.x - j.from.x) * e), y: Math.round(j.from.y + (j.to.y - j.from.y) * e), width: Math.round(j.from.width + (j.to.width - j.from.width) * e), height: Math.round(j.from.height + (j.to.height - j.from.height) * e) } })));
      if (t >= 1 && anim) { clearInterval(anim.timer); anim = null; if (!noFit) setTimeout(() => checkFit(jobs), 150); }
    };
    anim = { timer: setInterval(step, 16) };
    step();
  }

  // ------------------------------------------------------------ active-window border (Windows 11)
  const colorref = (hex) => { const n = parseInt(String(hex || '#888888').slice(1, 7), 16); return ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff); };
  const bordered = new Set();
  function borders() {
    if (!k) return;
    const cfg = S();
    const fg = Number(k.GetForegroundWindow());
    const p = palette();
    for (const h of [...bordered]) if (!tiledNow.has(h) || !cfg.border || !cfg.enabled) { try { k.DwmSetWindowAttribute(h, 34, [0xFFFFFFFF], 4); } catch {} bordered.delete(h); }
    if (!cfg.border || !cfg.enabled) return;
    for (const h of tiledNow) {
      try { k.DwmSetWindowAttribute(h, 34, [colorref(h === fg ? p.accent : p.surface)], 4); bordered.add(h); } catch {}
    }
  }

  // ------------------------------------------------------------ events
  let hooks = [], cb = null, timer = null;
  const soon = (ms = 40) => { clearTimeout(timer); timer = setTimeout(retile, ms); };
  function onEvent(hook, ev, h, obj) {
    if (obj !== 0) return;
    h = Number(h);
    if (ev === 0x000A) { if (tiledNow.has(h)) dragging = h; return; }          // move/resize started
    if (ev === 0x000B) { if (dragging) { const d = dragging; dragging = 0; dropped(d); } return; } // ended
    if (ev === 0x0003) { borders(); return; }                                  // focus changed
    soon(ev === 0x8002 || ev === 0x8018 ? 60 : 30);
  }
  // Dragging a tiled window onto another one swaps them (like Hyprland); dropping it elsewhere snaps it back.
  function dropped(h) {
    const p = {};
    k.GetCursorPos(p);
    for (const list of order.values()) {
      const i = list.indexOf(h);
      if (i < 0) continue;
      const j = list.findIndex((o) => o !== h && (() => { const r = ext(o); return p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom; })());
      if (j >= 0) [list[i], list[j]] = [list[j], list[i]];
    }
    soon(10);
  }
  function hook(on) {
    if (!k) return;
    for (const hk of hooks) k.UnhookWinEvent(hk);
    hooks = [];
    if (cb) { k.koffi.unregister(cb); cb = null; }
    if (!on) return;
    cb = k.koffi.register(onEvent, k.koffi.pointer(k.WinEventProc));
    // Foreground + move/size + minimize events, then show/hide/destroy/cloak (desktop switches).
    hooks.push(k.SetWinEventHook(0x0003, 0x0017, 0, cb, 0, 0, 0x0002));
    hooks.push(k.SetWinEventHook(0x8001, 0x8003, 0, cb, 0, 0, 0x0002));
    hooks.push(k.SetWinEventHook(0x8017, 0x8018, 0, cb, 0, 0, 0x0002));
  }

  // ------------------------------------------------------------ keyboard
  const KEYS = {
    'Ctrl+Alt+Left': () => focusDir(-1, 0), 'Ctrl+Alt+Right': () => focusDir(1, 0), 'Ctrl+Alt+Up': () => focusDir(0, -1), 'Ctrl+Alt+Down': () => focusDir(0, 1),
    'Ctrl+Alt+Shift+Left': () => swapDir(-1, 0), 'Ctrl+Alt+Shift+Right': () => swapDir(1, 0), 'Ctrl+Alt+Shift+Up': () => swapDir(0, -1), 'Ctrl+Alt+Shift+Down': () => swapDir(0, 1),
    'Ctrl+Alt+F': () => toggleFloat(), 'Ctrl+Alt+L': () => set({ layout: S().layout === 'dwindle' ? 'master' : 'dwindle' }),
    'Ctrl+Alt+Q': () => { const h = Number(k.GetForegroundWindow()); if (h) k.PostMessageW(h, 0x10, 0, 0); },
    'Ctrl+Alt+Enter': () => execFile('wt.exe', [], (err) => { if (err) execFile('cmd.exe', ['/c', 'start', 'cmd.exe']); }),
    'Ctrl+Alt+P': () => { paused = !paused; if (!paused) retile(); },
    'Ctrl+Alt+Z': () => toggleFocus(),
  };
  let keysOn = false;
  function keys(on) {
    if (on === keysOn) return;
    for (const [acc, fn] of Object.entries(KEYS)) { try { if (on) globalShortcut.register(acc, fn); else globalShortcut.unregister(acc); } catch {} }
    keysOn = on;
  }
  function neighbor(dx, dy) {
    const fg = Number(k.GetForegroundWindow());
    if (!tiledNow.has(fg)) return null;
    const a = ext(fg), ac = { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 };
    let best = null, bd = Infinity;
    for (const h of tiledNow) {
      if (h === fg) continue;
      const b = ext(h), bc = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
      const vx = bc.x - ac.x, vy = bc.y - ac.y;
      if ((dx && Math.sign(vx) !== dx) || (dy && Math.sign(vy) !== dy)) continue;
      const dist = Math.abs(dx ? vx : vy) + Math.abs(dx ? vy : vx) * 2;
      if (dist < bd) { bd = dist; best = h; }
    }
    return { fg, best };
  }
  function focusDir(dx, dy) {
    const n = neighbor(dx, dy);
    if (!n || !n.best) return;
    k.keybd_event(0xE8, 0, 0, 0); k.keybd_event(0xE8, 0, 2, 0); k.SetForegroundWindow(n.best);
  }
  function swapDir(dx, dy) {
    const n = neighbor(dx, dy);
    if (!n || !n.best) return;
    for (const list of order.values()) {
      const i = list.indexOf(n.fg), j = list.indexOf(n.best);
      if (i >= 0 && j >= 0) [list[i], list[j]] = [list[j], list[i]];
    }
    retile();
  }
  function toggleFocus() {
    const fg = Number(k.GetForegroundWindow());
    focusWin = focusWin ? 0 : tiledNow.has(fg) ? fg : 0;
    retile();
    return !!focusWin;
  }
  function toggleFloat() {
    const h = Number(k.GetForegroundWindow());
    if (!h) return;
    if (floating.has(h)) floating.delete(h);
    else {
      floating.add(h);
      // A floated window comes forward, centered and a bit smaller.
      const d = displays().find((x) => { const r = ext(h); const cx = (r.left + r.right) / 2; return cx >= x.bounds.x && cx < x.bounds.x + x.bounds.width; }) || displays()[0];
      const w = Math.round(d.area.width * 0.6), hh = Math.round(d.area.height * 0.65);
      animate([{ h, to: { x: d.area.x + Math.round((d.area.width - w) / 2), y: d.area.y + Math.round((d.area.height - hh) / 2), width: w, height: hh } }]);
      try { k.DwmSetWindowAttribute(h, 34, [0xFFFFFFFF], 4); } catch {}
    }
    setTimeout(retile, S().animate ? 220 : 10);
  }

  // ------------------------------------------------------------ focus follows mouse
  // A light cursor check (only while tiling is on): resting on a tiled window for a moment focuses it.
  // It never steals focus from menus, dialogs or Haven's own pop-ups, and skips while a button is held.
  let fmTimer = null, fmLast = 0, fmSince = 0;
  const btnDown = () => [0x01, 0x02, 0x04].some((v) => (k.GetAsyncKeyState(v) & 0x8000) !== 0);
  function followTick() {
    if (paused || dragging || focusWin) return;
    const p = {};
    if (!k.GetCursorPos(p)) return;
    const h = Number(k.GetAncestor(k.WindowFromPoint(p), 2 /* GA_ROOT */));
    if (!tiledNow.has(h)) { fmLast = 0; return; }
    const fg = Number(k.GetForegroundWindow());
    if (h === fg) { fmLast = h; return; }
    if (!tiledNow.has(fg) && !floating.has(fg)) return; // a menu, dialog, launcher… keep it
    if (btnDown()) return;
    if (h !== fmLast) { fmLast = h; fmSince = Date.now(); return; }
    if (Date.now() - fmSince < 120) return;
    k.keybd_event(0xE8, 0, 0, 0); k.keybd_event(0xE8, 0, 2, 0); k.SetForegroundWindow(h); // unused key: unlocks focus without poking menus
    // Floating windows stay above the tiles, like in Hyprland.
    for (const f of floating) if (k.IsWindow(f) && k.IsWindowVisible(f)) { try { k.SetWindowPos(f, 0, 0, 0, 0, 0, 0x1 | 0x2 | 0x10); } catch {} }
  }
  function follow(on) {
    clearInterval(fmTimer); fmTimer = null;
    if (on) fmTimer = setInterval(followTick, 60);
  }

  // ------------------------------------------------------------ on / off
  function apply() {
    const on = !!(k && S().enabled);
    hook(on);
    keys(on);
    follow(on && S().followMouse);
    if (on) { paused = false; settled = false; retile(); } else { focusWin = 0; tiledNow.clear(); borders(); order.clear(); known.clear(); floating.clear(); }
  }
  function set(patch) {
    store.settings.tiler = { ...S(), ...patch };
    save();
    apply();
    return S();
  }
  screen.on('display-metrics-changed', () => soon(300));
  screen.on('display-added', () => soon(500));
  screen.on('display-removed', () => soon(500));

  return { apply, set, cfg: S, retile, available: () => !!k, toggleFocus, focused: () => !!focusWin, stop: () => { follow(false); hook(false); keys(false); tiledNow.clear(); borders(); }, KEYS: Object.keys(KEYS) };
}

module.exports = { setup, DEFAULTS };
