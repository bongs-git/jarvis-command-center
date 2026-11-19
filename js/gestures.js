// Hand gestures from WebXR hand tracking.
//   Explode:      pinch (or close your hand), then spread your fingers wide within ~0.6 s
//                 while pointing at a ticker  -> deep-dive card for that ticker
//   Consolidate:  open hands, bring them together (palms < 14 cm apart) within ~1.2 s
//                 -> every screen collapses into one summary
//   Expand:       from together, pull hands apart (> 45 cm) within ~1.2 s -> screens come back

const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];

function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

// joints: { name: {x,y,z} } in metres (world space). Returns a pose description or null.
export function handPose(joints) {
  const need = ['wrist', 'middle-finger-metacarpal', ...TIPS];
  for (const n of need) if (!joints[n]) return null;
  const palm = joints['middle-finger-metacarpal'];
  const pinch = dist(joints['thumb-tip'], joints['index-finger-tip']);
  const tips = TIPS.slice(1).map(n => joints[n]);
  const openness = tips.reduce((a, t) => a + dist(t, palm), 0) / tips.length;
  const spread = (dist(joints['index-finger-tip'], joints['middle-finger-tip']) + dist(joints['middle-finger-tip'], joints['ring-finger-tip']) + dist(joints['ring-finger-tip'], joints['pinky-finger-tip'])) / 3;
  const thumbOut = dist(joints['thumb-tip'], palm);
  let pose = 'relaxed';
  if (pinch < 0.022) pose = 'pinch';
  else if (openness < 0.06) pose = 'fist';
  else if (openness > 0.082 && spread > 0.03 && thumbOut > 0.07) pose = 'spread';
  else if (openness > 0.075) pose = 'open';
  return { pose, pinch, openness, spread, palm: { x: palm.x, y: palm.y, z: palm.z } };
}

export class GestureTracker {
  constructor({ onExplode, onConsolidate, onExpand } = {}) {
    this.on = { onExplode, onConsolidate, onExpand };
    this.hist = { left: [], right: [] };
    this.between = [];
    this.cooldown = 0;
    this.last = { left: null, right: null };
  }
  // poses: { left: pose|null, right: pose|null }, targets: { left: symbol|null, right: symbol|null }
  update(t, poses, targets = {}) {
    for (const side of ['left', 'right']) {
      const p = poses[side];
      this.last[side] = p;
      const h = this.hist[side];
      if (p) h.push({ t, pose: p.pose }); else h.length = 0;
      while (h.length && t - h[0].t > 900) h.shift();
    }
    if (t < this.cooldown) return null;
    // Two-hand consolidate / expand
    const L = poses.left, R = poses.right;
    if (L && R && L.pose !== 'fist' && R.pose !== 'fist' && L.pose !== 'pinch' && R.pose !== 'pinch') {
      const d = dist(L.palm, R.palm);
      this.between.push({ t, d });
      while (this.between.length && t - this.between[0].t > 1300) this.between.shift();
      const maxD = Math.max(...this.between.map(b => b.d)), minD = Math.min(...this.between.map(b => b.d));
      const first = this.between[0];
      if (d < 0.14 && maxD > 0.40 && first.d > 0.35) { this.fire(t); this.on.onConsolidate?.(); return 'consolidate'; }
      if (d > 0.45 && minD < 0.16 && first.d < 0.2) { this.fire(t); this.on.onExpand?.(); return 'expand'; }
    } else this.between.length = 0;
    // One-hand explode: closed (pinch/fist) -> spread quickly
    for (const side of ['right', 'left']) {
      const h = this.hist[side]; if (h.length < 2) continue;
      const now = h[h.length - 1];
      if (now.pose !== 'spread') continue;
      const closed = h.slice(0, -1).reverse().find(x => x.pose === 'pinch' || x.pose === 'fist');
      const anySpreadBetween = closed && h.filter(x => x.t > closed.t && x.t < now.t).some(x => x.pose === 'spread');
      if (closed && now.t - closed.t < 650 && !anySpreadBetween) {
        this.fire(t); this.on.onExplode?.(targets[side] || null, side); return 'explode';
      }
    }
    return null;
  }
  fire(t) { this.cooldown = t + 1500; this.between.length = 0; this.hist.left.length = 0; this.hist.right.length = 0; }
}
