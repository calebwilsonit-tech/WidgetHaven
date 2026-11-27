// Haven Lockscreen renderer
const api = window.haven;
const $ = (s) => document.querySelector(s);

let data = null;
let clockTimer = null;
let sceneEngine = null;
let busy = false;
let isOpen = false;
let armedAt = 0;
const isSecondary = new URLSearchParams(location.search).get('secondary') === '1';

if (isSecondary) document.body.classList.add('secondary');

function greet(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

function updateClock() {
  if (!data) return;
  const c = data.config || {};
  const now = new Date();
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  if (!c.clock24) h = h % 12 || 12;
  else h = String(h).padStart(2, '0');
  $('#clock').textContent = `${h}:${m}`;
  $('#date').hidden = !c.showDate;
  if (c.showDate) {
    $('#date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  $('#greeting').hidden = !c.showGreeting;
  if (c.showGreeting) {
    $('#greeting').textContent = greet(data.displayName);
  }
}

function applyPalette(p) {
  if (!p) return;
  const r = document.documentElement.style;
  if (p.base) r.setProperty('--base', p.base);
  if (p.surface) r.setProperty('--surface', p.surface);
  if (p.accent) r.setProperty('--accent', p.accent);
  if (p.accent2) r.setProperty('--accent2', p.accent2);
  if (p.red) r.setProperty('--red', p.red);
  // Keep lockscreen text crisp & readable over dimmed backdrops
  r.setProperty('--text', '#f4f6fc');
  r.setProperty('--subtext', 'rgba(244, 246, 252, 0.76)');
}

function applyBackdrop(d) {
  const c = d.config || {};
  const r = document.documentElement.style;
  r.setProperty('--blur', `${Number(c.blur ?? 14)}px`);
  r.setProperty('--dim', String(Math.max(0, Math.min(0.85, (Number(c.dim ?? 35)) / 100))));

  const wall = $('#bgWall');
  const canvas = $('#bgCanvas');
  const live = d.live || {};
  const useScene = (c.bgMode === 'scene') || (c.bgMode === 'theme' && live.enabled && live.source === 'scene');

  if (c.bgMode === 'solid') {
    wall.hidden = true;
    canvas.hidden = true;
    if (sceneEngine) sceneEngine.pause(true);
    return;
  }

  if (useScene && window.HavenScenes) {
    wall.hidden = true;
    canvas.hidden = false;
    const opts = {
      scene: live.scene || 'aurora',
      c1: (d.palette && d.palette.accent) || '#8b5cf6',
      c2: (d.palette && d.palette.accent2) || '#22d3ee',
      speed: live.speed || 100,
      intensity: live.intensity || 100,
      fps: 30,
      wallpaperURL: d.wallpaperURL || '',
    };
    if (!sceneEngine) sceneEngine = window.HavenScenes.create(canvas, opts);
    else sceneEngine.set(opts);
    sceneEngine.pause(false);
    return;
  }

  if (sceneEngine) sceneEngine.pause(true);
  canvas.hidden = true;
  if (d.wallpaperURL) {
    wall.hidden = false;
    wall.style.backgroundImage = `url("${d.wallpaperURL}")`;
  } else {
    wall.hidden = true;
  }
}

function renderMedia(m) {
  const card = $('#mediaCard');
  if (isSecondary || !data || !(data.config && data.config.showMedia) || !m || !m.title) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $('#mediaTitle').textContent = m.title || '';
  $('#mediaArtist').textContent = m.artist || '';
  $('#mPlay').innerHTML = m.playing
    ? '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
}

function openLock(d) {
  data = d;
  isOpen = true;
  busy = false;
  armedAt = Date.now() + 500;
  applyPalette(d.palette);
  document.body.classList.remove('style-modern', 'style-minimal', 'style-bold', 'style-mono');
  document.body.classList.add('style-' + ((d.config && d.config.clockStyle) || 'modern'));
  applyBackdrop(d);
  updateClock();
  clearInterval(clockTimer);
  clockTimer = setInterval(updateClock, 1000);
  renderMedia(d.media);

  const mode = (d.config && d.config.unlockMode) || 'any';
  const uAny = $('#uAny');
  const uForm = $('#uForm');
  const uInput = $('#uInput');
  const uErr = $('#uErr');
  uErr.textContent = '';
  uInput.value = '';

  if (!isSecondary) {
    if (mode === 'any') {
      uAny.hidden = false;
      uForm.hidden = true;
    } else {
      uAny.hidden = true;
      uForm.hidden = false;
      const name = d.displayName || d.username || 'User';
      $('#uName').textContent = name;
      $('#uAvatar').textContent = (name.trim()[0] || 'H').toUpperCase();
      if (mode === 'pin') {
        $('#uHint').textContent = 'Enter your Haven PIN';
        uInput.placeholder = 'PIN';
        uInput.inputMode = 'numeric';
      } else {
        $('#uHint').textContent = 'Enter your Windows password';
        uInput.placeholder = 'Windows password';
        uInput.inputMode = 'text';
      }
      setTimeout(() => uInput.focus(), 60);
    }
  }

  const shell = $('#shell');
  shell.classList.remove('out');
  requestAnimationFrame(() => shell.classList.add('in'));
}

function closeLock() {
  isOpen = false;
  clearInterval(clockTimer);
  clockTimer = null;
  if (sceneEngine) sceneEngine.pause(true);
  const shell = $('#shell');
  shell.classList.remove('in');
  shell.classList.add('out');
}

async function tryUnlock(secret) {
  if (!isOpen || busy) return;
  busy = true;
  const res = await api.lockVerify(secret || '');
  busy = false;
  if (res && res.ignored) return;
  if (!res || !res.ok) {
    const form = $('#uForm');
    const mode = data && data.config && data.config.unlockMode;
    $('#uErr').textContent = mode === 'pin' ? 'Incorrect PIN' : 'Incorrect Windows password';
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
    $('#uInput').select();
    $('#uInput').focus();
  }
}

$('#uForm').addEventListener('submit', (e) => {
  e.preventDefault();
  tryUnlock($('#uInput').value);
});

$('#uAny').addEventListener('click', () => {
  if (Date.now() < armedAt) return;
  tryUnlock('');
});

document.addEventListener('click', (e) => {
  if (!isOpen) return;
  if (e.target.closest('button, input, form, .media-card')) return;
  if (isSecondary) {
    if (data && data.config && data.config.unlockMode === 'any') {
      if (Date.now() >= armedAt) tryUnlock('');
    } else api.lockFocusPrimary();
    return;
  }
  if (data && data.config && data.config.unlockMode === 'any') {
    if (Date.now() >= armedAt) tryUnlock('');
  } else {
    $('#uInput').focus();
  }
});

document.addEventListener('keydown', (e) => {
  if (!isOpen) return;
  if (isSecondary) {
    if (data && data.config && data.config.unlockMode === 'any') {
      if (Date.now() >= armedAt) tryUnlock('');
    } else api.lockFocusPrimary();
    return;
  }
  const mode = (data && data.config && data.config.unlockMode) || 'any';
  if (mode === 'any') {
    if (Date.now() < armedAt) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    e.preventDefault();
    tryUnlock('');
  } else if (document.activeElement !== $('#uInput') && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    $('#uInput').focus();
  }
});

$('#bWinLock').addEventListener('click', (e) => {
  e.stopPropagation();
  api.lockWinLock();
});

$('#mPrev').addEventListener('click', (e) => { e.stopPropagation(); api.lockMedia('prev'); });
$('#mPlay').addEventListener('click', (e) => { e.stopPropagation(); api.lockMedia('toggle'); });
$('#mNext').addEventListener('click', (e) => { e.stopPropagation(); api.lockMedia('next'); });

api.on('lock:open', openLock);
api.on('lock:close', closeLock);
api.on('lock:media', renderMedia);
