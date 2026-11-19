// INDAI's spaces: passthrough (your real room) or a virtual scene around the screens.
// Everything here is generated in code (no downloads), built the first time a scene is picked,
// and kept light enough for a Quest to draw alongside the screens.
import * as THREE from 'three';

export const SCENES = [
  { id: 'passthrough', name: 'Passthrough', note: 'Your real room', sky: ['#2b3442', '#55606f'] },
  { id: 'loft', name: 'Loft', note: 'Sunlit loft, city view', sky: ['#6fa8dc', '#e8d9c4'] },
  { id: 'midnight', name: 'Midnight', note: 'Penthouse over the city', sky: ['#05060f', '#3a2a63'] },
  { id: 'ocean', name: 'Ocean sunset', note: 'Deck over a calm sea', sky: ['#24305e', '#ff8a50'] },
  { id: 'orbit', name: 'Orbit', note: 'High above Earth', sky: ['#000004', '#14305e'] },
  { id: 'deck', name: 'Command deck', note: 'The classic dark grid', sky: ['#06162a', '#0a3a52'] },
];
export const sceneName = (id) => (SCENES.find(s => s.id === id) || SCENES[1]).name;

// ---------------------------------------------------------------- helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}
const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }

function skyDome({ top, horizon, bottom, sunDir = [0, 0.3, -1], sunColor = '#ffffff', sunSize = 0, glow = 0, glowColor = '#ffffff', sharp = 0.6 }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, bottom: { value: new THREE.Color(bottom) },
      sunDir: { value: new THREE.Vector3(...sunDir).normalize() }, sunColor: { value: new THREE.Color(sunColor) }, glowColor: { value: new THREE.Color(glowColor) },
      sunSize: { value: sunSize }, glow: { value: glow }, sharp: { value: sharp },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 glowColor;
      uniform float sunSize; uniform float glow; uniform float sharp; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = h >= 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), sharp)) : mix(horizon, bottom, pow(clamp(-h * 3.0, 0.0, 1.0), 0.7));
        float s = max(dot(d, sunDir), 0.0);
        col += glowColor * (pow(s, 6.0) * 0.6 + pow(s, 48.0)) * glow;
        if (sunSize > 0.0) col = mix(col, sunColor, smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.55, s));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), mat);
  m.renderOrder = -10; m.frustumCulled = false;
  return m;
}
function stars(n, radius, { size = 0.18, seed = 3, minY = -1, color = '#ffffff', band = 0 } = {}) {
  const r = rng(seed), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x, y, z;
    if (band && r() < band) { // concentrate some along a tilted great circle (a faint "Milky Way")
      const a = r() * Math.PI * 2, off = (r() + r() + r() - 1.5) * 0.18;
      x = Math.cos(a); y = Math.sin(a) * 0.55 + off; z = Math.sin(a) * 0.83 - off * 0.4;
    } else { const u = r() * 2 - 1, a = r() * Math.PI * 2; x = Math.sqrt(1 - u * u) * Math.cos(a); y = u; z = Math.sqrt(1 - u * u) * Math.sin(a); }
    if (y < minY) y = Math.abs(y);
    const l = Math.hypot(x, y, z) || 1;
    pos.set([x / l * radius, y / l * radius, z / l * radius], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
  p.renderOrder = -9; p.frustumCulled = false;
  return p;
}

// City skyline painted on a canvas (transparent sky so the dome shows through).
function drawSkyline(ctx, w, h, { night = false, seed = 7, layers = 3, top = 0.78 } = {}) {
  const r = rng(seed);
  ctx.clearRect(0, 0, w, h);
  for (let L = 0; L < layers; L++) {
    const depth = L / Math.max(1, layers - 1);            // 0 = far, 1 = near
    const maxH = h * (top - 0.1 * (1 - depth)), minH = h * (0.18 + 0.12 * depth);
    let x = 0;
    while (x < w) {
      const bw = Math.round(28 + r() * (70 + 90 * depth));
      const bh = Math.round(minH + Math.pow(r(), 1.6) * (maxH - minH));
      const y0 = h - bh;
      let base;
      if (night) { const v = 10 + depth * 8 + r() * 8; base = `rgb(${v},${v + 2},${v + 12})`; }
      else { const v = 168 - depth * 70 + r() * 30; base = `rgb(${v - 8},${v + 2},${v + 18})`; }
      ctx.fillStyle = base; ctx.fillRect(x, y0, bw, bh);
      if (r() < 0.25) { ctx.fillRect(x + bw * 0.4, y0 - bh * 0.06, bw * 0.2, bh * 0.06); }                     // stepped top
      if (r() < 0.12) { ctx.fillRect(x + bw * 0.48, y0 - bh * 0.18, 2, bh * 0.18); if (night) { ctx.fillStyle = '#ff3b3b'; ctx.fillRect(x + bw * 0.48 - 1, y0 - bh * 0.18 - 3, 4, 4); } }
      // windows
      const cw = 5 + Math.round(depth * 3), ch = 6 + Math.round(depth * 3), gx = cw + 3, gy = ch + 4;
      for (let wy = y0 + 6; wy < h - 4; wy += gy) {
        for (let wx = x + 4; wx < x + bw - cw - 2; wx += gx) {
          if (night) {
            if (r() < 0.38) { const warm = r() < 0.7; ctx.fillStyle = warm ? `rgba(255,${200 + r() * 40 | 0},${120 + r() * 60 | 0},${0.55 + r() * 0.45})` : `rgba(190,220,255,${0.4 + r() * 0.4})`; ctx.fillRect(wx, wy, cw, ch); }
          } else if (r() < 0.85) {
            const v = 120 - depth * 50 + r() * 60; ctx.fillStyle = `rgba(${v - 20},${v},${v + 30},0.55)`; ctx.fillRect(wx, wy, cw, ch);
          }
        }
      }
      x += bw + Math.round(r() * 6 * (1 - depth));
    }
    // atmospheric haze between layers
    const g = ctx.createLinearGradient(0, h * 0.35, 0, h);
    if (night) { g.addColorStop(0, 'rgba(20,16,40,0)'); g.addColorStop(1, `rgba(255,140,60,${0.10 + 0.08 * (1 - depth)})`); }
    else { g.addColorStop(0, 'rgba(220,232,242,0)'); g.addColorStop(1, `rgba(220,232,242,${0.35 * (1 - depth)})`); }
    if (L < layers - 1) { ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
  }
}

function woodTex(seed = 11, tone = [150, 104, 68]) {
  return canvasTex(1024, 1024, (ctx, w, h) => {
    const r = rng(seed), rows = 8, rh = h / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * 400;
      while (x < w) {
        const len = 300 + r() * 420, k = 0.82 + r() * 0.3;
        ctx.fillStyle = `rgb(${tone[0] * k | 0},${tone[1] * k | 0},${tone[2] * k | 0})`;
        ctx.fillRect(x, i * rh, len, rh);
        ctx.strokeStyle = `rgba(60,35,20,${0.12 + r() * 0.12})`; ctx.lineWidth = 1;
        for (let g = 0; g < 9; g++) { const gy = i * rh + 4 + r() * (rh - 8); ctx.beginPath(); ctx.moveTo(x, gy); ctx.bezierCurveTo(x + len * 0.3, gy + (r() - 0.5) * 8, x + len * 0.7, gy + (r() - 0.5) * 8, x + len, gy); ctx.stroke(); }
        ctx.fillStyle = 'rgba(40,24,14,0.55)'; ctx.fillRect(x, i * rh, 3, rh);
        x += len;
      }
      ctx.fillStyle = 'rgba(40,24,14,0.5)'; ctx.fillRect(0, i * rh, w, 2);
    }
  }, { repeat: [3, 3] });
}

// ---------------------------------------------------------------- Loft (daylight, city view)
function buildLoft() {
  const g = new THREE.Group(); g.name = 'loft';
  g.add(skyDome({ top: '#5f9bd6', horizon: '#e6eef5', bottom: '#cfd8df', sunDir: [-0.45, 0.5, -0.75], sunColor: '#fffbea', sunSize: 0.0022, glow: 0.45, glowColor: '#fff0cc', sharp: 0.55 }));
  // the city outside the windows (front 220 degrees), two depths
  for (const [rad, seed, y, layers, op] of [[60, 21, 2, 2, 0.9], [38, 7, 1, 3, 1]]) {
    const tex = canvasTex(4096, 1024, (c, w, h) => drawSkyline(c, w, h, { seed, layers }));
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 30, 64, 1, true, Math.PI - 1.92, 3.84), basic(0xffffff, { map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, opacity: op }));
    cyl.position.y = y; cyl.renderOrder = -8; g.add(cyl);
  }
  const W = 14, D = 12, H = 4.8, zF = -6, zB = 6;
  // floor, rug, ceiling, beams
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), lambert(0xffffff, { map: woodTex() })); floor.rotation.x = -Math.PI / 2; g.add(floor);
  const rugTex = canvasTex(1024, 768, (c, w, h) => {
    c.fillStyle = '#e9e1d2'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#26324a'; c.lineWidth = 26; c.strokeRect(40, 40, w - 80, h - 80);
    c.lineWidth = 6; c.strokeRect(90, 90, w - 180, h - 180);
    c.fillStyle = 'rgba(38,50,74,0.18)'; for (let i = 0; i < 9; i++) c.fillRect(140 + i * 85, 140, 30, h - 280);
  });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.2), lambert(0xffffff, { map: rugTex })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.006, 0.6); g.add(rug);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), lambert('#d9d4cc')); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; g.add(ceil);
  const beamMat = lambert('#4a3526');
  for (let z = -4.5; z <= 4.5; z += 1.8) g.add(box(W, 0.32, 0.26, beamMat, 0, H - 0.16, z));
  // brick wall (left)
  const brick = canvasTex(1024, 512, (c, w, h) => {
    const r = rng(5); c.fillStyle = '#d8cfc3'; c.fillRect(0, 0, w, h);
    const bw = 128, bh = 42;
    for (let row = 0; row * bh < h; row++) for (let x = (row % 2) * -bw / 2; x < w; x += bw) {
      const k = 0.78 + r() * 0.35; c.fillStyle = `rgb(${158 * k | 0},${78 * k | 0},${56 * k | 0})`; c.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
      c.fillStyle = `rgba(0,0,0,${r() * 0.12})`; c.fillRect(x + 3, row * bh + bh - 10, bw - 6, 7);
    }
  }, { repeat: [5, 4] });
  const left = new THREE.Mesh(new THREE.PlaneGeometry(D, H), lambert(0xffffff, { map: brick })); left.rotation.y = Math.PI / 2; left.position.set(-W / 2, H / 2, 0); g.add(left);
  const plaster = lambert('#ece8e1');
  const right = new THREE.Mesh(new THREE.PlaneGeometry(D, H), plaster); right.rotation.y = -Math.PI / 2; right.position.set(W / 2, H / 2, 0); g.add(right);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), plaster); back.rotation.y = Math.PI; back.position.set(0, H / 2, zB); g.add(back);
  // the window wall (steel frames, open to the city)
  const steel = lambert('#1d1f22');
  g.add(box(W, 0.55, 0.3, lambert('#8f4f38', { map: brick }), 0, 0.275, zF));
  g.add(box(W, 0.7, 0.3, steel, 0, H - 0.35, zF));
  for (let x = -W / 2; x <= W / 2 + 0.01; x += 1.75) g.add(box(0.08, H - 1.2, 0.12, steel, x, 0.55 + (H - 1.2) / 2, zF));
  for (const y of [1.9, 3.2]) g.add(box(W, 0.05, 0.1, steel, 0, y, zF));
  // pendant lights
  for (const x of [-3, 0, 3]) {
    g.add(box(0.012, 1.3, 0.012, steel, x, H - 0.65, -3.4));
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.28, 28, 1, true), lambert('#22252a', { side: THREE.DoubleSide })); shade.position.set(x, H - 1.4, -3.4); g.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), basic('#fff1c9')); bulb.position.set(x, H - 1.52, -3.4); g.add(bulb);
  }
  // sofa behind you, sideboard, shelves, plants, art
  const leather = lambert('#8a4b2a');
  g.add(box(2.6, 0.42, 1.0, leather, 0, 0.21, 3.1), box(2.6, 0.55, 0.26, leather, 0, 0.62, 3.5), box(0.26, 0.62, 1.0, leather, -1.4, 0.31, 3.1), box(0.26, 0.62, 1.0, leather, 1.4, 0.31, 3.1));
  const walnut = lambert('#5b3a24');
  g.add(box(0.5, 0.8, 2.4, walnut, -W / 2 + 0.3, 0.4, -1.5));
  const shelf = new THREE.Group(), r = rng(9);
  for (let i = 0; i < 4; i++) shelf.add(box(3.2, 0.04, 0.34, walnut, 0, 0.4 + i * 0.55, 0));
  shelf.add(box(0.05, 2.1, 0.34, walnut, -1.6, 1.25, 0), box(0.05, 2.1, 0.34, walnut, 1.6, 1.25, 0));
  for (let i = 0; i < 3; i++) for (let x = -1.5; x < 1.45;) { const bw = 0.04 + r() * 0.05, bh = 0.26 + r() * 0.16; if (r() < 0.85) shelf.add(box(bw, bh, 0.22, lambert(['#2f4858', '#86604a', '#b5a27a', '#3c3c44', '#7a2f2f', '#d9cdb5'][r() * 6 | 0]), x + bw / 2, 0.42 + i * 0.55 + bh / 2, 0)); x += bw + 0.005 + (r() < 0.1 ? 0.25 : 0); }
  shelf.position.set(3, 0, zB - 0.2); g.add(shelf);
  const leaf = lambert('#3f6f3a'), pot = lambert('#b5643d');
  for (const [x, z] of [[-5.6, -5.0], [5.4, -4.9], [-5.8, 4.6]]) {
    g.add(box(0.5, 0.55, 0.5, pot, x, 0.275, z));
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 + r() * 0.22, 1), leaf); b.position.set(x + (r() - 0.5) * 0.6, 0.9 + r() * 1.1, z + (r() - 0.5) * 0.6); b.scale.set(1, 1.3, 1); g.add(b); }
  }
  for (const [z, hue] of [[-2.2, 0], [1.6, 1]]) {
    const art = canvasTex(512, 640, (c, w, h) => {
      c.fillStyle = hue ? '#efe7da' : '#1f2a3a'; c.fillRect(0, 0, w, h);
      const rr = rng(31 + hue); for (let i = 0; i < 7; i++) { c.fillStyle = ['#d1495b', '#edae49', '#00798c', '#30638e', '#003d5b', '#f6f2e8'][rr() * 6 | 0]; c.globalAlpha = 0.85; if (rr() < 0.5) { c.beginPath(); c.arc(rr() * w, rr() * h, 40 + rr() * 140, 0, 7); c.fill(); } else c.fillRect(rr() * w * 0.7, rr() * h * 0.7, 80 + rr() * 220, 30 + rr() * 200); }
      c.globalAlpha = 1;
    });
    const frame = box(0.05, 1.5, 1.2, lambert('#141414'), W / 2 - 0.04, 2.1, z); g.add(frame);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), basic(0xffffff, { map: art })); pic.rotation.y = -Math.PI / 2; pic.position.set(W / 2 - 0.075, 2.1, z); g.add(pic);
  }
  g.add(new THREE.HemisphereLight('#eaf2ff', '#8a6a52', 1.7));
  const sun = new THREE.DirectionalLight('#fff1d6', 1.6); sun.position.set(-4, 7, -7); g.add(sun, sun.target);
  return g;
}

