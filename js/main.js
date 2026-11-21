import './owner-hours.js';
import { initOwnerFeed } from './owner-feed.js';
import { initDataStatus } from './data-status.js';
import { initPriceStatus } from './price-status.js';
import { initCloudVoice } from './cloud-voice.js';
import { initBrainMeta } from './brain-meta.js';
import * as THREE from 'three';
import { loadSettings, saveSettings, loadDay, saveDay, freshDay, todayET, loadLayout, saveLayout, clearLayout, parseLevels } from './store.js';
import { MarketFeed, LEADLAG } from './feeds.js';
import { marketStatus, fmtDuration, etParts, INTERVAL_LABEL, isTradingDay, nextTradingDay, prevTradingDay, etToMs } from './market.js';
import { TopBar, Watchlist, MainChart, LeadLag, Levels, RiskBreaker, IndaiPanel, AnalysisPanel, CalcPanel, DeepDivePanel, SummaryPanel, PlanPanel, ScenesPanel, CoachPanel, Dock, nearestLevel } from './panels.js';
import { STRATEGIES, PROFILES, buildPlan, temperature, scanSetups, suggestContract } from './signals.js';
import { Indai } from './indai.js';
import { relay } from './relay.js';
import { bs, yearsTo } from './options.js';
import { handPose, GestureTracker, HAND_JOINTS, FINGERTIPS, LEVELS as GESTURE_LEVELS } from './gestures.js';
import { SceneManager, SCENES, sceneName } from './scenes.js';
import { fmtPrice, fmtMoney } from './hud.js';
import { initUI } from './ui.js';

const STEPS = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const R = 1.4;            // arc radius (m)
const RF = 1.2;           // focus cards float a little closer
const BASE_Y = -0.06;     // chart centre relative to eye height
const LAYOUT = {
  top: [0, 0.47], chart: [0, 0], dock: [0, -0.485],
  watch: [-40, 0], risk: [40, 0],
  leadlag: [-72, 0.19], levels: [-72, -0.215], indai: [72, 0],
};
const FOCUS = ['analysis', 'calc', 'deep', 'summary', 'plan', 'scenes'];
const COLLAPSIBLE = ['watch', 'chart', 'risk', 'leadlag', 'levels', 'indai'];
const ETFS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'XLF', 'XLE', 'SMH', 'TLT', 'GLD']);

// ------------------------------------------------------------------ app state
const app = {
  settings: loadSettings(),
  day: loadDay(),
  panels: {},
  inXR: false,
  xrMode: null,
  dirty: new Set(),
  focus: null,
  consolidated: false,
  analysis: null,
  calc: null,
  deep: null,
  morningGex: {},
  liveGex: {},
  tvLevels: {},
  tvAlerts: [],
  signals: [],
  temp: null,
  markDirty(id) { if (id === 'all') Object.keys(this.panels).forEach(k => this.dirty.add(k)); else this.dirty.add(id); },
};
app.levels = parseLevels(app.settings.levelsText);
app.feed = new MarketFeed(app.settings);
// His own prices: with the passcode saved, price requests carry it and Schwab's live stream feeds the chart
// (js/owner-feed.js and js/schwab-stream.js, copied unchanged from the website; trades outside the session go to the
// extended-hours price, js/owner-hours.js). js/data-status.js keeps each ticker's source and delay.
initOwnerFeed(app);
initDataStatus(app);
app.indai = new Indai(app);
initPriceStatus(app);
initBrainMeta(app);   // keeps who worked on a verdict, and whether a reply was about the idea (js/brain-meta.js)
app.saveSettings = () => saveSettings(app.settings);
const say = (...a) => app.indai.say(...a);

// ------------------------------------------------------------------ GEX levels
// Priority: levels you pasted > this morning's GEX refresh > live from the options chain > an older morning refresh > demo.
const num = (v) => v == null || v === '' ? null : Number(v);
function fromMorning(a, n, source) {
  return {
    cw: num(a.call_wall), pw: num(a.put_wall), zg: num(a.gamma_flip), cw2: num(a.call_wall2), pw2: num(a.put_wall2),
    near: n ? { expiry: n.expiry, cw: num(n.call_wall), pw: num(n.put_wall), zg: num(n.gamma_flip) } : null,
    source, asof: a.asof_et, netGexM: num(a.net_gex_m),
  };
}
function fromLive(c) {
  const g = c.gex || {}, n = c.gexNear;
  return {
    cw: g.callWall ?? null, pw: g.putWall ?? null, zg: g.zeroGamma ?? null, cw2: g.callWall2 ?? null, pw2: g.putWall2 ?? null, regime: g.regime,
    near: n ? { expiry: n.expiry, cw: n.callWall ?? null, pw: n.putWall ?? null, zg: n.zeroGamma ?? null } : null,
    source: 'live', asof: c.timestamp,
  };
}
app.levelsFor = (sym) => {
  const m = app.morningGex[sym], live = app.liveGex[sym];
  if (app.levels[sym]) return { ...app.levels[sym], source: 'manual', near: m?.N ? fromMorning(m.N, m.N, 'x').near : live ? fromLive(live).near : null };
  const tv = app.tvLevels[sym];
  if (tv && tv.day === todayET() && (tv.cw != null || tv.pw != null)) {
    const base = m?.A ? fromMorning(m.A, m.N, 'x') : live ? fromLive(live) : {};
    return { ...base, ...tv, source: 'tradingview', asof: tv.asof };
  }
  if (m?.A && String(m.A.asof_et || '').slice(0, 10) === todayET()) return fromMorning(m.A, m.N, 'morning');
  if (live?.gex && (live.gex.callWall || live.gex.putWall)) return fromLive(live);
  if (m?.A) return fromMorning(m.A, m.N, 'morning-stale');
  if (app.feed.status.mode === 'demo' && app.feed.demoLevels[sym]) return { ...app.feed.demoLevels[sym], source: 'demo' };
  return null;
};
app.noteChainGex = (sym, chain) => {
  if (!chain || !chain.gex) return;
  app.liveGex[sym] = { gex: chain.gex, gexNear: chain.gexNear, timestamp: chain.timestamp, spot: chain.spot, at: Date.now() };
  ['levels', 'chart', 'watch', 'summary'].forEach(id => app.markDirty(id));
};
async function loadMorningGex() {
  try { app.morningGex = await relay.morningGex(); app.markDirty('all'); } catch (e) { console.warn('morning GEX', e); }
}
// TradingView alerts (webhook -> indai-tv -> here). Your Pine alerts are spoken and can update GEX levels.
let tvSeen = null;
async function pollTradingView() {
  let res;
  try { res = await relay.tvAlerts(); } catch { return; }
  const rows = (res.alerts || []).slice().reverse();   // oldest first
  const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
  const etTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const first = tvSeen === null;
  if (first) tvSeen = 0;
  for (const a of rows) {
    if (a.id <= tvSeen) continue;
    tvSeen = a.id;
    app.tvAlerts.unshift(a); app.tvAlerts.length = Math.min(app.tvAlerts.length, 30);
    if (a.levels && a.ticker) {
      const lv = {}; for (const k of ['cw', 'pw', 'zg', 'cw2', 'pw2']) if (a.levels[k] != null) lv[k] = Number(a.levels[k]);
      app.tvLevels[a.ticker] = { ...(app.tvLevels[a.ticker]?.day === etDay(a.received_at) ? app.tvLevels[a.ticker] : {}), ...lv, day: etDay(a.received_at), asof: `${etDay(a.received_at)} ${etTime(a.received_at)}` };
      ['levels', 'chart', 'watch'].forEach(id => app.markDirty(id));
    }
    const recent = Date.now() - Date.parse(a.received_at) < 3 * 60e3;
    if (first && !recent) continue;
    say(`TradingView${a.ticker ? ` · ${a.ticker}` : ''}: ${a.text}`, 'alert', { speak: recent && app.settings.alerts.tradingview !== false });
    if (a.ticker && app.settings.symbols.includes(a.ticker)) { flash('watch'); if (a.ticker === app.settings.main) flash('chart'); }
  }
  if (first && rows.length) say(`${rows.length} TradingView alert${rows.length === 1 ? '' : 's'} in the last two days. The newest: ${rows[rows.length - 1].text}`, 'info', { speak: false });
}
// Live candles from the INDAI Bridge indicator running in your TradingView account.
let bridgeSince = 0;
async function pollBridge() {
  if (app.feed.status.mode === 'demo') return;
  let j; try { j = await relay.tvBars(bridgeSince); } catch { return; }
  const rows = j.bars || [];
  for (const b of rows) {
    const sym = b.ticker; if (!sym) continue;
    app.feed.applyBridgeBar(sym, { t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v }, b.tf || '1');
    bridgeSince = Math.max(bridgeSince, +b.t - 1);
  }
  if (rows.length && !app.bridgeAnnounced && app.feed.bridgeLive) { app.bridgeAnnounced = true; say('TradingView bridge connected. Charts and setup alerts are now on your live TradingView candles.', 'good', { speak: false }); }
}
app.openTradingView = (sym) => {
  sym = (sym || app.settings.main).toUpperCase();
  if (app.inXR) { say('TradingView opens in the browser, so exit the headset view first, then tap Open in TradingView.', 'info'); return; }
  window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`, '_blank', 'noopener');
};

let gexQueue = [], lastGexSweep = 0;
function gexTick() {
  if (app.feed.status.mode === 'demo') return;
  const now = Date.now();
  if (!gexQueue.length && now - lastGexSweep > (marketStatus().state === 'open' ? 12 * 60e3 : 45 * 60e3)) {
    lastGexSweep = now;
    const syms = [app.settings.main, ...app.settings.symbols.filter(s => s !== app.settings.main)];
    gexQueue = syms.filter(s => { const lv = app.levelsFor(s); return !lv || lv.source === 'live' || lv.source === 'morning-stale' || lv.source === 'demo' || lv.source === 'manual'; });
  }
  const sym = gexQueue.shift();
  if (sym) relay.chain(sym, '', 0.03).then(c => app.noteChainGex(sym, c)).catch(() => {});
}

// ------------------------------------------------------------------ symbols / chart
app.selectSymbol = (sym, { announce = false } = {}) => {
  sym = sym.toUpperCase();
  if (!app.settings.symbols.includes(sym)) {
    if (!/^[A-Z.]{1,6}$/.test(sym)) { say(`I don't know the ticker ${sym}.`); return; }
    app.settings.symbols = [...app.settings.symbols, sym].slice(-12);
    app.settings.main = sym; app.saveSettings();
    say(`Adding ${sym} to your watchlist.`);
    restartFeed();
    return;
  }
  app.settings.main = sym; app.saveSettings();
  app.feed.requestInterval(sym, app.settings.interval);
  if (app.feed.status.mode !== 'demo' && !app.liveGex[sym]) relay.chain(sym, '', 0.03).then(c => app.noteChainGex(sym, c)).catch(() => {});
  app.markDirty('all');
  if (announce) {
    const q = app.feed.quote(sym);
    say(q ? `${sym}, ${fmtPrice(q.last)}, ${q.pct >= 0 ? 'up' : 'down'} ${Math.abs(q.pct).toFixed(2)} percent.` : `${sym} on the main screen.`);
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
app.setShow = (k, v) => { app.settings.show[k] = v; app.saveSettings(); app.markDirty('chart'); say(`${k.toUpperCase()} ${v ? 'on' : 'off'}.`, 'info', { speak: false }); };

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
function persistDay() { saveDay(app.day); app.markDirty('risk'); app.markDirty('summary'); }
app.logTrade = (amt) => {
  const d = app.day, r = app.settings.risk;
  d.trades.push({ t: Date.now(), amt });
  d.pnl = +(d.pnl + amt).toFixed(2);
  d.checklist = [false, false, false, false];
  if (amt < 0) d.consec++; else d.consec = 0;
  const pnlTxt = `Day P&L ${d.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(d.pnl))}.`;
  if (!d.tripped && -d.pnl >= r.maxDailyLoss) {
    d.tripped = true;
    say(`Logged a loss of ${fmtMoney(-amt)}. That's your daily loss limit, so the breaker is tripped and you're done for today. Protect the account.`, 'risk');
    flash('risk');
  } else if (amt < 0 && d.consec >= r.maxConsecLosses) {
    d.cooldownUntil = Date.now() + r.cooldownMin * 60e3;
    d.consec = 0;
    say(`Logged a loss of ${fmtMoney(-amt)}. That's ${r.maxConsecLosses} in a row, so take a ${r.cooldownMin} minute cooldown. No revenge trades. ${pnlTxt}`, 'risk');
    flash('risk');
  } else if (amt < 0) {
    const left = r.maxConsecLosses - d.consec;
    say(`Logged a loss of ${fmtMoney(-amt)}. ${pnlTxt} ${left === 1 ? 'One more loss and you go on cooldown.' : ''}`.trim(), 'risk');
  } else {
    say(`Logged a win of ${fmtMoney(amt)}. ${pnlTxt}`, 'good');
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
  say(`Removed the last trade (${t.amt >= 0 ? '+' : '−'}${fmtMoney(Math.abs(t.amt))}). Day P&L ${fmtMoney(d.pnl, true)}.`, 'info', { speak: false });
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
app.resetDay = () => { app.day = freshDay(); persistDay(); say("Today's P&L and breaker were reset.", 'info', { speak: false }); };

// ------------------------------------------------------------------ INDAI actions
app.talk = () => app.indai.talk();
app.toggleMute = (force) => {
  const m = typeof force === 'boolean' ? force : !app.indai.muted;
  app.indai.setMuted(m);
  app.settings.voice = !m; app.saveSettings();
  if (!m) say('Voice on.');
  app.markDirty('dock');
};
app.openDeepDive = (sym) => app.indai.deepDive((sym || app.settings.main).toUpperCase());
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
      if (n) parts.push(`Nearest level is the ${n.name.toLowerCase()} at ${fmtPrice(n.level)}, ${Math.abs(n.dist).toFixed(2)} percent ${n.dist >= 0 ? 'above' : 'below'}.`);
    }
  }
  const ll = LEADLAG.map(s => ({ s, q: app.feed.quote(s) })).filter(x => x.q).sort((a, b) => b.q.pct - a.q.pct);
  if (ll.length === 3 && ll[0].q.pct - ll[2].q.pct >= 0.15) parts.push(`${ll[0].s} is leading, ${ll[2].s} is lagging.`);
  const rs = app.riskState();
  if (rs.state === 'tripped') parts.push('The risk breaker is tripped. No more trades today.');
  else if (rs.state === 'cooldown') parts.push(`You're on cooldown for ${fmtDuration(rs.cooldownLeft)}.`);
  else parts.push(`Day P&L ${app.day.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(app.day.pnl))}, with ${fmtMoney(rs.room)} of room before the breaker.`);
  if (ms.upcoming.length) parts.push(`Heads up: ${ms.upcoming[0].text} on ${new Date(ms.upcoming[0].date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}.`);
  say(parts.join(' '));
};

