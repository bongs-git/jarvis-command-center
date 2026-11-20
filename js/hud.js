// Canvas-rendered holographic panels. Each panel is a flat mesh whose texture is redrawn when data changes.
import * as THREE from 'three';

// The website's palette (bongs-git.github.io/indai, css/app.css). Gold marks brand, primary and selected;
// sky is only for the last-price tag and neutral info. No glow, no gradients.
export const C = {
  ink: '#050709', bg: '#0a0e14', bg2: '#111721', bg3: '#18202c',
  hair: 'rgba(255,255,255,0.08)', hair2: 'rgba(255,255,255,0.15)',
  line: '#dcbf6e', lineDim: 'rgba(220,191,110,0.5)', lineFaint: 'rgba(255,255,255,0.08)',
  // dim and faint are a step brighter than the website's: thin grey text on near-black strains the eyes in a headset
  text: '#f3f1ea', dim: '#b2b9c5', faint: '#838d9c',
  gold: '#dcbf6e', goldDim: 'rgba(220,191,110,0.5)', goldWash: 'rgba(220,191,110,0.12)', goldInk: '#17120a',
  up: '#3ecf8e', down: '#f2706b', amber: '#f0b34a', sky: '#6ec3f2', violet: '#a99bf5', white: '#fcfbf5',
  grid: 'rgba(255,255,255,0.055)',
};
// The website is drawn at about 14px body text; panels here are drawn at about 1.85x that, so 1 website px = S canvas px.
export const S = 1.85;
export const F = {
  hud: "Geist, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};
export const PPM = 1100; // layout units per meter: every panel is laid out in these units
// Panels are painted at TEX x their layout size so text stays crisp in the headset (the lenses and the
// compositor resample everything; a texture at 1:1 with the display reads soft). Layout code never sees this.
export const TEX = 1.6;

export function fmtPrice(p) { if (p == null || !isFinite(p)) return '—'; return p >= 1000 ? p.toFixed(1) : p.toFixed(2); }
export function fmtPct(p) { if (p == null || !isFinite(p)) return '—'; return (p >= 0 ? '+' : '') + p.toFixed(2) + '%'; }
export function fmtMoney(v, sign = false) {
  if (v == null || !isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (v < 0 ? '−$' : (sign && v > 0 ? '+$' : '$')) + s;
}
export const colorFor = (v) => (v > 0 ? C.up : v < 0 ? C.down : C.dim);

export function font(size, weight = 600, fam = F.hud) { return `${weight} ${size}px ${fam}`; }

export function text(ctx, str, x, y, { size = 28, weight = 600, color = C.text, align = 'left', base = 'alphabetic', fam = F.hud, max = 0, spacing = 0 } = {}) {
  weight = Math.max(500, weight);              // thin strokes shimmer and blur in VR
  ctx.font = font(size, weight, fam);
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  if ('letterSpacing' in ctx) ctx.letterSpacing = spacing ? (spacing * 0.35).toFixed(1) + 'px' : '0px';
  if (max > 0) {
    let s = size;
    while (s > 15 && ctx.measureText(str).width > max) { s -= 1; ctx.font = font(s, weight, fam); }
  }
  ctx.fillText(str, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return ctx.measureText(str).width;
}

export function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// The logo's viewfinder: four short gold corner brackets. On the website it frames the chart and nothing else.
export function frameCorners(ctx, x, y, w, h, len = 20 * S, t = 2 * S) {
  ctx.fillStyle = C.gold;
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.fillRect(dx > 0 ? cx : cx - len, dy > 0 ? cy : cy - t, len, t);
    ctx.fillRect(dx > 0 ? cx : cx - t, dy > 0 ? cy : cy - len, t, len);
  }
}

export class Panel {
  constructor({ id, title = '', w, h, header = true, resolution = PPM }) {
    this.id = id; this.title = title; this.w = w; this.h = h; this.header = header;
    this.W = Math.round(w * resolution); this.H = Math.round(h * resolution);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.W * TEX); this.canvas.height = Math.round(this.H * TEX);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingQuality = 'high';
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.generateMipmaps = true;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide, toneMapped: false });
    // Sample half a mip level sharper than the GPU would pick: keeps text crisp on panels seen at an angle or from afar.
    mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n\tdiffuseColor *= texture2D( map, vMapUv, -0.5 );\n#endif'); };
    mat.customProgramCacheKey = () => 'indai-panel-sharp';
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.userData.panel = this;
    this.mesh.renderOrder = 1;
    this.buttons = [];
    this.hover = null;      // {x, y} in canvas px while a pointer is over the panel
    this.hoverBtn = null;
    this.pressed = null;
    this.headerH = header ? 60 : 0;
    this.dirty = true;
    this.resizable = true;  // set false for focus cards and floating helpers
    this.flash = 0;         // alert flash intensity 0..1
    this.accent = C.line;
  }

  setAnisotropy(a) { this.tex.anisotropy = a; }

  // Buttons as on the website: hairline-bordered, nearly flat. `primary` is solid gold; a selected (active) button is a
  // wash of its colour with that colour's text; `tone` buttons (win/loss) always carry their colour at 10%.
  button(id, x, y, w, h, label, { active = false, color = C.line, disabled = false, size = 26, onClick, fill, primary = false, tone = false } = {}) {
    const ctx = this.ctx;
    const hov = this.hoverBtn === id && !disabled;
    const prs = this.pressed === id && !disabled;
    rrect(ctx, x, y, w, h, Math.min(8 * S, h / 2));
    let bg, border, ink, weight = 500;
    if (primary) { bg = prs ? '#c9ad5f' : hov ? '#e7cd85' : C.gold; border = C.gold; ink = C.goldInk; weight = 600; }
    else if (active) { bg = hexA(color, prs ? 0.22 : hov ? 0.18 : 0.12); border = hexA(color, 0.5); ink = color; weight = 600; }
    else if (tone) { bg = hexA(color, prs ? 0.24 : hov ? 0.18 : 0.10); border = hexA(color, 0.5); ink = color; weight = 600; }
    else { bg = prs ? '#1f2937' : hov ? C.bg3 : 'rgba(255,255,255,0.03)'; border = C.hair2; ink = C.text; }
    if (fill) bg = fill;
    if (disabled) { bg = 'rgba(255,255,255,0.02)'; border = C.hair; ink = C.faint; }
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = border; ctx.stroke();
    text(ctx, label, x + w / 2, y + h / 2 + 1, { size, weight, color: ink, align: 'center', base: 'middle', max: w - 16 });
    this.buttons.push({ id, x, y, w, h, onClick, disabled });
  }

  draw() {
    const { ctx, W, H } = this;
    if (this.prepare) this.prepare();
    this.buttons = [];
    ctx.setTransform(TEX, 0, 0, TEX, 0, 0);    // draw in layout units onto the larger canvas
    ctx.clearRect(0, 0, W, H);
    // flat panel, as on the website: #0a0e14, hairline border, 10px corners. Kept nearly opaque so text holds
    // its contrast against passthrough and the scenes.
    rrect(ctx, 2, 2, W - 4, H - 4, 10 * S);
    ctx.fillStyle = this.solid ? 'rgba(10,14,20,0.98)' : 'rgba(10,14,20,0.94)'; ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.flash > 0 ? mixColor('#ffffff', C.amber, this.flash) : C.hair;
    ctx.stroke();
    if (this.framed) frameCorners(ctx, 2, 2, W - 4, H - 4);
    if (this.header) {
      text(ctx, this.title, 24, 44, { size: 25, weight: 600, color: this.flash > 0 ? C.amber : this.titleColor || C.text });
      ctx.strokeStyle = C.hair; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, this.headerH); ctx.lineTo(W, this.headerH); ctx.stroke();
      // drag handle
      ctx.fillStyle = this.hover && this.hover.y < this.headerH ? C.gold : 'rgba(255,255,255,0.15)';
      rrect(ctx, W / 2 - 30, 4, 60, 5, 2.5); ctx.fill();
    }
    this.drawBody(ctx, { x: 24, y: this.headerH + 14, w: W - 48, h: H - this.headerH - 34 });
    // resize grip in the bottom-right corner: pinch (or trigger) and drag it to make the window bigger or smaller
    if (this.resizable) {
      const hot = this.hover && this.inCorner(this.hover);
      ctx.strokeStyle = hot ? C.gold : 'rgba(255,255,255,0.22)'; ctx.lineWidth = hot ? 4 : 3; ctx.lineCap = 'round';
      for (const k of [14, 28, 42]) { ctx.beginPath(); ctx.moveTo(W - 10 - k, H - 10); ctx.lineTo(W - 10, H - 10 - k); ctx.stroke(); }
      ctx.lineCap = 'butt';
    }
    this.tex.needsUpdate = true;
    this.dirty = false;
  }
  drawBody() {}

  // uv (0..1, origin bottom-left) -> canvas px
  toPx(uv) { return { x: uv.x * this.W, y: (1 - uv.y) * this.H }; }
  buttonAt(px) {
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (px.x >= b.x && px.x <= b.x + b.w && px.y >= b.y && px.y <= b.y + b.h) return b;
    }
    return null;
  }
  inHeader(px) { return this.header && px.y < this.headerH; }
  inCorner(px) { return !!this.resizable && px.x > this.W - 70 && px.y > this.H - 70; }
  setHover(px) {
    const b = px ? this.buttonAt(px) : null;
    const id = b && !b.disabled ? b.id : null;
    const moved = !!px !== !!this.hover || (px && this.hover && (Math.abs(px.x - this.hover.x) > 4 || Math.abs(px.y - this.hover.y) > 4));
    if (id !== this.hoverBtn || (moved && this.wantsHoverRedraw)) this.dirty = true;
    if (!!(px && this.inCorner(px)) !== !!(this.hover && this.inCorner(this.hover))) this.dirty = true;
    if (!!px !== !!this.hover) this.dirty = true;
    this.hoverBtn = id; this.hover = px;
  }
}

export function hexA(hex, a) {
  if (hex.startsWith('rgba')) return hex;
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function mixColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
