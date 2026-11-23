// Haven Launcher: a quick, animated app search (like rofi/wofi on Hyprland). Opens with Win+S
// (optional, replaces Windows search) or Alt+Space. The window is created once and kept hidden, so it
// appears instantly.
const { BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');

const DEFAULTS = { enabled: true, winS: true, altSpace: true, winKey: false };

function setup({ store, save, webPrefs, makeLogo, items, launchItem, palette, getFont, getRadius, focusWin, log }) {
  const S = () => ({ ...DEFAULTS, ...(store.settings.launcher || {}) });
  let win = null, shownAt = 0;

  function ensure() {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      width: 680, height: 520, frame: false, show: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      skipTaskbar: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true,
      title: 'Haven launcher', icon: makeLogo(64), webPreferences: { ...webPrefs, backgroundThrottling: false },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));
    win.on('blur', () => hide());
    return win;
  }
  function show() {
    const w = ensure();
    if (w.isVisible()) return hide();
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const a = d.workArea;
    w.setBounds({ x: Math.round(a.x + (a.width - 680) / 2), y: Math.round(a.y + a.height * 0.16), width: 680, height: 520 });
    const send = () => w.webContents.send('launcher:open', { items: items(), palette: palette(), font: getFont(), radius: getRadius ? getRadius() : 22 });
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
    shownAt = Date.now();
    w.show(); w.setAlwaysOnTop(true, 'pop-up-menu'); w.focus();
    // Haven is a background app here, so Windows needs a nudge to hand over the keyboard.
    if (focusWin) focusWin(w);
  }
  function hide() {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    win.webContents.send('launcher:close');
    setTimeout(() => { if (win && !win.isDestroyed()) win.hide(); }, 110);
  }
  ipcMain.on('launcher:hide', () => hide());
  ipcMain.handle('launcher:launch', (_, id) => { hide(); return launchItem(id); });

  // ------------------------------------------------------------ Win+S (low-level keyboard hook)
  let k = null, hookH = 0, hookCb = null;
  try {
    const koffi = require('koffi');
    const u = koffi.load('user32.dll'), kern = koffi.load('kernel32.dll');
    const KBD = koffi.struct('LAUNCHER_KBD', { vk: 'uint32', scan: 'uint32', flags: 'uint32', time: 'uint32', extra: 'uintptr_t' });
    const Proc = koffi.proto('intptr_t __stdcall LauncherHookProc(int code, uintptr_t wp, void *lp)');
    k = {
      koffi, Proc, KBD,
      SetWindowsHookExW: u.func('intptr_t __stdcall SetWindowsHookExW(int id, LauncherHookProc *cb, intptr_t mod, uint32_t tid)'),
      UnhookWindowsHookEx: u.func('bool __stdcall UnhookWindowsHookEx(intptr_t h)'),
      CallNextHookEx: u.func('intptr_t __stdcall CallNextHookEx(intptr_t h, int code, uintptr_t wp, void *lp)'),
      GetAsyncKeyState: u.func('int16_t __stdcall GetAsyncKeyState(int vk)'),
      keybd_event: u.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
      GetModuleHandleW: kern.func('intptr_t __stdcall GetModuleHandleW(const char16_t *n)'),
    };
  } catch (e) { log && log('launcher hook unavailable: ' + e.message); }
  const down = (vk) => (k.GetAsyncKeyState(vk) & 0x8000) !== 0;
  let swallowUp = false, winDown = false, winAlone = false, winKeyOn = false;
  function onKey(code, wp, lp) {
    // Keep this tiny: it runs for every key press on the PC.
    if (code !== 0 || !lp) return k.CallNextHookEx(0, code, wp, lp);
    const vk = k.koffi.decode(lp, k.KBD).vk;
    const isDown = wp === 0x100 || wp === 0x104;
    if (vk === 0x5B || vk === 0x5C) {
      // Tapping Windows on its own (no other key, no Ctrl/Alt/Shift) opens the launcher instead of Start.
      if (isDown && !winDown) winAlone = winKeyOn && !down(0x11) && !down(0x12) && !down(0x10);
      if (!isDown && winAlone) {
        winAlone = false; winDown = false;
        k.keybd_event(0xE8, 0, 0, 0); k.keybd_event(0xE8, 0, 2, 0); // Windows then skips the Start menu on release
        setImmediate(show);
        return k.CallNextHookEx(0, code, wp, lp); // still let the key go up, so it never sticks
      }
      winDown = isDown;
    } else if (isDown && vk !== 0xE8) winAlone = false; // Win+E, Win+D and so on keep working
    if (vk === 0x53 /* S */) {
      if (isDown && winDown && !down(0x11) && !down(0x12) && !down(0x10)) {
        swallowUp = true;
        k.keybd_event(0xE8, 0, 0, 0); k.keybd_event(0xE8, 0, 2, 0); // stops the Start menu opening when Win is released
        setImmediate(show);
        return 1;
      }
      if (!isDown && swallowUp) { swallowUp = false; return 1; }
    }
    return k.CallNextHookEx(0, code, wp, lp);
  }
  function hookOn(on) {
    if (!k) return;
    if (hookH) { k.UnhookWindowsHookEx(hookH); hookH = 0; }
    if (hookCb) { k.koffi.unregister(hookCb); hookCb = null; }
    if (!on) return;
    hookCb = k.koffi.register(onKey, k.koffi.pointer(k.Proc));
    hookH = Number(k.SetWindowsHookExW(13, hookCb, k.GetModuleHandleW(null), 0));
  }

  let altOn = false;
  function apply() {
    const c = S();
    winKeyOn = !!(c.enabled && c.winKey);
    hookOn(c.enabled && (c.winS || c.winKey));
    const wantAlt = c.enabled && c.altSpace;
    if (wantAlt !== altOn) { try { if (wantAlt) globalShortcut.register('Alt+Space', show); else globalShortcut.unregister('Alt+Space'); } catch {} altOn = wantAlt; }
    if (c.enabled) setTimeout(ensure, 1500); else if (win && !win.isDestroyed()) { win.destroy(); win = null; }
  }
  function set(patch) { store.settings.launcher = { ...S(), ...patch }; save(); apply(); return S(); }

  return { apply, set, cfg: S, show, stop: () => hookOn(false) };
}

module.exports = { setup, DEFAULTS };
