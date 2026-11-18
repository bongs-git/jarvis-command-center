import * as THREE from 'three';
import { loadSettings, saveSettings, loadDay, saveDay, freshDay, todayET, loadLayout, saveLayout, clearLayout, parseLevels } from './store.js';
import { MarketFeed, LEADLAG } from './feeds.js';
import { marketStatus, fmtDuration, etParts, INTERVAL_LABEL } from './market.js';
import { TopBar, Watchlist, MainChart, LeadLag, Levels, RiskBreaker, JarvisLog, Dock, nearestLevel } from './panels.js';
import { Jarvis } from './jarvis.js';
import { fmtPrice, fmtPct, fmtMoney } from './hud.js';
import { initUI } from './ui.js';

const STEPS = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const R = 1.4;            // arc radius (m)
const BASE_Y = -0.06;     // chart centre relative to eye height
const LAYOUT = {
  top: [0, 0.47], chart: [0, 0], dock: [0, -0.485],
  watch: [-40, 0], risk: [40, 0],
  leadlag: [-72, 0.19], levels: [-72, -0.215], jarvis: [72, 0],
};

// ------------------------------------------------------------------ app state
const app = {
  settings: loadSettings(),
  day: loadDay(),
  panels: {},
  inXR: false,
  xrMode: null,
  dirty: new Set(),
  markDirty(id) { if (id === 'all') Object.keys(this.panels).forEach(k => this.dirty.add(k)); else this.dirty.add(id); },
};
app.levels = parseLevels(app.settings.levelsText);
app.feed = new MarketFeed(app.settings);
app.jarvis = new Jarvis(app);

app.levelsFor = (sym) => {
  if (app.levels[sym]) return { ...app.levels[sym], source: 'user' };
  if (app.feed.status.mode === 'demo' && app.feed.demoLevels[sym]) return { ...app.feed.demoLevels[sym], source: 'demo' };
  return null;
};
app.saveSettings = () => saveSettings(app.settings);

app.selectSymbol = (sym, { announce = false } = {}) => {
  sym = sym.toUpperCase();
  if (!app.settings.symbols.includes(sym)) {
    if (!/^[A-Z.]{1,6}$/.test(sym)) { app.jarvis.say(`I don't know the ticker ${sym}.`); return; }
    app.settings.symbols = [...app.settings.symbols, sym].slice(-12);
    app.settings.main = sym; app.saveSettings();
    app.jarvis.say(`Adding ${sym} to your watchlist.`);
    restartFeed();
    return;
  }
  app.settings.main = sym; app.saveSettings();
  app.feed.requestInterval(sym, app.settings.interval);
  app.markDirty('all');
  if (announce) {
    const q = app.feed.quote(sym);
    app.jarvis.say(q ? `${sym}, ${fmtPrice(q.last)}, ${q.pct >= 0 ? 'up' : 'down'} ${Math.abs(q.pct).toFixed(2)} percent.` : `${sym} on the main screen.`);
  }
};
app.cycleSymbol = (dir) => {
  const s = app.settings.symbols, i = s.indexOf(app.settings.main);
  app.selectSymbol(s[(i + dir + s.length) % s.length]);
};
app.setTimeframe = (iv) => {
  if (!INTERVAL_LABEL[iv]) return;
  app.settings.interval = iv; app.saveSettings();
  app.feed.requestInterval(app.settings.main, iv);
  app.markDirty('chart');
};
app.toggleShow = (k) => app.setShow(k, !app.settings.show[k]);
app.setShow = (k, v) => { app.settings.show[k] = v; app.saveSettings(); app.markDirty('chart'); };

