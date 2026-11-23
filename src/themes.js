// Haven Themes: one click recolors everything Haven draws — the bar, the hub and widgets, Studio
// widgets and the live wallpaper. "Auto" follows your wallpaper (Haven's original behaviour).
// Saved themes can also carry a wallpaper picture, a live wallpaper and a bar layout.
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { execFile } = require('child_process');

const BASE = { red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af' };
const BUILTIN = [
  { id: 'auto', name: 'Auto', desc: 'Matches your wallpaper and changes with it' },
  { id: 'mocha', name: 'Mocha', desc: 'Soft pastel on deep plum', scene: 'aurora', palette: { mode: 'dark', base: '#1e1e2e', mantle: '#181825', surface: '#313244', text: '#cdd6f4', subtext: '#a6adc8', accent: '#cba6f7', accent2: '#89b4fa', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af' } },
  { id: 'tokyo', name: 'Tokyo Night', desc: 'Neon blue city after dark', scene: 'night', palette: { mode: 'dark', base: '#1a1b26', mantle: '#16161e', surface: '#292e42', text: '#c0caf5', subtext: '#9aa5ce', accent: '#7aa2f7', accent2: '#bb9af7', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68' } },
  { id: 'rose', name: 'Rosé', desc: 'Dusky rose, gold and iris', scene: 'bokeh', palette: { mode: 'dark', base: '#191724', mantle: '#13111e', surface: '#26233a', text: '#e0def4', subtext: '#908caa', accent: '#ebbcba', accent2: '#c4a7e7', red: '#eb6f92', green: '#9ccfd8', yellow: '#f6c177' } },
  { id: 'gruvbox', name: 'Gruvbox', desc: 'Warm retro amber', scene: 'fireflies', palette: { mode: 'dark', base: '#282828', mantle: '#1d2021', surface: '#3c3836', text: '#ebdbb2', subtext: '#a89984', accent: '#fe8019', accent2: '#fabd2f', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f' } },
  { id: 'nord', name: 'Nord', desc: 'Calm arctic frost', scene: 'snow', palette: { mode: 'dark', base: '#2e3440', mantle: '#242933', surface: '#3b4252', text: '#eceff4', subtext: '#a5adbd', accent: '#88c0d0', accent2: '#81a1c1', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b' } },
  { id: 'dracula', name: 'Dracula', desc: 'Vivid purple and pink', scene: 'liquid', palette: { mode: 'dark', base: '#282a36', mantle: '#21222c', surface: '#44475a', text: '#f8f8f2', subtext: '#a4a7c0', accent: '#bd93f9', accent2: '#ff79c6', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c' } },
  { id: 'forest', name: 'Everforest', desc: 'Mossy greens, easy on the eyes', scene: 'fireflies', palette: { mode: 'dark', base: '#2d353b', mantle: '#232a2e', surface: '#3d484d', text: '#d3c6aa', subtext: '#9da9a0', accent: '#a7c080', accent2: '#83c092', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f' } },
  { id: 'neon', name: 'Synthwave', desc: 'Hot pink and cyan on midnight', scene: 'synthwave', palette: { mode: 'dark', base: '#140a24', mantle: '#0b0514', surface: '#2a1645', text: '#f6eaff', subtext: '#b89ad8', accent: '#ff4fd8', accent2: '#2de2e6', red: '#ff3864', green: '#72f1b8', yellow: '#fede5d' } },
  { id: 'mono', name: 'Mono', desc: 'Pure black and white', scene: 'rain', palette: { mode: 'dark', base: '#0f0f0f', mantle: '#080808', surface: '#262626', text: '#f4f4f4', subtext: '#9b9b9b', accent: '#f4f4f4', accent2: '#a3a3a3', red: '#f87171', green: '#86efac', yellow: '#fde68a' } },
  { id: 'latte', name: 'Latte', desc: 'Light pastel', scene: 'breathe', palette: { mode: 'light', base: '#eff1f5', mantle: '#e6e9ef', surface: '#ccd0da', text: '#4c4f69', subtext: '#6c6f85', accent: '#8839ef', accent2: '#1e66f5', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d' } },
  { id: 'paper', name: 'Paper', desc: 'Warm light, ink and rust', scene: 'breathe', palette: { mode: 'light', base: '#faf6ee', mantle: '#f1ebdf', surface: '#e2d9c6', text: '#2b2620', subtext: '#776d5e', accent: '#c2410c', accent2: '#0f766e', red: '#b91c1c', green: '#4d7c0f', yellow: '#b45309' } },
];

const hexRgb = (h) => { const n = parseInt(String(h || '#888888').slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(...x.map((v, i) => v + (y[i] - v) * t)); };

// Palette that follows the wallpaper.
function autoPalette(w) {
  const accent = (w && w.accent) || '#8b5cf6', accent2 = (w && (w.accent2 || w.accent)) || '#22d3ee';
  const light = !!(w && w.brightness > 0.62);
  return light
    ? { mode: 'light', base: mix('#f7f7fb', accent, 0.07), mantle: mix('#eeeef4', accent, 0.08), surface: mix('#dedfe8', accent, 0.16), text: '#1b1c25', subtext: '#5d6070', accent, accent2, red: '#dc2626', green: '#16a34a', yellow: '#ca8a04' }
    : { mode: 'dark', base: mix('#0e0e15', accent, 0.1), mantle: mix('#09090e', accent, 0.06), surface: mix('#20202c', accent, 0.2), text: '#eef0f8', subtext: '#a3a7b8', accent, accent2, ...BASE };
}

function setup({ store, save, desktop, getWallpaper, dataDir, onApplied, log }) {
  const S = () => store.settings;
  const THEME_DIR = path.join(dataDir, 'themes');
  const all = () => [...BUILTIN, ...(S().customThemes || []).map((t) => ({ ...t, custom: true }))];
  const find = (id) => all().find((t) => t.id === id);
  const currentId = () => (find(S().themeId) ? S().themeId : 'auto');
  function palette(id = currentId()) {
    const t = find(id);
    return t && t.palette ? { ...BASE, ...t.palette } : autoPalette(getWallpaper());
  }
  // Wallpaper info with the theme's accents swapped in (Studio widgets + the live wallpaper use this).
  function themedWallpaper() {
    const w = getWallpaper();
    if (currentId() === 'auto') return w;
    const p = palette();
    return { ...(w || {}), accent: p.accent, accent2: p.accent2 };
  }

  function setWindowsMode(mode) {
    const v = mode === 'light' ? '1' : '0';
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
    let n = 0;
    const done = () => { if (++n === 2) desktop.broadcastThemeChange(); };
    for (const name of ['AppsUseLightTheme', 'SystemUsesLightTheme']) execFile('reg.exe', ['add', key, '/v', name, '/t', 'REG_DWORD', '/d', v, '/f'], { windowsHide: true }, done);
  }

  function apply(id, { quiet } = {}) {
    const t = find(id) || find('auto');
    const prev = { ...S() };
    S().themeId = t.id;
    if (t.id === 'auto') {
      Object.assign(S(), { accentMode: 'wallpaper', theme: 'wallpaper', tint: null });
    } else {
      const p = { ...BASE, ...t.palette };
      Object.assign(S(), { accent: p.accent, accentMode: 'custom', theme: p.mode, tint: p.base });
    }
    const x = t.extras || {};
    if (x.look) Object.assign(S(), x.look);
    if (x.bar) S().bar = { ...S().bar, ...x.bar, enabled: S().bar && S().bar.enabled };
    if (x.live) S().live = { ...S().live, ...x.live };
    if (x.wallpaper && fs.existsSync(x.wallpaper)) desktop.setWallpaperFile(x.wallpaper);
    if ((S().themeOpts || {}).windowsMode) setWindowsMode(t.id === 'auto' ? (palette().mode) : t.palette.mode);
    save();
    onApplied && onApplied(prev, { quiet, live: !!x.live });
    return t;
  }

  function saveCurrent(name, opts = {}) {
    const p = palette();
    const id = 'c' + Date.now().toString(36);
    const extras = {};
    if (opts.wallpaper) {
      const src = desktop.wallpaperFile();
      if (src) {
        fs.mkdirSync(THEME_DIR, { recursive: true });
        const dst = path.join(THEME_DIR, id + '.jpg');
        try { fs.copyFileSync(src, dst); extras.wallpaper = dst; } catch {}
      }
    }
    if (opts.live) { const { enabled, ...rest } = S().live || {}; extras.live = { ...rest, enabled }; }
    if (opts.bar) { const { enabled, ...rest } = S().bar || {}; extras.bar = rest; }
    if (opts.look) extras.look = { glass: S().glass, opacity: S().opacity, plates: S().plates, border: S().border };
    const t = { id, name: String(name || 'My theme').slice(0, 40), desc: 'Saved ' + new Date().toLocaleDateString(), palette: p, extras };
    S().customThemes = [...(S().customThemes || []), t];
    S().themeId = id;
    save();
    return t;
  }
  function remove(id) {
    const t = (S().customThemes || []).find((x) => x.id === id);
    if (!t) return;
    if (t.extras && t.extras.wallpaper && t.extras.wallpaper.startsWith(THEME_DIR)) { try { fs.unlinkSync(t.extras.wallpaper); } catch {} }
    S().customThemes = S().customThemes.filter((x) => x.id !== id);
    if (S().themeId === id) apply('auto');
    for (const k of Object.keys(S().desktopThemes || {})) if (S().desktopThemes[k] === id) delete S().desktopThemes[k];
    save();
  }
  function next(dir = 1) {
    const list = all();
    const i = list.findIndex((t) => t.id === currentId());
    return apply(list[(i + dir + list.length) % list.length].id);
  }
  function list() {
    return { themes: all().map((t) => ({ id: t.id, name: t.name, desc: t.desc, custom: !!t.custom, scene: t.scene || null, palette: palette(t.id), hasWallpaper: !!(t.extras && t.extras.wallpaper), hasLive: !!(t.extras && t.extras.live), hasBar: !!(t.extras && t.extras.bar) })), current: currentId(), opts: S().themeOpts || {}, desktopThemes: S().desktopThemes || {} };
  }

  ipcMain.handle('theme:list', () => list());
  ipcMain.handle('theme:apply', (_, id) => { apply(id); return list(); });
  ipcMain.handle('theme:save', (_, name, opts) => { saveCurrent(name, opts || {}); onApplied && onApplied({ ...S() }, { quiet: true }); return list(); });
  ipcMain.handle('theme:delete', (_, id) => { remove(id); onApplied && onApplied({ ...S() }, { quiet: true }); return list(); });
  ipcMain.handle('theme:opts', (_, patch) => { S().themeOpts = { ...(S().themeOpts || {}), ...patch }; if (patch.windowsMode) setWindowsMode(palette().mode); save(); return list(); });
  ipcMain.handle('theme:desktop', (_, desktopId, themeId) => {
    S().desktopThemes = { ...(S().desktopThemes || {}) };
    if (themeId) S().desktopThemes[desktopId] = themeId; else delete S().desktopThemes[desktopId];
    save();
    return list();
  });
  ipcMain.handle('theme:scene', (_, id) => {
    // Use the theme's matching live wallpaper scene.
    const t = find(id);
    if (!t || !t.scene) return null;
    S().live = { ...S().live, enabled: true, source: 'scene', scene: t.scene, colors: 'wallpaper' };
    save();
    onApplied && onApplied({ ...S() }, { quiet: true, live: true });
    return S().live;
  });

  return { BUILTIN, all, list, palette, apply, next, currentId, themedWallpaper, saveCurrent, remove };
}

module.exports = { setup, BUILTIN, autoPalette };