// ---------------------------------------------------------------- Midnight penthouse
function buildMidnight() {
  const g = new THREE.Group(); g.name = 'midnight';
  g.add(skyDome({ top: '#03040b', horizon: '#2a1f4a', bottom: '#120c1c', sunDir: [0.4, 0.42, -0.8], sunColor: '#f2f0ff', sunSize: 0.0014, glow: 0.35, glowColor: '#7e78c4', sharp: 0.45 }));
  g.add(stars(1400, 85, { size: 0.22, seed: 4, minY: 0.04 }));
  for (const [rad, seed, y, layers, op] of [[58, 13, 0, 2, 0.75], [34, 29, -1.5, 3, 1]]) {
    const tex = canvasTex(4096, 1024, (c, w, h) => drawSkyline(c, w, h, { night: true, seed, layers, top: 0.72 }), { repeat: null });
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(2, 1);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 26, 72, 1, true), basic(0xffffff, { map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, opacity: op }));
    cyl.position.y = y - 2; cyl.renderOrder = -8; g.add(cyl);
  }
  const marble = canvasTex(1024, 1024, (c, w, h) => {
    const grd = c.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w / 2);
    grd.addColorStop(0, '#1c1a26'); grd.addColorStop(1, '#0b0a10'); c.fillStyle = grd; c.fillRect(0, 0, w, h);
    const r = rng(17); c.strokeStyle = 'rgba(160,150,200,0.08)'; c.lineWidth = 2;
    for (let i = 0; i < 40; i++) { c.beginPath(); let x = r() * w, y = r() * h; c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 160; y += (r() - 0.5) * 160; c.lineTo(x, y); } c.stroke(); }
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), basic(0xffffff, { map: marble })); floor.rotation.x = -Math.PI / 2; g.add(floor);
  const metal = basic('#0d0e14');
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; g.add(box(0.07, 3.8, 0.07, metal, Math.sin(a) * 7.5, 1.9, Math.cos(a) * 7.5)); }
  const over = new THREE.Mesh(new THREE.RingGeometry(7.4, 10, 64), basic('#08080d', { side: THREE.DoubleSide })); over.rotation.x = Math.PI / 2; over.position.y = 3.8; g.add(over);
  const glow = new THREE.Mesh(new THREE.RingGeometry(7.28, 7.34, 96), basic('#5ad1ff', { transparent: true, opacity: 0.55 })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01; g.add(glow);
  const sofa = basic('#16171f'), led = basic('#7c6cff');
  g.add(box(3.2, 0.4, 0.9, sofa, 0, 0.2, 3.4), box(3.2, 0.5, 0.22, sofa, 0, 0.6, 3.8), box(3.1, 0.02, 0.02, led, 0, 0.03, 2.94));
  g.add(box(0.9, 0.4, 2.4, sofa, -3.6, 0.2, 1.6), box(0.9, 0.02, 0.02, led, -3.14, 0.03, 1.6));
  return g;
}