// ------------------------------------------------------------------ risk breaker
app.riskState = () => {
  const r = app.settings.risk, d = app.day, now = Date.now();
  const used = Math.max(0, -d.pnl);
  const room = Math.max(0, r.maxDailyLoss - used);
  const state = d.tripped ? 'tripped' : d.cooldownUntil > now ? 'cooldown' : 'armed';
  const riskPerTrade = Math.min(r.account * r.riskPct / 100, room);
  const perContract = Math.max(0.01, d.premium * 100 * (r.stopPct / 100));
  return {
    state, used, room, riskPerTrade,
    contracts: Math.max(0, Math.floor(riskPerTrade / perContract)),
    cooldownLeft: d.cooldownUntil - now,
    checklistScore: d.checklist.filter(Boolean).length,
  };
};
function persistDay() { saveDay(app.day); app.markDirty('risk'); }
app.logTrade = (amt) => {
  const d = app.day, r = app.settings.risk;
  d.trades.push({ t: Date.now(), amt });
  d.pnl = +(d.pnl + amt).toFixed(2);
  d.checklist = [false, false, false, false];
  if (amt < 0) d.consec++; else d.consec = 0;
  const pnlTxt = `Day P&L ${d.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(d.pnl))}.`;
  if (!d.tripped && -d.pnl >= r.maxDailyLoss) {
    d.tripped = true;
    app.jarvis.say(`Logged a loss of ${fmtMoney(-amt)}. That's your daily loss limit. The breaker is tripped — you're done for today. Close the app and protect the account.`, 'risk');
    flash('risk');
  } else if (amt < 0 && d.consec >= r.maxConsecLosses) {
    d.cooldownUntil = Date.now() + r.cooldownMin * 60e3;
    d.consec = 0;
    app.jarvis.say(`Logged a loss of ${fmtMoney(-amt)}. ${r.maxConsecLosses} losses in a row. Cooldown for ${r.cooldownMin} minutes — step away, no revenge trades. ${pnlTxt}`, 'risk');
    flash('risk');
  } else if (amt < 0) {
    const left = r.maxConsecLosses - d.consec;
    app.jarvis.say(`Logged a loss of ${fmtMoney(-amt)}. ${pnlTxt} ${left === 1 ? 'One more loss and you go on cooldown.' : ''}`.trim(), 'risk');
  } else {
    app.jarvis.say(`Logged a win of ${fmtMoney(amt)}. ${pnlTxt}`, 'good');
  }
  persistDay();
};
app.undoTrade = () => {
  const d = app.day, r = app.settings.risk;
  const t = d.trades.pop();
  if (!t) return;
  d.pnl = +d.trades.reduce((s, x) => s + x.amt, 0).toFixed(2);
  let trailing = 0; for (let i = d.trades.length - 1; i >= 0 && d.trades[i].amt < 0; i--) trailing++;
  d.consec = trailing % r.maxConsecLosses;
  d.tripped = -d.pnl >= r.maxDailyLoss;
  app.jarvis.say(`Removed the last trade (${t.amt >= 0 ? '+' : '−'}${fmtMoney(Math.abs(t.amt))}). Day P&L ${fmtMoney(d.pnl, true)}.`, 'info', { speak: false });
  persistDay();
};
app.setStep = (dir) => {
  const i = STEPS.indexOf(app.day.step);
  app.day.step = STEPS[Math.max(0, Math.min(STEPS.length - 1, (i < 0 ? 2 : i) + dir))];
  persistDay();
};
app.setPremium = (dir) => {
  const p = app.day.premium;
  const step = p < 1 ? 0.05 : p < 5 ? 0.1 : 0.25;
  app.day.premium = Math.max(0.05, +(p + dir * step).toFixed(2));
  persistDay();
};
app.toggleCheck = (i) => { app.day.checklist[i] = !app.day.checklist[i]; persistDay(); };
app.resetDay = () => { app.day = freshDay(); persistDay(); app.jarvis.say("Today's P&L and breaker were reset.", 'info', { speak: false }); };

