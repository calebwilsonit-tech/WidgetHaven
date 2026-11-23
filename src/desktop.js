// Desktop-widget plumbing: pins a window to the desktop layer, and reads the wallpaper's colors.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nativeImage } = require('electron');

let user32 = null;
try {
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  user32 = {
    FindWindowW: lib.func('intptr_t __stdcall FindWindowW(const char16_t* cls, const char16_t* name)'),
    SetWindowLongPtrW: lib.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int idx, intptr_t val)'),
    GetWindowLongPtrW: lib.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int idx)'),
    SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
    AllowSetForegroundWindow: lib.func('bool __stdcall AllowSetForegroundWindow(uint32_t pid)'),
    GetAsyncKeyState: lib.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
  };
  try {
    const RECT = koffi.struct('HAVEN_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    Object.assign(user32, {
      RECT,
      FindWindowExW: lib.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, const char16_t* cls, const char16_t* name)'),
      SetParent: lib.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
      SendMessageTimeoutW: lib.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t hwnd, uint32_t msg, uintptr_t w, intptr_t l, uint32_t flags, uint32_t timeout, void *result)'),
      GetForegroundWindow: lib.func('intptr_t __stdcall GetForegroundWindow()'),
      GetWindowRect: lib.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ HAVEN_RECT *rect)'),
      GetClassNameW: lib.func('int __stdcall GetClassNameW(intptr_t hwnd, void *buf, int max)'),
      GetWindowThreadProcessId: lib.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
      IsZoomed: lib.func('bool __stdcall IsZoomed(intptr_t hwnd)'),
      IsWindow: lib.func('bool __stdcall IsWindow(intptr_t hwnd)'),
      IsWindowVisible: lib.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
      SystemParametersInfoW: lib.func('bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void *pv, uint32_t winIni)'),
      keybd_event: lib.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
      SetForegroundWindow: lib.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)'),
      ShowWindow: lib.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
      IsIconic: lib.func('bool __stdcall IsIconic(intptr_t hwnd)'),
      PostMessageW: lib.func('bool __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t w, intptr_t l)'),
      LockWorkStation: lib.func('bool __stdcall LockWorkStation()'),
      SendMessageTimeoutStr: lib.func('__stdcall', 'SendMessageTimeoutW', 'intptr_t', ['intptr_t', 'uint32_t', 'uintptr_t', 'str16', 'uint32_t', 'uint32_t', 'void *']),
    });
    try {
      const shell = koffi.load('shell32.dll');
      const ABD = koffi.struct('HAVEN_APPBARDATA', { cbSize: 'uint32', hWnd: 'intptr_t', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr_t' });
      user32.ABD = ABD;
      user32.ABD_SIZE = koffi.sizeof(ABD);
      user32.SHAppBarMessage = shell.func('uintptr_t __stdcall SHAppBarMessage(uint32_t msg, _Inout_ HAVEN_APPBARDATA *data)');
    } catch (e) { console.warn('App bar APIs unavailable:', e.message); }
    try {
      // Which monitor a window is on, and that monitor's rectangle, straight from Windows (no DPI conversions).
      const MONINFO = koffi.struct('HAVEN_MONINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
      user32.MONINFO_SIZE = koffi.sizeof(MONINFO);
      user32.MonitorFromWindow = lib.func('intptr_t __stdcall MonitorFromWindow(intptr_t h, uint32_t flags)');
      user32.GetMonitorInfoW = lib.func('bool __stdcall GetMonitorInfoW(intptr_t m, _Inout_ HAVEN_MONINFO *mi)');
      // Is a full-screen app (a game, a presentation, a video) running? Catches exclusive Direct3D full screen too.
      user32.SHQueryUserNotificationState = koffi.load('shell32.dll').func('int32_t __stdcall SHQueryUserNotificationState(_Out_ int32_t *state)');
    } catch (e) { console.warn('Monitor APIs unavailable:', e.message); }
  } catch (e) { console.warn('Live wallpaper APIs unavailable:', e.message); }
  try {
    const dwm = koffi.load('dwmapi.dll');
    user32.DwmSetWindowAttribute = dwm.func('int32_t __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, _In_ uint32_t *value, uint32_t size)');
  } catch {}
} catch (e) {
  console.warn('Desktop pinning unavailable:', e.message);
}

const GWLP_HWNDPARENT = -8;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;
const HWND_BOTTOM = 1;
const SWP = { NOSIZE: 0x1, NOMOVE: 0x2, NOACTIVATE: 0x10, FRAMECHANGED: 0x20 };

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return Number(buf.length === 8 ? buf.readBigUInt64LE() : buf.readUInt32LE());
}

