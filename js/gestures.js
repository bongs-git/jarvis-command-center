// Hand gestures from WebXR hand tracking, built to fire once when you mean it and not otherwise.
//
//   Explode:      make a fist, hold it a beat, then burst your fingers wide open  -> deep dive
//   Consolidate:  open hands facing each other about shoulder-width apart, then bring them together
//   Expand:       open hands together, then pull them apart
//
// What keeps it steady:
//   - all 25 tracked joints per hand are used, and every measure is scaled to the size of the hand
//   - finger curl comes from each finger's own bones (tip-to-knuckle vs finger length), so it does not
//     depend on which way the hand is turned
//   - measures are smoothed, poses need to hold for a few frames, and thresholds have hysteresis
//   - two-hand moves need open palms that face each other, a held starting position, and a re-arm between fires
//   - a plain pinch (a click) can never start an explode

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
export const HAND_JOINTS = ['wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...FINGERS.flatMap(f => [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`])];
export const FINGERTIPS = ['thumb-tip', ...FINGERS.map(f => `${f}-tip`)];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

export const LEVELS = {
  //          pose hold  fist hold  burst window  wide/close hold  wide   together  close  apart   move window
  easy:   { hold: 55, fist: 90,  burst: 800, arm: 80,  wide: 0.28, near: 0.17, close: 0.19, far: 0.38, win: 1500 },
  normal: { hold: 70, fist: 140, burst: 600, arm: 120, wide: 0.32, near: 0.15, close: 0.17, far: 0.42, win: 1150 },
  strict: { hold: 90, fist: 220, burst: 450, arm: 200, wide: 0.38, near: 0.12, close: 0.14, far: 0.48, win: 900 },
};

// joints: { name: {x,y,z} } in metres. Returns raw measures, or null if the hand is not fully tracked.
export function handMetrics(joints) {
  for (const n of HAND_JOINTS) if (!joints[n]) return null;
  const wrist = joints.wrist;
  const knuckles = FINGERS.map(f => joints[`${f}-phalanx-proximal`]);
  const size = dist(wrist, knuckles[1]) || 0.09;                          // wrist to middle knuckle
  const ext = FINGERS.map((f) => {                                         // 1 = straight, ~0.4 = fully curled
    const k = joints[`${f}-phalanx-proximal`], i = joints[`${f}-phalanx-intermediate`], d = joints[`${f}-phalanx-distal`], t = joints[`${f}-tip`];
    const len = dist(k, i) + dist(i, d) + dist(d, t);
    return len > 1e-4 ? dist(t, k) / len : 1;
  });
  const tips = FINGERS.map(f => joints[`${f}-tip`]);
  const gap = (dist(tips[0], tips[1]) + dist(tips[1], tips[2]) + dist(tips[2], tips[3])) / 3 / size;
  const pinch = dist(joints['thumb-tip'], tips[0]) / size;
  const thumbOut = dist(joints['thumb-tip'], knuckles[0]) / size;
  const palm = { x: 0, y: 0, z: 0 };
  for (const p of [wrist, ...knuckles]) { palm.x += p.x / 5; palm.y += p.y / 5; palm.z += p.z / 5; }
  const normal = unit(cross(sub(knuckles[0], wrist), sub(knuckles[3], wrist)));
  return { size, ext, gap, pinch, thumbOut, palm, normal };
}

// Pose from measures. `prev` is the pose currently held, so a pose is harder to enter than to stay in.
export function classify(m, prev = null) {
  const stay = (p, a, b) => (prev === p ? b : a);
  const straight = m.ext.filter(e => e > stay('open', 0.86, 0.8)).length;
  const curled = m.ext.filter(e => e < stay('fist', 0.6, 0.68)).length;
  if (curled === 4) return 'fist';
  if (m.pinch < stay('pinch', 0.2, 0.32)) return 'pinch';
  if (straight === 4 && m.gap > stay('spread', 0.36, 0.3) && m.thumbOut > stay('spread', 0.6, 0.5)) return 'spread';
  if (prev === 'spread' && straight >= 3 && m.gap > 0.3) return 'spread';
  if (straight >= 3) return 'open';
  return 'relaxed';
}
// One-shot pose (no smoothing or hysteresis). Kept for callers that only want a quick read.
export function handPose(joints) {
  const m = handMetrics(joints); if (!m) return null;
  return { pose: classify(m), m, palm: m.palm, normal: m.normal };
}

const isOpen = (p) => p === 'open' || p === 'spread';
const blend = (a, b, k) => a + (b - a) * k;

export class GestureTracker {
  constructor({ onExplode, onConsolidate, onExpand, level = 'normal' } = {}) {
    this.on = { onExplode, onConsolidate, onExpand };
    this.level = level;
    this.hands = { left: this.blank(), right: this.blank() };
    this.cooldown = 0;
    this.two = { wideSince: 0, wideAt: 0, closeSince: 0, closeAt: 0, d: null };
    this.state = { left: null, right: null, armed: null, dist: null };     // for the UI: stable poses and what is primed
  }
  blank() { return { m: null, pose: null, cand: null, candAt: 0, since: 0, seen: 0, fist: null, palm: null, normal: null }; }
  get cfg() { return LEVELS[this.level] || LEVELS.normal; }

  // input: { left, right } where each is null, a result of handPose(), or { pose, palm } (already classified)
  // targets: { left, right } what each hand points at.  ctx: { canConsolidate, canExpand, busy: {left,right} }
  update(t, input, targets = {}, ctx = {}) {
    const c = this.cfg;
    for (const side of ['left', 'right']) {
      const h = this.hands[side], p = input[side];
      if (!p) { if (h.pose && t - h.seen > 250) this.hands[side] = this.blank(); continue; }
      h.seen = t; h.normal = p.normal || null;
      let raw;
      if (p.m) {
        // smooth the measures, then classify against the pose we are holding
        if (!h.m) h.m = { ext: [...p.m.ext], gap: p.m.gap, pinch: p.m.pinch, thumbOut: p.m.thumbOut };
        else { const k = 0.55; h.m.ext = h.m.ext.map((e, i) => blend(e, p.m.ext[i], k)); h.m.gap = blend(h.m.gap, p.m.gap, k); h.m.pinch = blend(h.m.pinch, p.m.pinch, 0.7); h.m.thumbOut = blend(h.m.thumbOut, p.m.thumbOut, k); }
        raw = classify(h.m, h.pose);
      } else raw = p.pose;
      h.palm = h.palm && p.m ? { x: blend(h.palm.x, p.palm.x, 0.6), y: blend(h.palm.y, p.palm.y, 0.6), z: blend(h.palm.z, p.palm.z, 0.6) } : { ...p.palm };
      // a new pose has to hold before it counts
      if (raw === h.pose) { h.cand = null; }
      else if (raw !== h.cand) { h.cand = raw; h.candAt = t; }
      if (h.cand && (h.pose == null || t - h.candAt >= c.hold)) {
        const was = h.pose, wasSince = h.since;
        h.pose = h.cand; h.since = h.candAt; h.cand = null;
        if (was === 'fist' && h.since - wasSince >= c.fist) h.fist = { end: h.since, palm: { ...h.palm } };   // a held fist just opened
      }
      if (h.pose === 'fist') h.fist = null;
    }
    const L = this.hands.left, R = this.hands.right;
    this.state.left = L.pose; this.state.right = R.pose; this.state.armed = null; this.state.dist = null;

    // ---- two hands: consolidate / expand
    const two = this.two;
    if (L.pose && R.pose && t - L.seen < 120 && t - R.seen < 120) {
      const d = two.d == null ? dist(L.palm, R.palm) : blend(two.d, dist(L.palm, R.palm), 0.6);
      two.d = d; this.state.dist = d;
      const open = isOpen(L.pose) && isOpen(R.pose);
      const notClosed = L.pose !== 'fist' && R.pose !== 'fist' && L.pose !== 'pinch' && R.pose !== 'pinch';
      let facing = true;
      if (L.normal && R.normal) { const u = unit(sub(R.palm, L.palm)); facing = Math.abs(dot(L.normal, u)) > 0.42 && Math.abs(dot(R.normal, u)) > 0.42; }
      // primed wide: open, facing, apart and held
      if (open && facing && d > c.wide) { if (!two.wideSince) two.wideSince = t; if (t - two.wideSince >= c.arm) two.wideAt = t; } else two.wideSince = 0;
      // primed close: open, together and held
      if (open && d < c.close) { if (!two.closeSince) two.closeSince = t; if (t - two.closeSince >= c.arm) two.closeAt = t; } else two.closeSince = 0;
      const wideLive = two.wideAt && t - two.wideAt < c.win, closeLive = two.closeAt && t - two.closeAt < c.win;
      if (t >= this.cooldown) {
        if (wideLive && ctx.canConsolidate !== false) this.state.armed = 'wide';
        else if (closeLive && ctx.canExpand !== false) this.state.armed = 'close';
        if (wideLive && notClosed && d < c.near && ctx.canConsolidate !== false) { this.fire(t); this.on.onConsolidate?.(); return 'consolidate'; }
        if (closeLive && notClosed && d > c.far && ctx.canExpand !== false) { this.fire(t); this.on.onExpand?.(); return 'expand'; }
      }
    } else { two.wideSince = 0; two.closeSince = 0; two.d = null; if (t - Math.max(L.seen, R.seen) > 400) { two.wideAt = 0; two.closeAt = 0; } }

    // ---- one hand: a held fist bursting open
    for (const side of ['right', 'left']) {
      const h = this.hands[side];
      if (h.pose === 'fist' && t - h.since >= c.fist && t >= this.cooldown && !this.state.armed) this.state.armed = 'fist-' + side;
      if (!h.fist) continue;
      if (t - h.fist.end > c.burst) { h.fist = null; continue; }
      if (h.pose !== 'spread' || t < this.cooldown) continue;
      const moved = dist(h.palm, h.fist.palm);
      h.fist = null;
      if (moved > 0.18 || ctx.busy?.[side]) continue;                         // a swing of the arm, or a drag in progress
      this.fire(t); this.on.onExplode?.(targets[side] || null, side); return 'explode';
    }
    return null;
  }
  fire(t) {
    this.cooldown = t + 1300;
    this.two.wideSince = this.two.wideAt = this.two.closeSince = this.two.closeAt = 0;
    this.hands.left.fist = null; this.hands.right.fist = null;
    this.state.armed = null;
  }
}
