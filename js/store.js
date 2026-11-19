// INDAI settings + per-day state, kept in this device's browser storage only.
// API keys never leave the device except in requests to the data providers themselves.

const SETTINGS_KEY = 'jarvis.settings.v1';
const DAY_KEY = 'jarvis.day.v1';
const LAYOUT_KEY = 'jarvis.layout.v1';

export const DEFAULT_SETTINGS = {
  name: 'Bongs',
  symbols: ['SPY', 'QQQ', 'IWM', 'TSLA', 'AMZN', 'MSFT'],
  main: 'IWM',
  interval: '5min',
  dataMode: 'auto',          // 'auto' = CBOE delayed (free), plus Finnhub real-time if a key is set; 'demo' = simulated
  finnhubKey: '',
  twelveKey: '',
  levelsText: '',            // pasted GEX levels, parsed by parseLevels()
  risk: {
    account: 5000,           // $ account size
    maxDailyLoss: 300,       // $ daily loss circuit breaker
    riskPct: 2,              // % of account risked per trade
    stopPct: 50,             // % of option premium you stop out at
    maxConsecLosses: 2,      // losses in a row before forced cooldown
    cooldownMin: 15,         // cooldown length, minutes
  },
  scene: 'passthrough',      // passthrough (your room) or a virtual scene: loft, midnight, ocean, orbit, deck
  voice: true,
  voiceEngine: 'neural',     // 'neural' = INDAI's on-device voice (Kokoro), 'system' = the browser's own voice
  voiceName: 'af_heart',
  voiceSpeed: 0.95,
  micEngine: 'auto',         // 'auto' = on-device Whisper on Quest, browser recognizer elsewhere
  researchPass: '',          // optional passcode for INDAI's web research
  researchDepth: 'fast',     // 'fast' or 'deep'
  rate: 0.04,                // risk-free rate for options math
  alerts: { levels: true, hod: true, breaker: true, bells: true, tradingview: true },
  show: { ema: true, vwap: true, gex: true },
};

function safeGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ }
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    const b = base ? base[k] : undefined;
    out[k] = (b && typeof b === 'object' && !Array.isArray(b)) ? deepMerge(b, over[k]) : over[k];
  }
  return out;
}

export function loadSettings() {
  const s = deepMerge(DEFAULT_SETTINGS, safeGet(SETTINGS_KEY) || {});
  s.symbols = (s.symbols || []).map(x => String(x).trim().toUpperCase()).filter(Boolean).slice(0, 12);
  if (!s.symbols.length) s.symbols = [...DEFAULT_SETTINGS.symbols];
  if (!s.symbols.includes(s.main)) s.main = s.symbols.includes('IWM') ? 'IWM' : s.symbols[0];
  return s;
}
export function saveSettings(s) { safeSet(SETTINGS_KEY, s); }

export function todayET() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // YYYY-MM-DD
}

export function freshDay() {
  return {
    date: todayET(), pnl: 0, trades: [], consec: 0, cooldownUntil: 0, tripped: false,
    step: 50, premium: 1.0, checklist: [false, false, false, false],
    plan: null, goalHit: false, signals: 0,
  };
}
export function loadDay() {
  const d = safeGet(DAY_KEY);
  if (!d || d.date !== todayET()) return freshDay();
  return { ...freshDay(), ...d };
}
export function saveDay(d) { safeSet(DAY_KEY, d); }

export function loadLayout() { return safeGet(LAYOUT_KEY) || {}; }
export function saveLayout(l) { safeSet(LAYOUT_KEY, l); }
export function clearLayout() { try { localStorage.removeItem(LAYOUT_KEY); } catch {} }

// GEX levels. Accepts lines like:
//   IWM CW 245 PW 238 ZG 241
//   SPY call wall 690, put wall 670, zero gamma 681
//   QQQ cw=620 pw=600 hvl=612
export function parseLevels(text) {
  const out = {};
  if (!text) return out;
  for (const raw of text.split(/\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\$?([A-Za-z.]{1,6})\b(.*)$/);
    if (!m) continue;
    const sym = m[1].toUpperCase();
    const rest = m[2].toLowerCase().replace(/[,:=]/g, ' ');
    const lv = out[sym] || {};
    const grab = (re) => { const r = rest.match(re); return r ? parseFloat(r[1]) : undefined; };
    const cw = grab(/(?:cw|call\s*wall|callwall|cwall)\s+(-?\d+(?:\.\d+)?)/);
    const pw = grab(/(?:pw|put\s*wall|putwall|pwall)\s+(-?\d+(?:\.\d+)?)/);
    const zg = grab(/(?:zg|zero\s*gamma|zerogamma|hvl|flip|gamma\s*flip)\s+(-?\d+(?:\.\d+)?)/);
    if (cw !== undefined) lv.cw = cw;
    if (pw !== undefined) lv.pw = pw;
    if (zg !== undefined) lv.zg = zg;
    if (Object.keys(lv).length) out[sym] = lv;
  }
  return out;
}