// ------------------------------------------------------------------ options calculator state
const fmtYMD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function nearestExpiry() {
  const p = etParts();
  if (isTradingDay(p.y, p.m, p.d) && Date.now() < etToMs(p.y, p.m, p.d, 16, 0)) return fmtYMD(p.y, p.m, p.d);
  return fmtYMD(...nextTradingDay(p.y, p.m, p.d));
}
function strikeStep(sym, spot) { return ETFS.has(sym) ? 1 : spot < 30 ? 0.5 : spot < 100 ? 1 : spot < 300 ? 2.5 : 5; }
function calcSpot() { const c = app.calc; return app.feed.quote(c.sym)?.last ?? c.spot; }
function repriceModel(leg) {
  const c = app.calc, S = calcSpot();
  if (!S) return;
  leg.entry = Math.max(0.01, +bs(S, leg.strike, yearsTo(leg.expiry), app.settings.rate ?? 0.04, leg.iv, leg.type).price.toFixed(2));
}
function calcChanged({ chain = true } = {}) {
  app.markDirty('calc');
  app.onCalcChange?.();
  if (chain) { clearTimeout(calcChanged.t); calcChanged.t = setTimeout(() => app.calcFromChain({ quiet: true }), 700); }
}
app.calcReprice = (leg) => repriceModel(leg);
app.strikeStep = strikeStep;
app.loadCalc = ({ sym, spot, legs, expirations, strikes }) => {
  app.calc = { sym, spot, legs: legs.map(l => ({ ...l })), expirations: expirations || null, strikes: strikes || null, loading: false };
  calcChanged({ chain: false });
};
app.ensureCalc = (sym) => {
  sym = (sym || app.calc?.sym || app.settings.main).toUpperCase();
  if (app.calc && app.calc.sym === sym && app.calc.legs.length) return app.calc;
  const q = app.feed.quote(sym);
  const spot = q?.last ?? 100;
  const step = strikeStep(sym, spot);
  const leg = { type: 'C', side: 1, strike: Math.round(spot / step) * step, qty: 1, entry: 1, iv: q?.iv30 ? q.iv30 / 100 : 0.2, expiry: nearestExpiry() };
  app.calc = { sym, spot, legs: [leg], expirations: null, strikes: null, loading: false };
  repriceModel(leg);
  app.calcFromChain({ quiet: true });
  return app.calc;
};
app.calcSet = (patch) => {
  const c = app.ensureCalc(); const leg = c.legs[0];
  Object.assign(leg, patch);
  if ('type' in patch || 'strike' in patch || 'expiry' in patch) repriceModel(leg);
  calcChanged({ chain: 'type' in patch || 'strike' in patch || 'expiry' in patch });
};
app.calcStep = (field, dir) => {
  const c = app.ensureCalc(); const leg = c.legs[0];
  if (field === 'strike') {
    const ks = (c.strikes || []).filter((k, i, a) => a.indexOf(k) === i).sort((a, b) => a - b);
    const i = ks.indexOf(leg.strike);
    if (i >= 0 && ks[i + dir] != null) leg.strike = ks[i + dir];
    else leg.strike = +(leg.strike + dir * strikeStep(c.sym, calcSpot() || leg.strike)).toFixed(2);
    repriceModel(leg); return calcChanged();
  }
  if (field === 'expiry') {
    const ex = c.expirations;
    const i = ex ? ex.indexOf(leg.expiry) : -1;
    if (ex && i >= 0 && ex[i + dir]) leg.expiry = ex[i + dir];
    else {
      const [y, m, d] = leg.expiry.split('-').map(Number);
      const nd = dir > 0 ? nextTradingDay(y, m, d) : prevTradingDay(y, m, d);
      const cand = fmtYMD(...nd);
      if (cand >= nearestExpiry()) leg.expiry = cand;
    }
    repriceModel(leg); return calcChanged();
  }
  if (field === 'entry') { const p = leg.entry, st = p < 3 ? 0.05 : p < 10 ? 0.1 : 0.25; leg.entry = Math.max(0.01, +(p + dir * st).toFixed(2)); return calcChanged({ chain: false }); }
  if (field === 'iv') { leg.iv = Math.max(0.01, +(leg.iv + dir * 0.01).toFixed(4)); return calcChanged({ chain: false }); }
  if (field === 'qty') { leg.qty = Math.max(1, Math.min(500, leg.qty + dir)); return calcChanged({ chain: false }); }
};
// Fill entry prices and IVs from the live (delayed) chain.
app.calcFromChain = async ({ quiet = false } = {}) => {
  const c = app.calc; if (!c) return;
  c.loading = true; app.markDirty('calc'); app.onCalcChange?.();
  const exps = [...new Set(c.legs.map(l => l.expiry))];
  try {
    for (const exp of exps) {
      const ch = await relay.chain(c.sym, exp, 0.12);
      if (app.calc !== c) return;
      if (!ch || !ch.spot) throw new Error(ch?.error || 'no chain');
      c.expirations = ch.expirations; c.spot = ch.spot;
      c.strikes = [...new Set(ch.chain.map(o => o.strike))].sort((a, b) => a - b);
      for (const leg of c.legs.filter(l => l.expiry === exp)) {
        if (ch.expiry !== exp) leg.expiry = ch.expiry;
        const row = ch.chain.find(o => o.type === leg.type && o.strike === leg.strike);
        if (row) { if (row.mid > 0) leg.entry = row.mid; if (row.iv > 0.01) leg.iv = row.iv; }
      }
    }
    if (!quiet) say(`Calculator updated from the ${c.sym} chain.`, 'info', { speak: false });
  } catch (e) { if (!quiet) say(`Couldn't load the ${c.sym} chain: ${e.message}`, 'info', { speak: false }); }
  c.loading = false; app.markDirty('calc'); app.onCalcChange?.();
};
app.openCalc = () => { if (!app.inXR && app.openCalcModal) { app.ensureCalc(); app.openCalcModal(); } else { app.ensureCalc(); app.openFocus('calc'); } };


