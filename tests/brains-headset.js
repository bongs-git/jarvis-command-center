// PAP-5 end to end: a stand-in indai-brain answers a rated idea with `brains` and `second`; the Analysis panel names them.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8765/index.html?demo=1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
function etYMD(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d); }
function ncdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
function chain(sym, spot, wantExp) {
  const today = etYMD(new Date()); const exps = [0, 1, 2, 5, 6, 7].map(k => etYMD(new Date(Date.now() + k * 864e5))).filter(e => ![0, 6].includes(new Date(e + 'T12:00:00Z').getUTCDay()));
  const expiry = (wantExp && exps.find(e => e >= wantExp)) || exps[0], T = 1 / 365 / 2, iv = 0.19, rows = [];
  for (let K = Math.round(spot * 0.9); K <= spot * 1.1; K++) for (const type of ['C', 'P']) {
    const v = iv * Math.sqrt(T), d1 = (Math.log(spot / K) + 0.5 * iv * iv * T) / v, d2 = d1 - v;
    const price = type === 'C' ? spot * ncdf(d1) - K * ncdf(d2) : K * ncdf(-d2) - spot * ncdf(-d1), mid = Math.max(0.01, +price.toFixed(2));
    rows.push({ type, strike: K, bid: +(mid * 0.98).toFixed(2), ask: +(mid * 1.02 + 0.01).toFixed(2), mid, last: mid, iv, delta: +(type === 'C' ? ncdf(d1) : ncdf(d1) - 1).toFixed(3), gamma: 0.04, theta: -0.9, vega: 0.05, oi: 4000 + (K % 5 === 0 ? 9000 : 0), vol: 3000 + (K % 5 === 0 ? 7000 : 0) });
  }
  const st = { callVol: 900000, putVol: 760000, pcVolume: 0.84, callOI: 2.1e6, putOI: 2.6e6, pcOI: 1.24, callPremium: 61e6, putPremium: 48e6 };
  return { symbol: sym, spot, timestamp: new Date().toISOString(), delayed: true, source: 'CBOE delayed quotes (about 15 minutes)', meta: { iv30: 19.4 }, expirations: exps, expiry, all: st, expiryStats: st,
    gex: { callWall: Math.round(spot * 1.012), putWall: Math.round(spot * 0.985), callWall2: Math.round(spot * 1.02), putWall2: Math.round(spot * 0.975), zeroGamma: Math.round(spot * 0.997), regime: 'positive', total: 1200 },
    gexNear: { expiry: exps[0], callWall: Math.round(spot * 1.008), putWall: Math.round(spot * 0.99), zeroGamma: Math.round(spot * 0.998) },
    unusual: [{ exp: expiry, type: 'C', strike: Math.round(spot) + 3, vol: 21000, oi: 9000, mid: 0.84, premium: 1764000, iv: 0.2 }], chain: rows, today };
}


