// Market data: demo simulator, Finnhub (real-time trades + quotes), Twelve Data (intraday candles).
import { INTERVAL_MS, aggregate, chartSession, etParts, etToMs, marketStatus } from './market.js';
import { relay } from './relay.js';

const IVS = ['1min', '5min', '15min'];
export const LEADLAG = ['SPY', 'QQQ', 'IWM'];

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Rough demo profiles. Demo prices are illustrative only and are always labelled DEMO.
const PROFILE = {
  SPY: { p: 749, beta: 1.0, vol: 0.00022, v: 90e3, step: 1 },
  QQQ: { p: 662, beta: 1.2, vol: 0.00026, v: 60e3, step: 1 },
  IWM: { p: 276, beta: 1.3, vol: 0.00040, v: 45e3, step: 1 },
  TSLA: { p: 387, beta: 1.8, vol: 0.0011, v: 140e3, step: 5 },
  AMZN: { p: 265, beta: 1.1, vol: 0.00055, v: 70e3, step: 2.5 },
  MSFT: { p: 528, beta: 0.9, vol: 0.00045, v: 30e3, step: 5 },
  NVDA: { p: 156, beta: 1.6, vol: 0.0009, v: 300e3, step: 2.5 },
  AAPL: { p: 358, beta: 1.0, vol: 0.00045, v: 70e3, step: 2.5 },
};
function profileFor(sym) {
  if (PROFILE[sym]) return PROFILE[sym];
  const h = hashStr(sym);
  return { p: 40 + (h % 400), beta: 1 + ((h >> 8) % 60) / 100, vol: 0.0006, v: 20e3, step: 1 };
}

function emptySym(sym) {
  return { sym, last: null, prevClose: null, dayOpen: null, high: null, low: null, bars: { '1min': [], '5min': [], '15min': [] }, lastTradeAt: 0, rev: 0 };
}

export class MarketFeed {
  constructor(settings) {
    this.settings = settings;
    this.syms = new Map();
    this.rev = 0;
    this.status = { mode: 'demo', finnhubRest: 'off', finnhubWs: 'off', twelve: 'off', note: '' };
    this.demoLevels = {};
    this.timers = [];
    this.ws = null;
    this.wsBackoff = 2000;
    this.tdQueue = [];
    this.tdTokens = 8;
    this.tdLastRefill = Date.now();
    this.lastSeriesFetch = {};
  }

  get trackedSymbols() {
    return [...new Set([...this.settings.symbols, ...LEADLAG])];
  }
  sym(s) { if (!this.syms.has(s)) this.syms.set(s, emptySym(s)); return this.syms.get(s); }
  bump(s) { s.rev++; this.rev++; }

  setStatus(patch) { Object.assign(this.status, patch); this.rev++; }

  start() {
    this.stop();
    this.syms.clear();
    for (const s of this.trackedSymbols) this.sym(s);
    const hasF = !!this.settings.finnhubKey;
    if (this.settings.dataMode === 'demo') { this.startDemoMode('Demo mode is on in Settings.'); return; }
    this.setStatus({ mode: hasF ? 'live' : 'delayed', cboe: 'connecting', finnhubRest: 'off', finnhubWs: hasF ? 'connecting' : 'off', twelve: 'off', note: '' });
    this.cboeFails = 0;
    this.cboeKick();
    if (hasF) this.fhConnect();
    this.timers.push(setInterval(() => this.cboeTick(), 5000));
    this.timers.push(setInterval(() => this.tdPump(), 1000));
  }
  startDemoMode(note) {
    this.stop();
    this.syms.clear();
    for (const s of this.trackedSymbols) this.sym(s);
    this.setStatus({ mode: 'demo', cboe: 'off', finnhubRest: 'off', finnhubWs: 'off', twelve: 'off', note: note || 'DEMO DATA' });
    this.startDemo();
  }

