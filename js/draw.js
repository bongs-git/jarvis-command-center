// Drawings on the main chart: the trend lines and price levels the trader adds by hand.
// Kept on this device per ticker. A level stays until it is deleted; a trend line is dropped a month after it was drawn.
const KEY = 'indai.web.draw.v1';
const KEEP = 31 * 864e5;

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {}, num = Number.isFinite;
    for (const [sym, list] of Object.entries(v)) {
      if (!Array.isArray(list)) continue;
      const ok = list.filter(d => d && typeof d.id === 'string' && (
        (d.type === 'level' && num(d.p)) ||
        (d.type === 'line' && num(d.day) && d.a && d.b && [d.a.t, d.a.p, d.b.t, d.b.p].every(num) && Date.now() - d.day < KEEP)));
      if (ok.length) out[sym] = ok;
    }
    return out;
  } catch { return {}; }
}
let state = load(), seq = 0;

export function saveDrawings() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private window or full storage: they last until the page closes */ } }
// Everything drawn for the ticker.
export function drawingsFor(sym) { return state[sym] || []; }
export function addDrawing(sym, d) {
  const item = { id: Date.now().toString(36) + (seq++).toString(36), ...d };
  (state[sym] ||= []).push(item);
  saveDrawings();
  return item;
}
export function removeDrawing(sym, id) {
  const list = state[sym] || [], n = list.length;
  state[sym] = list.filter(d => d.id !== id);
  if (!state[sym].length) delete state[sym];
  saveDrawings();
  return n !== (state[sym] || []).length;
}
// Removes everything drawn for the ticker.
export function clearDrawings(sym) { delete state[sym]; saveDrawings(); }
export function reloadDrawings() { state = load(); }

// Distance from a point to the segment a-b, all in pixels.
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const k = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}