// ------------------------------------------------------------------ Jarvis actions
app.talk = () => app.jarvis.listen();
app.toggleMute = (force) => {
  const m = typeof force === 'boolean' ? force : !app.jarvis.muted;
  app.jarvis.setMuted(m);
  app.settings.voice = !m; app.saveSettings();
  if (!m) app.jarvis.say('Voice on.');
  app.markDirty('dock');
};
app.brief = () => {
  const ms = marketStatus();
  const h = ms.et.h;
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const parts = [];
  if (app.feed.status.mode === 'demo') parts.push('Demo mode, prices are simulated.');
  parts.push(`${greet}, ${app.settings.name}.`);
  if (ms.state === 'open') parts.push(`Market's open, closing in ${fmtDuration(ms.msToNext)}.`);
  else if (ms.state === 'pre') parts.push(`Pre-market. The bell rings in ${fmtDuration(ms.msToNext)}.`);
  else parts.push(`${ms.label.toLowerCase().replace('·', ',')}. Next open in ${fmtDuration(ms.msToNext)}.`);
  const sym = app.settings.main, q = app.feed.quote(sym);
  if (q) {
    parts.push(`${sym} is ${fmtPrice(q.last)}, ${q.pct >= 0 ? 'up' : 'down'} ${Math.abs(q.pct).toFixed(2)} percent.`);
    const lv = app.levelsFor(sym);
    if (lv) {
      const n = nearestLevel(q.last, lv);
      if (n) parts.push(`Nearest level is the ${n.name.toLowerCase().replace('γ', 'gamma')} at ${fmtPrice(n.level)}, ${Math.abs(n.dist).toFixed(2)} percent ${n.dist >= 0 ? 'above' : 'below'}.`);
    }
  }
  const ll = LEADLAG.map(s => ({ s, q: app.feed.quote(s) })).filter(x => x.q).sort((a, b) => b.q.pct - a.q.pct);
  if (ll.length === 3 && ll[0].q.pct - ll[2].q.pct >= 0.15) parts.push(`${ll[0].s} is leading, ${ll[2].s} is lagging.`);
  const rs = app.riskState();
  if (rs.state === 'tripped') parts.push('The risk breaker is tripped. No more trades today.');
  else if (rs.state === 'cooldown') parts.push(`You're on cooldown for ${fmtDuration(rs.cooldownLeft)}.`);
  else parts.push(`Day P&L ${app.day.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(app.day.pnl))}, with ${fmtMoney(rs.room)} of room before the breaker.`);
  if (ms.upcoming.length) parts.push(`Heads up: ${ms.upcoming[0].text} on ${new Date(ms.upcoming[0].date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}.`);
  app.jarvis.say(parts.join(' '));
};

// ------------------------------------------------------------------ three.js scene
const canvasHost = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
try { renderer.xr.setFoveation(0.25); } catch {}
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.03, 200);
camera.position.set(0, 1.6, 0);
scene.add(camera);

// environment (hidden in mixed reality so you see your room)
const env = new THREE.Group();
scene.add(env);
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#06162a') }, bottom: { value: new THREE.Color('#010409') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y*0.5+0.5; gl_FragColor = vec4(mix(bottom, top, smoothstep(0.35,1.0,h)),1.0); }',
  }));
  env.add(sky);
  const grid = new THREE.GridHelper(40, 80, 0x1a6f8f, 0x0a2a3a);
  grid.material.transparent = true; grid.material.opacity = 0.45;
  env.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.02, 96), new THREE.MeshBasicMaterial({ color: 0x35d8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; env.add(ring);
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 4 + Math.random() * 18, th = Math.random() * Math.PI * 2, y = Math.random() * 10 - 1;
    pos.set([Math.cos(th) * r, y, Math.sin(th) * r], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x5fe3ff, size: 0.03, transparent: true, opacity: 0.6 }));
  pts.name = 'dust'; env.add(pts);
}

// the HUD rig: everything you see floats in here, placed around your head on recenter
const rig = new THREE.Group();
scene.add(rig);

// Jarvis orb
const orb = new THREE.Group();
{
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), new THREE.MeshBasicMaterial({ color: 0x7fefff, transparent: true, opacity: 0.95 }));
  core.name = 'core'; orb.add(core);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), new THREE.MeshBasicMaterial({ color: 0x35d8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.name = 'glow'; orb.add(glow);
  const ringMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  [[0.07, 0x35d8ff, 0.8], [0.085, 0xe7b84a, 0.7], [0.1, 0x35d8ff, 0.45]].forEach(([r, c, o], i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0025, 8, 96), ringMat(c, o));
    m.name = 'ring' + i; m.rotation.x = Math.PI / 2 + i * 0.5; orb.add(m);
  });
  rig.add(orb);
}

