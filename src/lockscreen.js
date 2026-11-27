// Haven Lockscreen: instant preloaded in-session lockscreen overlay (with theme, live scenes,
// clocks, media controls, and Any / PIN / Windows-password unlock) plus optional wallpaper sync
// to the stock Windows lock screen.
const { app, BrowserWindow, ipcMain, screen, globalShortcut, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DEFAULTS = {
  enabled: false,
  unlockMode: 'any',       // 'any' | 'pin' | 'windows'
  pinHash: '',
  pinSalt: '',
  clockStyle: 'modern',    // 'modern' | 'minimal' | 'bold' | 'mono'
  clock24: false,
  showDate: true,
  showGreeting: true,
  showMedia: true,
  bgMode: 'theme',         // 'theme' | 'wallpaper' | 'scene' | 'solid'
  blur: 14,
  dim: 35,
  hotkey: true,            // Ctrl+Alt+Shift+L
  idleMinutes: 0,          // 0 = off
  fallbackWinLock: 0,      // 0 = off; minutes after Haven lockscreen engages to call LockWorkStation
  syncWindowsLock: false,  // push current wallpaper to stock Windows lock screen via WinRT
  fastBootStart: false,    // zero-delay Windows Logon Scheduled Task so Haven starts right as Windows boots into your session
  lockOnBoot: false,       // launch straight into Haven's lockscreen before loading the rest of Haven
  replaceStockLock: false, // disable Windows' stock lock screen curtain (NoLockScreen policy, requires UAC) & use Haven's
};

// Optional Win32 password verification (LogonUserW via koffi)
let winAuth = null;
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const advapi = koffi.load('advapi32.dll');
    const kernel = koffi.load('kernel32.dll');
    winAuth = {
      LogonUserW: advapi.func('bool __stdcall LogonUserW(const char16_t *user, const char16_t *domain, const char16_t *pass, uint32_t logonType, uint32_t provider, _Out_ intptr_t *token)'),
      CloseHandle: kernel.func('bool __stdcall CloseHandle(intptr_t h)'),
    };
  } catch {}
}

function verifyWindowsPassword(password) {
  if (!winAuth || typeof password !== 'string') return false;
  const user = os.userInfo().username;
  if (!user) return false;
  const domains = [process.env.USERDOMAIN || '.', '.', null];
  const seen = new Set();
  for (const dom of domains) {
    const key = dom === null ? '\0' : dom;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const tok = [0];
      // LOGON32_LOGON_INTERACTIVE = 2, LOGON32_PROVIDER_DEFAULT = 0
      const ok = winAuth.LogonUserW(user, dom, password, 2, 0, tok);
      if (ok) {
        if (tok[0]) try { winAuth.CloseHandle(tok[0]); } catch {}
        return true;
      }
    } catch {}
  }
  return false;
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), String(salt), 32).toString('hex');
}

