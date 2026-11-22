// Discovers apps, games, recent files and folders on this PC.
const { app, shell } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 14);
const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
const env = (k) => process.env[k] || '';

const JUNK = /\b(uninstall|uninst|readme|read me|help|documentation|docs|website|web site|release notes|license|licence|manual|support|faq|changelog|what's new|homepage|online|register|eula)\b/i;
const DOC_EXT = /\.(txt|pdf|html?|chm|rtf|url|md|ini|log|xml)$/i;
const APP_EXT = /\.(exe|lnk|bat|cmd|ps1|msc|appref-ms|com|vbs)$/i;
const isGamePath = (p) => /\\steamapps\\common\\|\\epic games\\|\\gog galaxy\\games\\|\\riot games\\|\\ubisoft game launcher\\games\\|\\ea games\\|\\xboxgames\\/i.test(p || '');

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

async function walk(dir, depth = 0, out = []) {
  if (depth > 5) return out;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, depth + 1, out);
    else out.push(full);
  }
  return out;
}

function readLink(p) {
  try { return shell.readShortcutLink(p); } catch { return null; }
}

function classifyShortcut(lnkPath, folderHint = '') {
  const name = path.basename(lnkPath, path.extname(lnkPath));
  if (JUNK.test(name)) return null;
  const link = readLink(lnkPath);
  const target = link && link.target ? link.target : '';
  if (target && DOC_EXT.test(target)) return null;
  if (target && /\\(unins\d*|uninstall|setup|update|updater|crashreporter)\.exe$/i.test(target)) return null;
  const game = isGamePath(target) || /\\games?\\/i.test(folderHint);
  return {
    id: 'sm-' + hash(name.toLowerCase()),
    name,
    type: game ? 'game' : 'app',
    path: lnkPath,
    target,
    args: link && link.args ? link.args : '',
  };
}

// ---------- Start Menu + Desktop shortcuts ----------
async function scanStartMenu() {
  const roots = [
    path.join(env('ProgramData'), 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(env('APPDATA'), 'Microsoft\\Windows\\Start Menu\\Programs'),
  ];
  const seen = new Map();
  for (const root of roots) {
    const files = await walk(root);
    for (const f of files) {
      if (!/\.lnk$/i.test(f)) continue;
      const rel = path.relative(root, path.dirname(f));
      const it = classifyShortcut(f, rel ? '\\' + rel + '\\' : '');
      if (!it || seen.has(it.id)) continue;
      it.source = 'startmenu';
      seen.set(it.id, it);
    }
  }
  return [...seen.values()];
}

async function scanDesktop() {
  const dirs = [app.getPath('desktop'), path.join(env('PUBLIC'), 'Desktop')];
  const shortcuts = [];
  const loose = [];
  for (const d of dirs) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (/^desktop\.ini$/i.test(e.name) || e.name.startsWith('~$')) continue;
      if (/\.lnk$/i.test(e.name)) {
        const it = classifyShortcut(full);
        if (it) { it.source = 'desktop'; shortcuts.push(it); }
      } else if (/\.url$/i.test(e.name)) {
        // Steam/Epic desktop shortcuts are covered by their own scanners.
        continue;
      } else {
        loose.push(fileItem(full, e.isDirectory(), 'desktop', true));
      }
    }
  }
  return { shortcuts, loose };
}

function fileItem(p, isDir, source, transient = false, extra = {}) {
  const ext = path.extname(p);
  const name = isDir ? path.basename(p) : path.basename(p, APP_EXT.test(p) ? ext : '') ;
  let type = isDir ? 'folder' : APP_EXT.test(p) ? 'app' : 'file';
  if (type === 'app' && /\.lnk$/i.test(p)) {
    const l = readLink(p);
    if (l && isGamePath(l.target)) type = 'game';
  }
  return { id: 'p-' + hash(p.toLowerCase()), name: name || p, type, path: p, source, transient, ...extra };
}

// ---------- Recent files (Windows' own Recent list) ----------
async function scanRecent() {
  const dir = path.join(env('APPDATA'), 'Microsoft\\Windows\\Recent');
  let entries;
  try { entries = await fsp.readdir(dir); } catch { return []; }
  const stats = [];
  for (const n of entries) {
    if (!/\.lnk$/i.test(n)) continue;
    const full = path.join(dir, n);
    try { stats.push({ full, t: (await fsp.stat(full)).mtimeMs }); } catch {}
  }
  stats.sort((a, b) => b.t - a.t);
  const out = [];
  const seen = new Set();
  for (const s of stats) {
    if (out.length >= 48) break;
    const l = readLink(s.full);
    if (!l || !l.target || seen.has(l.target.toLowerCase())) continue;
    let st;
    try { st = await fsp.stat(l.target); } catch { continue; }
    seen.add(l.target.toLowerCase());
    out.push(fileItem(l.target, st.isDirectory(), 'recent', true, { recentAt: s.t }));
  }
  return out;
}