// ------------------------------------------------------------------ daily game plan
const roundTo = (v, st) => Math.max(st, Math.round(v / st) * st);
function defaultDraft() {
  const p = app.day.plan;
  if (p) return { capital: p.capital, goal: p.goal, aggr: p.aggr, strategies: [...p.strategies] };
  const cap = app.settings.risk.account || 2000;
  return { capital: cap, goal: roundTo(cap * 0.03, 10), aggr: app.settings.lastAggr || 'balanced', strategies: app.settings.strategies?.length ? [...app.settings.strategies] : Object.keys(STRATEGIES) };
}
app.planDraft = defaultDraft();
app.activePlan = () => app.day.plan ? buildPlan(app.day.plan) : buildPlan({ capital: app.settings.risk.account, goal: 0, aggr: app.settings.lastAggr || 'balanced', strategies: app.settings.strategies?.length ? app.settings.strategies : Object.keys(STRATEGIES) });
app.planSet = (patch) => { Object.assign(app.planDraft, patch); app.markDirty('plan'); };
app.planStep = (field, dir) => {
  const d = app.planDraft;
  if (field === 'capital') { const st = d.capital < 1000 ? 100 : d.capital < 10000 ? 250 : 1000; d.capital = Math.max(100, d.capital + dir * st); }
  if (field === 'goal') { const st = d.goal < 100 ? 10 : d.goal < 1000 ? 25 : 100; d.goal = Math.max(10, d.goal + dir * st); }
  app.markDirty('plan');
};
app.planToggleStrategy = (k) => {
  const d = app.planDraft; const on = d.strategies.includes(k);
  if (on && d.strategies.length === 1) return;
  d.strategies = on ? d.strategies.filter(x => x !== k) : [...d.strategies, k];
  app.markDirty('plan');
};
app.lockPlan = ({ quiet = false } = {}) => {
  const d = app.planDraft, p = buildPlan(d);
  app.day.plan = { capital: d.capital, goal: d.goal, aggr: d.aggr, strategies: [...d.strategies], at: Date.now() };
  app.day.goalHit = false;
  const r = app.settings.risk;
  r.account = d.capital; r.maxDailyLoss = p.maxLoss; r.riskPct = PROFILES[d.aggr].riskPct; r.stopPct = p.stopPct; r.maxConsecLosses = p.consec; r.cooldownMin = p.cool;
  app.settings.lastAggr = d.aggr; app.settings.strategies = [...d.strategies];
  app.saveSettings(); persistDay();
  ['plan', 'risk', 'dock', 'indai', 'summary'].forEach(id => app.markDirty(id));
  if (!quiet) say(`Plan locked: starting with ${fmtMoney(d.capital)}, goal ${fmtMoney(d.goal)}, ${p.label.toLowerCase()}. About ${fmtMoney(p.riskPerTrade)} risk per trade, and the breaker trips at minus ${fmtMoney(p.maxLoss)}. ${p.winsNeeded ? `That's roughly ${p.winsNeeded} good trade${p.winsNeeded > 1 ? 's' : ''} at ${p.rr} to 1.` : ''} I'll call out ${d.strategies.map(k => STRATEGIES[k].short).join(', ')} setups scoring ${p.minScore} or better.${p.warnings[0] ? ' ' + p.warnings[0] : ''}`, 'good');
};
app.openPlan = () => { app.planDraft = defaultDraft(); app.openFocus('plan'); if (!app.temp) app.checkTemperature(); };
app.checkTemperature = async (force = false) => {
  if (app.tempLoading) return app.temp;
  if (app.temp && !force && Date.now() - app.temp.at < 10 * 60e3) return app.temp;
  app.tempLoading = true; app.markDirty('plan');
  const quotes = {}; for (const s of ['SPY', 'QQQ', 'IWM']) { const q = app.feed.quote(s); if (q) quotes[s] = q; }
  let vix = null;
  try { const j = await relay.snapshot(['VIX']); const v = (j.quotes || [])[0]; if (v && v.ok) vix = { last: v.price || v.close, pct: v.changePct ?? (v.prevClose ? ((v.price || v.close) / v.prevClose - 1) * 100 : 0) }; } catch {}
  const gex = {};
  for (const s of ['SPY', 'QQQ', 'IWM']) { const lv = app.levelsFor(s), q = app.feed.quote(s); if (lv && q) gex[s] = { zg: lv.zg, spot: q.ext ?? q.last }; }
  const st = marketStatus().state;
  app.temp = { ...temperature({ quotes, vix, gex, preMarket: st !== 'open' }), vix, at: Date.now(), demo: app.feed.status.mode === 'demo' };
  app.tempLoading = false; app.markDirty('plan');
  return app.temp;
};

// ------------------------------------------------------------------ INDAI's own setup alerts
const sigMem = { lastBar: {}, last: {}, hour: [], pausedNote: 0 };
function nextExpiries() {
  const p = etParts(), todayOk = isTradingDay(p.y, p.m, p.d) && Date.now() < etToMs(p.y, p.m, p.d, 16, 0);
  const today = todayOk ? fmtYMD(p.y, p.m, p.d) : fmtYMD(...nextTradingDay(p.y, p.m, p.d));
  const [y, m, d] = today.split('-').map(Number);
  return { today, next: fmtYMD(...nextTradingDay(y, m, d)) };
}
function completedBars(sym) {
  const bars = app.feed.getBars(sym, '5min');
  const one = app.feed.getBars(sym, '1min');
  const latest = one.length ? one[one.length - 1].t + 60e3 : (app.feed.syms.get(sym)?.lastTradeAt || Date.now());
  return bars.filter(b => b.t + 300e3 <= latest + 1000);
}
function leadDirection() {
  const dirs = ['SPY', 'QQQ'].map(s => { const b = completedBars(s); if (b.length < 4) return 0; const ch = b[b.length - 1].c - b[b.length - 4].c; return Math.abs(ch) / b[b.length - 1].c < 0.0005 ? 0 : Math.sign(ch); });
  return dirs[0] === dirs[1] ? dirs[0] : 0;
}
function scanTick() {
  const ms = marketStatus();
  const demo = app.feed.status.mode === 'demo';
  if (ms.state !== 'open' && !(demo && app.settings.demoSignals)) return;
  const plan = app.activePlan();
  const rs = app.riskState();
  if (rs.state !== 'armed') { if (Date.now() - sigMem.pausedNote > 30 * 60e3) { sigMem.pausedNote = Date.now(); say(`Setup alerts are paused while the breaker is ${rs.state === 'tripped' ? 'tripped' : 'on cooldown'}.`, 'risk', { speak: false }); } return; }
  let minScore = plan.minScore;
  if (app.day.plan && app.day.goalHit) { if (plan.afterGoal === 'stop') return; if (plan.afterGoal === 'aplus') minScore = Math.max(minScore, 80); }
  const now = Date.now();
  sigMem.hour = sigMem.hour.filter(t => now - t < 3600e3);
  const lead = leadDirection();
  for (const sym of app.settings.symbols) {
    const bars = completedBars(sym);
    if (bars.length < 6) continue;
    const lastT = bars[bars.length - 1].t;
    if (sigMem.lastBar[sym] === lastT) continue;
    sigMem.lastBar[sym] = lastT;
    if (now - (lastT + 300e3) > (app.feed.status.mode === 'live' || app.feed.bridgeLive ? 6 * 60e3 : 25 * 60e3)) continue; // stale bar
    const lv = app.levelsFor(sym);
    const cands = scanSetups(sym, bars, { levels: lv, leadDir: ['SPY', 'QQQ'].includes(sym) ? 0 : lead, now, enabled: plan.strategies })
      .filter(c => c.score >= minScore).sort((a, b) => b.score - a.score);
    const sig = cands.find(c => now - (sigMem.last[sym + c.strat + c.dir] || 0) > 20 * 60e3);
    if (!sig || sigMem.hour.length >= plan.perHour) continue;
    sigMem.last[sym + sig.strat + sig.dir] = now; sigMem.hour.push(now);
    const q = app.feed.quote(sym);
    sig.contract = suggestContract(sig, plan, { iv: q?.iv30 ? q.iv30 / 100 : 0.22, r: app.settings.rate ?? 0.04, strikeStep: strikeStep(sym, sig.price), nextExpiry: nextExpiries() });
    fireSignal(sig, plan);
  }
}
function fireSignal(sig, plan, { practice = false } = {}) {
  app.signals.unshift(sig); if (app.signals.length > 30) app.signals.length = 30;
  if (!practice) { app.day.signals = (app.day.signals || 0) + 1; saveDay(app.day); }
  const k = sig.contract, side = sig.type === 'C' ? 'call' : 'put';
  const delayed = practice ? '' : app.feed.status.mode === 'demo' ? ' Demo data.' : app.priceStatus().kind === 'delayed' ? ' Heads up, this is on delayed data.' : '';
  const grade = sig.score >= 80 ? 'A-plus' : sig.score >= 70 ? 'strong' : 'decent';
  const text = `${practice ? `Practice alert, replayed from the ${new Date(sig.barT + 300e3).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} candle. ` : ''}${sig.sym} ${side} setup, ${grade}, score ${sig.score}: ${sig.title}. Idea: the ${k.strike} ${side} ${k.expiry === nextExpiries().today ? 'for today' : 'for ' + new Date(k.expiry + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}, about ${k.premium.toFixed(2)}, ${k.qty} contract${k.qty > 1 ? 's' : ''}, risking about ${fmtMoney(k.risk)}${k.overBudget ? `, which is over your ${fmtMoney(plan.riskPerTrade)} per-trade risk, so size down or skip` : ''}. Out if ${sig.sym} ${sig.dir > 0 ? 'loses' : 'gets back above'} ${fmtPrice(sig.stop)}; target ${fmtPrice(sig.target)}.${sig.against.length ? ' Watch: ' + sig.against.slice(0, 2).join(', ') + '.' : ''}${delayed}`;
  say(text, sig.dir > 0 ? 'good' : 'risk');
  flash('watch'); if (sig.sym === app.settings.main) flash('chart');
  app.markDirty('indai'); app.markDirty('summary');
  try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(`INDAI · ${sig.sym} ${side} setup (${sig.score})`, { body: `${sig.title}. ${k.strike}${sig.type} ≈ $${k.premium.toFixed(2)} × ${k.qty}. Stop ${fmtPrice(sig.stop)}, target ${fmtPrice(sig.target)}.`, icon: './icons/icon-192.png', tag: 'indai-' + sig.sym }); } catch {}
}
app.fireSignal = fireSignal;

// Replay the setup scanner over the current (or last) session's candles: how many alerts your plan would have fired.
app.replayScan = () => {
  const plan = app.activePlan();
  const all = []; let syms = 0;
  for (const sym of app.settings.symbols) {
    const bars = app.feed.getBars(sym, '5min');
    if (bars.length < 8) continue;
    syms++;
    const lv = app.levelsFor(sym), last = {};
    for (let i = 8; i <= bars.length; i++) {
      const sub = bars.slice(0, i), at = sub[i - 1].t + 300e3;
      for (const c of scanSetups(sym, sub, { levels: lv, leadDir: 0, now: at, enabled: plan.strategies })) {
        const k = c.strat + c.dir;
        if (at - (last[k] || 0) < 20 * 60e3) continue;
        last[k] = at; all.push({ ...c, at });
      }
    }
  }
  // same limits as live alerts: score bar and alerts-per-hour cap
  const hits = [];
  for (const c of all.filter(x => x.score >= plan.minScore).sort((a, b) => a.at - b.at)) {
    if (hits.filter(h => c.at - h.at < 3600e3).length < plan.perHour) hits.push(c);
  }
  const best = [...hits].sort((a, b) => b.score - a.score)[0] || null;
  const practice = best || [...all].sort((a, b) => b.score - a.score)[0] || null;
  return { symbols: syms, count: hits.length, best, practice, label: marketStatus().state === 'open' ? "today's" : 'last', minScore: plan.minScore };
};
// Play one replayed setup as a clearly-labelled practice alert, so the whole alert flow can be tested any time.
app.practiceAlert = (sig) => {
  if (!sig) sig = app.replayScan().practice;
  if (!sig) { say('There are no candles to replay yet. Give the data a minute to load, then try again.', 'info'); return; }
  const plan = app.activePlan(), q = app.feed.quote(sig.sym);
  const s = { ...sig, at: Date.now(), practice: true };
  s.contract = suggestContract(s, plan, { iv: q?.iv30 ? q.iv30 / 100 : 0.22, r: app.settings.rate ?? 0.04, strikeStep: strikeStep(sig.sym, sig.price), nextExpiry: nextExpiries() });
  fireSignal(s, plan, { practice: true });
};

// ------------------------------------------------------------------ three.js scene
const canvasHost = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// Sharp text in the headset: no fixed foveation (it blurs every panel away from the centre of view) and a
// framebuffer a little above the browser's default, close to the Quest 3's native panel resolution.
try { renderer.xr.setFoveation(0); } catch {}
try { renderer.xr.setFramebufferScaleFactor(1.2); } catch {}
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.03, 200);
camera.position.set(0, 1.6, 0);
scene.add(camera);

// spaces: passthrough (your room) or a virtual scene around the screens
const spaces = new SceneManager(scene);
app.scenes = SCENES;
// Which space to show right now: passthrough only exists in a mixed-reality session.
function effectiveScene() {
  const want = app.settings.scene || 'loft';
  if (want === 'passthrough') return app.inXR && app.xrMode === 'ar' ? 'passthrough' : app.inXR ? 'loft' : 'deck';
  return want;
}
function applyScene() {
  const id = spaces.set(effectiveScene());
  app.sceneShown = id;
  renderer.setClearColor(0x000000, id === 'passthrough' ? 0 : 1);
  app.markDirty('scenes'); app.markDirty('dock');
}
app.passthroughAvailable = () => app.inXR && app.xrMode === 'ar';
app.setScene = (id, { announce = true } = {}) => {
  if (!SCENES.find(s => s.id === id)) return;
  app.settings.scene = id; app.saveSettings();
  applyScene();
  if (!announce) return;
  if (id === 'passthrough' && !app.passthroughAvailable()) say(app.inXR ? 'Passthrough needs mixed reality. Exit and tap Enter mixed reality to see your room behind the screens.' : 'Passthrough shows your room once you enter mixed reality on the Quest.', 'info');
  else say(`${sceneName(id)}.`, 'info', { speak: false });
};
app.cycleScene = (dir = 1) => {
  const list = SCENES.filter(s => s.id !== 'passthrough' || app.passthroughAvailable());
  const i = Math.max(0, list.findIndex(s => s.id === app.sceneShown));
  app.setScene(list[(i + dir + list.length) % list.length].id);
};

// the HUD rig: everything you see floats in here, placed around your head on recenter
const rig = new THREE.Group();
scene.add(rig);

// INDAI orb (tap or pinch it to talk)
const orb = new THREE.Group();
{
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), new THREE.MeshBasicMaterial({ color: 0x6ec3f2, transparent: true, opacity: 0.95 }));
  core.name = 'core'; orb.add(core);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), new THREE.MeshBasicMaterial({ color: 0x6ec3f2, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.name = 'glow'; orb.add(glow);
  const ringMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  [[0.07, 0x6ec3f2, 0.75], [0.085, 0xdcbf6e, 0.6], [0.1, 0xa99bf5, 0.4]].forEach(([r, c, o], i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0022, 8, 96), ringMat(c, o));
    m.name = 'ring' + i; m.rotation.x = Math.PI / 2 + i * 0.5; orb.add(m);
  });
  rig.add(orb);
}
const orbHit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
orbHit.userData.orb = true;
orb.add(orbHit);

// panels
const P = app.panels;
P.top = new TopBar(app); P.chart = new MainChart(app); P.dock = new Dock(app);
P.watch = new Watchlist(app); P.risk = new RiskBreaker(app);
P.leadlag = new LeadLag(app); P.levels = new Levels(app); P.indai = new IndaiPanel(app);
P.analysis = new AnalysisPanel(app); P.calc = new CalcPanel(app); P.deep = new DeepDivePanel(app); P.summary = new SummaryPanel(app); P.plan = new PlanPanel(app); P.scenes = new ScenesPanel(app); P.coach = new CoachPanel(app);
const panelMeshes = [];
const maxAniso = renderer.capabilities.getMaxAnisotropy();
for (const [id, p] of Object.entries(P)) {
  p.setAnisotropy(maxAniso); rig.add(p.mesh); panelMeshes.push(p.mesh);
  if (FOCUS.includes(id)) { p.mesh.visible = false; p.mesh.renderOrder = 3; p.focus = true; p.solid = true; p.resizable = false; }
  if (id === 'coach') { p.mesh.visible = false; p.mesh.renderOrder = 4; p.solid = true; p.floating = true; p.resizable = false; }
}
const home = {}, homeS = {};   // where each screen lives (and how big it is) when not collapsed
const SCALE_MIN = 0.55, SCALE_MAX = 2.2;

function placeDefault(id) {
  const [deg, dy] = LAYOUT[id];
  const th = THREE.MathUtils.degToRad(deg);
  const m = P[id].mesh;
  m.position.set(Math.sin(th) * R, BASE_Y + dy, -Math.cos(th) * R);
  m.rotation.set(0, -th, 0);
}
function placeCoach() {
  const th = THREE.MathUtils.degToRad(33), m = P.coach.mesh, r = 1.05;
  m.position.set(Math.sin(th) * r, BASE_Y + 0.04, -Math.cos(th) * r);
  m.rotation.set(0, -th, 0);
}
function placeFocus(id) {
  const m = P[id].mesh;
  m.position.set(0, BASE_Y + 0.075, -RF);
  m.rotation.set(0, 0, 0);
}
function applyLayout() {
  const saved = loadLayout();
  for (const id of Object.keys(P)) {
    if (FOCUS.includes(id)) { placeFocus(id); continue; }
    if (id === 'coach') { placeCoach(); continue; }
    const s = saved[id];
    if (s && Array.isArray(s.p) && Array.isArray(s.q)) { P[id].mesh.position.fromArray(s.p); P[id].mesh.quaternion.fromArray(s.q); }
    else placeDefault(id);
    const sc = s && Number.isFinite(s.s) ? Math.max(SCALE_MIN, Math.min(SCALE_MAX, s.s)) : 1;
    P[id].mesh.scale.setScalar(sc); P[id].maxed = null;
    home[id] = P[id].mesh.position.clone(); homeS[id] = sc;
  }
  orb.position.set(0, BASE_Y + 0.64, -R);
}
function persistLayout() {
  if (app.consolidated) return;
  const out = {};
  for (const id of Object.keys(P)) {
    if (FOCUS.includes(id) || id === 'coach') continue;
    const m = P[id].mesh, mx = P[id].maxed;      // a maximised window is saved where it came from
    out[id] = mx ? { p: mx.p.toArray(), q: mx.q.toArray(), s: mx.s } : { p: m.position.toArray(), q: m.quaternion.toArray(), s: m.scale.x };
    home[id] = mx ? mx.p.clone() : m.position.clone(); homeS[id] = mx ? mx.s : m.scale.x;
  }
  saveLayout(out);
}
app.resetLayout = () => { clearLayout(); app.consolidated = false; for (const id of COLLAPSIBLE) P[id].mesh.visible = true; applyLayout(); say('Layout reset.', 'info', { speak: false }); };
applyLayout();

// ------------------------------------------------------------------ focus cards + consolidate / restore
const anims = new Map();
function animate(mesh, { to = null, scale = 1, quat = null, dur = 300, after = null }) {
  anims.set(mesh, { p0: mesh.position.clone(), p1: to ? to.clone() : mesh.position.clone(), s0: mesh.scale.x, s1: scale, q0: mesh.quaternion.clone(), q1: quat ? quat.clone() : null, t0: performance.now(), dur, after });
}
function stepAnims(now) {
  for (const [mesh, a] of anims) {
    const t = Math.min(1, (now - a.t0) / a.dur), e = 1 - Math.pow(1 - t, 3);
    mesh.position.lerpVectors(a.p0, a.p1, e);
    mesh.scale.setScalar(a.s0 + (a.s1 - a.s0) * e);
    if (a.q1) mesh.quaternion.slerpQuaternions(a.q0, a.q1, e);
    if (t >= 1) { anims.delete(mesh); a.after && a.after(); }
  }
}
app.openFocus = (id) => {
  if (!FOCUS.includes(id)) return;
  if (id === 'calc') app.ensureCalc();
  if (app.focus && app.focus !== id) { const old = P[app.focus].mesh; anims.delete(old); old.visible = false; }
  const m = P[id].mesh;
  if (!m.visible) { placeFocus(id); m.scale.setScalar(0.82); m.visible = true; animate(m, { scale: 1, dur: 260 }); }
  app.focus = id;
  P[id].dirty = true;
  app.markDirty('dock');
};
app.closeFocus = () => {
  const id = app.focus; if (!id) return;
  if (id === 'summary' && app.consolidated) { app.restoreAll(); return; }
  const m = P[id].mesh;
  animate(m, { scale: 0.85, dur: 150, after: () => { m.visible = false; m.scale.setScalar(1); } });
  app.focus = null;
  if (app.consolidated) app.openFocus('summary');
};
app.consolidate = () => {
  if (app.consolidated) { app.openFocus('summary'); return; }
  app.consolidated = true;
  const target = new THREE.Vector3(0, BASE_Y + 0.075, -RF - 0.05);
  for (const id of COLLAPSIBLE) {
    const m = P[id].mesh;
    if (P[id].maxed) unmax(P[id], { instant: true });
    home[id] = home[id] || m.position.clone(); homeS[id] = homeS[id] || m.scale.x;
    animate(m, { to: target, scale: 0.05, dur: 380, after: () => { m.visible = false; } });
  }
  setTimeout(() => { if (app.consolidated && !app.focus) app.openFocus('summary'); }, 200);
  say('Everything in one view. Pull your hands apart or tap Restore to bring the screens back.', 'info', { speak: false });
  app.markDirty('dock');
};
app.restoreAll = () => {
  if (app.focus) { const m = P[app.focus].mesh; m.visible = false; app.focus = null; }
  if (!app.consolidated) return;
  app.consolidated = false;
  for (const id of COLLAPSIBLE) {
    const m = P[id].mesh;
    m.visible = true;
    animate(m, { to: home[id], scale: homeS[id] || 1, dur: 380 });
    P[id].dirty = true;
  }
  app.markDirty('dock');
};

// ------------------------------------------------------------------ maximise a window (double-pinch its top bar)
function unmax(panel, { instant = false } = {}) {
  const mx = panel.maxed; if (!mx) return;
  panel.maxed = null;
  if (instant) { panel.mesh.position.copy(mx.p); panel.mesh.quaternion.copy(mx.q); panel.mesh.scale.setScalar(mx.s); }
  else animate(panel.mesh, { to: mx.p, scale: mx.s, quat: mx.q, dur: 300 });
  panel.mesh.renderOrder = mx.order;
}
app.toggleMax = (panel) => {
  if (!panel || panel.focus || panel.floating || app.consolidated) return;
  if (panel.maxed) { unmax(panel); return; }
  for (const p of Object.values(P)) if (p.maxed) unmax(p);
  const m = panel.mesh;
  panel.maxed = { p: m.position.clone(), q: m.quaternion.clone(), s: m.scale.x, order: m.renderOrder };
  const big = Math.max(1, Math.min(1.9, 1.75 / panel.w));    // about 1.75 m wide, never smaller than it is now
  m.renderOrder = 5;
  animate(m, { to: new THREE.Vector3(0, BASE_Y + 0.08, -R + 0.22), scale: Math.max(big, m.scale.x), quat: new THREE.Quaternion(), dur: 320 });
  say(`${panel.title || 'Window'} is up front. Double-pinch its top bar again to put it back.`, 'info', { speak: false });
};

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
  spaces.follow(rig.position, rig.rotation.y);
};

// ------------------------------------------------------------------ 2D (non-headset) view
const view = { yaw: 0, pitch: 0, dist: 0.5 };
function fit2D() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.fov = aspect < 0.8 ? 72 : 60;
  const needW = aspect < 0.8 ? 1.35 : aspect < 1.4 ? 2.0 : 2.7;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
  view.dist = Math.max(0.2, Math.min(3.2, needW / 2 / Math.tan(hfov / 2) - R * 0.82));
  updateView();
}
function updateView() {
  if (app.inXR) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  camera.position.set(0, 1.6 + BASE_Y * 0.5, view.dist);
  camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
}
window.addEventListener('resize', () => { if (!app.inXR) { renderer.setSize(window.innerWidth, window.innerHeight); fit2D(); } });

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let mouseHoverPanel = null;
function targets() { const t = panelMeshes.filter(m => m.visible && m.scale.x > 0.3); t.push(orbHit); return t; }
function resolveHit(hit) {
  if (!hit) return null;
  if (hit.object.userData.orb) return { orb: true, point: hit.point, distance: hit.distance };
  const panel = hit.object.userData.panel;
  return { panel, px: panel.toPx(hit.uv), point: hit.point, distance: hit.distance };
}
const _plane = new THREE.Plane(), _n = new THREE.Vector3(), _hitW = new THREE.Vector3(), _loc = new THREE.Vector3();
function panelPx(panel, r) {
  const m = panel.mesh; m.updateMatrixWorld();
  _n.set(0, 0, 1).applyQuaternion(m.getWorldQuaternion(_q2)); m.getWorldPosition(_hitW);
  _plane.setFromNormalAndCoplanarPoint(_n, _hitW);
  if (!r.intersectPlane(_plane, _hitW)) return null;
  _loc.copy(_hitW); m.worldToLocal(_loc);
  return { px: panel.toPx({ x: _loc.x / panel.w + 0.5, y: _loc.y / panel.h + 0.5 }), world: _hitW.clone() };
}
const _q2 = new THREE.Quaternion();
function ndcRay(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray;
}
function pick2D(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return resolveHit(ray.intersectObjects(targets(), false)[0]);
}
function firstGesture() { app.indai.voice.unlock(); if (!firstGesture.done) { firstGesture.done = true; if (!app.indai.muted) app.indai.voice.preload({ tts: true }); maybeCheckIn(false); } }
// Each trading day, the first time you come in, INDAI reads the market and asks for the day's plan.
function maybeCheckIn(xr) {
  if (app.day.plan || app.checkInStarted) return;
  const p = etParts();
  if (!isTradingDay(p.y, p.m, p.d) || p.h < 6 || p.h >= 16) return;
  app.checkInStarted = true;
  setTimeout(() => app.indai.startDay({ voice: xr }), xr ? 2500 : 600);
}
app.maybeCheckIn = maybeCheckIn;
const pointers = new Map();
let dragView = null, pinch = null, chart2D = null, resize2D = null, move2D = null;
const rayFor = (pt) => ndcRay({ clientX: pt.x, clientY: pt.y });
renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (app.inXR) return;
  firstGesture();
  renderer.domElement.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    // two fingers on the chart zoom the chart; anywhere else they move the camera in and out
    if (chart2D && chart2D.panel.pinchStart) {
      const [pa, pb] = [...pointers.values()].map(pt => panelPx(chart2D.panel, rayFor(pt)));
      if (pa && pb) { chart2D.panel.pinchStart(pa.px, pb.px); chart2D.pinch = true; return; }
    }
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.dist }; dragView = null; chart2D = null; return;
  }
  const h = pick2D(ev);
  if (h && h.panel && !h.panel.buttonAt(h.px)) {
    const panel = h.panel;
    if (panel.inCorner(h.px)) {           // drag the corner grip to resize the window
      const c = panel.mesh.getWorldPosition(new THREE.Vector3());
      resize2D = { panel, c, r0: Math.max(0.05, c.distanceTo(h.point)), s0: panel.mesh.scale.x }; dragView = null; return;
    }
    if (panel.pointerDown && !panel.inHeader(h.px) && panel.pointerDown(h.px, { coarse: ev.pointerType !== 'mouse' })) { chart2D = { panel, id: ev.pointerId }; dragView = null; return; }
    if (panel.inHeader(h.px) && !panel.focus) {   // drag a window by its top bar
      const m = panel.mesh; m.getWorldPosition(_v);
      move2D = { panel, dist: h.distance, offset: _v.clone().sub(h.point), moved: false, x: ev.clientX, y: ev.clientY, at: performance.now() };
      dragView = null; return;
    }
  }
  dragView = { x: ev.clientX, y: ev.clientY, yaw: view.yaw, pitch: view.pitch, moved: false, hit: h };
  if (h && h.panel) { const b = h.panel.buttonAt(h.px); if (b && !b.disabled) { h.panel.pressed = b.id; h.panel.dirty = true; } }
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (app.inXR) return;
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (resize2D) {
    const pp = panelPx(resize2D.panel, ndcRay(ev));
    if (pp) { const sc = Math.max(SCALE_MIN, Math.min(SCALE_MAX, resize2D.s0 * resize2D.c.distanceTo(pp.world) / resize2D.r0)); resize2D.panel.mesh.scale.setScalar(sc); }
    return;
  }
  if (move2D) {
    if (Math.abs(ev.clientX - move2D.x) + Math.abs(ev.clientY - move2D.y) > 5) move2D.moved = true;
    if (move2D.moved) {
      const r = ndcRay(ev), target = r.origin.clone().addScaledVector(r.direction, move2D.dist).add(move2D.offset);
      const m = move2D.panel.mesh; rig.worldToLocal(target); m.position.copy(target);
      const camLocal = rig.worldToLocal(camera.position.clone());
      m.lookAt(rig.localToWorld(new THREE.Vector3(camLocal.x, m.position.y, camLocal.z)));
    }
    return;
  }
  if (chart2D) {
    if (chart2D.pinch && pointers.size === 2) {
      const [pa, pb] = [...pointers.values()].map(pt => panelPx(chart2D.panel, rayFor(pt)));
      if (pa && pb) chart2D.panel.pinchMove(pa.px, pb.px);
    } else if (!chart2D.pinch && ev.pointerId === chart2D.id) { const pp = panelPx(chart2D.panel, ndcRay(ev)); if (pp) chart2D.panel.pointerMove(pp.px); }
    return;
  }
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    view.dist = Math.max(-0.6, Math.min(3.5, pinch.dist * (pinch.d / d))); updateView(); return;
  }
  if (dragView) {
    const dx = ev.clientX - dragView.x, dy = ev.clientY - dragView.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragView.moved = true;
    if (dragView.moved) {
      view.yaw = Math.max(-1.6, Math.min(1.6, dragView.yaw + dx * 0.004));
      view.pitch = Math.max(-0.9, Math.min(0.9, dragView.pitch + dy * 0.004));
      updateView();
      if (dragView.hit && dragView.hit.panel) { dragView.hit.panel.pressed = null; dragView.hit.panel.dirty = true; }
    }
    return;
  }
  const h = pick2D(ev);
  const hp = h && h.panel ? h.panel : null;
  if (mouseHoverPanel && mouseHoverPanel !== hp) mouseHoverPanel.setHover(null);
  if (hp) { hp.setHover(h.px); mouseHoverPanel = hp; } else mouseHoverPanel = null;
  renderer.domElement.style.cursor = (h && h.orb) || (hp && hp.buttonAt(h.px)) ? 'pointer'
    : hp && hp.inCorner(h.px) ? 'nwse-resize' : hp && hp.inHeader(h.px) && !hp.focus ? 'move' : hp && hp.zone && hp.zone(h.px) ? 'crosshair' : 'grab';
});
let lastHeader2D = null;
const endPointer = (ev) => {
  pointers.delete(ev.pointerId);
  if (resize2D) { resize2D = null; persistLayout(); app.tutorialEvent('resize'); return; }
  if (move2D) {
    const m = move2D; move2D = null;
    if (m.moved) persistLayout();
    else { // two quick clicks on a top bar bring that window up front (and back)
      const now = performance.now();
      if (lastHeader2D && lastHeader2D.panel === m.panel && now - lastHeader2D.t < 450) { lastHeader2D = null; app.toggleMax(m.panel); }
      else lastHeader2D = { panel: m.panel, t: now };
    }
    return;
  }
  if (chart2D) {
    const c = chart2D;
    if (c.pinch) { if (pointers.size < 2) { c.panel.pinchEnd(); chart2D = null; } return; }
    if (ev.pointerId !== c.id) return;
    chart2D = null;
    const pp = panelPx(c.panel, ndcRay(ev));
    c.panel.pointerUp(pp ? pp.px : null, ev.type !== 'pointerup');
    return;
  }
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (!dragView) return;
  const d = dragView; dragView = null;
  if (d.hit && d.hit.panel) { d.hit.panel.pressed = null; d.hit.panel.dirty = true; }
  if (!d.moved && d.hit && ev.type === 'pointerup') {
    const h = pick2D(ev);
    if (h && h.orb && d.hit.orb) { app.talk(); return; }
    if (h && h.panel && h.panel === d.hit.panel) {
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
  const h = pick2D(ev);   // over the chart: zoom or move the chart; anywhere else: move the camera in and out
  if (h && h.panel && h.panel.wheel && h.panel.wheel(h.px, ev.deltaX * (ev.deltaMode === 1 ? 33 : 1), ev.deltaY * (ev.deltaMode === 1 ? 33 : 1))) return;
  view.dist = Math.max(-0.6, Math.min(3.5, view.dist + ev.deltaY * 0.0015)); updateView();
}, { passive: false });
// keyboard push-to-talk for desktop testing: hold the space bar
window.addEventListener('keydown', (ev) => { if (ev.code === 'Space' && !ev.repeat && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { ev.preventDefault(); firstGesture(); if (!app.indai.listening) app.talk(); } });
window.addEventListener('keyup', (ev) => { if (ev.code === 'Space' && app.indai.voice.state.listening) app.indai.voice.stop(); });

// ------------------------------------------------------------------ XR input: controllers + hands
const xrPointers = [];
const cursorGeo = new THREE.RingGeometry(0.006, 0.011, 24);
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x6ec3f2, transparent: true, opacity: 0.6 }));
  line.visible = false;
  ctrl.add(line);
  const cursor = new THREE.Mesh(cursorGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
  cursor.renderOrder = 10; cursor.visible = false; scene.add(cursor);
  const ptr = { i, ctrl, line, cursor, source: null, hit: null, press: null, drag: null, chart: null, resize: null, hold: null, hoverPanel: null, talkBtn: false, talkAt: 0, lastT: 0 };
  xrPointers.push(ptr);
  ctrl.addEventListener('connected', (e) => { ptr.source = e.data; line.visible = true; if (!e.data.hand) app.tutorialEvent?.('controllers'); });
  ctrl.addEventListener('disconnected', () => { endAny(ptr, true); ptr.source = null; line.visible = false; cursor.visible = false; if (ptr.hoverPanel) ptr.hoverPanel.setHover(null); ptr.hoverPanel = null; });
  ctrl.addEventListener('selectstart', () => onPress(ptr, false));
  ctrl.addEventListener('selectend', () => onRelease(ptr));
  ctrl.addEventListener('squeezestart', () => onPress(ptr, true));
  ctrl.addEventListener('squeezeend', () => endAny(ptr));
  scene.add(ctrl);
  const hand = renderer.xr.getHand(i);
  scene.add(hand);
}
const jointGeo = new THREE.SphereGeometry(0.0048, 10, 8), tipGeo = new THREE.SphereGeometry(0.0078, 12, 10);
const HAND_COL = { idle: 0x6ec3f2, pinch: 0xa99bf5, fist: 0xdcbf6e, armed: 0xdcbf6e, fired: 0x3ecf8e };
const BONES = [];
for (const f of ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
  const chain = HAND_JOINTS.filter(n => n.startsWith(f + '-'));
  BONES.push(['wrist', chain[0]]); for (let k = 0; k < chain.length - 1; k++) BONES.push([chain[k], chain[k + 1]]);
}
const handVis = [0, 1].map(() => {
  const mat = new THREE.MeshBasicMaterial({ color: HAND_COL.idle, transparent: true, opacity: 0.9, depthTest: false });
  const lineMat = new THREE.LineBasicMaterial({ color: HAND_COL.idle, transparent: true, opacity: 0.45, depthTest: false });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
  const bones = new THREE.LineSegments(geo, lineMat); bones.frustumCulled = false; bones.visible = false; bones.renderOrder = 9; scene.add(bones);
  const palm = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.016, 24), new THREE.MeshBasicMaterial({ color: HAND_COL.idle, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }));
  palm.visible = false; palm.renderOrder = 9; scene.add(palm);
  return { mat, lineMat, bones, palm, firedAt: 0 };
});
function updateHandVisuals() {
  for (let i = 0; i < 2; i++) {
    const hand = renderer.xr.getHand(i), hv = handVis[i];
    let tracked = false;
    for (const [name, j] of Object.entries(hand.joints || {})) {
      if (!j.userData.vis) { const m = new THREE.Mesh(FINGERTIPS.includes(name) ? tipGeo : jointGeo, hv.mat); m.renderOrder = 10; j.add(m); j.userData.vis = m; }
      if (j.visible) tracked = true;
    }
    const src = xrPointers[i] && xrPointers[i].source;
    tracked = tracked && !!(src && src.hand);
    hv.bones.visible = tracked; hv.palm.visible = false;
    if (!tracked) continue;
    const pos = hv.bones.geometry.attributes.position; let k = 0;
    for (const [a, b] of BONES) {
      const ja = hand.joints[a], jb = hand.joints[b];
      if (ja && jb) { ja.getWorldPosition(_v); pos.setXYZ(k, _v.x, _v.y, _v.z); jb.getWorldPosition(_v); pos.setXYZ(k + 1, _v.x, _v.y, _v.z); }
      k += 2;
    }
    pos.needsUpdate = true;
    // colour shows what INDAI sees: violet = pinch, gold = primed for a gesture, green = it fired
    const side = src.handedness === 'left' ? 'left' : 'right', st = gestures.state, pose = st[side];
    const armed = (st.armed && (st.armed === 'wide' || st.armed === 'close' || st.armed === 'fist-' + side)) || (palmTalk.side === side && palmTalk.charge > 0.15);
    const col = performance.now() - hv.firedAt < 450 ? HAND_COL.fired : armed ? HAND_COL.armed : pose === 'pinch' ? HAND_COL.pinch : HAND_COL.idle;
    hv.mat.color.setHex(col); hv.lineMat.color.setHex(col);
    const pm = app.handInfo && app.handInfo.palms && app.handInfo.palms[side];
    if (pm) { hv.palm.visible = true; hv.palm.position.set(pm.x, pm.y, pm.z); hv.palm.lookAt(pm.x + pm.nx, pm.y + pm.ny, pm.z + pm.nz); hv.palm.material.color.setHex(col); hv.palm.scale.setScalar(armed ? 1.5 : 1); }
  }
}
function haptic(ptr, v = 0.35, ms = 25) {
  try { const h = ptr.source && ptr.source.gamepad && ptr.source.gamepad.hapticActuators && ptr.source.gamepad.hapticActuators[0]; if (h && h.pulse) h.pulse(v, ms); } catch {}
}
function castXR(ptr) {
  ray.setFromXRController(ptr.ctrl);
  return resolveHit(ray.intersectObjects(targets(), false)[0]);
}
// Two hands on one window stretch it; two hands on the chart zoom it.
app.stretch = null; app.chartPinch = null;
let lastHeaderTap = null;
function rayPoint(ptr, dist) { ray.setFromXRController(ptr.ctrl); return ray.ray.origin.clone().addScaledVector(ray.ray.direction, dist); }
function startStretch(a, b, panel, da, db) {
  const pa = rayPoint(a, da), pb = rayPoint(b, db), m = panel.mesh;
  const mid = pa.clone().add(pb).multiplyScalar(0.5), c = m.getWorldPosition(new THREE.Vector3());
  app.stretch = { panel, a, b, da, db, d0: Math.max(0.05, pa.distanceTo(pb)), s0: m.scale.x, off: c.sub(mid) };
  a.drag = null; a.hold = null; b.hold = null;
  haptic(a, 0.4, 25); haptic(b, 0.4, 25);
}
function endStretch() {
  const st = app.stretch; if (!st) return;
  app.stretch = null;
  if (!st.panel.focus && !st.panel.floating) persistLayout();
  app.tutorialEvent('resize');
}
function endChartPinch() { const cp = app.chartPinch; if (!cp) return; app.chartPinch = null; cp.panel.pinchEnd(); cp.a.chart = null; cp.b.chart = null; }
// Release whatever this hand or controller was doing.
function endAny(ptr, cancelled = false) {
  if (app.stretch && (app.stretch.a === ptr || app.stretch.b === ptr)) { endStretch(); return true; }
  if (app.chartPinch && (app.chartPinch.a === ptr || app.chartPinch.b === ptr)) { endChartPinch(); return true; }
  if (ptr.resize) { ptr.resize = null; persistLayout(); app.tutorialEvent('resize'); return true; }
  if (ptr.chart) {
    const panel = ptr.chart.panel; ptr.chart = null;
    ray.setFromXRController(ptr.ctrl); const pp = panelPx(panel, ray.ray);
    panel.pointerUp(pp ? pp.px : null, cancelled);
    return true;
  }
  if (ptr.hold) { ptr.hold = null; return true; }
  if (ptr.drag) { endDrag(ptr); return true; }
  return false;
}
function onPress(ptr, isSqueeze) {
  if (ptr.source && ptr.source.hand && !isSqueeze) app.tutorialEvent('pinch');
  const h = ptr.hit;
  if (!h) return;
  if (h.orb) { if (!isSqueeze) { app.tutorialEvent('talk'); app.talk(); haptic(ptr, 0.5, 30); } return; }
  const panel = h.panel;
  // the other hand already holds this window: pull them apart to make it bigger, together to make it smaller
  const holder = !app.stretch && xrPointers.find(q => q !== ptr && ((q.drag && q.drag.panel === panel) || q.hold === panel));
  if (holder && !panel.focus) { startStretch(holder, ptr, panel, holder.drag ? holder.drag.dist : holder.holdDist, h.distance); return; }
  // the other hand is on the chart too: zoom with both
  const onChart = !app.chartPinch && !isSqueeze && panel.pinchStart && xrPointers.find(q => q !== ptr && q.chart && q.chart.panel === panel);
  if (onChart && panel.zone(h.px) === 'plot') {
    ray.setFromXRController(onChart.ctrl); const pa = panelPx(panel, ray.ray);
    if (pa) { panel.pinchStart(pa.px, h.px); ptr.chart = { panel }; app.chartPinch = { panel, a: onChart, b: ptr }; haptic(ptr, 0.3, 20); return; }
  }
  const b = isSqueeze ? null : panel.buttonAt(h.px);
  if (b && !b.disabled) { ptr.press = { panel, id: b.id }; panel.pressed = b.id; panel.dirty = true; haptic(ptr, 0.3, 20); return; }
  if (panel.inCorner(h.px)) {            // the corner grip: drag it to resize
    const c = panel.mesh.getWorldPosition(new THREE.Vector3());
    ptr.resize = { panel, c, r0: Math.max(0.05, c.distanceTo(h.point)), s0: panel.mesh.scale.x };
    haptic(ptr, 0.4, 25); return;
  }
  if (!isSqueeze && panel.inHeader(h.px)) {   // two quick pinches on a top bar: bring that window up front (and back)
    const now = performance.now();
    if (lastHeaderTap && lastHeaderTap.panel === panel && now - lastHeaderTap.t < 500) { lastHeaderTap = null; app.toggleMax(panel); app.tutorialEvent('maximize'); haptic(ptr, 0.6, 35); return; }
    lastHeaderTap = { panel, t: now };
  }
  if (!isSqueeze && !panel.inHeader(h.px) && panel.pointerDown && panel.pointerDown(h.px, { coarse: true })) {
    ptr.chart = { panel }; app.tutorialEvent('chart-down'); haptic(ptr, 0.25, 15); return;
  }
  if (isSqueeze || panel.inHeader(h.px)) {
    const m = panel.mesh;
    m.getWorldPosition(_v);
    ptr.drag = { panel, dist: h.distance, offset: _v.clone().sub(h.point) };
    app.tutorialEvent('drag');
    haptic(ptr, 0.5, 30);
    return;
  }
  // a pinch on an empty part of a window holds it, so the other hand can join in and stretch it
  if (!panel.focus) { ptr.hold = panel; ptr.holdDist = h.distance; }
}
function onRelease(ptr) {
  if (endAny(ptr)) return;
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
  app.tutorialEvent('dragEnd');
  const wasFocus = ptr.drag.panel.focus || ptr.drag.panel.floating;
  ptr.drag = null;
  if (!wasFocus) persistLayout();
}
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _head = new THREE.Vector3();
function faceHead(m) { const headLocal = rig.worldToLocal(_head.clone()); m.lookAt(rig.localToWorld(new THREE.Vector3(headLocal.x, m.position.y, headLocal.z))); }
function updateXRPointers() {
  renderer.xr.getCamera().getWorldPosition(_head);
  const now = performance.now();
  // two hands stretching one window
  const st = app.stretch;
  if (st) {
    if (!st.a.source || !st.b.source) endStretch();
    else {
      const pa = rayPoint(st.a, st.da), pb = rayPoint(st.b, st.db), m = st.panel.mesh;
      const sc = Math.max(SCALE_MIN, Math.min(SCALE_MAX, st.s0 * pa.distanceTo(pb) / st.d0));
      m.scale.setScalar(sc);
      if (!st.panel.focus) { const target = pa.add(pb).multiplyScalar(0.5).add(st.off); rig.worldToLocal(target); m.position.copy(target); faceHead(m); }
    }
  }
  // two hands zooming the chart
  const cp = app.chartPinch;
  if (cp) {
    ray.setFromXRController(cp.a.ctrl); const pa = panelPx(cp.panel, ray.ray);
    ray.setFromXRController(cp.b.ctrl); const pb = panelPx(cp.panel, ray.ray);
    if (pa && pb) cp.panel.pinchMove(pa.px, pb.px);
  }
  for (const ptr of xrPointers) {
    if (!ptr.source) continue;
    const dt = ptr.lastT ? Math.min(0.1, (now - ptr.lastT) / 1000) : 0; ptr.lastT = now;
    // A / X held = push-to-talk (controllers only)
    const gp = ptr.source.gamepad;
    const pressed = !!(gp && !ptr.source.hand && gp.buttons && gp.buttons[4] && gp.buttons[4].pressed);
    if (pressed && !ptr.talkBtn) { ptr.talkAt = now; if (!app.indai.listening) { app.talk(); haptic(ptr, 0.4, 30); } }
    if (!pressed && ptr.talkBtn && now - ptr.talkAt > 450 && app.indai.voice.state.listening) app.indai.voice.stop();
    ptr.talkBtn = pressed;
    if (st && (st.a === ptr || st.b === ptr)) { ptr.cursor.visible = false; continue; }
    if (cp && (cp.a === ptr || cp.b === ptr)) continue;
    if (ptr.resize) {
      ray.setFromXRController(ptr.ctrl);
      const pp = panelPx(ptr.resize.panel, ray.ray);
      if (pp) {
        ptr.resize.panel.mesh.scale.setScalar(Math.max(SCALE_MIN, Math.min(SCALE_MAX, ptr.resize.s0 * ptr.resize.c.distanceTo(pp.world) / ptr.resize.r0)));
        ptr.cursor.visible = true; ptr.cursor.position.copy(pp.world); ptr.line.scale.z = pp.world.distanceTo(ray.ray.origin);
      }
      continue;
    }
    if (ptr.chart) {
      ray.setFromXRController(ptr.ctrl);
      const pp = panelPx(ptr.chart.panel, ray.ray);
      if (pp) {
        ptr.chart.panel.pointerMove(pp.px);
        ptr.cursor.visible = true; ptr.cursor.position.copy(pp.world); ptr.chart.panel.mesh.getWorldQuaternion(ptr.cursor.quaternion); ptr.cursor.translateZ(0.002);
        ptr.cursor.material.color.set(0xa99bf5); ptr.line.scale.z = pp.world.distanceTo(ray.ray.origin);
      }
      continue;
    }
    if (ptr.drag) {
      ray.setFromXRController(ptr.ctrl);
      _o.copy(ray.ray.origin); _d.copy(ray.ray.direction);
      const target = _o.addScaledVector(_d, ptr.drag.dist).add(ptr.drag.offset);
      const m = ptr.drag.panel.mesh;
      rig.worldToLocal(target);
      m.position.copy(target);
      faceHead(m);
      ptr.cursor.visible = false;
      ptr.line.scale.z = ptr.drag.dist;
      continue;
    }
    const h = castXR(ptr);
    ptr.hit = h;
    const hp = h && h.panel ? h.panel : null;
    if (ptr.hoverPanel && ptr.hoverPanel !== hp) { ptr.hoverPanel.setHover(null); ptr.hoverPanel = null; }
    if (h) {
      if (hp) { hp.setHover(h.px); ptr.hoverPanel = hp; }
      ptr.cursor.visible = true;
      ptr.cursor.position.copy(h.point);
      if (hp) hp.mesh.getWorldQuaternion(ptr.cursor.quaternion); else ptr.cursor.lookAt(_head);
      ptr.cursor.translateZ(0.002);
      ptr.line.scale.z = h.distance;
      if (h.orb) app.tutorialEvent('orbHover');
      const overBtn = h.orb || hp.buttonAt(h.px) || hp.inHeader(h.px) || hp.inCorner(h.px);
      ptr.cursor.material.color.set(overBtn ? 0xdcbf6e : 0xffffff);
      // thumbstick on the chart: left/right moves through the day, up/down zooms
      if (hp && hp.stick && gp && !ptr.source.hand && gp.axes && gp.axes.length >= 4 && hp.zone(h.px)) {
        const ax = gp.axes[2] || 0, ay = gp.axes[3] || 0;
        if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) hp.stick(ax, ay, h.px, dt);
      }
    } else {
      ptr.cursor.visible = false;
      ptr.line.scale.z = 3;
    }
  }
}

// ------------------------------------------------------------------ hand gestures
const flashHands = () => { const n = performance.now(); handVis.forEach(h => { h.firedAt = n; }); for (const p of xrPointers) haptic(p, 0.7, 60); };
const gestures = new GestureTracker({
  onExplode: (sym) => { flashHands(); app.tutorialEvent('explode'); say(`Exploding ${sym || app.settings.main}.`, 'info', { speak: false }); app.openDeepDive(sym || app.settings.main); },
  onConsolidate: () => { flashHands(); app.tutorialEvent('consolidate'); app.consolidate(); },
  onExpand: () => { flashHands(); app.tutorialEvent('expand'); app.restoreAll(); },
});
app.handInfo = { left: null, right: null, dist: null, at: 0 };
app.setGestures = (level, { announce = true } = {}) => {
  app.settings.gestures = level; app.saveSettings(); gestures.level = GESTURE_LEVELS[level] ? level : 'normal';
  if (announce) say(level === 'off' ? 'Hand gestures are off. Pinch to click still works.' : level === 'easy' ? 'Gestures set to easy. They trigger with less effort.' : level === 'strict' ? 'Gestures set to strict. They need a more deliberate move.' : 'Gestures set to normal.', 'info');
};
const JOINTS = HAND_JOINTS;
function symbolUnder(ptr) {
  const h = ptr.hit; if (!h || h.orb || !h.panel) return null;
  const b = h.panel.buttonAt(h.px);
  if (b && b.sym) return b.sym;
  if (h.panel.id === 'chart') return app.settings.main;
  if (h.panel.id === 'deep' && app.deep) return app.deep.sym;
  return null;
}
// Palm to talk: open your hand and turn the palm toward your face for a moment, and INDAI starts listening.
// (Pinching in that pose is Meta's own menu, so this one is a held open hand, no pinch.)
let twoHandQuietUntil = 0;
const palmTalk = { since: 0, armed: true, offAt: 0, side: null };
function palmToTalk(now, poses) {
  renderer.xr.getCamera().getWorldPosition(_head);
  let facing = null;
  for (const side of ['left', 'right']) {
    const p = poses[side], pose = gestures.state[side] || (p && p.pose);
    if (!p || !(pose === 'open' || pose === 'spread')) continue;
    const sg = side === 'right' ? 1 : -1;      // out of the palm, for each hand (index and pinky knuckles mirror)
    const nx = p.normal.x * sg, ny = p.normal.y * sg, nz = p.normal.z * sg;
    const tx = _head.x - p.palm.x, ty = _head.y - p.palm.y, tz = _head.z - p.palm.z, d = Math.hypot(tx, ty, tz);
    if (d < 0.12 || d > 0.6) continue;
    if ((nx * tx + ny * ty + nz * tz) / d > 0.8) facing = side;
  }
  const busy = xrPointers.some(q => q.drag || q.chart || q.resize || q.press) || app.stretch;
  if (facing && palmTalk.armed && !busy) {
    if (!palmTalk.since) palmTalk.since = now;
    if (now - palmTalk.since > 650) {
      palmTalk.armed = false; palmTalk.since = 0;
      const vs = app.indai.voice.state;
      if (!vs.listening && !vs.transcribing) { flashHands(); app.tutorialEvent('palm'); app.talk(); }
    }
  } else if (!facing) {
    palmTalk.since = 0;
    if (!palmTalk.armed) { if (!palmTalk.offAt) palmTalk.offAt = now; if (now - palmTalk.offAt > 400) { palmTalk.armed = true; palmTalk.offAt = 0; } } else palmTalk.offAt = 0;
  }
  palmTalk.side = facing;
  palmTalk.charge = palmTalk.since ? Math.min(1, (now - palmTalk.since) / 650) : 0;
}
function updateGestures(now) {
  const level = app.settings.gestures || 'normal';
  const poses = { left: null, right: null }, tgt = { left: null, right: null }, busy = { left: false, right: false };
  for (const ptr of xrPointers) {
    const src = ptr.source; if (!src || !src.hand) continue;
    const hand = renderer.xr.getHand(ptr.i); const joints = {};
    for (const n of JOINTS) { const j = hand.joints && hand.joints[n]; if (!j || !j.visible) break; j.getWorldPosition(_v); joints[n] = { x: _v.x, y: _v.y, z: _v.z }; }
    const side = src.handedness === 'left' ? 'left' : 'right';
    poses[side] = handPose(joints); tgt[side] = symbolUnder(ptr); busy[side] = !!(ptr.drag || ptr.press || ptr.chart || ptr.resize || ptr.hold);
  }
  const t = app.tutorial, step = t && TUTORIAL[t.i].id;
  if (level !== 'off' || t) {
    gestures.level = GESTURE_LEVELS[level] ? level : 'normal';
    // a two-hand stretch or chart zoom must not read as collapse / bring back, during it or just after
    if (app.stretch || app.chartPinch) twoHandQuietUntil = now + 700;
    const quiet = now < twoHandQuietUntil;
    gestures.update(now, poses, tgt, { busy, canConsolidate: !quiet && (!app.consolidated || step === 'consolidate'), canExpand: !quiet && (!!app.consolidated || step === 'expand') });
  }
  if (level !== 'off' || step === 'palm') palmToTalk(now, poses);
  // what the headset sees, for the hand dots and the gesture tutorial
  const L = poses.left, R = poses.right, st = gestures.state;
  const pm = (p) => p && { x: p.palm.x, y: p.palm.y, z: p.palm.z, nx: p.normal.x, ny: p.normal.y, nz: p.normal.z };
  app.handInfo = { left: L ? st.left || L.pose : null, right: R ? st.right || R.pose : null, dist: L && R ? st.dist : null, armed: st.armed, palms: { left: pm(L), right: pm(R) }, at: now };
  if (L || R) {
    app.tutorialEvent('hands');
    if (t && !t.started && !t.doneAt) {
      const hi = app.handInfo;
      const inPos = step === 'pinch' ? !!(hi.left || hi.right)
        : step === 'explode' ? !!(st.armed && st.armed.startsWith('fist'))
        : step === 'consolidate' ? st.armed === 'wide'
        : step === 'expand' ? st.armed === 'close' : false;
      if (inPos) { t.started = true; P.coach.dirty = true; }
    }
    if (app.tutorial) app.markDirty('coach');
    if (!app.settings.gestureTutorialOffered && !app.tutorial) {
      app.settings.gestureTutorialOffered = true; app.saveSettings();
      say('I can see your hands. Want to learn the gestures? Say “gesture tutorial”, or pinch Gestures on my panel.', 'info');
    }
  }
}

// ------------------------------------------------------------------ gesture tutorial (hands-on, in the headset)
const TUTORIAL = [
  { id: 'hands', icon: 'hands', start: 'controllers', finish: 'hands', title: 'Use your hands', lines: ['Start: controllers in your hands.', 'Finish: set them down. Your hands show up as small dots.'] },
  { id: 'pinch', icon: 'pinch', finish: 'pinch', title: 'Point and pinch to click', lines: ['Start: point at any button with your index finger.', 'Finish: tap your thumb and index finger together. Keep your palm facing away.'] },
  { id: 'drag', icon: 'drag', start: 'drag', finish: 'dragEnd', title: 'Move a screen', lines: ['Start: point at the bar along the top of a screen, then pinch and hold.', 'Finish: move your hand, then open it to drop the screen.'] },
  { id: 'resize', icon: 'resize', finish: 'resize', title: 'Resize a screen', lines: ['Start: pinch a screen with both hands (or pinch the grip in its bottom-right corner).', 'Finish: pull apart to make it bigger, push together to make it smaller.'] },
  { id: 'maximize', icon: 'max', finish: 'maximize', title: 'Bring a screen up front', lines: ['Start: point at a screen’s top bar.', 'Finish: pinch twice quickly. Do it again to put it back.'] },
  { id: 'chart', icon: 'pan', start: 'chart-down', finish: ['chart-pan', 'chart-zoom'], title: 'Move and zoom the chart', lines: ['Start: pinch on the candles and hold.', 'Finish: drag sideways to move through the day. Pinch with both hands and spread them to zoom in.'] },
  { id: 'trend', icon: 'trend', start: 'chart-tool-line', finish: 'chart-line', title: 'Draw a trend line', lines: ['Start: pinch Draw on the chart, then Trend line.', 'Finish: pinch where the line starts and drag to where it ends.'] },
  { id: 'explode', icon: 'explode', finish: 'explode', title: 'Explode a ticker', lines: ['Start: point at a ticker in the watchlist, make a fist and hold it for a beat. Your hand turns gold.', 'Finish: burst your fingers wide open. Its deep dive opens.'] },
  { id: 'consolidate', icon: 'together', finish: 'consolidate', title: 'Collapse everything', lines: ['Start: open hands, palms facing each other, shoulder-width apart. Hold until they turn gold.', 'Finish: bring them together until they almost touch.'] },
  { id: 'expand', icon: 'apart', finish: 'expand', title: 'Bring the screens back', lines: ['Start: open hands close together. Hold until they turn gold.', 'Finish: pull them apart, wider than your shoulders.'] },
  { id: 'palm', icon: 'palm', finish: 'palm', title: 'Palm to talk', lines: ['Start: open your hand and turn your palm toward your face.', 'Finish: hold it there a moment until it turns gold. INDAI starts listening. (Don’t pinch: that opens Meta’s menu.)'] },
  { id: 'talk', icon: 'orb', start: 'orbHover', finish: 'talk', title: 'Talk to INDAI', lines: ['Start: point at the glowing orb above the screens.', 'Finish: pinch, then say “brief me”.'] },
];
app.tutorialSteps = TUTORIAL;
app.chartEvent = (k) => app.tutorialEvent('chart-' + k);
app.tutorial = null;
app.startTutorial = () => {
  if (app.consolidated) app.restoreAll(); else if (app.focus) app.closeFocus();
  const hi = app.handInfo, handsUp = app.inXR && hi && performance.now() - hi.at < 800 && !!(hi.left || hi.right);
  app.tutorial = { i: handsUp ? 1 : 0, doneAt: 0, started: !handsUp && xrPointers.some(p => p.source && !p.source.hand) };
  placeCoach(); P.coach.mesh.visible = true; P.coach.dirty = true;
  const first = TUTORIAL[app.tutorial.i];
  if (!app.inXR) say('Gesture tutorial. Each card shows where a gesture starts and where it finishes. The gestures need the headset with hand tracking, so here you can read through them. Tap Next to go on.', 'info');
  else if (handsUp) say(`Gesture tutorial. I can already see your hands, so let's start with clicking. ${first.lines.join(' ')}`, 'info');
  else say(`Gesture tutorial, ${TUTORIAL.length} quick moves. Each card shows where the gesture starts and where it finishes. ${first.lines.join(' ')}`, 'info');
};
app.endTutorial = (finished = false, { speak = true } = {}) => {
  app.tutorial = null; P.coach.mesh.visible = false;
  if (finished) say("That's every gesture. Say “gesture tutorial” any time to practice again.", 'good', { speak });
};
app.tutorialGo = (dir) => {
  const t = app.tutorial; if (!t) return;
  const i = t.i + dir;
  if (i >= TUTORIAL.length) { app.endTutorial(true); return; }
  t.i = Math.max(0, i); t.doneAt = 0; t.started = false; P.coach.dirty = true;
  const st = TUTORIAL[t.i];
  say(`${st.title}. ${st.lines.join(' ')}`, 'info', { log: false });
};
app.tutorialEvent = (id) => {
  const t = app.tutorial; if (!t || t.doneAt) return;
  const st = TUTORIAL[t.i]; if (!st) return;
  const is = (k) => Array.isArray(k) ? k.includes(id) : k === id;
  if (is(st.start) && !t.started) { t.started = true; P.coach.dirty = true; return; }
  if (!is(st.finish)) return;
  t.started = true; t.doneAt = performance.now(); P.coach.dirty = true;
  const at = t.i, next = TUTORIAL[t.i + 1];
  // the last step opens the mic, so stay quiet there and write the wrap-up instead of saying it
  if (next) say(`Nice. Next: ${next.title.toLowerCase()}. ${next.lines.join(' ')}`, 'good', { log: false });
  setTimeout(() => {
    if (app.tutorial !== t || t.i !== at) return;     // moved on by hand (Skip/Back/Exit) in the meantime
    if (!next) { app.endTutorial(true, { speak: false }); return; }
    t.i++; t.doneAt = 0; t.started = false; P.coach.dirty = true;
  }, 1500);
};

// ------------------------------------------------------------------ entering / leaving the headset
app.enterXR = async (mode) => {
  if (!navigator.xr) return;
  const sessionMode = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
  firstGesture();
  try {
    const session = await navigator.xr.requestSession(sessionMode, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    app.xrMode = mode;
    await renderer.xr.setSession(session);
    app.inXR = true;
    applyScene();
    pendingRecenter = 3;
    document.body.classList.add('in-xr');
    app.markDirty('all');
    session.addEventListener('end', () => {
      app.inXR = false; app.xrMode = null;
      applyScene();
      document.body.classList.remove('in-xr');
      for (const p of xrPointers) { p.cursor.visible = false; p.drag = null; }
      rig.position.set(0, 1.6, 0); rig.rotation.set(0, 0, 0); spaces.follow(rig.position, 0);
      renderer.setSize(window.innerWidth, window.innerHeight); fit2D();
      app.markDirty('all');
      if (app.onXREnd) app.onXREnd();
    });
    say(`INDAI online. Hold A or X, or pinch the orb, and talk to me.`, 'info');
    maybeCheckIn(true);
  } catch (err) {
    say(`Couldn't start ${mode === 'ar' ? 'mixed reality' : 'VR'}: ${err.message || err}`, 'info', { speak: false });
    throw err;
  }
};
app.exitXR = () => { const s = renderer.xr.getSession(); if (s) s.end(); };

// Ask for the microphone in 2D (before the headset view) so the permission prompt is easy to answer.
app.primeMic = async () => {
  if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' }).catch(() => null);
    if (st && st.state !== 'prompt') return st.state;
  } catch {}
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return 'granted-now'; }
  catch { return 'denied'; }
};

// ------------------------------------------------------------------ alerts
const alertMem = { last: {}, at: {}, hod: {}, lod: {}, mkt: null, warned5: null };
function flash(id) { if (P[id]) { P[id].flash = 1; P[id].dirty = true; } }
function canAlert(key, ms) { const now = Date.now(); if (now - (alertMem.at[key] || 0) < ms) return false; alertMem.at[key] = now; return true; }
function checkAlerts() {
  const s = app.settings, now = Date.now();
  const ms = marketStatus(now);
  const demo = app.feed.status.mode === 'demo';
  const tag = demo ? ' (demo)' : '';
  if (s.alerts.bells) {
    if (alertMem.mkt && alertMem.mkt !== ms.state) {
      if (ms.state === 'open') say('Opening bell. Market is open. Trade your plan and size from the breaker.', 'alert');
      if (alertMem.mkt === 'open' && ms.state !== 'open') say(`Closing bell. Day P&L ${app.day.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(app.day.pnl))}.`, 'alert');
    }
    if (ms.state === 'open' && ms.msToNext < 5 * 60e3 && alertMem.warned5 !== ms.et.ymd) { alertMem.warned5 = ms.et.ymd; say('Five minutes to the close. Zero-day options decay fast here.', 'alert'); }
  }
  alertMem.mkt = ms.state;
  for (const sym of s.symbols) {
    const q = app.feed.quote(sym);
    if (!q) continue;
    const prev = alertMem.last[sym];
    alertMem.last[sym] = q.last;
    if (prev == null) { alertMem.hod[sym] = q.high; alertMem.lod[sym] = q.low; continue; }
    const lv = app.levelsFor(sym);
    if (s.alerts.levels && lv && prev !== q.last && ms.state === 'open') {
      for (const [k, name] of [['cw', 'call wall'], ['pw', 'put wall'], ['zg', 'gamma flip']]) {
        const L = lv[k]; if (L == null) continue;
        if ((prev - L) * (q.last - L) <= 0 && canAlert(sym + k, 10 * 60e3)) {
          say(`${sym} crossing ${q.last >= L ? 'above' : 'below'} the ${name} at ${fmtPrice(L)}${tag}.`, 'alert');
          if (sym === s.main) flash('chart'); flash('watch');
        }
      }
    }
    if (s.alerts.hod && ms.state === 'open' && ms.et.h >= 10) {
      if (q.high != null && alertMem.hod[sym] != null && q.high > alertMem.hod[sym] && canAlert(sym + 'hod', 15 * 60e3)) { say(`${sym} new high of day, ${fmtPrice(q.high)}${tag}.`, 'alert'); flash('watch'); }
      if (q.low != null && alertMem.lod[sym] != null && q.low < alertMem.lod[sym] && canAlert(sym + 'lod', 15 * 60e3)) { say(`${sym} new low of day, ${fmtPrice(q.low)}${tag}.`, 'alert'); flash('watch'); }
    }
    alertMem.hod[sym] = q.high; alertMem.lod[sym] = q.low;
  }
  const d = app.day;
  if (d.plan && d.plan.goal > 0 && !d.goalHit && d.pnl >= d.plan.goal) {
    d.goalHit = true; saveDay(d);
    const after = PROFILES[d.plan.aggr]?.afterGoal;
    say(`Goal hit: you're up ${fmtMoney(d.pnl)} against a ${fmtMoney(d.plan.goal)} goal. ${after === 'stop' ? "That's the plan, so I'm turning setup alerts off. Great day to walk away." : after === 'aplus' ? "From here I'll only flag A-plus setups. Don't give it back." : "If you keep going, protect at least 70 percent of today's gains."}`, 'good');
  }
  if (d.cooldownUntil && now >= d.cooldownUntil && !d.cooldownAnnounced) {
    d.cooldownAnnounced = true; saveDay(d);
    say('Cooldown over. Only take A-plus setups, and run the checklist first.', 'good');
  }
  if (d.cooldownUntil > now) d.cooldownAnnounced = false;
  if (todayET() !== d.date) { app.day = freshDay(); persistDay(); }
}

// ------------------------------------------------------------------ feed lifecycle
function restartFeed() {
  app.feed.stop();
  app.feed = new MarketFeed(app.settings);
  app.feed.start();
  alertMem.last = {}; alertMem.hod = {}; alertMem.lod = {};
  lastGexSweep = 0;
  app.markDirty('all');
}
app.applySettings = (prev) => {
  app.levels = parseLevels(app.settings.levelsText);
  app.saveSettings();
  const changed = !prev || prev.f !== app.settings.finnhubKey || prev.syms !== app.settings.symbols.join(',') || prev.mode !== app.settings.dataMode;
  if (changed) restartFeed();
  app.indai.setMuted(!app.settings.voice);
  app.markDirty('all');
};

// ------------------------------------------------------------------ render loop
const FEED_PANELS = ['watch', 'chart', 'leadlag', 'levels', 'top', 'summary', 'deep', 'calc'];
const lastDraw = {};
let lastFeedRev = -1, lastSecond = 0, lastAlert = 0, lastGex = 0, lastTV = 0, lastScan = 0, lastBridge = 0;
const clock = new THREE.Timer();
function loop(time, frame) {
  clock.update(time); const dt = Math.min(0.1, clock.getDelta());
  const now = Date.now(), pnow = performance.now();
  if (app.inXR) {
    if (pendingRecenter && frame) { pendingRecenter--; if (pendingRecenter === 0) app.recenter(); }
    updateXRPointers();
    updateHandVisuals();
    try { updateGestures(pnow); } catch (e) { console.warn(e); }
  }
  stepAnims(pnow);
  // orb
  const ind = app.indai, vs = ind.voice.state;
  const level = Math.min(1, (ind.voice.level || 0) * 12);
  const pulse = vs.speaking ? 1 + Math.sin(time * 0.018) * 0.14 : vs.listening ? 1 + level * 0.35 + Math.sin(time * 0.012) * 0.05 : ind.thinking || vs.transcribing ? 1 + Math.sin(time * 0.008) * 0.1 : 1 + Math.sin(time * 0.002) * 0.04;
  orb.scale.setScalar(pulse);
  orb.getObjectByName('core').material.color.set(vs.listening ? 0xf0b34a : vs.transcribing || ind.thinking ? 0xa99bf5 : vs.speaking ? 0x3ecf8e : 0x6ec3f2);
  const spin = ind.thinking || vs.transcribing ? 3 : 1;
  for (let i = 0; i < 3; i++) { const r = orb.getObjectByName('ring' + i); r.rotation.z += dt * spin * (0.4 + i * 0.35) * (i % 2 ? -1 : 1); r.rotation.y += dt * 0.2 * (i + 1); }
  spaces.update(dt);

  if (app.feed.rev !== lastFeedRev) { lastFeedRev = app.feed.rev; FEED_PANELS.forEach(id => app.dirty.add(id)); }
  const sec = Math.floor(now / 1000);
  if (sec !== lastSecond) {
    lastSecond = sec; app.dirty.add('top');
    if (app.focus === 'summary') app.dirty.add('summary');
    if (app.riskState().state === 'cooldown') app.dirty.add('risk');
  }
  if (vs.listening || vs.transcribing || ind.thinking) app.dirty.add('indai');
  for (const [id, p] of Object.entries(P)) {
    if (p.flash > 0) { p.flash = Math.max(0, p.flash - dt * 0.6); if (Math.floor(time / 250) % 2 === 0 || p.flash === 0) p.dirty = true; }
    if (app.dirty.has(id)) p.dirty = true;
  }
  app.dirty.clear();
  // redraw at most 3 visible panels per frame, each at most ~5x/second (keeps the headset smooth)
  let budget = 3;
  const order = app.focus ? [app.focus, ...Object.keys(P).filter(k => k !== app.focus)] : Object.keys(P);
  for (const id of order) {
    const p = P[id];
    if (!p.dirty || budget <= 0 || !p.mesh.visible) continue;
    const minGap = p.pressed || p.hoverBtn !== p._lastHoverBtn ? 0 : id === 'chart' || id === 'calc' ? 220 : 180;
    if (now - (lastDraw[id] || 0) < minGap) continue;
    try { p.draw(); } catch (e) { console.warn('draw', id, e); p.dirty = false; }
    p._lastHoverBtn = p.hoverBtn; lastDraw[id] = now; budget--;
  }
  if (now - lastAlert > 1000) { lastAlert = now; try { checkAlerts(); } catch (e) { console.warn(e); } }
  if (now - lastGex > 8000) { lastGex = now; try { gexTick(); } catch (e) { console.warn(e); } }
  if (now - lastTV > 12000) { lastTV = now; pollTradingView(); }
  if (now - lastBridge > (marketStatus().state === 'closed' ? 60000 : 8000)) { lastBridge = now; pollBridge(); }
  if (now - lastScan > 15000) { lastScan = now; try { scanTick(); } catch (e) { console.warn('scan', e); } }
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    await Promise.race([
      Promise.all(["600 30px Geist", "500 30px Geist", "400 30px Geist", "700 30px Geist", "500 30px 'Geist Mono'", "600 30px 'Geist Mono'"].map(f => document.fonts.load(f))),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch {}
  applyScene();
  app.recenter();
  fit2D();
  // Her hosted voice (ElevenLabs, js/cloud-voice.js copied from the website): when it is set up she speaks from the
  // server and the speaking model is not downloaded here. Listening stays on the headset.
  initCloudVoice(app);
  app.feed.start();
  loadMorningGex();
  setInterval(loadMorningGex, 10 * 60e3);
  // Start downloading INDAI's voice (and, on Quest, her listening model) right away so they're ready when needed.
  setTimeout(() => {
    const v = app.indai.voice, quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
    if (!app.indai.muted && app.settings.voiceEngine !== 'system') v.preload({ tts: true });
    if (quest || app.settings.micEngine === 'whisper') v.preload({ tts: false, stt: true });
  }, 1500);
  app.markDirty('all');
  renderer.setAnimationLoop(loop);
  const st = app.feed.status;
  say(st.mode === 'demo'
    ? `Hi ${app.settings.name}, I'm INDAI. Running on demo data right now.`
    : `Hi ${app.settings.name}, I'm INDAI. Market data is connecting.`, 'info', { speak: false });
  say('Ask me about a trade, like “QQQ calls expiring today, 665 strike”. Tap Talk, hold A or X, or pinch the orb.', 'info', { speak: false });
  initUI(app);
  document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => app.markDirty('all'));
  window.__indai = window.__jarvis = { app, renderer, scene, camera, rig, P, THREE, orb, gestures };
}
boot();