const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const VERDICT = { rag: 'GREEN', confidence: 62, headline: 'Momentum with you, wall overhead', spoken: 'Green, with a caution.', summary: ['Above VWAP'], bullish: [], bearish: [], news: [], events: [], watch: [], plan_notes: '',
  second: { by: 'ChatGPT', model: 'gpt-5.5', rag: 'AMBER', confidence: 55, reason: 'Fed speaker at two.', risk: 'rates', agrees: false } };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const run = async (answer, label) => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 820 }, serviceWorkers: 'block' }), page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { const s = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); s.voice = false; s.gestureTutorialOffered = true; s.main = 'QQQ'; localStorage.setItem('jarvis.settings.v1', JSON.stringify(s)); });
    await page.route('**/*', async (route) => {
      const req = route.request(), u = new URL(req.url());
      if (u.host === 'localhost:8765') return route.continue();
      if (u.host !== 'zptjziewsfuvfcogrikz.supabase.co') return route.abort();
      const json = (j, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (u.pathname.endsWith('/indai-brain')) {
        if (req.method() === 'GET') return json({ configured: true, passcode: false, memory: true });
        const body = JSON.parse(req.postData() || '{}');
        if (body.mode === 'trade') { await sleep(200); return json(answer); }
        return json({ error: 'not_configured' }, 503);
      }
      if (u.pathname.endsWith('/indai-market') && u.searchParams.get('kind') === 'chain') { const spot = await page.evaluate(() => (window.__indai.app.feed.quote('QQQ') || {}).last || 662); return json(chain('QQQ', spot, u.searchParams.get('expiry'))); }
      if (u.pathname.includes('/rest/v1/')) return json([]);
      return json({ error: 'unavailable' }, 503);
    });
    await page.goto(BASE);
    await page.waitForFunction(() => window.__indai && window.__indai.P && window.__indai.P.chart && window.__indai.app.indai.brain.checked, null, { timeout: 40000 });
    await page.evaluate(() => { window.__indai.app.indai.muted = true; return window.__indai.app.indai.analyzeText('QQQ calls expiring today 665 strike'); });
    await page.waitForFunction(() => window.__indai.app.analysis && window.__indai.app.analysis.final, null, { timeout: 30000 }).catch(() => {});
    if (!(await page.evaluate(() => !!(window.__indai.app.analysis && window.__indai.app.analysis.final)))) console.log('LOG', JSON.stringify(await page.evaluate(() => window.__indai.app.indai.log.slice(-5).map(l => l.text.slice(0, 160)))));
    const out = await page.evaluate(() => {
      const a = window.__indai.app, P = window.__indai.P.analysis, seen = [];
      const ctx = P.ctx, ft = ctx.fillText.bind(ctx); ctx.fillText = (t, ...r) => { seen.push(String(t)); return ft(t, ...r); };
      P.draw(); ctx.fillText = ft;
      return { final: !!(a.analysis && a.analysis.final), meta: a.brainMeta.trade && a.brainMeta.trade.brains, seen: seen.join(' | '), png: P.canvas.toDataURL('image/png') };
    });
    fs.writeFileSync(`/tmp/brains-${label}.png`, Buffer.from(out.png.split(',')[1], 'base64'));
    await ctx.close();
    return { ...out, errors };
  };
  try {
    const three = await run({ mode: 'trade', model: 'claude-opus-5-5', result: VERDICT, sources: [], brains: [
      { brain: 'perplexity', role: 'research', model: 'sonar-pro', ok: true, ms: 4100 }, { brain: 'claude', role: 'verdict', model: 'claude-opus-5-5', ok: true, ms: 20000 }, { brain: 'chatgpt', role: 'second opinion', model: 'gpt-5.5', ok: true, ms: 9000 }] }, 'three');
    check('three brains: the panel names research, verdict and the disagreeing second opinion', three.final && /Research: Perplexity · Verdict: Claude · Second opinion: ChatGPT, amber, disagrees: Fed speaker at two/.test(three.seen.replace(/: \| /g, ': ')) && !three.errors.length, three.seen.slice(0, 400));
    const failedP = await run({ mode: 'trade', model: 'claude-opus-5-5', result: { ...VERDICT, second: undefined }, sources: [], brains: [
      { brain: 'perplexity', role: 'research', model: 'sonar-pro', ok: false, ms: 30000, error: 'timeout' }, { brain: 'claude', role: 'verdict', model: 'claude-opus-5-5', ok: true, ms: 20000 }] }, 'failed');
    check('Perplexity failed: said in faint text', /Verdict: Claude/.test(failedP.seen) && /Perplexity did not answer; Claude searched itself\./.test(failedP.seen), failedP.seen.slice(0, 400));
    const stand = await run({ mode: 'trade', model: 'gpt-5.5', result: { ...VERDICT, second: undefined }, sources: [], brains: [
      { brain: 'claude', role: 'verdict', model: 'claude-opus-5-5', ok: false, ms: 60000, error: 'overloaded' }, { brain: 'chatgpt', role: 'stand-in for Claude', model: 'gpt-5.5', ok: true, ms: 15000 }] }, 'stand');
    check('ChatGPT standing in for Claude', /Verdict: ChatGPT \(standing in for Claude\)/.test(stand.seen) && /Claude did not answer; ChatGPT stood in\./.test(stand.seen), stand.seen.slice(0, 400));
    const old = await run({ mode: 'trade', model: 'claude-opus-5-5', result: { ...VERDICT, second: undefined }, sources: [] }, 'old');
    check('an older server (no brains): nothing new on the panel', old.final && !/Research:|Verdict:|did not answer/.test(old.seen), old.seen.slice(0, 300));
  } finally { await browser.close(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