// ---------- Steam ----------
async function steamRoot() {
  const out = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
  const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
  const cands = [m && m[1].trim().replace(/\//g, '\\'), 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  return cands.find((c) => c && exists(path.join(c, 'steamapps'))) || null;
}

function findSteamArt(root, appid) {
  const cache = path.join(root, 'appcache', 'librarycache');
  const pick = (names) => {
    for (const n of names) {
      const flat = path.join(cache, `${appid}_${n}`);
      if (exists(flat)) return flat;
      const nested = path.join(cache, String(appid), n);
      if (exists(nested)) return nested;
    }
    // Newer Steam clients store art in hashed sub-folders.
    try {
      const dir = path.join(cache, String(appid));
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        for (const n of names) {
          const p = path.join(dir, e.name, n);
          if (exists(p)) return p;
        }
      }
    } catch {}
    return null;
  };
  return {
    cover: pick(['library_600x900.jpg', 'library_capsule.jpg']),
    hero: pick(['library_hero.jpg', 'header.jpg']),
    logo: pick(['logo.png']),
    icon: (() => {
      // Steam's own small game icon (hashed name) lives next to the art.
      try {
        const dir = path.join(cache, String(appid));
        const f = fs.readdirSync(dir).find((n) => /^[0-9a-f]{40}\.jpg$/i.test(n));
        return f ? path.join(dir, f) : null;
      } catch { return null; }
    })(),
  };
}

const STEAM_SKIP = /redistributable|steamworks|proton|steam linux runtime|dedicated server|\bsdk\b|steamvr performance test|soundtrack/i;
async function scanSteam() {
  const root = await steamRoot();
  if (!root) return [];
  const libs = new Set([root]);
  try {
    const vdf = await fsp.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
  } catch {}
  const games = new Map();
  for (const lib of libs) {
    const dir = path.join(lib, 'steamapps');
    let files;
    try { files = await fsp.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      let txt;
      try { txt = await fsp.readFile(path.join(dir, f), 'utf8'); } catch { continue; }
      const appid = (txt.match(/"appid"\s+"(\d+)"/) || [])[1];
      const name = (txt.match(/"name"\s+"([^"]+)"/) || [])[1];
      const installdir = (txt.match(/"installdir"\s+"([^"]+)"/) || [])[1];
      if (!appid || !name || appid === '228980' || STEAM_SKIP.test(name)) continue;
      const art = findSteamArt(root, appid);
      games.set(appid, {
        id: 'steam-' + appid,
        name,
        type: 'game',
        url: `steam://rungameid/${appid}`,
        path: installdir ? path.join(dir, 'common', installdir) : null,
        source: 'steam',
        appid,
        cover: art.cover || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
        hero: art.hero || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`,
        iconFile: art.icon,
      });
    }
  }
  return [...games.values()];
}

// ---------- Epic Games ----------
async function scanEpic() {
  const dir = path.join(env('ProgramData'), 'Epic\\EpicGamesLauncher\\Data\\Manifests');
  let files;
  try { files = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!/\.item$/i.test(f)) continue;
    try {
      const j = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      if (j.bIsIncompleteInstall || !j.DisplayName) continue;
      if ((j.AppCategories || []).includes('plugins')) continue;
      const exe = j.InstallLocation && j.LaunchExecutable ? path.join(j.InstallLocation, j.LaunchExecutable) : null;
      out.push({
        id: 'epic-' + hash(j.AppName || j.DisplayName),
        name: j.DisplayName,
        type: 'game',
        url: `com.epicgames.launcher://apps/${encodeURIComponent(`${j.CatalogNamespace}:${j.CatalogItemId}:${j.AppName}`)}?action=launch&silent=true`,
        path: j.InstallLocation || null,
        iconTarget: exists(exe) ? exe : null,
        source: 'epic',
      });
    } catch {}
  }
  return out;
}

// ---------- Store / packaged apps (Settings, Xbox, Game Pass, etc.) ----------
async function scanPackaged() {
  const txt = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'], 20000);
  let list = [];
  try { list = JSON.parse(txt.trim() || '[]'); } catch { return []; }
  if (!Array.isArray(list)) list = [list];
  return list
    .filter((a) => a && a.AppID && a.AppID.includes('!') && a.Name && !JUNK.test(a.Name))
    .map((a) => ({
      id: 'sm-' + hash(a.Name.toLowerCase()),
      name: a.Name,
      type: /xbox|game|minecraft|solitaire/i.test(a.AppID) && !/xboxapp|gamingapp|gamebar|xboxidentity/i.test(a.AppID) ? 'game' : 'app',
      aumid: a.AppID,
      source: 'store',
    }));
}

function knownFolders() {
  const list = [
    ['Desktop', app.getPath('desktop')],
    ['Documents', app.getPath('documents')],
    ['Downloads', app.getPath('downloads')],
    ['Pictures', app.getPath('pictures')],
    ['Music', app.getPath('music')],
    ['Videos', app.getPath('videos')],
    ['Home', app.getPath('home')],
  ];
  return list.filter(([, p]) => exists(p)).map(([name, p]) => ({ ...fileItem(p, true, 'system'), name }));
}

async function scanAll(sources = {}) {
  const on = (k) => sources[k] !== false;
  const [sm, desk, steam, epic, pkg, recent] = await Promise.all([
    on('startmenu') ? scanStartMenu() : [],
    on('desktop') ? scanDesktop() : { shortcuts: [], loose: [] },
    on('steam') ? scanSteam() : [],
    on('epic') ? scanEpic() : [],
    on('store') ? scanPackaged() : [],
    on('recent') ? scanRecent() : [],
  ]);
  const byId = new Map();
  const add = (it) => { if (!byId.has(it.id)) byId.set(it.id, it); };
  // Launcher-native entries win over shortcuts that point at the same game.
  const gameNames = new Set([...steam, ...epic].map((g) => g.name.toLowerCase()));
  steam.forEach(add);
  epic.forEach(add);
  for (const it of [...sm, ...desk.shortcuts, ...pkg]) {
    if (it.type === 'game' && gameNames.has(it.name.toLowerCase())) continue;
    add(it);
  }
  knownFolders().forEach(add);
  desk.loose.forEach(add);
  recent.forEach(add);
  return [...byId.values()];
}

module.exports = { scanAll, fileItem, hash, isGamePath, readLink };