  // ---------- CBOE delayed data via the INDAI relay (free, no keys) ----------
  async cboeKick() {
    const syms = this.trackedSymbols;
    try {
      await this.cboeSnapshot(syms);
      this.setStatus({ cboe: 'ok' });
      const first = [...new Set([this.settings.main, ...LEADLAG])];
      await this.cboeBars(first);
      await this.cboeBars(syms.filter(x => !first.includes(x)));
    } catch (e) {
      this.cboeFails++;
      this.setStatus({ cboe: 'err', cboeErr: e.message });
      if (this.cboeFails >= 2 && this.status.mode === 'delayed') this.startDemoMode("Couldn't reach market data, so this is demo data. It retries when you reopen the app.");
      else setTimeout(() => this.cboeKick(), 4000);
    }
  }
  async cboeTick() {
    if (this.status.mode === 'demo') return;
    const now = Date.now(), st = marketStatus(now).state;
    const open = st === 'open' || st === 'pre' || st === 'post';
    this.lastSnap ??= 0; this.lastBarsMain ??= 0; this.lastBarsRest ??= 0;
    try {
      if (now - this.lastSnap > (open ? 20e3 : 120e3)) { this.lastSnap = now; await this.cboeSnapshot(this.trackedSymbols); this.setStatus({ cboe: 'ok' }); }
      const first = [...new Set([this.settings.main, ...LEADLAG])];
      if (now - this.lastBarsMain > (st === 'open' ? 60e3 : 900e3)) { this.lastBarsMain = now; await this.cboeBars(first); }
      if (now - this.lastBarsRest > (st === 'open' ? 180e3 : 1800e3)) { this.lastBarsRest = now; await this.cboeBars(this.trackedSymbols.filter(x => !first.includes(x))); }
    } catch (e) { this.setStatus({ cboe: 'err', cboeErr: e.message }); }
  }
  async cboeSnapshot(syms) {
    if (!syms.length) return;
    const j = await relay.snapshot(syms);
    const st = marketStatus().state;
    for (const q of j.quotes || []) {
      if (!q.ok || !(q.price > 0 || q.close > 0)) continue;
      const s = this.sym(q.symbol);
      s.prevClose = q.prevClose || s.prevClose; s.iv30 = q.iv30; s.cboeTime = q.timestamp;
      if (q.open) s.dayOpen = q.open; if (q.high) s.high = q.high; if (q.low) s.low = q.low;
      const liveTick = (s.lastTradeAt && Date.now() - s.lastTradeAt < 30e3 && this.status.finnhubWs === 'live') || (s.tvAt && Date.now() - s.tvAt < 150e3);
      if (st === 'open') { if (!liveTick) { s.last = q.price; s.lastTradeAt = Date.now(); } s.ext = null; }
      else { s.last = q.close > 0 ? q.close : q.price; s.ext = q.price > 0 && q.close > 0 && Math.abs(q.price - q.close) > 0.005 ? q.price : null; s.lastTradeAt = Date.now(); }
      this.bump(s);
    }
    this.lastSnap = Date.now();
  }
  async cboeBars(syms) {
    for (let i = 0; i < syms.length; i += 8) {
      const j = await relay.bars(syms.slice(i, i + 8));
      for (const [sym, d] of Object.entries(j.bars || {})) {
        if (!d || !d.session || !Array.isArray(d.bars) || !d.bars.length) continue;
        const [y, m, dd] = d.session.split('-').map(Number);
        const base = etToMs(y, m, dd, 0, 0);
        const bars = d.bars.map(b => ({ t: base + (b[0] - 1) * 60e3, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], cv: b[6], pv: b[7] }));
        const s = this.sym(sym);
        const lastT = bars[bars.length - 1].t;
        s.cboeVol = new Map(bars.map(b => [b.t, b.v]));
        const live = s.bars['1min'].filter(b => b.t > lastT);
        if (s.tvRaw) { const k = this.bridgeVolScale(s); for (const b of live) if (s.tvRaw.has(b.t)) b.v = Math.round(s.tvRaw.get(b.t) * k); }
        s.bars['1min'] = [...bars, ...live];
        s.bars['5min'] = []; s.bars['15min'] = [];
        s.cboeBars = true;
        this.bump(s);
      }
    }
  }

  // ---------- TradingView bridge (candles sent by the INDAI Bridge indicator) ----------
  applyBridgeBar(sym, b, tf = '1') {
    if (this.status.mode === 'demo' || !(b.c > 0)) return;
    const s = this.sym(sym);
    const iv = tf === '5' ? '5min' : tf === '15' ? '15min' : '1min';
    const arr = s.bars[iv];
    // TradingView's free Cboe (BATS) feed only carries Cboe's share of volume, so scale it to market-wide volume
    // using minutes where both it and the consolidated CBOE candles exist.
    (s.tvRaw ??= new Map()).set(b.t, b.v || 0);
    const bar = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: Math.round((b.v || 0) * this.bridgeVolScale(s)) };
    const i = arr.findIndex(x => x.t === bar.t);
    if (i >= 0) arr[i] = bar; else { arr.push(bar); if (arr.length > 1 && arr[arr.length - 2].t > bar.t) arr.sort((p, q) => p.t - q.t); }
    const newest = arr[arr.length - 1];
    if (newest === bar) {
      s.last = bar.c; s.lastTradeAt = Date.now(); s.tvAt = Date.now(); s.ext = null;
      const sess = chartSession();
      if (bar.t >= sess.open && bar.t < sess.close) { s.high = s.high == null ? bar.h : Math.max(s.high, bar.h); s.low = s.low == null ? bar.l : Math.min(s.low, bar.l); }
    }
    this.status.tvBridge = 'live'; this.status.tvAt = Date.now();
    this.bump(s);
  }
  bridgeVolScale(s) {
    const cv = s.cboeVol, raw = s.tvRaw;
    if (!raw || !raw.size) return 1;
    const med = (a) => { a = a.filter(x => x > 0).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : 0; };
    const ratios = [];
    if (cv) for (const [t, v] of raw) { const c = cv.get(t); if (c > 0 && v > 0) ratios.push(c / v); }
    let k = ratios.length >= 3 ? med(ratios) : 0;
    if (!k && cv && cv.size >= 5 && raw.size >= 5) { const a = med([...cv.values()].slice(-20)), b = med([...raw.values()].slice(-20)); if (a && b) k = a / b; }
    if (!k) k = 12; // Cboe BZX trades roughly 6-10% of US volume
    return Math.max(1, Math.min(60, k));
  }
  get bridgeLive() { return this.status.tvAt && Date.now() - this.status.tvAt < 180e3; }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch {} this.ws = null; }
    this.tdQueue = [];
  }

  // ---------- common ----------
  applyTrade(sym, price, vol, t, { updateIntervals = IVS } = {}) {
    const s = this.sym(sym);
    if (!(price > 0)) return;
    s.last = price; s.lastTradeAt = t;
    const sess = chartSession(t);
    if (t >= sess.open && t < sess.close) {
      s.high = s.high == null ? price : Math.max(s.high, price);
      s.low = s.low == null ? price : Math.min(s.low, price);
      if (s.dayOpen == null) s.dayOpen = price;
    }
    for (const iv of updateIntervals) {
      const ms = INTERVAL_MS[iv];
      const bucket = Math.floor(t / ms) * ms;
      const arr = s.bars[iv];
      const last = arr[arr.length - 1];
      if (!last || bucket > last.t) arr.push({ t: bucket, o: last && bucket - last.t <= ms ? last.c : price, h: price, l: price, c: price, v: vol || 0 });
      else if (bucket === last.t) { last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); last.c = price; last.v += vol || 0; }
      if (arr.length > 1200) arr.splice(0, arr.length - 1200);
    }
    this.bump(s);
  }

  // Bars for the chart session (regular hours only).
  getBars(sym, iv) {
    const s = this.syms.get(sym);
    if (!s) return [];
    const sess = chartSession();
    const within = (arr) => arr.filter(b => b.t >= sess.open && b.t < sess.close);
    let arr = within(s.bars[iv]);
    if (iv === '15min') {
      const agg = aggregate(within(s.bars['5min']).length ? within(s.bars['5min']) : within(s.bars['1min']), INTERVAL_MS['15min']);
      if (agg.length > arr.length) arr = agg;
    } else if (iv === '5min') {
      const agg = aggregate(within(s.bars['1min']), INTERVAL_MS['5min']);
      if (agg.length > arr.length) arr = agg;
    }
    return arr;
  }

  quote(sym) {
    const s = this.syms.get(sym);
    if (!s || s.last == null) return null;
    let base = s.prevClose;
    if (base == null) { const b = this.getBars(sym, '5min'); base = b.length ? b[0].o : s.dayOpen; }
    const chg = base ? s.last - base : 0;
    return { sym, last: s.last, prevClose: s.prevClose, base, chg, pct: base ? (chg / base) * 100 : 0, high: s.high, low: s.low, lastTradeAt: s.lastTradeAt, ext: s.ext ?? null, extPct: s.ext && s.last ? (s.ext / s.last - 1) * 100 : null, iv30: s.iv30 ?? null };
  }

  // ---------- demo ----------
  startDemo() {
    const now = Date.now();
    const sess = chartSession(now);
    const seed = hashStr(sess.ymd);
    const rnd = mulberry32(seed);
    const end = Math.min(now, sess.close);
    const minutes = Math.max(1, Math.floor((end - sess.open) / 60e3));
    const syms = this.trackedSymbols;
    const state = {};
    for (const sym of syms) {
      const pr = profileFor(sym);
      const symRnd = mulberry32(seed ^ hashStr(sym));
      const prevClose = pr.p * (1 + gauss(symRnd) * 0.006);
      const open = prevClose * (1 + gauss(symRnd) * pr.vol * 6);
      state[sym] = { pr, rnd: symRnd, price: open, prevClose };
      const s = this.sym(sym);
      s.prevClose = +prevClose.toFixed(2);
    }
    let drift = 0;
    for (let i = 0; i < minutes; i++) {
      const t0 = sess.open + i * 60e3;
      drift = drift * 0.97 + gauss(rnd) * 0.000025;
      const mkt = drift + gauss(rnd) * 0.00028; // per-minute market move
      const u = i / 390; const volShape = 1.8 - 3.2 * u * (1 - u) * 1.6;
      for (const sym of syms) {
        const st = state[sym];
        let p = st.price;
        for (let k = 0; k < 4; k++) {
          const r = st.pr.beta * mkt / 4 + gauss(st.rnd) * st.pr.vol / 2;
          p = p * (1 + r);
          this.applyTrade(sym, +p.toFixed(2), Math.round(st.pr.v * Math.max(0.3, volShape) * (0.5 + st.rnd()) / 4), t0 + k * 14e3);
        }
        st.price = p;
      }
    }
    // Demo GEX levels anchored on the simulated session.
    for (const sym of syms) {
      const s = this.sym(sym);
      const pr = profileFor(sym);
      const step = pr.step;
      const ref = s.dayOpen || s.last;
      const range = Math.max((s.high - s.low) || ref * 0.006, ref * 0.004);
      this.demoLevels[sym] = {
        cw: Math.ceil((s.high + range * 0.15) / step) * step,
        pw: Math.floor((s.low - range * 0.15) / step) * step,
        zg: Math.round(ref / step) * step,
      };
    }
    this.demoState = state;
    this.timers.push(setInterval(() => this.demoTick(), 1000));
    this.setStatus({});
  }

  demoTick() {
    const now = Date.now();
    const ms = marketStatus(now);
    const scale = ms.state === 'open' ? 1 : 0.25;
    const mkt = gauss(Math.random) * 0.000036 * scale; // ~market move per second
    for (const [sym, st] of Object.entries(this.demoState || {})) {
      const r = st.pr.beta * mkt + gauss(Math.random) * st.pr.vol * 0.13 * scale;
      st.price *= 1 + r;
      // Off-hours: price moves but the chart session stays frozen.
      if (ms.state === 'open') this.applyTrade(sym, +st.price.toFixed(2), Math.round(st.pr.v / 60 * (0.5 + Math.random())), now);
      else { const s = this.sym(sym); s.last = +st.price.toFixed(2); s.lastTradeAt = now; this.bump(s); }
    }
  }

  // ---------- Finnhub ----------
  async fhQuote(sym) {
    const key = this.settings.finnhubKey;
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`);
    if (r.status === 401 || r.status === 403) throw new Error('Finnhub key rejected');
    if (r.status === 429) throw new Error('Finnhub rate limit');
    if (!r.ok) throw new Error('Finnhub HTTP ' + r.status);
    const q = await r.json();
    const s = this.sym(sym);
    if (q && q.pc) {
      s.prevClose = q.pc;
      if (q.o) s.dayOpen = s.dayOpen ?? q.o;
      if (q.h) s.high = Math.max(s.high ?? q.h, q.h);
      if (q.l) s.low = Math.min(s.low ?? q.l, q.l);
      if (q.c && (!s.lastTradeAt || Date.now() - s.lastTradeAt > 30e3)) { s.last = q.c; s.lastTradeAt = (q.t || 0) * 1000 || Date.now(); }
      this.bump(s);
    }
  }
  async fhQuotesAll() {
    let ok = 0, err = '';
    for (const sym of this.trackedSymbols) {
      try { await this.fhQuote(sym); ok++; } catch (e) { err = e.message || 'blocked'; }
    }
    this.setStatus({ finnhubRest: ok ? 'ok' : 'err', ...(ok ? {} : { fhRestErr: err }) });
  }
  fhConnect() {
    const key = this.settings.finnhubKey;
    let ws;
    try { ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`); } catch { this.setStatus({ finnhubWs: 'err' }); return; }
    this.ws = ws;
    this.setStatus({ finnhubWs: 'connecting' });
    ws.onopen = () => {
      this.wsBackoff = 2000;
      this.setStatus({ finnhubWs: 'live' });
      for (const sym of this.trackedSymbols) ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'trade' && Array.isArray(m.data)) {
        for (const d of m.data) this.applyTrade(d.s, d.p, d.v, d.t, this.syms.get(d.s)?.cboeBars ? { updateIntervals: ['1min'] } : undefined);
      } else if (m.type === 'error') {
        this.setStatus({ finnhubWs: 'err', fhWsErr: m.msg || 'error' });
      }
    };
    ws.onerror = () => this.setStatus({ finnhubWs: 'err' });
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setStatus({ finnhubWs: 'reconnecting' });
      const wait = this.wsBackoff; this.wsBackoff = Math.min(this.wsBackoff * 2, 60e3);
      setTimeout(() => { if (this.ws === ws) this.fhConnect(); }, wait);
    };
  }

  // ---------- Twelve Data (free plan: 8 credits/min, 800/day) ----------
  tdCreditsToday() {
    try {
      const d = JSON.parse(localStorage.getItem('jarvis.td.credits') || 'null');
      return d && d.date === etParts().ymd ? d.n : 0;
    } catch { return 0; }
  }
  tdAddCredits(n) {
    try { localStorage.setItem('jarvis.td.credits', JSON.stringify({ date: etParts().ymd, n: this.tdCreditsToday() + n })); } catch {}
  }
  tdEnqueue(symbols, iv, priority = false) {
    const job = { symbols, iv };
    if (priority) this.tdQueue.unshift(job); else this.tdQueue.push(job);
  }
  async tdPump() {
    const now = Date.now();
    this.tdTokens = Math.min(8, this.tdTokens + ((now - this.tdLastRefill) / 60e3) * 8);
    this.tdLastRefill = now;
    if (!this.tdQueue.length || this.tdBusy) return;
    if (this.tdCreditsToday() >= 790) { this.setStatus({ twelve: 'limited' }); this.tdQueue = []; return; }
    const job = this.tdQueue[0];
    const cost = job.symbols.length;
    if (this.tdTokens < Math.min(cost, 8)) return;
    // Split oversized jobs.
    if (cost > Math.floor(this.tdTokens)) {
      const n = Math.max(1, Math.floor(this.tdTokens));
      this.tdQueue[0] = { symbols: job.symbols.slice(n), iv: job.iv };
      this.tdQueue.unshift({ symbols: job.symbols.slice(0, n), iv: job.iv });
      return this.tdPump();
    }
    this.tdQueue.shift();
    this.tdTokens -= cost;
    this.tdBusy = true;
    try { await this.tdSeries(job.symbols, job.iv); }
    catch (e) { this.setStatus({ twelve: 'err', tdErr: e.message }); }
    finally { this.tdBusy = false; }
  }
  async tdSeries(symbols, iv) {
    const size = { '1min': 800, '5min': 200, '15min': 70 }[iv];
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbols.join(','))}&interval=${iv}&outputsize=${size}&timezone=UTC&apikey=${encodeURIComponent(this.settings.twelveKey)}`;
    const r = await fetch(url);
    this.tdAddCredits(symbols.length);
    if (!r.ok) throw new Error('Twelve Data HTTP ' + r.status);
    const j = await r.json();
    if (j.status === 'error') throw new Error(j.message || 'Twelve Data error');
    const bySym = symbols.length === 1 ? { [symbols[0]]: j } : j;
    let any = false;
    for (const sym of symbols) {
      const d = bySym[sym];
      if (!d || d.status === 'error' || !Array.isArray(d.values)) continue;
      const bars = d.values.map(v => ({
        t: Date.parse(v.datetime.replace(' ', 'T') + 'Z'),
        o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0),
      })).filter(b => Number.isFinite(b.t)).sort((a, b) => a.t - b.t);
      if (!bars.length) continue;
      any = true;
      const s = this.sym(sym);
      const lastFetched = bars[bars.length - 1].t;
      const live = s.bars[iv].filter(b => b.t > lastFetched);
      s.bars[iv] = [...bars, ...live];
      const sess = chartSession();
      const before = bars.filter(b => b.t < sess.open);
      if (before.length && s.prevClose == null) s.prevClose = before[before.length - 1].c;
      const inSess = bars.filter(b => b.t >= sess.open && b.t < sess.close);
      if (inSess.length) {
        s.dayOpen = s.dayOpen ?? inSess[0].o;
        const hi = Math.max(...inSess.map(b => b.h)), lo = Math.min(...inSess.map(b => b.l));
        s.high = s.high == null ? hi : Math.max(s.high, hi);
        s.low = s.low == null ? lo : Math.min(s.low, lo);
      }
      if (!this.settings.finnhubKey || this.status.finnhubWs !== 'live' || !s.lastTradeAt) {
        const lb = bars[bars.length - 1];
        s.last = lb.c; s.lastTradeAt = lb.t + (INTERVAL_MS[iv] || 0);
      }
      this.lastSeriesFetch[sym + iv] = Date.now();
      this.bump(s);
    }
    this.setStatus({ twelve: any ? 'ok' : 'err' });
  }
  tdInitialLoad() {
    const main = this.settings.main, iv = this.settings.interval;
    this.tdEnqueue([main], iv, true);
    const rest = this.trackedSymbols.filter(s => !(s === main && iv === '5min'));
    for (let i = 0; i < rest.length; i += 7) this.tdEnqueue(rest.slice(i, i + 7), '5min');
  }
  requestInterval(sym, iv) {
    if (!this.settings.twelveKey) return;
    const last = this.lastSeriesFetch[sym + iv] || 0;
    if (Date.now() - last > 60e3) this.tdEnqueue([sym], iv, true);
  }

  liveSchedule() {
    const now = Date.now();
    const st = marketStatus(now).state;
    const hasF = !!this.settings.finnhubKey, hasT = !!this.settings.twelveKey;
    if (hasF) {
      this.fhQuoteTick = (this.fhQuoteTick || 0) + 1;
      const every = this.status.finnhubWs === 'live' ? 8 : 4; // ×15s
      if (this.fhQuoteTick % every === 0) this.fhQuotesAll();
    }
    if (hasT && (st === 'open')) {
      const main = this.settings.main, iv = this.settings.interval;
      const mainEvery = hasF && this.status.finnhubWs === 'live' ? 300e3 : 60e3;
      if (now - (this.lastSeriesFetch[main + iv] || 0) > mainEvery && !this.tdQueue.length) this.tdEnqueue([main], iv);
      const stale = this.trackedSymbols.filter(s => s !== main && now - (this.lastSeriesFetch[s + '5min'] || 0) > 600e3);
      if (stale.length && this.tdQueue.length === 0) this.tdEnqueue(stale.slice(0, 6), '5min');
    }
  }
}
