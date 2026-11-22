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

module.exports = { pin, sendToBottom, allowForeground, keyDown, moveTo, watchWallpaper, readWallpaper, available: () => !!user32 };
