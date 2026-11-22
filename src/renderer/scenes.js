// Haven live-wallpaper scenes. HavenScenes.create(canvas, opts) → { set(opts), pause(bool), destroy() }
// opts: { scene, c1, c2, speed (100 = normal), intensity (100 = normal), fps, wallpaperURL, preview }
(function () {
  const LIST = [
    { id: 'aurora', name: 'Aurora', desc: 'Northern lights over a mountain ridge' },
    { id: 'liquid', name: 'Liquid', desc: 'Slow, swirling ink in your colors' },
    { id: 'synthwave', name: 'Synthwave', desc: 'Retro sun and an endless neon grid' },
    { id: 'night', name: 'Night sky', desc: 'Twinkling stars and the odd shooting star' },
    { id: 'bokeh', name: 'Bokeh', desc: 'Soft drifting lights' },
    { id: 'rain', name: 'Rain', desc: 'Rainfall over your own wallpaper', wall: true },
    { id: 'snow', name: 'Snow', desc: 'Snow drifting over your wallpaper', wall: true },
    { id: 'fireflies', name: 'Fireflies', desc: 'Glowing fireflies over your wallpaper', wall: true },
    { id: 'breathe', name: 'Breathe', desc: 'Your wallpaper, slowly zooming with drifting light', wall: true },
  ];

  const rgb = (hex) => { const h = String(hex || '#888').replace('#', ''); const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255); };
  const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},${a})`; };
  const rand = (a, b) => a + Math.random() * (b - a);

  // ------------------------------------------------------------ shader scenes
  const NOISE = `
    precision mediump float;
    uniform vec2 R; uniform float T; uniform vec3 C1; uniform vec3 C2; uniform float I;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(h(i), h(i+vec2(1.,0.)), f.x), mix(h(i+vec2(0.,1.)), h(i+vec2(1.,1.)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a*n(p); p *= 2.02; a *= .5; } return v; }
  `;
  const SHADERS = {
    aurora: NOISE + `
      void main(){
        vec2 uv = gl_FragCoord.xy / R; vec2 p = uv; p.x *= R.x / R.y;
        vec3 col = mix(vec3(.008,.01,.03), vec3(.02,.035,.09), uv.y);
        vec2 sp = floor(gl_FragCoord.xy / (R.y / 420.));
        float s = h(sp);
        col += step(.996, s) * (.55 + .45*sin(T*2.5 + s*90.)) * smoothstep(.2, .9, uv.y) * .9;
        for (int k = 0; k < 3; k++) {
          float fk = float(k);
          float y = .5 + .13*fk + .18*(fbm(vec2(p.x*.5 + T*.04 + fk*3.1, T*.025 + fk)) - .5);
          float band = exp(-pow((uv.y - y) * (6. + fk*2.), 2.));
          float curtain = fbm(vec2(p.x*3.2 + T*.15 + fk*7., uv.y*1.5 - T*.08));
          vec3 c = mix(C1, C2, smoothstep(.3, .7, fbm(vec2(p.x*.7 + fk*2., T*.03))));
          col += c * pow(curtain, 1.8) * band * 1.7 * I;
          col += c * .22 * I * band * smoothstep(.45, .85, n(vec2(p.x*38., T*.35 + fk)));
        }
        float m = .16 + .07*fbm(vec2(p.x*1.4, 3.)) + .025*n(vec2(p.x*9., 2.));
        col = mix(col, vec3(.004,.005,.012), smoothstep(m + .004, m - .004, uv.y));
        gl_FragColor = vec4(col, 1.);
      }`,
    liquid: NOISE + `
      void main(){
        vec2 uv = gl_FragCoord.xy / R; vec2 p = uv * vec2(R.x / R.y, 1.) * 1.7;
        float t = T * .06;
        vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
        vec2 r = vec2(fbm(p + 3.*q + vec2(1.7, 9.2) + t*1.5), fbm(p + 3.*q + vec2(8.3, 2.8) - t));
        float f = fbm(p + 3.*r);
        vec3 col = mix(vec3(.025,.025,.06), C1, clamp(f*f*2.4, 0., 1.));
        col = mix(col, C2, clamp(length(q)*.95 - .25, 0., 1.) * .85);
        col += vec3(1.) * pow(clamp(r.x, 0., 1.), 7.) * .3;
        col *= .45 + .55 * I;
        gl_FragColor = vec4(col, 1.);
      }`,
  };
  function shaderScene(canvas, id) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, SHADERS[id]));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = Object.fromEntries(['R', 'T', 'C1', 'C2', 'I'].map((k) => [k, gl.getUniformLocation(prog, k)]));
    return {
      scale: 0.5, // shaders are smooth; half resolution looks the same and saves the GPU
      frame(t, o) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(U.R, canvas.width, canvas.height);
        gl.uniform1f(U.T, t);
        gl.uniform3fv(U.C1, rgb(o.c1)); gl.uniform3fv(U.C2, rgb(o.c2));
        gl.uniform1f(U.I, o.intensity / 100);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy() { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); },
    };
  }

  // ------------------------------------------------------------ 2D helpers
  function wallLayer(o) {
    // Draws the user's wallpaper (cover-fit) into a cached offscreen canvas.
    let img = null, cache = null, cacheKey = '';
    if (o.wallpaperURL) { img = new Image(); img.onload = () => o.onWallLoad && o.onWallLoad(); img.src = o.wallpaperURL; }
    return {
      img: () => (img && img.complete && img.naturalWidth ? img : null),
      draw(ctx, W, H, dim = 0) {
        const im = this.img();
        if (!im) { ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, W, H); return; }
        const key = W + 'x' + H + ':' + dim;
        if (key !== cacheKey) {
          cache = document.createElement('canvas'); cache.width = W; cache.height = H;
          const c = cache.getContext('2d');
          const s = Math.max(W / im.naturalWidth, H / im.naturalHeight);
          c.drawImage(im, (W - im.naturalWidth * s) / 2, (H - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
          if (dim) { c.fillStyle = `rgba(4,6,12,${dim})`; c.fillRect(0, 0, W, H); }
          cacheKey = key;
        }
        ctx.drawImage(cache, 0, 0);
      },
    };
  }

  const SCENES2D = {
    synthwave(ctx, o) {
      let stars = [];
      return {
        resize(W, H) { stars = Array.from({ length: 160 }, () => [Math.random() * W, Math.random() * H * 0.55, Math.random()]); },
        frame(t, W, H) {
          const hz = H * 0.62;
          const sky = ctx.createLinearGradient(0, 0, 0, hz);
          sky.addColorStop(0, '#07021a'); sky.addColorStop(0.6, '#24063f'); sky.addColorStop(1, rgba(o.c1, 1));
          ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hz);
          let g;
          for (const [x, y, s] of stars) { ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.5 * Math.abs(Math.sin(t * 1.3 + s * 40))})`; ctx.fillRect(x, y, s * 1.8 + 0.5, s * 1.8 + 0.5); }
          // sun
          const r = H * 0.2, cx = W / 2, cy = hz - r * 0.35;
          const glow = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2.2);
          glow.addColorStop(0, rgba(o.c2, 0.45)); glow.addColorStop(1, rgba(o.c2, 0));
          ctx.fillStyle = glow; ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, Math.min(r * 4.4, hz - (cy - r * 2.2)));
          ctx.save();
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
          g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
          g.addColorStop(0, '#ffe66d'); g.addColorStop(0.55, rgba(o.c2, 1)); g.addColorStop(1, '#ff2a8a');
          ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
          ctx.fillStyle = sky;
          for (let i = 0; i < 7; i++) { const y = cy + r * (0.05 + i * 0.14) + ((t * 8) % (r * 0.14)); ctx.fillRect(cx - r, y, r * 2, 2 + i * 1.6); }
          ctx.restore();
          // ground + grid
          g = ctx.createLinearGradient(0, hz, 0, H); g.addColorStop(0, '#12002a'); g.addColorStop(1, '#030008');
          ctx.fillStyle = g; ctx.fillRect(0, hz, W, H - hz);
          ctx.strokeStyle = rgba(o.c2, 0.75 * (o.intensity / 100)); ctx.lineWidth = 1.5; ctx.shadowColor = rgba(o.c2, 1); ctx.shadowBlur = 8;
          ctx.beginPath();
          const phase = (t * 0.6) % 1;
          for (let i = 1; i < 26; i++) { const z = i - phase; const y = hz + (H - hz) * (1.6 / (z + 0.6)) - (H - hz) * 0.12; if (y < hz || y > H) continue; ctx.moveTo(0, y); ctx.lineTo(W, y); }
          for (let i = -24; i <= 24; i++) { ctx.moveTo(cx + i * W * 0.012, hz); ctx.lineTo(cx + i * W * 0.16, H); }
          ctx.stroke(); ctx.shadowBlur = 0;
          ctx.fillStyle = rgba(o.c2, 0.9); ctx.fillRect(0, hz - 1, W, 2);
        },
      };
    },
    night(ctx, o) {
      let stars = [], shoot = null, nextShoot = 3;
      return {
        resize(W, H) { stars = Array.from({ length: Math.round((W * H) / 2600 * (o.intensity / 100)) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() ** 3 * 1.6 + 0.35, p: Math.random() * 9, s: rand(0.6, 2.2) })); },
        frame(t, W, H, dt) {
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, '#02030a'); g.addColorStop(0.7, '#060a1e'); g.addColorStop(1, rgba(o.c1, 0.55));
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          const rg = ctx.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, W * 0.5);
          rg.addColorStop(0, rgba(o.c2, 0.10)); rg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
          for (const s of stars) { const a = 0.35 + 0.65 * Math.abs(Math.sin(t * s.s + s.p)); ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill(); }
          nextShoot -= dt;
          if (!shoot && nextShoot <= 0) { shoot = { x: rand(W * 0.1, W * 0.9), y: rand(0, H * 0.4), vx: rand(-1, 1) > 0 ? 900 : -900, vy: 380, life: 0 }; nextShoot = rand(4, 11); }
          if (shoot) {
            shoot.life += dt; shoot.x += shoot.vx * dt; shoot.y += shoot.vy * dt;
            const tail = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 0.15, shoot.y - shoot.vy * 0.15);
            tail.addColorStop(0, 'rgba(255,255,255,.95)'); tail.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.strokeStyle = tail; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * 0.15, shoot.y - shoot.vy * 0.15); ctx.stroke();
            if (shoot.life > 1.1) shoot = null;
          }
        },
      };
    },
    bokeh(ctx, o) {
      let dots = [];
      return {
        resize(W, H) { dots = Array.from({ length: Math.round(46 * (o.intensity / 100)) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: rand(20, 110) * (H / 1080), v: rand(6, 22), c: Math.random() < 0.45 ? o.c1 : Math.random() < 0.7 ? o.c2 : '#ffffff', p: Math.random() * 9 })); },
        frame(t, W, H, dt) {
          const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#05050c'); g.addColorStop(1, '#0d0a1c');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'lighter';
          for (const d of dots) {
            d.y -= d.v * dt; d.x += Math.sin(t * 0.3 + d.p) * 6 * dt;
            if (d.y < -d.r) { d.y = H + d.r; d.x = Math.random() * W; }
            const a = 0.10 + 0.10 * Math.sin(t * 0.7 + d.p);
            const rg = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
            rg.addColorStop(0, rgba(d.c, a + 0.12)); rg.addColorStop(0.7, rgba(d.c, a)); rg.addColorStop(1, rgba(d.c, 0));
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
        },
      };
    },
    rain(ctx, o, wall) {
      let drops = [], glass = [];
      return {
        resize(W, H) {
          drops = Array.from({ length: Math.round(420 * (o.intensity / 100) * (W / 1920)) }, () => ({ x: Math.random() * W, y: Math.random() * H, l: rand(14, 36), v: rand(900, 1500), a: rand(0.12, 0.35) }));
          glass = Array.from({ length: Math.round(60 * (o.intensity / 100)) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: rand(2, 6), v: rand(4, 40) }));
        },
        frame(t, W, H, dt) {
          wall.draw(ctx, W, H, 0.28);
          ctx.strokeStyle = 'rgba(210,225,255,.28)'; ctx.lineWidth = 1.1; ctx.beginPath();
          for (const d of drops) {
            d.y += d.v * dt; d.x += d.v * 0.12 * dt;
            if (d.y > H) { d.y = -d.l; d.x = Math.random() * W * 1.1 - W * 0.1; }
            ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.12, d.y - d.l);
          }
          ctx.stroke();
          for (const g of glass) {
            g.y += g.v * dt * (Math.random() < 0.02 ? 6 : 1);
            if (g.y > H + 10) { g.y = -10; g.x = Math.random() * W; }
            const rg = ctx.createRadialGradient(g.x - g.r * 0.3, g.y - g.r * 0.3, 0, g.x, g.y, g.r);
            rg.addColorStop(0, 'rgba(255,255,255,.55)'); rg.addColorStop(0.6, 'rgba(200,215,240,.18)'); rg.addColorStop(1, 'rgba(0,0,0,.18)');
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 6.283); ctx.fill();
          }
        },
      };
    },
    snow(ctx, o, wall) {
      let flakes = [];
      return {
        resize(W, H) { flakes = Array.from({ length: Math.round(260 * (o.intensity / 100) * (W / 1920)) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() ** 2 * 3.2 + 0.8, p: Math.random() * 9 })); },
        frame(t, W, H, dt) {
          wall.draw(ctx, W, H, 0.12);
          ctx.fillStyle = 'rgba(255,255,255,.85)';
          for (const f of flakes) {
            f.y += (18 + f.r * 22) * dt; f.x += Math.sin(t * 0.8 + f.p) * 18 * dt + 6 * dt;
            if (f.y > H + 5) { f.y = -5; f.x = Math.random() * W; }
            if (f.x > W + 5) f.x = -5;
            ctx.globalAlpha = 0.35 + f.r / 5;
            ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
          }
          ctx.globalAlpha = 1;
        },
      };
    },
    fireflies(ctx, o, wall) {
      let flies = [];
      return {
        resize(W, H) { flies = Array.from({ length: Math.round(70 * (o.intensity / 100)) }, () => ({ x: Math.random() * W, y: H * rand(0.3, 1), a: Math.random() * 6.28, v: rand(10, 40), p: Math.random() * 9, c: Math.random() < 0.6 ? '#ffe9a3' : o.c1 })); },
        frame(t, W, H, dt) {
          wall.draw(ctx, W, H, 0.3);
          ctx.globalCompositeOperation = 'lighter';
          for (const f of flies) {
            f.a += rand(-1, 1) * dt * 2; f.x += Math.cos(f.a) * f.v * dt; f.y += Math.sin(f.a) * f.v * dt;
            if (f.x < 0) f.x = W; if (f.x > W) f.x = 0; if (f.y < H * 0.15) f.a = Math.PI / 2; if (f.y > H) f.a = -Math.PI / 2;
            const b = Math.max(0, Math.sin(t * 1.6 + f.p)) ** 2;
            const r = 14 * (H / 1080);
            const rg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
            rg.addColorStop(0, rgba(f.c, 0.95 * b)); rg.addColorStop(0.25, rgba(f.c, 0.4 * b)); rg.addColorStop(1, rgba(f.c, 0));
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 6.283); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
        },
      };
    },
    breathe(ctx, o, wall) {
      return {
        resize() {},
        frame(t, W, H) {
          const im = wall.img();
          if (!im) { ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, W, H); return; }
          const z = 1.04 + 0.04 * Math.sin(t * 0.12), px = Math.sin(t * 0.07) * W * 0.012, py = Math.cos(t * 0.09) * H * 0.012;
          const s = Math.max(W / im.naturalWidth, H / im.naturalHeight) * z;
          ctx.drawImage(im, (W - im.naturalWidth * s) / 2 + px, (H - im.naturalHeight * s) / 2 + py, im.naturalWidth * s, im.naturalHeight * s);
          ctx.globalCompositeOperation = 'screen';
          const lx = W * (0.5 + 0.4 * Math.sin(t * 0.05)), ly = H * (0.3 + 0.2 * Math.cos(t * 0.04));
          const rg = ctx.createRadialGradient(lx, ly, 0, lx, ly, W * 0.6);
          rg.addColorStop(0, rgba(o.c1, 0.16 * (o.intensity / 100))); rg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'source-over';
        },
      };
    },
  };

  // ------------------------------------------------------------ engine
  function create(canvas, opts) {
    let o = { speed: 100, intensity: 100, fps: 30, ...opts };
    let scene = null, raf = 0, paused = false, t = 0, last = 0, acc = 0, wall = null, W = 0, H = 0, sceneId = null, ctx2d = null;
    const isShader = (id) => !!SHADERS[id];

    function build() {
      if (scene && scene.destroy) scene.destroy();
      scene = null;
      sceneId = o.scene;
      // A canvas keeps whichever context it first got, so swap in a fresh one when switching kinds.
      const fresh = canvas.cloneNode(false);
      canvas.replaceWith(fresh);
      canvas = fresh;
      if (isShader(o.scene)) scene = shaderScene(canvas, o.scene);
      if (!scene) {
        ctx2d = canvas.getContext('2d');
        wall = wallLayer(o);
        const f = SCENES2D[o.scene] || SCENES2D.bokeh;
        scene = f(ctx2d, o, wall);
        scene.is2d = true;
      }
      W = 0;
    }
    function size() {
      const scale = (scene && scene.scale) || 1;
      const cw = Math.max(1, Math.round(canvas.clientWidth * scale)), ch = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (cw !== W || ch !== H) { W = canvas.width = cw; H = canvas.height = ch; if (scene.resize) scene.resize(W, H); }
    }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (paused) { last = now; return; }
      const dtReal = last ? (now - last) / 1000 : 0;
      last = now;
      acc += dtReal;
      const step = 1 / (o.fps || 30);
      if (acc < step * 0.95) return;
      const dt = Math.min(acc, 0.1) * (o.speed / 100);
      acc = 0;
      t += dt;
      size();
      if (scene.is2d) scene.frame(t, W, H, dt);
      else scene.frame(t, o);
    }
    // Paused previews still show the wallpaper once it has loaded.
    o.onWallLoad = () => { size(); if (scene.is2d) scene.frame(t + 3, W, H, 0.016); };
    build();
    raf = requestAnimationFrame(loop);
    // Draw something immediately (previews start paused).
    requestAnimationFrame(() => { size(); t += 0.01; scene.is2d ? scene.frame(t + 3, W, H, 0.016) : scene.frame(t + 3, o); });
    return {
      get canvas() { return canvas; },
      set(next) {
        const prev = o;
        o = { ...o, ...next };
        if (o.scene !== sceneId || o.wallpaperURL !== prev.wallpaperURL || o.intensity !== prev.intensity || o.c1 !== prev.c1 || o.c2 !== prev.c2) { if (o.scene !== sceneId || scene.is2d) build(); }
      },
      pause(p) { paused = !!p; },
      destroy() { cancelAnimationFrame(raf); if (scene && scene.destroy) scene.destroy(); },
    };
  }

  window.HavenScenes = { LIST, create };
})();