// Make the window "owned" by the desktop (Progman). Owned windows survive Win+D / Show Desktop,
// never get a taskbar button, and can be pushed beneath every normal app window.
function pin(win, on) {
  if (!user32) return false;
  try {
    const h = hwndOf(win);
    const progman = on ? Number(user32.FindWindowW('Progman', null)) : 0;
    user32.SetWindowLongPtrW(h, GWLP_HWNDPARENT, progman || 0);
    let ex = Number(user32.GetWindowLongPtrW(h, GWL_EXSTYLE));
    ex = on ? (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW : ex & ~WS_EX_TOOLWINDOW;
    user32.SetWindowLongPtrW(h, GWL_EXSTYLE, ex);
    user32.SetWindowPos(h, on ? HWND_BOTTOM : 0, 0, 0, 0, 0, SWP.NOSIZE | SWP.NOMOVE | SWP.NOACTIVATE | SWP.FRAMECHANGED);
    noBorder(h, on);
    return true;
  } catch (e) {
    console.warn('pin failed', e.message);
    return false;
  }
}
// Windows 11 draws a 1px accent/gray frame around windows; widgets shouldn't have one.
const DWMWA_BORDER_COLOR = 34, DWMWA_COLOR_NONE = 0xFFFFFFFE, DWMWA_COLOR_DEFAULT = 0xFFFFFFFF;
// Windows 11 rounds window corners; square looks turn that off (DWMWA_WINDOW_CORNER_PREFERENCE).
function setCorners(win, round) {
  if (!user32 || !user32.DwmSetWindowAttribute) return;
  try { user32.DwmSetWindowAttribute(hwndOf(win), 33, [round ? 0 /* default */ : 1 /* do not round */], 4); } catch {}
}
function noBorder(h, on) {
  if (!user32 || !user32.DwmSetWindowAttribute) return;
  try { user32.DwmSetWindowAttribute(h, DWMWA_BORDER_COLOR, [on ? DWMWA_COLOR_NONE : DWMWA_COLOR_DEFAULT], 4); } catch {}
}

function sendToBottom(win) {
  if (!user32) return;
  try { user32.SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP.NOSIZE | SWP.NOMOVE | SWP.NOACTIVATE); } catch {}
}

// ------------------------------------------------------------------ wallpaper colors
const TRANSCODED = path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Themes\\TranscodedWallpaper');

function wallpaperFile() {
  try { if (fs.statSync(TRANSCODED).size > 0) return TRANSCODED; } catch {}
  return null;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Picks a vivid "accent" and a contrasting second hue from the wallpaper.
function paletteFrom(img) {
  const small = img.resize({ width: 64, height: 64, quality: 'good' });
  const { width, height } = small.getSize();
  const px = small.toBitmap(); // BGRA
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let lum = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    const b = px[i], g = px[i + 1], r = px[i + 2];
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const [h, s, v] = rgbToHsv(r, g, b);
    if (s < 0.18 || v < 0.18) continue;
    const w = s * s * v;
    const bin = bins[Math.floor(h / 15) % 24];
    bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
  }
  lum /= width * height * 255;
  const ranked = bins.map((b, i) => ({ ...b, i })).filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const color = (b) => {
    let [h, s, v] = rgbToHsv(b.r / b.w, b.g / b.w, b.b / b.w);
    s = Math.min(Math.max(s, 0.5), 0.85); v = Math.min(Math.max(v, 0.88), 1); // keep it lively and readable
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return hex((r + m) * 255, (g + m) * 255, (bb + m) * 255);
  };
  const grid = luminanceGrid(img);
  if (!ranked.length) return { accent: '#94a3b8', accent2: '#cbd5e1', brightness: lum, grid };
  const first = ranked[0];
  const second = ranked.find((b) => Math.min(Math.abs(b.i - first.i), 24 - Math.abs(b.i - first.i)) >= 3 && b.w > first.w * 0.08);
  return { accent: color(first), accent2: second ? color(second) : null, brightness: lum, grid };
}