// panels
const P = app.panels;
P.top = new TopBar(app); P.chart = new MainChart(app); P.dock = new Dock(app);
P.watch = new Watchlist(app); P.risk = new RiskBreaker(app);
P.leadlag = new LeadLag(app); P.levels = new Levels(app); P.jarvis = new JarvisLog(app);
const panelMeshes = [];
const maxAniso = renderer.capabilities.getMaxAnisotropy();
for (const p of Object.values(P)) { p.setAnisotropy(maxAniso); rig.add(p.mesh); panelMeshes.push(p.mesh); }

function placeDefault(id) {
  const [deg, dy] = LAYOUT[id];
  const th = THREE.MathUtils.degToRad(deg);
  const m = P[id].mesh;
  m.position.set(Math.sin(th) * R, BASE_Y + dy, -Math.cos(th) * R);
  m.rotation.set(0, -th, 0);
}
function applyLayout() {
  const saved = loadLayout();
  for (const id of Object.keys(P)) {
    const s = saved[id];
    if (s && Array.isArray(s.p) && Array.isArray(s.q)) { P[id].mesh.position.fromArray(s.p); P[id].mesh.quaternion.fromArray(s.q); }
    else placeDefault(id);
  }
  orb.position.set(0, BASE_Y + 0.64, -R);
}
function persistLayout() {
  const out = {};
  for (const id of Object.keys(P)) out[id] = { p: P[id].mesh.position.toArray(), q: P[id].mesh.quaternion.toArray() };
  saveLayout(out);
}
app.resetLayout = () => { clearLayout(); applyLayout(); app.jarvis.say('Layout reset.', 'info', { speak: false }); };
applyLayout();

// ------------------------------------------------------------------ recenter
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
let pendingRecenter = false;
app.recenter = () => {
  if (app.inXR) {
    const xrCam = renderer.xr.getCamera();
    xrCam.getWorldPosition(_v); xrCam.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, 'YXZ');
    rig.position.copy(_v);
    rig.rotation.set(0, _e.y, 0);
  } else {
    rig.position.set(0, 1.6, 0); rig.rotation.set(0, 0, 0);
    view.yaw = 0; view.pitch = 0; updateView();
  }
};

// ------------------------------------------------------------------ 2D (non-headset) view
const view = { yaw: 0, pitch: 0, dist: 0.5 };
function fit2D() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.fov = aspect < 0.8 ? 72 : 60;
  // pull back so the main chart (and on wide screens the side panels) fit
  const needW = aspect < 0.8 ? 1.35 : aspect < 1.4 ? 2.0 : 2.7;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
  view.dist = Math.max(0.2, Math.min(3.2, needW / 2 / Math.tan(hfov / 2) - R * 0.82));
  updateView();
}
function updateView() {
  if (app.inXR) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const yaw = view.yaw, pitch = view.pitch;
  camera.position.set(0, 1.6 + BASE_Y * 0.5, view.dist);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}
window.addEventListener('resize', () => { if (!app.inXR) { renderer.setSize(window.innerWidth, window.innerHeight); fit2D(); } });

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let mouseHoverPanel = null;
function pick2D(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(panelMeshes, false)[0];
  if (!hit) return null;
  const panel = hit.object.userData.panel;
  return { panel, px: panel.toPx(hit.uv) };
}
const pointers = new Map();
let dragView = null, pinch = null;
renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (app.inXR) return;
  renderer.domElement.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.dist }; dragView = null; return;
  }
  const h = pick2D(ev);
  dragView = { x: ev.clientX, y: ev.clientY, yaw: view.yaw, pitch: view.pitch, moved: false, hit: h };
  if (h) { const b = h.panel.buttonAt(h.px); if (b && !b.disabled) { h.panel.pressed = b.id; h.panel.dirty = true; } }
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (app.inXR) return;
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    view.dist = Math.max(-0.6, Math.min(3.5, pinch.dist * (pinch.d / d))); updateView(); return;
  }
  if (dragView) {
    const dx = ev.clientX - dragView.x, dy = ev.clientY - dragView.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragView.moved = true;
    if (dragView.moved) {
      view.yaw = dragView.yaw + dx * 0.004;
      view.pitch = Math.max(-0.9, Math.min(0.9, dragView.pitch + dy * 0.004));
      view.yaw = Math.max(-1.6, Math.min(1.6, view.yaw));
      updateView();
      if (dragView.hit) { dragView.hit.panel.pressed = null; dragView.hit.panel.dirty = true; }
    }
    return;
  }
  const h = pick2D(ev);
  if (mouseHoverPanel && (!h || h.panel !== mouseHoverPanel)) mouseHoverPanel.setHover(null);
  if (h) { h.panel.setHover(h.px); mouseHoverPanel = h.panel; } else mouseHoverPanel = null;
  renderer.domElement.style.cursor = h && h.panel.buttonAt(h.px) ? 'pointer' : 'grab';
});
const endPointer = (ev) => {
  pointers.delete(ev.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (!dragView) return;
  const d = dragView; dragView = null;
  if (d.hit) { d.hit.panel.pressed = null; d.hit.panel.dirty = true; }
  if (!d.moved && d.hit && ev.type === 'pointerup') {
    const h = pick2D(ev);
    if (h && h.panel === d.hit.panel) {
      const b = h.panel.buttonAt(h.px);
      if (b && !b.disabled && b.onClick) { b.onClick(); h.panel.dirty = true; }
    }
  }
};
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);
renderer.domElement.addEventListener('pointerleave', () => { if (mouseHoverPanel) { mouseHoverPanel.setHover(null); mouseHoverPanel = null; } });
renderer.domElement.addEventListener('wheel', (ev) => {
  if (app.inXR) return;
  ev.preventDefault();
  view.dist = Math.max(-0.6, Math.min(3.5, view.dist + ev.deltaY * 0.0015)); updateView();
}, { passive: false });

