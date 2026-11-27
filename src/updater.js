// Updates from the GitHub releases (calebwilsonit-tech/WidgetHaven).
// The installed version downloads new releases in the background and installs them on restart (or when
// you quit). The portable version can't replace itself, so it just tells you a new version is out.
const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');

const RELEASES = 'https://github.com/calebwilsonit-tech/WidgetHaven/releases/latest';

function setup({ store, save, makeLogo, onState, beforeInstall, log }) {
  let autoUpdater = null;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { log && log('updater unavailable: ' + e.message); }
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  const enabled = () => store.settings.autoUpdate !== false;
  let state = { status: app.isPackaged && autoUpdater ? 'idle' : 'dev', version: null, percent: 0, error: null, portable, current: app.getVersion() };
  const set = (patch) => { state = { ...state, ...patch }; onState && onState(state); };

  if (state.status !== 'dev') {
    autoUpdater.autoDownload = !portable;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => set({ status: 'latest' }));
    autoUpdater.on('update-available', (info) => {
      set({ status: portable ? 'available' : 'downloading', version: info.version, percent: 0 });
      if (portable) notify(`Haven ${info.version} is out`, 'Click to download it from GitHub.', () => shell.openExternal(RELEASES));
    });
    autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => {
      set({ status: 'ready', version: info.version, percent: 100 });
      notify(`Haven ${info.version} is ready`, 'Click to restart and update now, or it installs the next time you quit Haven.', install);
    });
    autoUpdater.on('error', (e) => set({ status: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 160) }));
  }

  function notify(title, body, onClick) {
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, icon: makeLogo ? makeLogo(64) : undefined });
      if (onClick) n.on('click', onClick);
      n.show();
    } catch {}
  }
  function check() {
    if (state.status === 'dev' || ['checking', 'downloading', 'ready'].includes(state.status)) return Promise.resolve(state);
    return autoUpdater.checkForUpdates().then(() => state).catch((e) => { set({ status: 'error', error: String((e && e.message) || e).slice(0, 160) }); return state; });
  }
  function install() {
    if (state.status !== 'ready') return;
    beforeInstall && beforeInstall();
    app.removeAllListeners('window-all-closed');
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.removeAllListeners('close'); w.destroy(); } catch {}
    }
    // Give background helpers (e.g. sysinfo.ps1) a moment to exit so NSIS can replace files cleanly.
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 180);
  }

  // First check shortly after start (so it doesn't slow startup), then every 6 hours.
  if (state.status !== 'dev') {
    setTimeout(() => enabled() && check(), 20000);
    setInterval(() => enabled() && check(), 6 * 3600 * 1000);
  }

  ipcMain.handle('update:get', () => state);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => install());
  ipcMain.handle('update:releases', () => shell.openExternal(RELEASES));

  return { state: () => state, check, install };
}

module.exports = { setup };