// Brightness map of the wallpaper (aspect preserved) so each widget can tell how light the
// patch of desktop behind it is, and choose readable text/icon colors for that spot.
function luminanceGrid(img) {
  const { width: iw, height: ih } = img.getSize();
  const w = 64, h = Math.max(8, Math.round((64 * ih) / iw));
  const small = img.resize({ width: w, height: h, quality: 'good' });
  const px = small.toBitmap();
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const data = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const b = px[i * 4], g = px[i * 4 + 1], r = px[i * 4 + 2];
    // WCAG relative luminance
    data[i] = Math.round((0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)) * 1000) / 1000;
  }
  return { w, h, data };
}

let lastSig = '';
function readWallpaper() {
  const f = wallpaperFile();
  if (!f) return null;
  try {
    const st = fs.statSync(f);
    const sig = st.mtimeMs + ':' + st.size;
    // TranscodedWallpaper has no extension; give the decoder a hint.
    const tmp = path.join(os.tmpdir(), 'haven-wallpaper.jpg');
    fs.copyFileSync(f, tmp);
    let img = nativeImage.createFromPath(tmp);
    if (img.isEmpty()) { fs.copyFileSync(f, tmp.replace('.jpg', '.png')); img = nativeImage.createFromPath(tmp.replace('.jpg', '.png')); }
    if (img.isEmpty()) return null;
    lastSig = sig;
    return { ...paletteFrom(img), sig };
  } catch { return null; }
}

function watchWallpaper(cb) {
  const check = () => {
    const f = wallpaperFile();
    if (!f) return;
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs + ':' + st.size !== lastSig) { const p = readWallpaper(); if (p) cb(p); }
    } catch {}
  };
  setInterval(check, 4000);
  return readWallpaper();
}

// Let whatever we launch next take the foreground, so it opens on top instead of behind a widget.
function allowForeground() {
  if (!user32) return;
  try { user32.AllowSetForegroundWindow(0xFFFFFFFF); } catch {}
}

// Move a window to a DIP position WITHOUT touching its size. Electron's setBounds/setPosition round
// through DIP↔pixel on every call at fractional scaling (125%/150%), which makes the size creep while
// dragging. Moving natively in physical pixels with SWP_NOSIZE can't change the size.
// Where a window really is (DIPs). Electron's getBounds() can be stale after Windows moves a window itself.
function realBounds(win) {
  const { screen } = require('electron');
  if (!user32 || !user32.GetWindowRect) return win.getBounds();
  try { const r = {}; user32.GetWindowRect(hwndOf(win), r); return screen.screenToDipRect(win, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }); } catch { return win.getBounds(); }
}
// Place a window natively (physical pixels), so the move always happens even if Electron thinks it's already there.
function placeNative(win, b) {
  const { screen } = require('electron');
  win.setBounds(b);
  if (!user32) return;
  try { const p = screen.dipToScreenRect(win, b); user32.SetWindowPos(hwndOf(win), 0, p.x, p.y, p.width, p.height, 0x4 /* NOZORDER */ | SWP.NOACTIVATE); } catch {}
}
function moveTo(win, x, y) {
  const { screen } = require('electron');
  if (!user32) { win.setPosition(Math.round(x), Math.round(y)); return; }
  try {
    const p = screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
    user32.SetWindowPos(hwndOf(win), 0, Math.round(p.x), Math.round(p.y), 0, 0, SWP.NOSIZE | 0x4 /* NOZORDER */ | SWP.NOACTIVATE);
  } catch { win.setPosition(Math.round(x), Math.round(y)); }
}

// Modifier keys during an OS window drag (the page gets no key events then).
const VK = { lbutton: 0x01, shift: 0x10, ctrl: 0x11, alt: 0x12 };
function keyDown(name) {
  if (!user32) return false;
  try { return (user32.GetAsyncKeyState(VK[name]) & 0x8000) !== 0; } catch { return false; }
}