// ------------------------------------------------------------------ XR input: controllers + hands
const xrPointers = [];
const cursorGeo = new THREE.RingGeometry(0.006, 0.011, 24);
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x35d8ff, transparent: true, opacity: 0.7 }));
  line.visible = false;
  ctrl.add(line);
  const cursor = new THREE.Mesh(cursorGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
  cursor.renderOrder = 10; cursor.visible = false; scene.add(cursor);
  const ptr = { ctrl, line, cursor, source: null, hit: null, press: null, drag: null, hoverPanel: null };
  xrPointers.push(ptr);
  ctrl.addEventListener('connected', (e) => { ptr.source = e.data; line.visible = true; });
  ctrl.addEventListener('disconnected', () => { ptr.source = null; line.visible = false; cursor.visible = false; endDrag(ptr); if (ptr.hoverPanel) ptr.hoverPanel.setHover(null); ptr.hoverPanel = null; });
  ctrl.addEventListener('selectstart', () => onPress(ptr, false));
  ctrl.addEventListener('selectend', () => onRelease(ptr));
  ctrl.addEventListener('squeezestart', () => onPress(ptr, true));
  ctrl.addEventListener('squeezeend', () => endDrag(ptr));
  scene.add(ctrl);

  const hand = renderer.xr.getHand(i);
  hand.userData.jointMeshes = true;
  scene.add(hand);
}
const jointGeo = new THREE.SphereGeometry(0.0055, 10, 8);
const jointMat = new THREE.MeshBasicMaterial({ color: 0x8eefff, transparent: true, opacity: 0.85 });
function updateHandVisuals() {
  for (let i = 0; i < 2; i++) {
    const hand = renderer.xr.getHand(i);
    for (const j of Object.values(hand.joints || {})) {
      if (!j.userData.vis) { const m = new THREE.Mesh(jointGeo, jointMat); j.add(m); j.userData.vis = m; }
    }
  }
}
function haptic(ptr, v = 0.35, ms = 25) {
  try { const h = ptr.source && ptr.source.gamepad && ptr.source.gamepad.hapticActuators && ptr.source.gamepad.hapticActuators[0]; if (h && h.pulse) h.pulse(v, ms); } catch {}
}
function castXR(ptr) {
  ray.setFromXRController(ptr.ctrl);
  const hit = ray.intersectObjects(panelMeshes, false)[0];
  if (!hit) return null;
  const panel = hit.object.userData.panel;
  return { panel, px: panel.toPx(hit.uv), point: hit.point, distance: hit.distance };
}
function onPress(ptr, isSqueeze) {
  const h = ptr.hit;
  if (!h) return;
  const b = isSqueeze ? null : h.panel.buttonAt(h.px);
  if (b && !b.disabled) { ptr.press = { panel: h.panel, id: b.id }; h.panel.pressed = b.id; h.panel.dirty = true; haptic(ptr, 0.3, 20); return; }
  if (isSqueeze || h.panel.inHeader(h.px)) {
    const m = h.panel.mesh;
    m.getWorldPosition(_v);
    ptr.drag = { panel: h.panel, dist: h.distance, offset: _v.clone().sub(h.point) };
    haptic(ptr, 0.5, 30);
  }
}
function onRelease(ptr) {
  if (ptr.drag) { endDrag(ptr); return; }
  const p = ptr.press; ptr.press = null;
  if (!p) return;
  p.panel.pressed = null; p.panel.dirty = true;
  const h = castXR(ptr);
  if (h && h.panel === p.panel) {
    const b = h.panel.buttonAt(h.px);
    if (b && b.id === p.id && b.onClick) { b.onClick(); haptic(ptr, 0.6, 35); }
  }
}
function endDrag(ptr) {
  if (!ptr.drag) return;
  ptr.drag = null;
  persistLayout();
}
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _head = new THREE.Vector3();
function updateXRPointers() {
  renderer.xr.getCamera().getWorldPosition(_head);
  for (const ptr of xrPointers) {
    if (!ptr.source) continue;
    if (ptr.drag) {
      ray.setFromXRController(ptr.ctrl);
      _o.copy(ray.ray.origin); _d.copy(ray.ray.direction);
      const target = _o.addScaledVector(_d, ptr.drag.dist).add(ptr.drag.offset);
      const m = ptr.drag.panel.mesh;
      rig.worldToLocal(target);
      m.position.copy(target);
      // face the user, stay upright
      const headLocal = rig.worldToLocal(_head.clone());
      m.lookAt(rig.localToWorld(new THREE.Vector3(headLocal.x, m.position.y, headLocal.z)));
      ptr.cursor.visible = false;
      ptr.line.scale.z = ptr.drag.dist;
      continue;
    }
    const h = castXR(ptr);
    ptr.hit = h;
    if (ptr.hoverPanel && (!h || h.panel !== ptr.hoverPanel)) { ptr.hoverPanel.setHover(null); ptr.hoverPanel = null; }
    if (h) {
      h.panel.setHover(h.px); ptr.hoverPanel = h.panel;
      ptr.cursor.visible = true;
      ptr.cursor.position.copy(h.point);
      h.panel.mesh.getWorldQuaternion(ptr.cursor.quaternion);
      ptr.cursor.translateZ(0.002);
      ptr.line.scale.z = h.distance;
      const overBtn = h.panel.buttonAt(h.px) || h.panel.inHeader(h.px);
      ptr.cursor.material.color.set(overBtn ? 0xe7b84a : 0xffffff);
    } else {
      ptr.cursor.visible = false;
      ptr.line.scale.z = 3;
    }
  }
}

