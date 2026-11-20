import { serve, markMode } from "../_shared/http.ts";
// INDAI market relay: public market data for the INDAI command center.
// Reads CBOE's free delayed quotes (options chains with Greeks, OI, volume) and news RSS,
// and returns compact summaries: put/call ratios, premium flow, unusual activity, GEX walls.
import { licensedKey, minuteBars, optionsRaw, quotes } from "./licensed.ts";
import { failure } from "../_shared/http.ts";
import { rpc } from "../_shared/db.ts";
import { BRIDGE, bridgeBars, bridgePrevClose, bridgeQuote, bridgeRows } from "./bridge.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-indai-pass",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const UA = "Mozilla/5.0 (compatible; INDAI-command-center/1.0)";
const SYM = /^[A-Z][A-Z.]{0,7}$/;
const INDEX = new Set(["SPX", "NDX", "RUT", "VIX", "XSP", "DJX", "OEX"]);

const cache = new Map<string, { t: number; v: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v as T;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  return v;
}
function json(data: any, status = 200, maxAge = 30) {
  const licensed=data.source==="Massive";
  data={source:"CBOE delayed quotes (about 15 minutes)",delay:900,...data};
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Vary":"Authorization, x-indai-pass", "Cache-Control": licensed ? "private, no-store" : `public, max-age=${maxAge}` },
  });
}
const cboeSym = (s: string) => (INDEX.has(s) ? "_" + s : s);
async function cboe(path: string) {
  const r = await fetch("https://cdn.cboe.com/api/global/delayed_quotes/" + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`CBOE ${r.status} for ${path}`);
  return await r.json();
}
function todayET() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
// The owner's TradingView bridge stands in when CBOE refuses a quote or the intraday candles.
async function bridge(symbol: string) {
  const rows = await cached("tv:" + symbol, 15_000, () => bridgeRows(symbol));
  if (!Array.isArray(rows) || !rows.length) return null;
  const prevClose = await cached("tvp:" + symbol + ":" + todayET(), 3_600_000, () => bridgePrevClose(symbol, rows));
  return { rows, prevClose };
}
// The answer as a whole is labelled as the bridge's when every ticker that could be answered came from it.
const allBridge = (items: any[]) => {
  const answered = items.filter((x) => x && !x.error && x.ok !== false);
  return answered.length > 0 && answered.every((x) => x.source === BRIDGE) ? { source: BRIDGE, delay: 0, delayed: false } : {};
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

type Opt = { exp: string; type: "C" | "P"; strike: number; bid: number; ask: number; mid: number; last: number; iv: number; delta: number; gamma: number; theta: number; vega: number; oi: number; vol: number };

function parseChain(raw: any) {
  const d = raw?.data ?? {};
  const spot = num(d.current_price) || num(d.close) || num(d.prev_day_close);
  const out: Opt[] = [];
  for (const o of d.options ?? []) {
    const m = String(o.option ?? "").match(/^([A-Z.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
    if (!m) continue;
    const bid = num(o.bid), ask = num(o.ask);
    out.push({
      exp: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5] as "C" | "P", strike: Number(m[6]) / 1000,
      bid, ask, mid: bid && ask ? (bid + ask) / 2 : num(o.last_trade_price), last: num(o.last_trade_price),
      iv: num(o.iv), delta: num(o.delta), gamma: num(o.gamma), theta: num(o.theta), vega: num(o.vega),
      oi: num(o.open_interest), vol: num(o.volume),
    });
  }
  return {
    spot, opts: out, timestamp: raw?.timestamp ?? null,
    meta: { iv30: num(d.iv30), iv30Change: num(d.iv30_change), prevClose: num(d.prev_day_close), change: num(d.price_change), changePct: num(d.price_change_percent), high: num(d.high), low: num(d.low), open: num(d.open), volume: num(d.volume) },
  };
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function analyse(sym: string, raw: any, wantExp: string | null, range: number) {
  const { spot, opts, timestamp, meta } = parseChain(raw);
  const today = todayET();
  const live = opts.filter((o) => o.exp >= today);
  const expirations = [...new Set(live.map((o) => o.exp))].sort();
  let exp = expirations[0] ?? null;
  if (wantExp) exp = expirations.find((e) => e >= wantExp) ?? exp;

  const sum = (arr: Opt[], f: (o: Opt) => number) => arr.reduce((s, o) => s + f(o), 0);
  const ratios = (arr: Opt[]) => {
    const c = arr.filter((o) => o.type === "C"), p = arr.filter((o) => o.type === "P");
    const cv = sum(c, (o) => o.vol), pv = sum(p, (o) => o.vol), coi = sum(c, (o) => o.oi), poi = sum(p, (o) => o.oi);
    const cprem = sum(c, (o) => o.vol * o.mid * 100), pprem = sum(p, (o) => o.vol * o.mid * 100);
    return { callVol: cv, putVol: pv, pcVolume: cv ? r2(pv / cv) : null, callOI: coi, putOI: poi, pcOI: coi ? r2(poi / coi) : null, callPremium: Math.round(cprem), putPremium: Math.round(pprem) };
  };
  const near = live.filter((o) => daysBetween(today, o.exp) <= 45);

  // GEX levels, same method as the Morning GEX refresh: Black-Scholes gamma at spot from OI and IV,
  // contracts within 45 days and 25% of spot, call wall above / put wall below, gamma flip within +/-15%.
  const RATE = 0.04, YEAR = 365 * 24 * 3600, SQ2PI = Math.sqrt(2 * Math.PI), now = Date.now();
  const closeUtc = new Map<string, number>();
  const closeOf = (exp: string) => {
    if (!closeUtc.has(exp)) {
      const noon = new Date(exp + "T12:00:00Z");
      const hNY = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(noon));
      closeUtc.set(exp, Date.parse(exp + "T16:00:00Z") - (hNY - 12) * 3600e3);
    }
    return closeUtc.get(exp)!;
  };
  type Row = [string, number, number, number, number];
  const rowsAll: Row[] = [];
  for (const o of live) {
    if (o.oi <= 0 || Math.abs(o.strike / spot - 1) > 0.25) continue;
    const secs = (closeOf(o.exp) - now) / 1000;
    if (secs <= 0 || secs > 46 * 86400) continue;
    rowsAll.push([o.exp, o.strike, Math.max(secs, 3600) / YEAR, o.iv, o.type === "C" ? o.oi : -o.oi]);
  }
  const ivs = rowsAll.map((r) => r[3]).filter((v) => v > 0).sort((a, b) => a - b);
  if (ivs.length && ivs[Math.floor(ivs.length / 2)] > 3) rowsAll.forEach((r) => (r[3] /= 100));
  const byExp: Record<string, number[]> = {};
  rowsAll.forEach((r) => { if (r[3] > 0.01 && r[3] < 5) (byExp[r[0]] ??= []).push(r[3]); });
  const med: Record<string, number> = {};
  for (const e in byExp) { const v = byExp[e].sort((a, b) => a - b); med[e] = v[Math.floor(v.length / 2)]; }
  rowsAll.forEach((r) => { if (!(r[3] > 0.01 && r[3] < 5)) r[3] = med[r[0]] ?? 0.25; });
  const prep = (rows: Row[]) => rows.map(([, k, T, iv, soi]) => { const vt = iv * Math.sqrt(T); return [Math.log(k), (RATE + 0.5 * iv * iv) * T, vt, soi / vt, k]; });
  const netAt = (S: number, pc: number[][]) => { const l = Math.log(S); let t = 0; for (const [lk, dr, vt, sv] of pc) { const d1 = (l - lk + dr) / vt; t += Math.exp(-0.5 * d1 * d1) * sv; } return t * 100 * S * 0.01 / SQ2PI; };
  const levels = (rows: Row[]) => {
    const pc = prep(rows);
    if (!pc.length) return { callWall: null, putWall: null, callWall2: null, putWall2: null, zeroGamma: null, total: 0, strikes: [] as { strike: number; net: number }[] };
    const l = Math.log(spot), sc = 100 * spot * 0.01 / SQ2PI;
    const calls = new Map<number, number>(), puts = new Map<number, number>(), net = new Map<number, number>();
    for (const [lk, dr, vt, sv, k] of pc) {
      const d1 = (l - lk + dr) / vt, g = Math.exp(-0.5 * d1 * d1) * sv * sc;
      net.set(k, (net.get(k) ?? 0) + g);
      if (g > 0) calls.set(k, (calls.get(k) ?? 0) + g); else puts.set(k, (puts.get(k) ?? 0) - g);
    }
    const top2 = (m: Map<number, number>, keep: (k: number) => boolean) => { const ks = [...m.keys()].filter(keep).sort((a, b) => m.get(b)! - m.get(a)!); return [ks[0] ?? null, ks[1] ?? null]; };
    const [cw, cw2] = top2(calls, (k) => k >= spot), [pw, pw2] = top2(puts, (k) => k <= spot);
    const lo = spot * 0.85, hi = spot * 1.15, steps = 300, dx = (hi - lo) / steps;
    let flip: number | null = null, best: number | null = null, ps = lo, pg = netAt(lo, pc);
    for (let j = 1; j <= steps; j++) {
      const sv = lo + dx * j, g = netAt(sv, pc);
      if ((pg <= 0 && g > 0) || (pg >= 0 && g < 0)) { const x = ps + (sv - ps) * (0 - pg) / (g - pg); if (best === null || Math.abs(x - spot) < best) { best = Math.abs(x - spot); flip = x; } }
      ps = sv; pg = g;
    }
    const strikes = [...net.entries()].filter(([k]) => Math.abs(k / spot - 1) <= 0.07).sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ strike: k, net: Math.round(v) }));
    return { callWall: cw, putWall: pw, callWall2: cw2, putWall2: pw2, zeroGamma: flip === null ? null : r2(flip), total: Math.round(netAt(spot, pc)), strikes };
  };
  const exps = [...new Set(rowsAll.map((r) => r[0]))].sort();
  const gexAll = levels(rowsAll);
  const gexNear = exps.length ? { expiry: exps[0], ...levels(rowsAll.filter((r) => r[0] === exps[0])) } : null;

  const unusual = near
    .filter((o) => o.vol >= 500 && o.vol > o.oi * 1.2 && o.mid > 0 && o.iv > 0 && Math.abs(o.strike - spot) / spot <= 0.06)
    .map((o) => ({ exp: o.exp, type: o.type, strike: o.strike, vol: o.vol, oi: o.oi, mid: r2(o.mid), premium: Math.round(o.vol * o.mid * 100), iv: r2(o.iv) }))
    .sort((a, b) => b.premium - a.premium).slice(0, 10);

  const expRows = exp ? live.filter((o) => o.exp === exp) : [];
  const chain = expRows
    .filter((o) => Math.abs(o.strike - spot) / spot <= range)
    .map((o) => ({ type: o.type, strike: o.strike, bid: o.bid, ask: o.ask, mid: r2(o.mid), last: o.last, iv: Math.round(o.iv * 10000) / 10000, delta: Math.round(o.delta * 1000) / 1000, gamma: Math.round(o.gamma * 10000) / 10000, theta: Math.round(o.theta * 1000) / 1000, vega: Math.round(o.vega * 1000) / 1000, oi: o.oi, vol: o.vol }))
    .sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type));

  return {
    symbol: sym, spot, timestamp, delayed: true, source: "CBOE delayed quotes (about 15 minutes)",
    meta, expirations: expirations.slice(0, 40), expiry: exp,
    all: ratios(live), expiryStats: ratios(expRows),
    gex: { ...gexAll, regime: gexAll.zeroGamma === null ? (gexAll.total >= 0 ? "positive" : "negative") : (spot >= gexAll.zeroGamma ? "positive" : "negative"), method: "Black-Scholes gamma at spot, OI-weighted, expiries within 45 days" },
    gexNear,
    unusual, chain,
  };
}