// ------------------------------------------------------------------ live wallpaper layer
// Puts a window *behind the desktop icons* (where the wallpaper is drawn). Windows 11 24H2+ keeps the
// wallpaper host (WorkerW) inside Progman; older builds spawn a separate top-level WorkerW.
const className = (h) => {
  const buf = Buffer.alloc(512);
  const n = user32.GetClassNameW(h, buf, 256);
  return buf.toString('utf16le', 0, n * 2);
};
function wallpaperHost() {
  const progman = Number(user32.FindWindowW('Progman', null));
  if (!progman) return null;
  // Ask Explorer to create the wallpaper WorkerW (harmless if it already exists).
  user32.SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0 /* SMTO_NORMAL */, 1000, Buffer.alloc(8));
  user32.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, Buffer.alloc(8));
  const inner = Number(user32.FindWindowExW(progman, 0, 'WorkerW', null));
  const defView = Number(user32.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null));
  if (inner && defView) return { mode: 'progman', parent: progman, defView, worker: inner };
  // Classic layout: the WorkerW that holds the icons (SHELLDLL_DefView) is followed by the wallpaper WorkerW.
  let w = 0;
  for (let i = 0; i < 200; i++) {
    w = Number(user32.FindWindowExW(0, w, 'WorkerW', null));
    if (!w) break;
    if (Number(user32.FindWindowExW(w, 0, 'SHELLDLL_DefView', null))) {
      const next = Number(user32.FindWindowExW(0, w, 'WorkerW', null));
      if (next) return { mode: 'workerw', parent: next };
    }
  }
  return null;
}
const GWL_STYLE = -16, WS_CHILD = 0x40000000, WS_POPUP = 0x80000000;
// rect: physical pixels, relative to the virtual screen's top-left.
function attachToWallpaper(win, rect) {
  if (!user32 || !user32.SetParent) return { ok: false, error: 'unavailable' };
  try {
    const host = wallpaperHost();
    if (!host) return { ok: false, error: 'no wallpaper host' };
    const h = hwndOf(win);
    let st = Number(user32.GetWindowLongPtrW(h, GWL_STYLE));
    st = (st | WS_CHILD) & ~WS_POPUP;
    user32.SetWindowLongPtrW(h, GWL_STYLE, st);
    user32.SetParent(h, host.parent);
    // In the Progman layout, sit just under the icon layer (and above the static wallpaper).
    const after = host.mode === 'progman' ? host.defView : 0;
    user32.SetWindowPos(h, after, rect.x, rect.y, rect.width, rect.height, SWP.NOACTIVATE | SWP.FRAMECHANGED | (after ? 0 : 0x4));
    noBorder(h, true);
    return { ok: true, mode: host.mode, parent: host.parent };
  } catch (e) { return { ok: false, error: e.message }; }
}
// Is a standard pop-up menu open anywhere (window class #32768, what right-click menus use)?
// The monitor a window is on (0 if unknown).
function monitorOf(win) {
  if (!user32 || !user32.MonitorFromWindow) return 0;
  try { return Number(user32.MonitorFromWindow(hwndOf(win), 2)); } catch { return 0; }
}
// Windows' "do not disturb" state: 2 = a full-screen app is running, 3 = a full-screen Direct3D game.
function fullscreenAppRunning() {
  if (!user32 || !user32.SHQueryUserNotificationState) return false;
  try { const s = [0]; if (user32.SHQueryUserNotificationState(s) !== 0) return false; return s[0] === 2 || s[0] === 3; } catch { return false; }
}
function menuOpen() {
  if (!user32) return false;
  try { let h = 0; for (let i = 0; i < 6; i++) { h = Number(user32.FindWindowExW(0, h, '#32768', null)); if (!h) return false; if (user32.IsWindowVisible(h)) return true; } } catch {}
  return false;
}
function isWindowAlive(h) { try { return !!user32.IsWindow(h); } catch { return false; } }
// Repaint the normal wallpaper (used after the live wallpaper is turned off).
function refreshWallpaper() {
  if (!user32 || !user32.SystemParametersInfoW) return;
  try {
    const buf = Buffer.alloc(1040);
    user32.SystemParametersInfoW(0x73 /* SPI_GETDESKWALLPAPER */, 520, buf, 0);
    const p = buf.toString('utf16le').split('\0')[0];
    if (!p) return;
    user32.SystemParametersInfoW(0x14 /* SPI_SETDESKWALLPAPER */, 0, Buffer.from(p + '\0', 'utf16le'), 0);
  } catch {}
}
// What's in the foreground: lets the live wallpaper pause for games, fullscreen video and maximized apps.
function foregroundState(displaysPhys) {
  if (!user32 || !user32.GetForegroundWindow) return null;
  try {
    const h = Number(user32.GetForegroundWindow());
    if (!h) return null;
    const cls = className(h);
    if (/^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd)$/.test(cls)) return { desktop: true };
    const pid = [0];
    user32.GetWindowThreadProcessId(h, pid);
    const r = {};
    user32.GetWindowRect(h, r);
    const fullscreen = (displaysPhys || []).some((d) => r.left <= d.x && r.top <= d.y && r.right >= d.x + d.width && r.bottom >= d.y + d.height);
    const style = Number(user32.GetWindowLongPtrW(h, GWL_STYLE));
    const popup = ((style >>> 0) & 0x80000000) !== 0 && (style & 0x00C00000) !== 0x00C00000; // WS_POPUP, no title bar: menus
    // Does it cover its whole monitor? Compared in Windows' own coordinates, so a game running at a different
    // resolution, or in exclusive full screen, still counts.
    let monitor = 0, coversMonitor = false;
    if (user32.MonitorFromWindow) {
      monitor = Number(user32.MonitorFromWindow(h, 2 /* nearest */));
      const mi = { cbSize: user32.MONINFO_SIZE, rcMonitor: {}, rcWork: {}, dwFlags: 0 };
      if (monitor && user32.GetMonitorInfoW(monitor, mi)) { const m = mi.rcMonitor; coversMonitor = r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom; }
    }
    return { pid: pid[0], fullscreen, monitor, coversMonitor, maximized: !!user32.IsZoomed(h), cls, popup, hwnd: h, rect: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } };
  } catch { return null; }
}

