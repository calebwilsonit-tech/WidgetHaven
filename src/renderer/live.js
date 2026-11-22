// Live wallpaper page (one per display). Main sends 'live:config' and 'live:pause'.
const api = window.haven;
let engine = null, media = null, cfg = null, paused = false;

function clearMedia() { if (media) { media.remove(); media = null; } }
function apply(c) {
  cfg = c;
  paused = !!c.paused;
  document.body.classList.toggle('contain', c.fit === 'contain');
  const wantMedia = (c.source === 'video' && c.videoURL) || (c.source === 'image' && c.imageURL);
  if (wantMedia) {
    if (engine) { engine.destroy(); engine.canvas.style.display = 'none'; engine = null; }
    const tag = c.source === 'video' ? 'video' : 'img';
    const url = c.source === 'video' ? c.videoURL : c.imageURL;
    if (!media || media.tagName.toLowerCase() !== tag || media.dataset.url !== url) {
      clearMedia();
      media = document.createElement(tag);
      media.dataset.url = url;
      if (tag === 'video') Object.assign(media, { autoplay: true, loop: true, muted: true, playsInline: true });
      media.src = url;
      document.body.appendChild(media);
    }
    if (tag === 'video') { media.playbackRate = Math.max(0.25, Math.min(3, (c.speed || 100) / 100)); paused ? media.pause() : media.play().catch(() => {}); }
    return;
  }
  clearMedia();
  const opts = { scene: c.scene, c1: c.c1, c2: c.c2, speed: c.speed, intensity: c.intensity, fps: c.fps, wallpaperURL: c.wallpaperURL };
  const canvas = document.getElementById('c') || (engine && engine.canvas);
  if (!engine) engine = HavenScenes.create(canvas, opts); else engine.set(opts);
  engine.canvas.style.display = '';
  engine.canvas.id = 'c';
  engine.pause(paused);
}
api.on('live:config', apply);
api.on('live:pause', (p) => {
  paused = p;
  if (engine) engine.pause(p);
  if (media && media.tagName === 'VIDEO') p ? media.pause() : media.play().catch(() => {});
});

api.liveGet().then((c) => { if (c && !cfg) apply(c); });
