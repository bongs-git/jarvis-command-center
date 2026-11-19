// Canvas-rendered holographic panels. Each panel is a flat mesh whose texture is redrawn when data changes.
import * as THREE from 'three';

export const C = {
  bg: 'rgba(9,14,24,0.80)', bg2: 'rgba(16,24,38,0.90)', bg3: 'rgba(24,34,52,0.95)',
  line: '#5ad1ff', lineDim: 'rgba(90,209,255,0.30)', lineFaint: 'rgba(255,255,255,0.07)',
  text: '#eef4fb', dim: '#9aa8bb', faint: '#66758a',
  gold: '#f0c674', goldDim: 'rgba(240,198,116,0.35)',
  up: '#34d399', down: '#f87171', amber: '#fbbf24', violet: '#a78bfa', white: '#f8fbff',
  grid: 'rgba(255,255,255,0.06)',
};
export const F = {
  hud: "'Geist', 'Inter', 'Segoe UI', Roboto, system-ui, sans-serif",
  mono: "'Geist Mono', 'JetBrains Mono', 'Roboto Mono', monospace",
};
export const PPM = 1100; // canvas pixels per meter

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
  ctx.font = font(size, weight, fam);
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  if ('letterSpacing' in ctx) ctx.letterSpacing = spacing ? (spacing * 0.35).toFixed(1) + 'px' : '0px';
  if (max > 0) {
    let s = size;
    while (s > 10 && ctx.measureText(str).width > max) { s -= 1; ctx.font = font(s, weight, fam); }
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

export class Panel {
  constructor({ id, title = '', w, h, header = true, resolution = PPM }) {
    this.id = id; this.title = title; this.w = w; this.h = h; this.header = header;
    this.W = Math.round(w * resolution); this.H = Math.round(h * resolution);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.generateMipmaps = true;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.userData.panel = this;
    this.mesh.renderOrder = 1;
    this.buttons = [];
    this.hover = null;      // {x, y} in canvas px while a pointer is over the panel
    this.hoverBtn = null;
    this.pressed = null;
    this.headerH = header ? 62 : 0;
    this.dirty = true;
    this.flash = 0;         // alert flash intensity 0..1
    this.accent = C.line;
  }

  setAnisotropy(a) { this.tex.anisotropy = a; }

  button(id, x, y, w, h, label, { active = false, color = C.line, disabled = false, size = 26, onClick, fill } = {}) {
    const ctx = this.ctx;
    const hov = this.hoverBtn === id && !disabled;
    const prs = this.pressed === id && !disabled;
    rrect(ctx, x, y, w, h, Math.min(16, h / 2));
    ctx.fillStyle = fill ? fill : active ? hexA(color, 0.26) : prs ? hexA(color, 0.34) : hov ? hexA(color, 0.16) : 'rgba(255,255,255,0.055)';
    ctx.fill();
    ctx.lineWidth = active || hov ? 2.5 : 1.5;
    ctx.strokeStyle = disabled ? 'rgba(255,255,255,0.06)' : active || hov ? hexA(color, 0.95) : 'rgba(255,255,255,0.10)';
    ctx.stroke();
    text(ctx, label, x + w / 2, y + h / 2 + 1, { size, weight: 600, color: disabled ? C.faint : active ? C.white : hov ? C.white : C.text, align: 'center', base: 'middle', max: w - 16 });
    this.buttons.push({ id, x, y, w, h, onClick, disabled });
  }

  draw() {
    const { ctx, W, H } = this;
    if (this.prepare) this.prepare();
    this.buttons = [];
    ctx.clearRect(0, 0, W, H);
    // glass body
    rrect(ctx, 3, 3, W - 6, H - 6, 30);
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, this.solid ? 'rgba(20,29,46,0.97)' : 'rgba(22,32,50,0.86)'); g.addColorStop(1, this.solid ? 'rgba(8,12,22,0.97)' : 'rgba(8,12,22,0.84)');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.flash > 0 ? mixColor('#ffffff', C.amber, this.flash) : 'rgba(255,255,255,0.12)';
    ctx.stroke();
    // soft top highlight
    const hl = ctx.createLinearGradient(0, 0, 0, 90);
    hl.addColorStop(0, 'rgba(255,255,255,0.07)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    rrect(ctx, 4, 4, W - 8, 90, 28); ctx.fillStyle = hl; ctx.fill();
    if (this.header) {
      ctx.fillStyle = this.flash > 0 ? C.amber : this.accent;
      ctx.beginPath(); ctx.arc(36, 37, 6, 0, Math.PI * 2); ctx.fill();
      text(ctx, this.title, 54, 47, { size: 29, weight: 600, color: this.titleColor || C.text });
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(24, this.headerH); ctx.lineTo(W - 24, this.headerH); ctx.stroke();
      // drag handle
      ctx.fillStyle = this.hover && this.hover.y < this.headerH ? C.gold : 'rgba(255,255,255,0.18)';
      rrect(ctx, W / 2 - 34, 14, 68, 7, 3.5); ctx.fill();
    }
    this.drawBody(ctx, { x: 24, y: this.headerH + 14, w: W - 48, h: H - this.headerH - 34 });
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
  setHover(px) {
    const b = px ? this.buttonAt(px) : null;
    const id = b && !b.disabled ? b.id : null;
    const moved = !!px !== !!this.hover || (px && this.hover && (Math.abs(px.x - this.hover.x) > 4 || Math.abs(px.y - this.hover.y) > 4));
    if (id !== this.hoverBtn || (moved && this.wantsHoverRedraw)) this.dirty = true;
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