// ---------------------------------------------------------------- Ocean sunset
function buildOcean() {
  const g = new THREE.Group(); g.name = 'ocean';
  g.add(skyDome({ top: '#1f2b5c', horizon: '#ff9156', bottom: '#2a2240', sunDir: [0, 0.055, -1], sunColor: '#fff3c9', sunSize: 0.0032, glow: 1.25, glowColor: '#ffb26a', sharp: 0.42 }));
  const sea = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, deep: { value: new THREE.Color('#0d1a33') }, far: { value: new THREE.Color('#c86a52') }, sunCol: { value: new THREE.Color('#ffc27a') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = vec3(position.x, 0.0, -position.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float time; uniform vec3 deep; uniform vec3 far; uniform vec3 sunCol; varying vec3 vP;
      void main(){
        float d = length(vP.xz);
        float w = sin(vP.x * 0.9 + time * 0.7) * 0.5 + sin(vP.z * 1.3 - time * 0.9 + vP.x * 0.4) * 0.5 + sin((vP.x + vP.z) * 3.1 + time * 1.6) * 0.3;
        vec3 col = mix(deep, far, smoothstep(6.0, 220.0, d) * 0.85);
        float ahead = clamp(-vP.z, 0.0, 400.0);
        float streak = exp(-pow(vP.x / (0.8 + ahead * 0.035), 2.0)) * smoothstep(2.0, 30.0, ahead);
        float glint = smoothstep(0.35, 1.0, w * 0.5 + 0.5);
        col += sunCol * streak * (0.25 + 1.1 * glint);
        col += vec3(0.035) * w * (1.0 - smoothstep(20.0, 120.0, d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), sea); water.rotation.x = -Math.PI / 2; water.position.y = -1.6; g.add(water);
  const hills = canvasTex(4096, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h); const r = rng(41);
    for (const [col, amp, base] of [['#4a2f4d', 0.5, 0.82], ['#2e1f33', 0.35, 0.9]]) {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) { const y = h * base - Math.max(0, Math.sin(x / w * Math.PI * 7 + r()) * amp * h * 0.5 + (r() - 0.5) * 6); c.lineTo(x, y); }
      c.lineTo(w, h); c.fill();
    }
  });
  const isl = new THREE.Mesh(new THREE.CylinderGeometry(160, 160, 14, 72, 1, true, Math.PI * 0.15, Math.PI * 0.7), basic(0xffffff, { map: hills, transparent: true, side: THREE.BackSide, depthWrite: false }));
  isl.position.y = 3.2; isl.renderOrder = -8; g.add(isl);
  const wood = lambert(0xffffff, { map: woodTex(23, [168, 118, 78]) });
  const deck = box(7, 0.2, 5.4, wood, 0, -0.1, 0.4); g.add(deck);
  const rail = lambert('#5e3e28');
  g.add(box(7, 0.07, 0.09, rail, 0, 1.0, -2.3));
  for (let x = -3.5; x <= 3.51; x += 1.4) g.add(box(0.09, 1.0, 0.09, rail, x, 0.5, -2.3));
  for (const s of [-1, 1]) { g.add(box(0.07, 0.07, 5.4, rail, s * 3.5, 1.0, 0.4)); for (let z = -2.3; z <= 3.1; z += 1.35) g.add(box(0.09, 1.0, 0.09, rail, s * 3.5, 0.5, z)); }
  for (const [x, z] of [[-3.3, -2.1], [3.3, -2.1], [-3.3, 3], [3.3, 3]]) g.add(box(0.22, 3, 0.22, rail, x, -1.5, z));
  g.add(new THREE.HemisphereLight('#ffd2a8', '#3a2a40', 1.25));
  const sun = new THREE.DirectionalLight('#ffb070', 1.5); sun.position.set(0, 2, -10); g.add(sun, sun.target);
  g.userData.update = (dt, t) => { sea.uniforms.time.value = t; };
  return g;
}