function parseRss(xml: string) {
  const items: { title: string; link: string; date: string; source: string }[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (tag: string) => {
      const r = m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
    };
    items.push({ title: get("title"), link: get("link"), date: get("pubDate"), source: get("source") });
    if (items.length >= 15) break;
  }
  return items;
}

async function news(sym: string) {
  const urls = [
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`,
    `https://news.google.com/rss/search?q=${encodeURIComponent(sym + " stock")}&hl=en-US&gl=US&ceid=US:en`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      const items = parseRss(await r.text()).filter((i) => i.title);
      if (items.length) return { symbol: sym, source: new URL(u).hostname, items };
    } catch { /* try next */ }
  }
  return { symbol: sym, source: null, items: [] };
}

serve("indai-market",async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "chain";
  markMode(req,kind);
  if (req.method!=="GET") return json({error:"method",message:"Use GET."},405,0);
  const many = (url.searchParams.get("symbols") ?? "").toUpperCase().split(",").map((x) => x.trim()).filter((x) => SYM.test(x)).slice(0, 16);
  if (["quote","snapshot","bars","chain"].includes(kind)) {
    let key: string | null;
    try { key=await licensedKey(req); } catch(e) { return failure(e); }
    if (key) {
      const symbol=(url.searchParams.get("symbol")??"").toUpperCase();
      const symbols=kind==="snapshot" || kind==="bars" ? many : SYM.test(symbol) ? [symbol] : [];
      if (symbols.length) try {
        const q=await cached("massive:q:"+symbols.join(","),2000,()=>quotes(symbols,key!));
        const meta={source:"Massive",delay:0,delayed:false};
        if (kind==="snapshot") return json({quotes:q,...meta});
        if (kind==="quote") return json({...q[0],...meta});
        if (kind==="bars") {
          const rows=await Promise.all(q.map(async item=>[item.symbol,await cached("massive:b:"+item.symbol,5000,()=>minuteBars(item,key!))]));
          return json({bars:Object.fromEntries(rows),note:"1-minute bars, minutes after midnight New York time: [mins, open, high, low, close, volume, callVolume, putVolume]",...meta});
        }
        const raw=await cached("massive:options:"+symbol,10000,()=>optionsRaw(symbol,key!,q[0]));
        const exp=url.searchParams.get("expiry");
        const range=Math.min(0.25,Math.max(0.01,Number(url.searchParams.get("range")??0.06)||0.06));
        return json({...analyse(symbol,raw,exp && /^\d{4}-\d{2}-\d{2}$/.test(exp)?exp:null,range),...meta,iv30Available:false});
      } catch { /* Return the complete delayed product when entitlements, coverage or vendor availability differ. */ }
    }
  }
  try {
    if (kind === "health") return json({source:"INDAI",delay:null,jobs:await rpc("indai_job_health")},200,0);
    if (kind === "snapshot") {
      const out = await Promise.all(many.map(async (t) => {
        try {
          const raw = await cached("q:" + t, 20_000, () => cboe(`quotes/${cboeSym(t)}.json`));
          const d = raw?.data ?? {};
          return { symbol: t, ok: true, timestamp: raw?.timestamp ?? null, price: num(d.current_price), change: num(d.price_change), changePct: num(d.price_change_percent), open: num(d.open), high: num(d.high), low: num(d.low), prevClose: num(d.prev_day_close), close: num(d.close), volume: num(d.volume), iv30: num(d.iv30), lastTrade: d.last_trade_time ?? null };
        } catch (e) {
          try {
            const b = await bridge(t);
            const q = b && bridgeQuote(t, b.rows, b.prevClose, Date.now());
            if (q) return q;
          } catch { /* the bridge has nothing for this ticker either */ }
          return { symbol: t, ok: false, error: String((e as Error).message) };
        }
      }));
      return json({ quotes: out, ...allBridge(out) }, 200, 10);
    }
    if (kind === "bars") {
      const out: Record<string, unknown> = {};
      await Promise.all(many.map(async (t) => {
        try {
          const raw = await cached("b:" + t, 30_000, () => cboe(`charts/intraday/${cboeSym(t)}.json`));
          const arr = Array.isArray(raw?.data) ? raw.data : [];
          let session = "";
          const bars: number[][] = [];
          for (const b of arr) {
            const dt = String(b?.datetime ?? "");
            const p = b?.price ?? {}, v = b?.volume ?? {};
            if (!dt || !(num(p.close) > 0)) continue;
            session = dt.slice(0, 10);
            const mins = Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
            bars.push([mins, num(p.open), num(p.high), num(p.low), num(p.close), num(v.stock_volume), num(v.calls_volume), num(v.puts_volume)]);
          }
          out[t] = { session, bars, timestamp: raw?.timestamp ?? null };
        } catch (e) {
          let stored = null;
          try {
            const b = await bridge(t);
            stored = b && bridgeBars(b.rows);
          } catch { /* the bridge has nothing for this ticker either */ }
          out[t] = stored ?? { error: String((e as Error).message) };
        }
      }));
      return json({ bars: out, note: "1-minute bars, minutes after midnight New York time: [mins, open, high, low, close, volume, callVolume, putVolume]", ...allBridge(Object.values(out)) }, 200, 15);
    }
    if (kind === "daily") {
      // days: how many daily candles to return, newest last (1 to 6000; 260 when not given, as before).
      const want = Number(url.searchParams.get("days"));
      const days = Number.isFinite(want) && want >= 1 ? Math.min(6000, Math.floor(want)) : 260;
      const out: Record<string, unknown> = {};
      await Promise.all(many.map(async (t) => {
        try {
          const raw = await cached("d:" + t, 3_600_000, () => cboe(`charts/historical/${cboeSym(t)}.json`));
          const arr = (Array.isArray(raw?.data) ? raw.data : []).slice(-days);
          out[t] = arr.map((b: any) => [b.date, num(b.open), num(b.high), num(b.low), num(b.close), num(b.volume)]);
        } catch (e) { out[t] = { error: String((e as Error).message) }; }
      }));
      return json({ daily: out }, 200, 600);
    }
  } catch (e) {
    return json({ error: "upstream", message:"Market data is unavailable." }, 502, 0);
  }
  const sym = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!SYM.test(sym)) return json({ error: "bad_symbol", message: "Give a ticker, e.g. ?symbol=QQQ (or symbols=QQQ,SPY for snapshot, bars, daily)" }, 400);
  try {
    if (kind === "chain") {
      const exp = url.searchParams.get("expiry");
      const range = Math.min(0.25, Math.max(0.01, Number(url.searchParams.get("range") ?? 0.06)));
      const raw = await cached("opt:" + sym, 60_000, () => cboe(`options/${cboeSym(sym)}.json`));
      return json(analyse(sym, raw, exp && /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null, range));
    }
    if (kind === "quote") {
      const raw = await cached("q:" + sym, 30_000, () => cboe(`quotes/${cboeSym(sym)}.json`));
      const d = raw?.data ?? {};
      return json({ symbol: sym, timestamp: raw?.timestamp ?? null, price: num(d.current_price), change: num(d.price_change), changePct: num(d.price_change_percent), open: num(d.open), high: num(d.high), low: num(d.low), prevClose: num(d.prev_day_close), volume: num(d.volume), iv30: num(d.iv30), iv30Change: num(d.iv30_change) });
    }
    if (kind === "news") return json({...await cached("n:" + sym, 300_000, () => news(sym)),delay:null}, 200, 120);
    if (kind === "debug") {
      const raw = await cboe(`options/${cboeSym(sym)}.json`);
      const d = raw?.data ?? {};
      return json({ dataKeys: Object.keys(d), count: (d.options ?? []).length, sample: (d.options ?? [])[0] ?? null, timestamp: raw?.timestamp }, 200, 0);
    }
    return json({ error:"bad_kind", message: "Unknown kind. Use chain, quote, news, snapshot, bars or daily." }, 400);
  } catch (e) {
    return json({ error: "upstream", message:"Market data is unavailable." }, 502, 0);
  }
});
