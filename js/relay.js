// Talks to INDAI's backend in Supabase (project "command-center"):
//   indai-market  - CBOE delayed quotes, intraday bars, option chains with GEX, news (no keys needed)
//   indai-brain   - Claude + web search research (needs ANTHROPIC_API_KEY set as a Supabase secret)
//   indai-tv      - TradingView alert webhooks (your Pine alerts land here)
//   indai_gex_levels table - GEX levels copied each morning from the Morning GEX refresh task
export const RELAY_URL = 'https://zptjziewsfuvfcogrikz.supabase.co';
// Public "anon" key: safe to ship in a web page; it only allows what the backend explicitly permits.
export const RELAY_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwdGp6aWV3c2Z1dmZjb2dyaWt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MDkyMDEsImV4cCI6MjEwOTM4NTIwMX0.hAyxlOpNO7JY-tA_sIhpLmfpco6DXpFDbT20B8GRK8Q';

const HEADERS = { Authorization: `Bearer ${RELAY_ANON}`, apikey: RELAY_ANON };
const memo = new Map();

async function getJSON(url, { ttl = 0, timeout = 20000 } = {}) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  if (hit && hit.p) return hit.p;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const p = fetch(url, { headers: HEADERS, signal: ctl.signal })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`); return j; })
    .finally(() => clearTimeout(timer));
  memo.set(url, { t: hit?.t ?? 0, v: hit?.v, p });
  try { const v = await p; memo.set(url, { t: Date.now(), v }); return v; }
  catch (e) { memo.set(url, { t: hit?.t ?? 0, v: hit?.v }); throw e; }
}
const fn = (q) => `${RELAY_URL}/functions/v1/indai-market?${q}`;

export const relay = {
  snapshot: (syms) => getJSON(fn(`kind=snapshot&symbols=${syms.join(',')}`), { ttl: 8000 }),
  bars: (syms) => getJSON(fn(`kind=bars&symbols=${syms.join(',')}`), { ttl: 20000 }),
  daily: (syms) => getJSON(fn(`kind=daily&symbols=${syms.join(',')}`), { ttl: 3600e3 }),
  chain: (sym, expiry = '', range = 0.05) => getJSON(fn(`kind=chain&symbol=${sym}${expiry ? `&expiry=${expiry}` : ''}&range=${range}`), { ttl: 45000, timeout: 30000 }),
  news: (sym) => getJSON(fn(`kind=news&symbol=${sym}`), { ttl: 300e3 }),
  // TradingView alerts that arrived through the webhook (last 2 days, newest first).
  tvAlerts: (since = '') => getJSON(`${RELAY_URL}/functions/v1/indai-tv${since ? `?since=${encodeURIComponent(since)}` : ''}`, { ttl: 4000, timeout: 10000 }),
  // Candles pushed by the INDAI Bridge TradingView indicator.
  tvBars: (since = 0) => getJSON(`${RELAY_URL}/functions/v1/indai-tv?bars=1&since=${since}`, { ttl: 0, timeout: 10000 }),
  async morningGex() {
    const url = `${RELAY_URL}/rest/v1/indai_gex_levels?select=ticker,scope,asof_et,expiry,spot,call_wall,put_wall,call_wall2,put_wall2,gamma_flip,net_gex_m`;
    const rows = await getJSON(url, { ttl: 300e3 });
    const out = {};
    for (const r of rows || []) (out[r.ticker] ??= {})[r.scope] = r;
    return out;
  },
  async brainStatus() {
    try { return await getJSON(`${RELAY_URL}/functions/v1/indai-brain`, { ttl: 60e3, timeout: 8000 }); } catch { return { configured: false, error: true }; }
  },
  async brain(body, passcode = '') {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 140000);
    try {
      const r = await fetch(`${RELAY_URL}/functions/v1/indai-brain`, {
        method: 'POST', signal: ctl.signal,
        headers: { ...HEADERS, 'Content-Type': 'application/json', ...(passcode ? { 'x-indai-pass': passcode } : {}) },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.message || j.error || `HTTP ${r.status}`); e.code = j.error; throw e; }
      return j;
    } finally { clearTimeout(timer); }
  },
};