// ---------------------------------------------------------------- Orbit
function noise3(seed) {
  const r = rng(seed), p = new Uint8Array(512), v = new Float32Array(256);
  for (let i = 0; i < 256; i++) { p[i] = i; v[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  const h = (x, y, z) => v[p[p[p[x & 255] + (y & 255)] + (z & 255)]];
  const s = (t) => t * t * (3 - 2 * t);
  const n = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = s(x - xi), yf = s(y - yi), zf = s(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf), zf);
  };
  return (x, y, z, oct = 5) => { let a = 0, f = 1, amp = 0.5, tot = 0; for (let o = 0; o < oct; o++) { a += n(x * f, y * f, z * f) * amp; tot += amp; f *= 2.03; amp *= 0.5; } return a / tot; };
}
async function paintEarth() {
  const W = 768, H = 384, nz = noise3(77);
  const cols = { deep: [8, 32, 78], shallow: [26, 82, 140], green: [52, 96, 48], dry: [146, 124, 82], ice: [236, 242, 248] };
  const surf = document.createElement('canvas'); surf.width = W; surf.height = H;
  const cl = document.createElement('canvas'); cl.width = W; cl.height = H;
  const sc = surf.getContext('2d'), cc = cl.getContext('2d');
  const si = sc.createImageData(W, H), ci = cc.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI, cy = Math.cos(lat), sy = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2, px = cy * Math.cos(lon), pz = cy * Math.sin(lon), py = sy;
      const e = nz(px * 1.6 + 5, py * 1.6, pz * 1.6, 5);
      let c;
      if (Math.abs(lat) > 1.25 + (e - 0.5) * 0.3) c = cols.ice;
      else if (e < 0.5) { const t = Math.min(1, e / 0.5); c = cols.deep.map((v, i) => v + (cols.shallow[i] - v) * t * t); }
      else { const m = nz(px * 4, py * 4 + 9, pz * 4, 3); c = (m > 0.55 || (Math.abs(lat) < 0.35 && m > 0.45)) ? cols.dry : cols.green; const k = 0.85 + (e - 0.5) * 0.6; c = c.map(v => Math.min(255, v * k)); }
      const i = (y * W + x) * 4; si.data[i] = c[0]; si.data[i + 1] = c[1]; si.data[i + 2] = c[2]; si.data[i + 3] = 255;
      const cv = nz(px * 2.6 + 30, py * 4.5, pz * 2.6, 4);
      ci.data[i] = ci.data[i + 1] = ci.data[i + 2] = 255; ci.data[i + 3] = Math.max(0, Math.min(255, (cv - 0.5) * 900));
    }
    if (y % 12 === 11) await new Promise(r => setTimeout(r, 0));
  }
  sc.putImageData(si, 0, 0); cc.putImageData(ci, 0, 0);
  const st = new THREE.CanvasTexture(surf); st.colorSpace = THREE.SRGBColorSpace;
  const ct = new THREE.CanvasTexture(cl); ct.colorSpace = THREE.SRGBColorSpace;
  return { st, ct };
}
function buildOrbit() {
  const g = new THREE.Group(); g.name = 'orbit';
  g.add(skyDome({ top: '#000002', horizon: '#02030a', bottom: '#000000', sunDir: [-0.62, 0.32, -0.72], sunColor: '#ffffff', sunSize: 0.0016, glow: 0.35, glowColor: '#9cb8ff' }));
  g.add(stars(2600, 85, { size: 0.16, seed: 8, band: 0.45 }), stars(500, 84, { size: 0.32, seed: 19 }));
  const earth = new THREE.Group(); earth.position.set(10, -31, -30);
  const R = 27;
  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.MeshLambertMaterial({ color: '#1d4f8a' })); earth.add(globe);
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 96, 64), new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false })); clouds.visible = false; earth.add(clouds);
  // Paint the planet in small slices so the headset never stalls; it fades from a plain blue globe to the full Earth.
  paintEarth().then(({ st, ct }) => {
    globe.material.map = st; globe.material.color.set('#ffffff'); globe.material.needsUpdate = true;
    clouds.material.map = ct; clouds.material.needsUpdate = true; clouds.visible = true;
  }).catch(e => console.warn('earth texture', e));
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 64, 48), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(vec3(0.33, 0.6, 1.0) * f * 1.3, f); }',
  }));
  earth.add(atmo); earth.rotation.set(-0.85, 0, 0.25); g.add(earth);  // tilt the poles away so you look down on the tropics
  const plat = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = 'rgba(10,18,32,0.9)'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, 7); c.fill();
    c.strokeStyle = 'rgba(90,209,255,0.18)'; c.lineWidth = 2;
    for (let i = 1; i < 8; i++) { c.beginPath(); c.arc(w / 2, h / 2, i * w / 16, 0, 7); c.stroke(); }
    for (let a = 0; a < 12; a++) { c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 + Math.cos(a / 12 * Math.PI * 2) * w / 2, h / 2 + Math.sin(a / 12 * Math.PI * 2) * h / 2); c.stroke(); }
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.4, 64), basic(0xffffff, { map: plat, transparent: true, depthWrite: false })); disc.rotation.x = -Math.PI / 2; g.add(disc);
  const edge = new THREE.Mesh(new THREE.RingGeometry(2.36, 2.44, 96), basic('#5ad1ff', { transparent: true, opacity: 0.8 })); edge.rotation.x = -Math.PI / 2; edge.position.y = 0.005; g.add(edge);
  const sun = new THREE.DirectionalLight('#ffffff', 2.6); sun.position.set(-62, 32, -72); g.add(sun, sun.target);
  g.add(new THREE.AmbientLight('#203050', 0.25));
  g.userData.update = (dt) => { globe.rotation.y += dt * 0.006; clouds.rotation.y += dt * 0.009; };
  return g;
}