// ------------------------------------------------------------------ entering / leaving the headset
app.enterXR = async (mode) => {
  if (!navigator.xr) return;
  const sessionMode = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
  try {
    const session = await navigator.xr.requestSession(sessionMode, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    app.xrMode = mode;
    env.visible = mode !== 'ar';
    renderer.setClearColor(0x000000, mode === 'ar' ? 0 : 1);
    await renderer.xr.setSession(session);
    app.inXR = true;
    pendingRecenter = 3; // wait a few frames for a valid head pose
    document.body.classList.add('in-xr');
    app.markDirty('all');
    session.addEventListener('end', () => {
      app.inXR = false; app.xrMode = null; env.visible = true;
      renderer.setClearColor(0x000000, 0);
      document.body.classList.remove('in-xr');
      for (const p of xrPointers) { p.cursor.visible = false; p.drag = null; }
      rig.position.set(0, 1.6, 0); rig.rotation.set(0, 0, 0);
      renderer.setSize(window.innerWidth, window.innerHeight); fit2D();
      app.markDirty('all');
    });
    app.jarvis.say(mode === 'ar' ? 'Command center online. Point and pull the trigger, or pinch, to use the screens. Grab a title bar to move one.' : 'Command center online.', 'info');
  } catch (err) {
    app.jarvis.say(`Couldn't start ${mode === 'ar' ? 'mixed reality' : 'VR'}: ${err.message || err}`, 'info', { speak: false });
    throw err;
  }
};
app.exitXR = () => { const s = renderer.xr.getSession(); if (s) s.end(); };

// ------------------------------------------------------------------ alerts
const alertMem = { last: {}, at: {}, hod: {}, lod: {}, mkt: null, warned5: null };
function flash(id) { if (P[id]) { P[id].flash = 1; P[id].dirty = true; } }
function canAlert(key, ms) { const now = Date.now(); if (now - (alertMem.at[key] || 0) < ms) return false; alertMem.at[key] = now; return true; }
function checkAlerts() {
  const s = app.settings, now = Date.now();
  const ms = marketStatus(now);
  const demo = app.feed.status.mode === 'demo';
  const tag = demo ? ' (demo)' : '';
  // bells
  if (s.alerts.bells) {
    if (alertMem.mkt && alertMem.mkt !== ms.state) {
      if (ms.state === 'open') app.jarvis.say('Opening bell. Market is open. Trade your plan, size from the breaker.', 'alert');
      if (alertMem.mkt === 'open' && ms.state !== 'open') app.jarvis.say(`Closing bell. Day P&L ${app.day.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(app.day.pnl))}.`, 'alert');
    }
    if (ms.state === 'open' && ms.msToNext < 5 * 60e3 && alertMem.warned5 !== ms.et.ymd) { alertMem.warned5 = ms.et.ymd; app.jarvis.say('Five minutes to the close. Zero-day options decay fast here.', 'alert'); }
  }
  alertMem.mkt = ms.state;
  for (const sym of s.symbols) {
    const q = app.feed.quote(sym);
    if (!q) continue;
    const prev = alertMem.last[sym];
    alertMem.last[sym] = q.last;
    if (prev == null) { alertMem.hod[sym] = q.high; alertMem.lod[sym] = q.low; continue; }
    const lv = app.levelsFor(sym);
    if (s.alerts.levels && lv && prev !== q.last) {
      for (const [k, name] of [['cw', 'call wall'], ['pw', 'put wall'], ['zg', 'zero gamma']]) {
        const L = lv[k]; if (L == null) continue;
        if ((prev - L) * (q.last - L) <= 0 && canAlert(sym + k, 10 * 60e3)) {
          app.jarvis.say(`${sym} crossing ${q.last >= L ? 'above' : 'below'} the ${name} at ${fmtPrice(L)}${tag}.`, 'alert');
          if (sym === s.main) flash('chart'); flash('watch');
        }
      }
    }
    if (s.alerts.hod && ms.state === 'open' && ms.et.h >= 10) {
      if (q.high != null && alertMem.hod[sym] != null && q.high > alertMem.hod[sym] && canAlert(sym + 'hod', 15 * 60e3)) {
        app.jarvis.say(`${sym} new high of day, ${fmtPrice(q.high)}${tag}.`, 'alert'); flash('watch');
      }
      if (q.low != null && alertMem.lod[sym] != null && q.low < alertMem.lod[sym] && canAlert(sym + 'lod', 15 * 60e3)) {
        app.jarvis.say(`${sym} new low of day, ${fmtPrice(q.low)}${tag}.`, 'alert'); flash('watch');
      }
    }
    alertMem.hod[sym] = q.high; alertMem.lod[sym] = q.low;
  }
  // cooldown finished
  const d = app.day;
  if (d.cooldownUntil && now >= d.cooldownUntil && !d.cooldownAnnounced) {
    d.cooldownAnnounced = true; saveDay(d);
    app.jarvis.say('Cooldown over. Only take A-plus setups — run the checklist first.', 'good');
  }
  if (d.cooldownUntil > now) d.cooldownAnnounced = false;
  // new day
  if (todayET() !== d.date) { app.day = freshDay(); persistDay(); }
}

// ------------------------------------------------------------------ feed lifecycle
function restartFeed() {
  app.feed.stop();
  app.feed = new MarketFeed(app.settings);
  app.feed.start();
  alertMem.last = {}; alertMem.hod = {}; alertMem.lod = {};
  app.markDirty('all');
}
app.applySettings = (prevKeys) => {
  app.levels = parseLevels(app.settings.levelsText);
  app.saveSettings();
  const keysChanged = !prevKeys || prevKeys.f !== app.settings.finnhubKey || prevKeys.t !== app.settings.twelveKey || prevKeys.syms !== app.settings.symbols.join(',');
  if (keysChanged) restartFeed();
  app.jarvis.setMuted(!app.settings.voice);
  app.markDirty('all');
};

// ------------------------------------------------------------------ render loop
const FEED_PANELS = ['watch', 'chart', 'leadlag', 'levels', 'top'];
const lastDraw = {};
let lastFeedRev = -1, lastSecond = 0, lastAlert = 0;
const clock = new THREE.Timer();
function loop(time, frame) {
  clock.update(time); const dt = Math.min(0.1, clock.getDelta());
  const now = Date.now();
  if (app.inXR) {
    if (pendingRecenter && frame) { pendingRecenter--; if (pendingRecenter === 0) app.recenter(); }
    updateXRPointers();
    updateHandVisuals();
  }
  // orb
  const j = app.jarvis;
  const pulse = j.speaking ? 1 + Math.sin(time * 0.02) * 0.18 : j.listening ? 1 + Math.sin(time * 0.012) * 0.12 : 1 + Math.sin(time * 0.002) * 0.04;
  orb.scale.setScalar(pulse);
  orb.getObjectByName('core').material.color.set(j.listening ? 0xffc04a : 0x7fefff);
  for (let i = 0; i < 3; i++) { const r = orb.getObjectByName('ring' + i); r.rotation.z += dt * (0.4 + i * 0.35) * (i % 2 ? -1 : 1); r.rotation.y += dt * 0.2 * (i + 1); }
  const dust = env.getObjectByName('dust'); if (dust) dust.rotation.y += dt * 0.004;

  // what needs redrawing
  if (app.feed.rev !== lastFeedRev) { lastFeedRev = app.feed.rev; FEED_PANELS.forEach(id => app.dirty.add(id)); }
  const sec = Math.floor(now / 1000);
  if (sec !== lastSecond) {
    lastSecond = sec; app.dirty.add('top');
    if (app.riskState().state === 'cooldown') app.dirty.add('risk');
  }
  for (const [id, p] of Object.entries(P)) {
    if (p.flash > 0) { p.flash = Math.max(0, p.flash - dt * 0.6); if (Math.floor(time / 250) % 2 === 0 || p.flash === 0) p.dirty = true; }
    if (app.dirty.has(id)) { p.dirty = true; }
  }
  app.dirty.clear();
  // redraw at most 3 panels per frame, each at most ~5x/second (keeps the headset smooth)
  let budget = 3;
  for (const [id, p] of Object.entries(P)) {
    if (!p.dirty || budget <= 0) continue;
    const minGap = p.pressed || p.hoverBtn !== p._lastHoverBtn ? 0 : id === 'chart' ? 220 : 180;
    if (now - (lastDraw[id] || 0) < minGap) continue;
    p.draw(); p._lastHoverBtn = p.hoverBtn; lastDraw[id] = now; budget--;
  }
  if (now - lastAlert > 1000) { lastAlert = now; try { checkAlerts(); } catch (e) { console.warn(e); } }
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    await Promise.race([
      Promise.all(["700 30px Rajdhani", "600 30px Rajdhani", "500 30px 'JetBrains Mono'", "700 30px 'JetBrains Mono'"].map(f => document.fonts.load(f))),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch {}
  app.recenter();
  fit2D();
  app.feed.start();
  app.markDirty('all');
  renderer.setAnimationLoop(loop);
  const st = app.feed.status;
  app.jarvis.say(st.mode === 'demo'
    ? `Welcome, ${app.settings.name}. Running on demo data. Add your free Finnhub and Twelve Data keys in Settings for live prices.`
    : `Welcome back, ${app.settings.name}. Live data connecting.`, 'info', { speak: false });
  if (!app.jarvis.canListen) app.jarvis.say('Voice commands are not supported in this browser, so the Talk button is off. Jarvis can still speak alerts.', 'info', { speak: false });
  initUI(app);
  // fonts may finish after first draw
  document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => app.markDirty('all'));
  window.__jarvis = { app, renderer, scene, camera, rig, P, THREE };
}
boot();