function verifyPin(pin, cfg) {
  if (!cfg.pinHash || !cfg.pinSalt) return true;
  try {
    const a = Buffer.from(hashPin(pin, cfg.pinSalt), 'hex');
    const b = Buffer.from(cfg.pinHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function setup({ store, save, desktop, webPrefs, makeLogo, dataDir, palette, getWallpaperURL, getLive, getMedia, sendMedia, getDisplayName, onUnlock, log }) {
  const S = () => ({ ...DEFAULTS, ...(store.settings.lockscreen || {}) });
  const safeCfg = () => {
    const { pinHash, pinSalt, ...rest } = S();
    return { ...rest, hasPin: !!(pinHash && pinSalt) };
  };

  let primaryWin = null;
  let coverWins = [];
  let locked = false;
  let lockedAt = 0;
  let focusGuard = null;
  let mediaTimer = null;
  let fallbackTimer = null;
  let idleTimer = null;
  let hotkeyOn = false;
  let lastSync = null;
  let syncDebounce = null;

  const HOTKEY = 'Ctrl+Alt+Shift+L';

  function blockShortcuts(w) {
    w.webContents.on('before-input-event', (e, input) => {
      if (!locked) return;
      const k = (input.key || '').toLowerCase();
      if ((input.alt && k === 'f4') || (input.control && k === 'w') || k === 'f11') {
        e.preventDefault();
      }
    });
  }

  function ensurePrimary() {
    if (primaryWin && !primaryWin.isDestroyed()) return primaryWin;
    const d = screen.getPrimaryDisplay();
    primaryWin = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, show: false, backgroundColor: '#09090e',
      skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, alwaysOnTop: true,
      title: 'Haven Lockscreen', icon: makeLogo(64),
      webPreferences: { ...webPrefs, backgroundThrottling: false },
    });
    primaryWin.setMenuBarVisibility(false);
    try { desktop.setToolWindow(primaryWin); } catch {}
    blockShortcuts(primaryWin);
    primaryWin.on('close', (e) => {
      if (locked) e.preventDefault();
    });
    primaryWin.loadFile(path.join(__dirname, 'renderer', 'lockscreen.html'));
    return primaryWin;
  }

  function buildPayload(secondary = false) {
    const c = safeCfg();
    const liveCfg = getLive ? getLive() : null;
    const effectiveUnlock = (c.unlockMode === 'pin' && !c.hasPin) ? 'any' : c.unlockMode;
    return {
      secondary,
      config: { ...c, unlockMode: effectiveUnlock, clock24: c.clock24 || !!store.settings.clock24 },
      palette: palette ? palette() : null,
      wallpaperURL: getWallpaperURL ? getWallpaperURL() : '',
      live: liveCfg,
      displayName: (getDisplayName && getDisplayName()) || os.userInfo().username || '',
      username: os.userInfo().username || '',
      media: getMedia ? getMedia() : null,
      winAuthAvailable: !!winAuth,
    };
  }

  function destroyCovers() {
    for (const w of coverWins) {
      try { if (w && !w.isDestroyed()) w.destroy(); } catch {}
    }
    coverWins = [];
  }

  function lock() {
    if (locked) return true;
    locked = true;
    lockedAt = Date.now();
    const primary = screen.getPrimaryDisplay();
    const w = ensurePrimary();
    w.setBounds(primary.bounds);
    const payload = buildPayload(false);
    const pushOpen = () => w.webContents.send('lock:open', payload);
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', pushOpen);
    else pushOpen();

    w.setAlwaysOnTop(true, 'screen-saver');
    w.show();
    w.focus();
    try { desktop.focusWindow(desktop.hwndOf(w)); } catch {}

    // Cover any secondary monitors with matching frameless backdrops (no kiosk/fullscreen to avoid breaking AppBars)
    destroyCovers();
    for (const d of screen.getAllDisplays()) {
      if (d.id === primary.id) continue;
      const cw = new BrowserWindow({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
        frame: false, show: false, backgroundColor: '#09090e',
        skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, alwaysOnTop: true,
        title: 'Haven Lockscreen', icon: makeLogo(64),
        webPreferences: { ...webPrefs, backgroundThrottling: false },
      });
      cw.setMenuBarVisibility(false);
      try { desktop.setToolWindow(cw); } catch {}
      blockShortcuts(cw);
      cw.on('close', (e) => { if (locked) e.preventDefault(); });
      const secPayload = buildPayload(true);
      cw.webContents.once('did-finish-load', () => {
        if (!cw.isDestroyed()) cw.webContents.send('lock:open', secPayload);
      });
      cw.loadFile(path.join(__dirname, 'renderer', 'lockscreen.html'), { query: { secondary: '1' } });
      cw.setAlwaysOnTop(true, 'screen-saver');
      cw.showInactive();
      coverWins.push(cw);
    }

    // Keep primary lockscreen focused while locked
    clearInterval(focusGuard);
    focusGuard = setInterval(() => {
      if (!locked || !primaryWin || primaryWin.isDestroyed()) return;
      if (!primaryWin.isFocused()) {
        primaryWin.setAlwaysOnTop(true, 'screen-saver');
        primaryWin.focus();
        try { desktop.focusWindow(desktop.hwndOf(primaryWin)); } catch {}
      }
    }, 600);

    // Keep media info fresh while locked
    clearInterval(mediaTimer);
    mediaTimer = setInterval(() => {
      if (!locked || !primaryWin || primaryWin.isDestroyed()) return;
      if (getMedia) primaryWin.webContents.send('lock:media', getMedia());
    }, 2500);

    // Optional fallback to real Windows lock after N minutes
    clearTimeout(fallbackTimer);
    const fb = Number(S().fallbackWinLock) || 0;
    if (fb > 0) {
      fallbackTimer = setTimeout(() => {
        if (locked) winLock();
      }, fb * 60 * 1000);
    }
    return true;
  }

  function unlock(immediate = false) {
    if (!locked) return;
    locked = false;
    clearInterval(focusGuard); focusGuard = null;
    clearInterval(mediaTimer); mediaTimer = null;
    clearTimeout(fallbackTimer); fallbackTimer = null;
    destroyCovers();
    const finish = () => {
      if (primaryWin && !primaryWin.isDestroyed() && !locked) {
        primaryWin.hide();
      }
      if (onUnlock) setTimeout(() => onUnlock(), 40);
    };
    if (primaryWin && !primaryWin.isDestroyed()) {
      if (immediate) {
        finish();
      } else {
        try { primaryWin.webContents.send('lock:close'); } catch {}
        setTimeout(finish, 180);
      }
    } else if (onUnlock) {
      setTimeout(() => onUnlock(), 40);
    }
  }

  function winLock() {
    unlock(true);
    desktop.lockWorkstation();
  }

  // If Windows locks for real (e.g. Win+L or lid close), dismiss Haven's overlay so the user doesn't double-unlock
  powerMonitor.on('lock-screen', () => {
    if (locked) unlock(true);
  });

  // ------------------------------------------------------------ Stock Windows lock screen wallpaper sync
  function syncWindowsLockWallpaper() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        lastSync = { ok: false, at: Date.now(), message: 'Windows only' };
        return resolve(lastSync);
      }
      const src = desktop.wallpaperFile();
      if (!src || !fs.existsSync(src)) {
        lastSync = { ok: false, at: Date.now(), message: 'No wallpaper file found' };
        return resolve(lastSync);
      }
      const dst = path.join(dataDir, 'lockscreen-wall.jpg');
      try { fs.copyFileSync(src, dst); } catch (e) {
        lastSync = { ok: false, at: Date.now(), message: e.message };
        return resolve(lastSync);
      }
      const ps = [
        '$ErrorActionPreference = "Stop"',
        '[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null',
        '[Windows.System.UserProfile.LockScreen, Windows.System.UserProfile, ContentType=WindowsRuntime] | Out-Null',
        'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
        '$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1" })[0]',
        '$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncAction" })[0]',
        'function AwaitOp($op, $t) { $m = $asTaskGeneric.MakeGenericMethod($t); $task = $m.Invoke($null, @($op)); $task.Wait(); return $task.Result }',
        'function AwaitAct($act) { $task = $asTask.Invoke($null, @($act)); $task.Wait() }',
        `$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${dst.replace(/'/g, "''")}')) ([Windows.Storage.StorageFile])`,
        'AwaitAct ([Windows.System.UserProfile.LockScreen]::SetImageFileAsync($file))',
      ].join('; ');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 15000 }, (err) => {
        if (err) {
          log && log('lockscreen wallpaper sync failed: ' + err.message);
          lastSync = { ok: false, at: Date.now(), message: 'Could not update Windows lock screen' };
        } else {
          lastSync = { ok: true, at: Date.now(), message: 'Synced to Windows lock screen' };
        }
        resolve(lastSync);
      });
    });
  }

  function onWallpaperOrThemeChange() {
    if (!S().syncWindowsLock) return;
    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(() => syncWindowsLockWallpaper(), 800);
  }

  // ------------------------------------------------------------ Hotkey, idle timer & preloading
  function apply() {
    const c = S();
    const wantKey = !!(c.enabled && c.hotkey);
    if (wantKey !== hotkeyOn) {
      try {
        if (wantKey) globalShortcut.register(HOTKEY, () => lock());
        else globalShortcut.unregister(HOTKEY);
      } catch {}
      hotkeyOn = wantKey;
    }

    clearInterval(idleTimer); idleTimer = null;
    if (c.enabled && c.idleMinutes > 0) {
      idleTimer = setInterval(() => {
        if (locked) return;
        try {
          if (desktop.fullscreenAppRunning && desktop.fullscreenAppRunning()) return;
          if (powerMonitor.getSystemIdleTime() >= c.idleMinutes * 60) lock();
        } catch {}
      }, 10000);
    }

    if (c.enabled) {
      setTimeout(() => { if (S().enabled) ensurePrimary(); }, 1800);
    } else {
      if (locked) unlock(true);
      if (primaryWin && !primaryWin.isDestroyed()) { primaryWin.destroy(); primaryWin = null; }
    }
  }

  // ------------------------------------------------------------ Fast boot startup task (zero-delay ONLOGON)
  const TASK_NAME = 'HavenFastStart';
  function startupCommand(withLock) {
    const exe = process.execPath;
    const args = [];
    if (!app.isPackaged) args.push(`"${path.resolve(process.argv[1] || '.')}"`);
    args.push('--hidden');
    if (withLock) args.push('--lock');
    return `"${exe}" ${args.join(' ')}`;
  }

  function setFastBootTask(enable, withLock) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve({ ok: false, message: 'Windows only' });
      if (!enable) {
        execFile('schtasks.exe', ['/Delete', '/TN', TASK_NAME, '/F'], { windowsHide: true, timeout: 10000 }, () => {
          resolve({ ok: true, message: 'Fast boot task removed' });
        });
        return;
      }
      const tr = startupCommand(withLock);
      execFile('schtasks.exe', ['/Create', '/TN', TASK_NAME, '/TR', tr, '/SC', 'ONLOGON', '/F'], { windowsHide: true, timeout: 10000 }, (err) => {
        if (err) {
          log && log('fast boot task create failed: ' + err.message);
          return resolve({ ok: false, message: 'Could not create startup task' });
        }
        resolve({ ok: true, message: withLock ? 'Fast startup + lock on boot enabled' : 'Fast startup on boot enabled' });
      });
    });
  }

  // ------------------------------------------------------------ Disable / restore stock Windows lock screen (NoLockScreen policy)
  const LOCK_POLICY_KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Personalization';
  function queryStockLockDisabled() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(false);
      execFile('reg.exe', ['query', LOCK_POLICY_KEY, '/v', 'NoLockScreen'], { windowsHide: true, timeout: 5000 }, (err, out) => {
        if (err) return resolve(false);
        resolve(/NoLockScreen\s+REG_DWORD\s+0x1/i.test(String(out || '')));
      });
    });
  }

  function setStockLockDisabled(disable) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve({ ok: false, disabled: false, message: 'Windows only' });
      const regArgs = disable
        ? `add "${LOCK_POLICY_KEY}" /v NoLockScreen /t REG_DWORD /d 1 /f`
        : `delete "${LOCK_POLICY_KEY}" /v NoLockScreen /f`;
      const ps = `try { $p = Start-Process reg.exe -ArgumentList '${regArgs.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 30000 }, async (err) => {
        const disabled = await queryStockLockDisabled();
        if (err && disabled !== !!disable) {
          return resolve({ ok: false, disabled, message: 'Admin permission was cancelled or denied' });
        }
        if (disabled === !!disable) {
          resolve({ ok: true, disabled, message: disable ? 'Stock Windows lock screen disabled — Haven lockscreen enabled' : 'Stock Windows lock screen restored' });
        } else {
          resolve({ ok: false, disabled, message: 'Could not update Windows lock screen policy' });
        }
      });
    });
  }

  function statePayload(extra = {}) {
    return {
      config: safeCfg(),
      winAuthAvailable: !!winAuth,
      username: os.userInfo().username || '',
      displayName: (getDisplayName && getDisplayName()) || os.userInfo().username || '',
      lastSync,
      hotkey: HOTKEY,
      ...extra,
    };
  }

  function set(patch) {
    const prev = S();
    const next = { ...prev, ...(patch || {}) };
    // Never let renderer directly overwrite pinHash/pinSalt via set()
    next.pinHash = prev.pinHash;
    next.pinSalt = prev.pinSalt;
    store.settings.lockscreen = next;
    save();
    apply();
    if (next.syncWindowsLock && !prev.syncWindowsLock) syncWindowsLockWallpaper();
    if (next.fastBootStart && next.lockOnBoot !== prev.lockOnBoot) {
      setFastBootTask(true, !!next.lockOnBoot);
    }
    return statePayload();
  }

  // ------------------------------------------------------------ IPC
  ipcMain.handle('lock:get', async () => {
    const stockLockDisabled = await queryStockLockDisabled();
    if (S().replaceStockLock !== stockLockDisabled && process.platform === 'win32') {
      store.settings.lockscreen = { ...S(), replaceStockLock: stockLockDisabled };
      save();
    }
    return statePayload({ stockLockDisabled });
  });
  ipcMain.handle('lock:set', async (_, patch) => {
    set(patch);
    const stockLockDisabled = await queryStockLockDisabled();
    return statePayload({ stockLockDisabled });
  });
  ipcMain.handle('lock:setFastBoot', async (_, enable) => {
    const cur = S();
    const res = await setFastBootTask(!!enable, !!cur.lockOnBoot);
    if (res.ok) {
      store.settings.lockscreen = { ...cur, fastBootStart: !!enable };
      save();
    }
    const stockLockDisabled = await queryStockLockDisabled();
    return { ...statePayload({ stockLockDisabled }), result: res };
  });
  ipcMain.handle('lock:setStockLock', async (_, disable) => {
    const res = await setStockLockDisabled(!!disable);
    const cur = S();
    const next = { ...cur, replaceStockLock: res.disabled };
    if (res.ok && res.disabled) next.enabled = true;
    store.settings.lockscreen = next;
    save();
    apply();
    return { ...statePayload({ stockLockDisabled: res.disabled }), result: res };
  });
  ipcMain.handle('lock:setPin', async (_, pin) => {
    const cur = S();
    if (!pin) {
      store.settings.lockscreen = { ...cur, pinHash: '', pinSalt: '' };
    } else {
      const salt = crypto.randomBytes(16).toString('hex');
      store.settings.lockscreen = { ...cur, pinSalt: salt, pinHash: hashPin(String(pin), salt) };
    }
    save();
    const stockLockDisabled = await queryStockLockDisabled();
    return statePayload({ stockLockDisabled });
  });
  ipcMain.handle('lock:testWinPass', (_, pass) => verifyWindowsPassword(pass));
  ipcMain.handle('lock:now', () => lock());
  ipcMain.handle('lock:verify', (_, secret) => {
    const c = S();
    const mode = (c.unlockMode === 'pin' && !(c.pinHash && c.pinSalt)) ? 'any' : c.unlockMode;
    if (mode === 'any' && Date.now() - lockedAt < 500) return { ok: false, ignored: true };
    let ok = false;
    if (mode === 'any') ok = true;
    else if (mode === 'pin') ok = verifyPin(secret, c);
    else if (mode === 'windows') ok = verifyWindowsPassword(secret);
    if (ok) unlock(false);
    return { ok };
  });
  ipcMain.handle('lock:winLock', () => { winLock(); return true; });
  ipcMain.handle('lock:focusPrimary', () => {
    if (locked && primaryWin && !primaryWin.isDestroyed()) {
      primaryWin.focus();
      try { desktop.focusWindow(desktop.hwndOf(primaryWin)); } catch {}
    }
  });
  ipcMain.handle('lock:media', (_, cmd) => {
    if (sendMedia) sendMedia(cmd);
    return true;
  });
  ipcMain.handle('lock:syncNow', () => syncWindowsLockWallpaper());

  function stop() {
    clearInterval(idleTimer);
    clearInterval(focusGuard);
    clearInterval(mediaTimer);
    clearTimeout(fallbackTimer);
    clearTimeout(syncDebounce);
    if (hotkeyOn) { try { globalShortcut.unregister(HOTKEY); } catch {} hotkeyOn = false; }
    locked = false;
    destroyCovers();
    if (primaryWin && !primaryWin.isDestroyed()) { try { primaryWin.destroy(); } catch {} primaryWin = null; }
  }

  return { apply, set, cfg: safeCfg, lock, unlock, winLock, isLocked: () => locked, syncWindowsLockWallpaper, onWallpaperOrThemeChange, stop, HOTKEY };
}

module.exports = { setup, DEFAULTS };