// ------------------------------------------------------------------ HavenBar helpers
const KEYUP = 2, EXT = 1;
const EXTENDED = new Set([0x25, 0x26, 0x27, 0x28, 0x5B, 0x5C]);
// Press a key combo, e.g. [0x11, 0x5B, 0x27] = Ctrl+Win+Right.
function keyCombo(vks) {
  if (!user32 || !user32.keybd_event) return false;
  try {
    for (const v of vks) user32.keybd_event(v, 0, EXTENDED.has(v) ? EXT : 0, 0);
    for (const v of [...vks].reverse()) user32.keybd_event(v, 0, (EXTENDED.has(v) ? EXT : 0) | KEYUP, 0);
    return true;
  } catch { return false; }
}
function focusWindow(h) {
  if (!user32 || !user32.SetForegroundWindow) return;
  try {
    if (user32.IsIconic(h)) user32.ShowWindow(h, 9 /* SW_RESTORE */);
    // A tapped Alt lets a background process hand the foreground to another window.
    // Tapping an unused key lets a background app hand over focus (Alt would open menu bars).
    user32.keybd_event(0xE8, 0, 0, 0);
    user32.keybd_event(0xE8, 0, KEYUP, 0);
    user32.SetForegroundWindow(h);
  } catch {}
}
function minimizeWindow(h) { try { user32.ShowWindow(h, 6 /* SW_MINIMIZE */); } catch {} }
function closeWindow(h) { try { user32.PostMessageW(h, 0x10 /* WM_CLOSE */, 0, 0); } catch {} }
function lockWorkstation() { try { user32.LockWorkStation(); } catch {} }
function foregroundHwnd() { try { return Number(user32.GetForegroundWindow()); } catch { return 0; } }
// Hide/show a window from Alt+Tab and keep it on every virtual desktop (tool window style).
function setToolWindow(win) {
  if (!user32) return;
  try {
    const h = hwndOf(win);
    let ex = Number(user32.GetWindowLongPtrW(h, GWL_EXSTYLE));
    user32.SetWindowLongPtrW(h, GWL_EXSTYLE, (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
    noBorder(h, true);
  } catch {}
}

// App bar: reserves a strip of the screen (like the taskbar) so maximized windows stop at the bar.
// rect: physical pixels of the monitor; edge 'top' | 'bottom'; thickness in physical pixels.
const ABM = { NEW: 0, REMOVE: 1, QUERYPOS: 2, SETPOS: 3, GETSTATE: 4, SETSTATE: 10 };
const appbars = new Map();
function appbarSet(win, edge, mon, thickness, callbackMsg) {
  if (!user32 || !user32.SHAppBarMessage) return null;
  try {
    const h = hwndOf(win);
    const d = { cbSize: user32.ABD_SIZE, hWnd: h, uCallbackMessage: callbackMsg || 0, uEdge: edge === 'bottom' ? 3 : 1, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 };
    if (!appbars.has(h)) { user32.SHAppBarMessage(ABM.NEW, d); appbars.set(h, true); }
    d.rc = edge === 'bottom'
      ? { left: mon.x, right: mon.x + mon.width, top: mon.y + mon.height - thickness, bottom: mon.y + mon.height }
      : { left: mon.x, right: mon.x + mon.width, top: mon.y, bottom: mon.y + thickness };
    user32.SHAppBarMessage(ABM.QUERYPOS, d);
    // Windows stacks app bars, so a strip left behind by a crashed program would push the bar inward.
    // Only make room for a real taskbar on this edge; otherwise sit flush with the screen edge.
    if (!taskbarOnEdge(mon, edge)) {
      if (edge === 'bottom') d.rc.bottom = mon.y + mon.height; else d.rc.top = mon.y;
    }
    if (edge === 'bottom') d.rc.top = d.rc.bottom - thickness; else d.rc.bottom = d.rc.top + thickness;
    const want = { ...d.rc };
    user32.SHAppBarMessage(ABM.SETPOS, d);
    // SETPOS can shift us again to sit beside a leftover strip; keep the spot we asked for unless a real taskbar is there.
    const r = taskbarOnEdge(mon, edge) ? d.rc : want;
    user32.SetWindowPos(h, -1 /* HWND_TOPMOST */, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP.NOACTIVATE);
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  } catch (e) { console.warn('appbar failed', e.message); return null; }
}
// Windows' own taskbar window. Haven's tray stand-in shares its class name, so look for the one that
// actually contains things (the real taskbar has child windows; the stand-in has none).
function realTaskbar() {
  let h = 0, first = 0;
  for (let i = 0; i < 8; i++) {
    h = Number(user32.FindWindowExW(0, h, 'Shell_TrayWnd', null));
    if (!h) break;
    if (!first) first = h;
    if (Number(user32.FindWindowExW(h, 0, null, null))) return h;
  }
  return first;
}
// Is a visible Windows taskbar docked to this monitor's top or bottom edge?
function taskbarOnEdge(mon, edge) {
  try {
    const list = [realTaskbar()];
    let h = 0;
    for (let i = 0; i < 16; i++) { h = Number(user32.FindWindowExW(0, h, 'Shell_SecondaryTrayWnd', null)); if (!h) break; list.push(h); }
    for (const t of list) {
      if (!t || !user32.IsWindowVisible(t)) continue;
      const r = {};
      user32.GetWindowRect(t, r);
      const onMon = r.left < mon.x + mon.width && r.right > mon.x && r.top < mon.y + mon.height && r.bottom > mon.y;
      if (!onMon || r.right - r.left < mon.width / 2) continue; // vertical taskbars don't share our edge
      if (edge === 'bottom' ? r.bottom >= mon.y + mon.height - 2 && r.top > mon.y + mon.height / 2 : r.top <= mon.y + 2 && r.bottom < mon.y + mon.height / 2) return true;
    }
  } catch {}
  return false;
}
// Drop a reservation by window handle, even if that window no longer exists (left behind by a crash).
function appbarRemoveHandle(h) {
  if (!user32 || !user32.SHAppBarMessage || !h) return;
  try { user32.SHAppBarMessage(ABM.REMOVE, { cbSize: user32.ABD_SIZE, hWnd: h, uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 }); } catch {}
}
// Physical-pixel rect of a window, and putting it back there (topmost) if something moved it.
function physRect(win) {
  try { const r = {}; user32.GetWindowRect(hwndOf(win), r); return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }; } catch { return null; }
}
function holdRect(win, r) {
  if (!user32 || !r) return false;
  const cur = physRect(win);
  if (cur && cur.x === r.x && cur.y === r.y && cur.width === r.width && cur.height === r.height) return false;
  try { user32.SetWindowPos(hwndOf(win), -1 /* HWND_TOPMOST */, r.x, r.y, r.width, r.height, SWP.NOACTIVATE); return true; } catch { return false; }
}
function appbarRemove(win) {
  if (!user32 || !user32.SHAppBarMessage) return;
  try {
    const h = typeof win === 'number' ? win : hwndOf(win);
    if (!appbars.has(h)) return;
    appbars.delete(h);
    user32.SHAppBarMessage(ABM.REMOVE, { cbSize: user32.ABD_SIZE, hWnd: h, uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 });
  } catch {}
}
function appbarRemoveAll() { for (const h of [...appbars.keys()]) appbarRemove(h); }
// Windows taskbar auto-hide (ABS_AUTOHIDE = 1, ABS_ALWAYSONTOP = 2).
function taskbarAutoHide(on) {
  if (!user32 || !user32.SHAppBarMessage) return null;
  try {
    const tray = realTaskbar();
    const d = { cbSize: user32.ABD_SIZE, hWnd: tray, uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 };
    const cur = Number(user32.SHAppBarMessage(ABM.GETSTATE, d));
    if (on === undefined) return !!(cur & 1);
    d.lParam = on ? 1 : 2;
    user32.SHAppBarMessage(ABM.SETSTATE, d);
    return on;
  } catch { return null; }
}
// Show or hide every Windows taskbar (main + other screens).
function showTaskbars(on) {
  if (!user32 || !user32.ShowWindow) return;
  try {
    const list = [realTaskbar()];
    let h = 0;
    for (let i = 0; i < 16; i++) { h = Number(user32.FindWindowExW(0, h, 'Shell_SecondaryTrayWnd', null)); if (!h) break; list.push(h); }
    for (const t of list) if (t) user32.ShowWindow(t, on ? 8 /* SW_SHOWNA */ : 0 /* SW_HIDE */);
  } catch {}
}
function setWallpaperFile(p) {
  if (!user32 || !user32.SystemParametersInfoW || !p) return false;
  try { return !!user32.SystemParametersInfoW(0x14, 0, Buffer.from(p + '\0', 'utf16le'), 3 /* update ini + broadcast */); } catch { return false; }
}
function currentWallpaperPath() {
  if (!user32 || !user32.SystemParametersInfoW) return null;
  try { const buf = Buffer.alloc(1040); user32.SystemParametersInfoW(0x73, 520, buf, 0); return buf.toString('utf16le').split('\0')[0] || null; } catch { return null; }
}
// Tell running apps that the light/dark setting changed.
function broadcastThemeChange() {
  try { user32.SendMessageTimeoutStr(0xFFFF, 0x1A, 0, 'ImmersiveColorSet', 2, 300, Buffer.alloc(8)); } catch {}
}

module.exports = {
  keyCombo, focusWindow, minimizeWindow, closeWindow, lockWorkstation, foregroundHwnd, setToolWindow,
  appbarSet, appbarRemove, appbarRemoveAll, appbarRemoveHandle, holdRect, taskbarAutoHide, showTaskbars, setWallpaperFile, currentWallpaperPath, broadcastThemeChange,
  pin, sendToBottom, allowForeground, keyDown, moveTo, realBounds, placeNative, setCorners, watchWallpaper, readWallpaper, available: () => !!user32,
  attachToWallpaper, refreshWallpaper, foregroundState, menuOpen, monitorOf, fullscreenAppRunning, isWindowAlive, hwndOf, wallpaperFile,
};
