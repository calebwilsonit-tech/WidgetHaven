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
  floatApps: '',           // apps that always open floating (centered); the rest tile around them
  followMouse: true,      // hovering a tiled window focuses it (Hyprland's default)
  overflow: 'float',      // when a window can't fit even the roomiest tile: 'float' | 'desktop' (its own virtual desktop)
};
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', '#32770', 'Windows.UI.Core.CoreWindow',
  'TopLevelWindowForOverflowXamlIsland', 'XamlExplorerHostIslandWindow', 'ApplicationManager_ImmersiveShellWindow', 'ForegroundStaging',
  'MultitaskingViewFrame', 'NotifyIconOverflowWindow', 'Windows.UI.Composition.DesktopWindowContentBridge', 'TaskManagerWindow_Mini', 'tooltips_class32']);

function setup({ store, save, palette, log, vd }) {
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
  const REST_MIN = 360; // keep at least this much (px) for the remaining windows when widening a share
  function split(area, n, inner, cfg, mins = []) {
    const out = [];
    const need = (i, dim) => (mins[i] && mins[i][dim]) || 0;
    if (cfg.layout === 'master' && n > 1) {
      let mw = Math.round(area.width * cfg.master / 100);
      mw = Math.max(mw, Math.min(need(0, 'w') + inner / 2, area.width - REST_MIN));
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
        let w = (rest.width - inner) / 2;
        w = Math.max(w, Math.min(need(i, 'w'), rest.width - inner - REST_MIN));
        out.push({ x: rest.x, y: rest.y, width: w, height: rest.height });
        rest = { x: rest.x + w + inner, y: rest.y, width: rest.width - w - inner, height: rest.height };
      } else {
        let hh = (rest.height - inner) / 2;
        hh = Math.max(hh, Math.min(need(i, 'h'), rest.height - inner - REST_MIN));
        out.push({ x: rest.x, y: rest.y, width: rest.width, height: hh });
        rest = { x: rest.x, y: rest.y + hh + inner, width: rest.width, height: rest.height - hh - inner };
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
    // The maximize button toggles focus mode: maximize to fill the tiled area, press it again to go back.
    for (const h of wins) if (k.IsZoomed(h)) { if (settled && h === fg) focusWin = focusWin === h ? 0 : h; k.ShowWindow(h, 9 /* SW_RESTORE */); }
    // A new window opening ends focus mode, so it never lands hidden under (or on top of) the focused one.
    if (focusWin && wins.some((h) => !known.has(h) && !floating.has(h))) focusWin = 0;
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
      split(area, prev.length, gi, cfg, prev.map((h) => minSize.get(h))).forEach((r, i) => {
        let to = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        if (prev[i] === focusWin) to = { ...area };
        moves.push({ h: prev[i], to, fresh: !known.has(prev[i]) });
        tiledNow.add(prev[i]);
        slots.set(prev[i], to);
      });
      if (focusWin && prev.includes(focusWin)) { try { k.SetWindowPos(focusWin, 0, 0, 0, 0, 0, 0x1 | 0x2 | 0x10); } catch {} }
    }
    for (const m of moves) { if (!known.has(m.h)) firstSeen.set(m.h, Date.now()); known.add(m.h); }
    for (const h of [...slots.keys()]) if (!tiledNow.has(h)) slots.delete(h);
    for (const h of [...minSize.keys()]) if (!k.IsWindow(h)) minSize.delete(h);
    watchProcesses();
    animate(moves);
    borders();
  }

  // ------------------------------------------------------------ animation
  let anim = null;
  const slots = new Map();    // tiled window -> the spot it should be in
  const placedAt = new Map(); // tiled window -> when we last moved it
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function place(list) {
    // One batched move for every window this frame.
    let hdwp = k.BeginDeferWindowPos(list.length);
    for (const { h, r, off } of list) {
      if (!hdwp) break;
      hdwp = k.DeferWindowPos(hdwp, h, 0, r.x - off.l, r.y - off.t, r.width + off.l + off.r, r.height + off.t + off.b, 0x4 | 0x10 | 0x200);
    }
    if (hdwp) k.EndDeferWindowPos(hdwp);
    const t = Date.now();
    for (const { h } of list) placedAt.set(h, t);
  }
  // Some apps (Steam, for one) refuse to shrink below their own minimum size. If a window ends up bigger
  // than its slot, float it centered and tile everything else around it, so nothing overlaps.
  const minSize = new Map(); // window -> the smallest size it accepted (apps with a minimum size)
  const autoFloat = new Set(); // floated only because there wasn't room; they rejoin when space frees up
  const ownDesk = new Map();   // window -> the desktop Haven made for it (removed again when it closes)
  const firstSeen = new Map(); // window -> when tiling first saw it
  const vdPending = new Set();
  // No room anywhere on this desktop. The newest window that can't shrink is the one that leaves (never the
  // windows that were already happily tiled): it gets a desktop of its own, or floats.
  function overflowed(h) {
    const list = [...order.values()].find((l) => l.includes(h)) || [h];
    const culprit = list.filter((x) => x === h || minSize.has(x)).sort((a, b) => (firstSeen.get(b) || 0) - (firstSeen.get(a) || 0))[0] || h;
    if (vdPending.has(culprit) || ownDesk.has(culprit)) return;
    floating.add(culprit); // out of this layout while it moves
    if (S().overflow === 'desktop' && vd) {
      vdPending.add(culprit);
      vd.move(culprit).then((r) => {
        vdPending.delete(culprit);
        if (r && r.ok) { ownDesk.set(culprit, r.id); floating.delete(culprit); soon(60); }
        else { autoFloat.add(culprit); centerFloat(culprit); soon(30); log && log('own desktop failed: ' + (r && r.error)); }
      });
      return;
    }
    autoFloat.add(culprit); centerFloat(culprit);
  }
  function checkFit(jobs) {
    let changed = false;
    for (const j of jobs) {
      if (j.h === focusWin || floating.has(j.h) || vdPending.has(j.h) || !k.IsWindow(j.h)) continue;
      const e = ext(j.h), w = e.right - e.left, h = e.bottom - e.top;
      const to = slots.get(j.h) || j.to; // its current tile (the layout may have changed since)
      if (w <= to.width + 12 && h <= to.height + 12) continue;
      // Make room: remember its minimum and move it to the first (roomiest) tile, then lay out again.
      // Floating is the last resort: only when it's already in that tile, sized for it, and still won't fit.
      const known = minSize.get(j.h);
      const first = [...order.values()].some((list) => list[0] === j.h);
      minSize.set(j.h, { w: Math.max(w, known ? known.w : 0), h: Math.max(h, known ? known.h : 0) });
      // Another window that can't shrink already holds the first tile: don't swap them back and forth.
      const frontTaken = [...order.values()].some((list) => list.includes(j.h) && list[0] !== j.h && minSize.has(list[0]));
      if (frontTaken) {
        overflowed(j.h);
      } else if (!first) {
        for (const list of order.values()) { const i = list.indexOf(j.h); if (i > 0) { list.splice(i, 1); list.unshift(j.h); } }
      } else if (known && w <= known.w && h <= known.h) {
        overflowed(j.h);
      }
      changed = true;
    }
    if (changed) setTimeout(retile, 30);
  }
  // Smooth movement: each window gets its new size once, up front (apps redraw their contents only once),
  // then just glides to its spot. Moving without resizing is cheap, so it can run at a high frame rate.
  const now = () => Number(process.hrtime.bigint() / 1000000n);
  const easeOut = (t) => 1 - Math.pow(1 - t, 4);
  function animate(moves, noFit) {
    if (anim) { clearTimeout(anim.timer); anim = null; }
    const jobs = [];
    for (const m of moves) {
      if (!k.IsWindow(m.h)) continue;
      const w = rect(m.h), e = ext(m.h);
      const off = { l: e.left - w.left, t: e.top - w.top, r: w.right - e.right, b: w.bottom - e.bottom };
      const cur = { x: e.left, y: e.top, width: e.right - e.left, height: e.bottom - e.top };
      const same = Math.abs(cur.x - m.to.x) < 2 && Math.abs(cur.y - m.to.y) < 2 && Math.abs(cur.width - m.to.width) < 2 && Math.abs(cur.height - m.to.height) < 2;
      if (same && !m.fresh) continue;
      // Start from where the window is, keeping its center, already at the final size. New windows slide up into place.
      const from = m.fresh
        ? { x: m.to.x, y: m.to.y + Math.round(m.to.height * 0.06) }
        : { x: Math.round(cur.x + cur.width / 2 - m.to.width / 2), y: Math.round(cur.y + cur.height / 2 - m.to.height / 2) };
      jobs.push({ h: m.h, from, to: m.to, off });
    }
    if (!jobs.length) return;
    const cfg = S();
    const ms = !cfg.animate ? 0 : cfg.speed === 'fast' ? 160 : 260;
    // Check twice: some apps (Steam) only snap back to their minimum size a moment later.
    const done = () => { if (!noFit) { setTimeout(() => checkFit(jobs), 120); setTimeout(() => checkFit(jobs), 700); } };
    if (!ms) { place(jobs.map((j) => ({ h: j.h, r: j.to, off: j.off }))); done(); return; }
    const frame = (e) => place(jobs.map((j) => ({ h: j.h, off: j.off, r: { x: Math.round(j.from.x + (j.to.x - j.from.x) * e), y: Math.round(j.from.y + (j.to.y - j.from.y) * e), width: j.to.width, height: j.to.height } })));
    frame(0);
    const t0 = now();
    const tick = () => {
      const t = Math.min(1, (now() - t0) / ms);
      frame(easeOut(t));
      if (t >= 1) { anim = null; done(); return; }
      anim = { timer: setTimeout(tick, 7) }; // ~144 fps; only positions change, so this stays light
    };
    anim = { timer: setTimeout(tick, 7) };
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
    const active = tiledNow.has(fg) ? fg : 0;
    // The window taking focus fades its border up to the accent; the one losing it fades back down.
    if (active !== lastActive) fadeBorders(lastActive, active, p);
    lastActive = active;
    for (const h of tiledNow) {
      if (fading.has(h)) continue;
      try { k.DwmSetWindowAttribute(h, 34, [colorref(h === active ? p.accent : p.surface)], 4); bordered.add(h); } catch {}
    }
  }
  let lastActive = 0, fadeTimer = null;
  const fading = new Set();
  const mixHex = (a, b, t) => { const x = parseInt(a.slice(1, 7), 16), y = parseInt(b.slice(1, 7), 16); const c = (sh) => Math.round(((x >> sh) & 255) + ((((y >> sh) & 255) - ((x >> sh) & 255)) * t)); return '#' + [16, 8, 0].map((sh) => c(sh).toString(16).padStart(2, '0')).join(''); };
  function fadeBorders(from, to, p) {
    clearInterval(fadeTimer);
    fading.clear();
    const ms = S().animate ? 150 : 0;
    const set = (h, hex) => { if (h && k.IsWindow(h)) { try { k.DwmSetWindowAttribute(h, 34, [colorref(hex)], 4); bordered.add(h); } catch {} } };
    if (!ms) { set(from, p.surface); set(to, p.accent); return; }
    if (from) fading.add(from);
    if (to) fading.add(to);
    const t0 = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / ms), e = 1 - Math.pow(1 - t, 2);
      if (from && tiledNow.has(from)) set(from, mixHex(p.accent, p.surface, e));
      if (to) set(to, mixHex(p.surface, p.accent, e));
      if (t >= 1) { clearInterval(fadeTimer); fadeTimer = null; fading.clear(); }
    };
    fadeTimer = setInterval(step, 16);
    step();
  }

  // ------------------------------------------------------------ events
  let hooks = [], cb = null, timer = null;
  const soon = (ms = 40) => { clearTimeout(timer); timer = setTimeout(retile, ms); };
  function onEvent(hook, ev, h, obj) {
    if (obj !== 0) return;
    h = Number(h);
    if (ev === 0x800B) { if (slots.has(h)) heldBack(h); return; }             // a tiled window moved or resized
    if (ev === 0x000A) { if (tiledNow.has(h)) dragging = h; return; }          // move/resize started
    if (ev === 0x000B) { if (dragging) { const d = dragging; dragging = 0; dropped(d); } return; } // ended
    if (ev === 0x0003) {                                                       // focus changed
      if (focusWin && h !== focusWin && tiledNow.has(h)) { focusWin = 0; soon(10); }
      borders(); return;
    }
    if (ev === 0x8001 && ownDesk.has(h)) { const id = ownDesk.get(h); ownDesk.delete(h); setTimeout(() => vd && vd.clean(id), 600); }
    if ((ev === 0x8001 || ev === 0x8003 || ev === 0x0016) && autoFloat.size && tiledNow.has(h)) { for (const f of autoFloat) floating.delete(f); autoFloat.clear(); }
    soon(ev === 0x8002 || ev === 0x8018 ? 60 : 30);
  }
  // Some apps (Opera, for one) resize themselves after being placed, e.g. back to a size they remember.
  // Put them back in their slot; if an app keeps fighting, float it instead of looping forever.
  const fights = new Map();
  const holdTimers = new Map();
  function heldBack(h) {
    if (dragging || anim || paused || focusWin === h) return;
    if (Date.now() - (placedAt.get(h) || 0) < 300) return; // that was us
    clearTimeout(holdTimers.get(h));
    holdTimers.set(h, setTimeout(() => {
      holdTimers.delete(h);
      const to = slots.get(h);
      if (!to || !k.IsWindow(h) || dragging || anim) return;
      if (k.IsZoomed(h) || k.IsIconic(h)) { soon(20); return; }
      const e = ext(h);
      if (Math.abs(e.left - to.x) <= 4 && Math.abs(e.top - to.y) <= 4 && Math.abs(e.right - e.left - to.width) <= 4 && Math.abs(e.bottom - e.top - to.height) <= 4) return;
      const now = Date.now(), list = (fights.get(h) || []).filter((t) => now - t < 4000);
      list.push(now); fights.set(h, list);
      if (list.length > 4) { floating.add(h); centerFloat(h); soon(30); return; }
      if (e.right - e.left > to.width + 12 || e.bottom - e.top > to.height + 12) { checkFit([{ h, to }]); return; }
      const w = rect(h);
      place([{ h, r: to, off: { l: e.left - w.left, t: e.top - w.top, r: w.right - e.right, b: w.bottom - e.bottom } }]);
    }, 120));
  }
  // Location changes are only watched for the processes that own tiled windows (not system-wide),
  // so mouse and caret movement elsewhere costs nothing.
  const procHooks = new Map(); // pid -> hook
  function watchProcesses() {
    if (!k || !cb) return;
    const want = new Set();
    for (const h of tiledNow) { const p = [0]; k.GetWindowThreadProcessId(h, p); if (p[0]) want.add(p[0]); }
    for (const [pid, hk] of procHooks) if (!want.has(pid)) { k.UnhookWinEvent(hk); procHooks.delete(pid); }
    for (const pid of want) if (!procHooks.has(pid)) procHooks.set(pid, k.SetWinEventHook(0x800B, 0x800B, 0, cb, pid, 0, 0x0002));
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
    for (const hk of procHooks.values()) k.UnhookWinEvent(hk);
    procHooks.clear();
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
    autoFloat.delete(h);
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
  let fmTimer = null, fmLast = 0, fmX = -1, fmY = -1;
  const btnDown = () => [0x01, 0x02, 0x04].some((v) => (k.GetAsyncKeyState(v) & 0x8000) !== 0);
  function followTick() {
    if (paused || dragging || focusWin) return;
    const p = {};
    if (!k.GetCursorPos(p)) return;
    const moved = p.x !== fmX || p.y !== fmY;
    fmX = p.x; fmY = p.y;
    if (!moved) return;
    const h = Number(k.GetAncestor(k.WindowFromPoint(p), 2 /* GA_ROOT */));
    if (!tiledNow.has(h)) { fmLast = 0; return; }
    const fg = Number(k.GetForegroundWindow());
    if (h === fg) { fmLast = h; return; }
    if (!tiledNow.has(fg) && !floating.has(fg)) return; // a menu, dialog, launcher… keep it
    if (btnDown()) return;
    fmLast = h;
    k.keybd_event(0xE8, 0, 0, 0); k.keybd_event(0xE8, 0, 2, 0); k.SetForegroundWindow(h); // unused key: unlocks focus without poking menus
    // Floating windows stay above the tiles, like in Hyprland.
    for (const f of floating) if (k.IsWindow(f) && k.IsWindowVisible(f)) { try { k.SetWindowPos(f, 0, 0, 0, 0, 0, 0x1 | 0x2 | 0x10); } catch {} }
  }
  function follow(on) {
    clearInterval(fmTimer); fmTimer = null;
    if (on) fmTimer = setInterval(followTick, 25);
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