// ---------------------------------------------------------------- Command deck (the original look)
function buildDeck() {
  const g = new THREE.Group(); g.name = 'deck';
  g.add(skyDome({ top: '#06162a', horizon: '#03101f', bottom: '#010409', sharp: 0.9 }));
  const grid = new THREE.GridHelper(40, 80, 0x1f4f6b, 0x0c1d2b); grid.material.transparent = true; grid.material.opacity = 0.45; g.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.015, 96), basic(0x5ad1ff, { transparent: true, opacity: 0.3, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; g.add(ring);
  const n = 600, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = 4 + Math.random() * 18, th = Math.random() * Math.PI * 2, y = Math.random() * 10 - 1; pos.set([Math.cos(th) * r, y, Math.sin(th) * r], i * 3); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x8fdcff, size: 0.025, transparent: true, opacity: 0.5 })); g.add(dust);
  g.userData.update = (dt) => { dust.rotation.y += dt * 0.004; };
  return g;
}

const BUILDERS = { loft: buildLoft, midnight: buildMidnight, ocean: buildOcean, orbit: buildOrbit, deck: buildDeck };

export class SceneManager {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'spaces';
    scene.add(this.root);
    this.built = {};
    this.current = null;
    this.time = 0;
  }
  // id: one of SCENES; 'passthrough' hides everything so the real room shows (mixed reality only).
  set(id) {
    if (!BUILDERS[id] && id !== 'passthrough') id = 'loft';
    if (id !== 'passthrough' && !this.built[id]) {
      try { this.built[id] = BUILDERS[id](); this.root.add(this.built[id]); }
      catch (e) { console.warn('scene build failed', id, e); id = 'deck'; if (!this.built.deck) { this.built.deck = buildDeck(); this.root.add(this.built.deck); } }
    }
    for (const [k, g] of Object.entries(this.built)) g.visible = k === id;
    this.current = id;
    return id;
  }
  get opaque() { return this.current && this.current !== 'passthrough'; }
  follow(pos, yaw) { this.root.position.set(pos.x, 0, pos.z); this.root.rotation.set(0, yaw, 0); }
  update(dt) { this.time += dt; const g = this.built[this.current]; if (g && g.userData.update) g.userData.update(dt, this.time); }
}
