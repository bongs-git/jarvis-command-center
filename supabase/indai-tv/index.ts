import { serve, markMode } from "../_shared/http.ts";
// INDAI <- TradingView: receives TradingView alert webhooks and stores them for the command center.
//   POST /functions/v1/indai-tv?key=<webhook key>   body: any alert text, or JSON like
//        {"ticker":"{{ticker}}","price":{{close}},"text":"QQQ crossed VWAP","cw":700,"pw":650,"zg":676}
//        or candles from the INDAI Bridge Pine indicator:
//        {"kind":"bars","tf":"1","bars":[{"s":"SPY","t":1795000000000,"o":1,"h":1,"l":1,"c":1,"v":100}, ...]}
//        or, between candle closes, the candle that is still forming: {"kind":"live","tf":"1","bars":[...]}
//   GET  /functions/v1/indai-tv?since=<ISO time>    recent alerts (last 2 days) for the app
//   GET  /functions/v1/indai-tv?bars=1&since=<ms>   bridge candles newer than <ms> (bar open time), the forming
//        candles in `live`, and a `cursor`; send it back as &seen=<cursor> to get only what was stored since
// The webhook key lives in public.indai_private_config (readable only by the service role).
import { bytes, HttpError } from "../_shared/http.ts";
import { sameSecret } from "../_shared/auth.ts";
import { cursorOf, LIVE_FOR, liveRows, seenAfter } from "./live.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const num = (v: unknown) => v == null || v === "" || !isFinite(Number(v)) ? null : Number(v);
let cachedKey: { v: string; t: number } | null = null;
async function webhookKey() {
  if (cachedKey && Date.now() - cachedKey.t < 300_000) return cachedKey.v;
  const r = await fetch(`${URL_}/rest/v1/indai_private_config?name=eq.tv_webhook_key&select=value`, { headers: H });
  if (!r.ok) throw new HttpError(502,"database","Webhook configuration is unavailable.");
  const j = await r.json();
  const v = Array.isArray(j) && j[0]?.value ? String(j[0].value) : "";
  cachedKey = { v, t: Date.now() };
  return v;
}

const NOT_TICKERS = new Set(["CW", "PW", "ZG", "GEX", "VWAP", "EMA", "MACD", "RSI", "ALERT", "CROSSING", "CROSSED", "ABOVE", "BELOW", "BUY", "SELL", "LONG", "SHORT", "CALL", "PUT", "CALLS", "PUTS", "THE", "AND", "AT", "ON", "TO", "OF", "UP", "DOWN", "HIGH", "LOW", "NEW", "FLIP", "WALL", "HOD", "LOD", "OPEN", "CLOSE", "BULL", "BEAR", "A", "I"]);
function cleanTicker(t: unknown) {
  if (t == null) return null;
  let s = String(t).toUpperCase().trim();
  if (s.includes(":")) s = s.split(":").pop()!;
  s = s.replace(/[^A-Z.]/g, "");
  if (s === "SPX" || s === "SPXW") return "SPX";
  return /^[A-Z.]{1,6}$/.test(s) ? s : null;
}
function grabLevels(text: string, obj: Record<string, unknown> | null) {
  const out: Record<string, number> = {};
  const pick = (k: string, ...alts: string[]) => {
    for (const a of [k, ...alts]) {
      const v = obj?.[a];
      if (v != null && isFinite(Number(v))) { out[k] = Number(v); return; }
    }
    const m = text.toLowerCase().replace(/[,:=]/g, " ").match(new RegExp(`(?:^|\\s)(?:${[k, ...alts].join("|")})\\s+(-?\\d+(?:\\.\\d+)?)`));
    if (m) out[k] = Number(m[1]);
  };
  pick("cw", "call_wall", "callwall", "call wall");
  pick("pw", "put_wall", "putwall", "put wall");
  pick("zg", "flip", "gamma_flip", "zero_gamma", "hvl", "gamma flip", "zero gamma");
  pick("cw2", "call_wall2");
  pick("pw2", "put_wall2");
  return Object.keys(out).length ? out : null;
}

serve("indai-tv",async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  markMode(req,url.searchParams.has("bars")?"bars":"alerts");
  if (req.method === "GET" && url.searchParams.get("bars") && url.searchParams.get("ticker")) {
    // History for one ticker, for scrolling a chart back: stored one-minute candles older than `before`, newest first.
    const ticker = cleanTicker(url.searchParams.get("ticker"));
    if (!ticker) return json({ error: "bad_symbol", message: "Give a ticker, e.g. ticker=QQQ." }, 400);
    const before = Math.round(Number(url.searchParams.get("before")) || Date.now() + 60_000);
    const limit = Math.max(1, Math.min(1000, Math.round(Number(url.searchParams.get("limit")) || 1000)));
    const r = await fetch(`${URL_}/rest/v1/indai_tv_bars?select=t,o,h,l,c,v&ticker=eq.${ticker}&tf=eq.1&t=lt.${before}&order=t.desc&limit=${limit}`, { headers: H });
    if (!r.ok) throw new HttpError(502,"database","The bridge feed is unavailable.");
    const rows = await r.json();
    return new Response(JSON.stringify({ ticker, bars: Array.isArray(rows) ? rows : [], now: Date.now() }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=30" } });
  }
  if (req.method === "GET" && url.searchParams.get("bars")) {
    const now = Date.now(), since = Math.max(Number(url.searchParams.get("since")) || 0, now - 3 * 3600e3);
    // An app that says what it has seen gets only what was stored after that, so a look that finds nothing new is
    // almost free. Without `seen` the answer is everything in the window, as it always was.
    const seen = url.searchParams.get("seen"), from = seenAfter(seen, now);
    const liveFrom = new Date(Math.max(now - LIVE_FOR, from ? Date.parse(from) : 0)).toISOString();
    const [r, lr] = await Promise.all([
      fetch(`${URL_}/rest/v1/indai_tv_bars?select=ticker,t,o,h,l,c,v,tf,received_at&t=gt.${since}${from ? `&received_at=gt.${encodeURIComponent(from)}` : ""}&order=t.asc&limit=1500`, { headers: H }),
      fetch(`${URL_}/rest/v1/indai_tv_live?select=ticker,t,o,h,l,c,v,received_at&received_at=gt.${encodeURIComponent(liveFrom)}&order=ticker.asc`, { headers: H }).catch(() => null),
    ]);
    if (!r.ok) throw new HttpError(502,"database","The bridge feed is unavailable.");
    const rows = await r.json(), bars = Array.isArray(rows) ? rows : [];
    // the forming candles are an extra: without them the finished ones are still worth sending
    const liveJson = lr && lr.ok ? await lr.json().catch(() => []) : [], live = Array.isArray(liveJson) ? liveJson : [];
    return new Response(JSON.stringify({ bars, live, now, cursor: cursorOf(seen, now, bars, live) }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (req.method === "GET") {
    const since = url.searchParams.get("since");
    const sinceQ = since && !isNaN(Date.parse(since)) ? `&received_at=gt.${encodeURIComponent(new Date(since).toISOString())}` : "";
    const r = await fetch(`${URL_}/rest/v1/indai_tv_alerts?select=id,received_at,ticker,kind,text,price,levels&received_at=gt.${encodeURIComponent(new Date(Date.now() - 2 * 864e5).toISOString())}${sinceQ}&order=received_at.desc&limit=50`, { headers: H });
    if (!r.ok) throw new HttpError(502,"database","The bridge feed is unavailable.");
    const rows = await r.json();
    return new Response(JSON.stringify({ alerts: Array.isArray(rows) ? rows : [] }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=5" } });
  }
  if (req.method !== "POST") return json({ error: "method", message:"Use GET or POST." }, 405);
  const key = await webhookKey();
  if (!sameSecret(key,url.searchParams.get("key")??"")) return json({error:"unauthorized",message:"Invalid webhook key."},401);
  const raw = new TextDecoder().decode(await bytes(req,16*1024));
  let obj: Record<string, unknown> | null = null;
  try { const p = JSON.parse(raw); if (p && typeof p === "object" && !Array.isArray(p)) obj = p; } catch { /* plain text alert */ }
  if (obj && obj.kind === "live") {
    // The candle that is still forming: its own table, so nothing that counts on finished candles ever sees it.
    const rows = liveRows(Array.isArray(obj.bars) ? obj.bars : [obj], obj.tf, Date.now(), cleanTicker, num);
    if (!rows.length) return json({ok:false,error:"no_valid_bars",message:"No candle that is forming now was supplied."},400);
    const r = await fetch(`${URL_}/rest/v1/rpc/indai_tv_live_put`, { method: "POST", headers: H, body: JSON.stringify({ p_rows: rows }) });
    if (!r.ok) return json({ error:"store",message:"The bridge write failed.",detail:"" }, 500);
    return json({ ok: true, live: rows.length });
  }
  if (obj && (obj.kind === "bars" || obj.kind === "bar")) {
    const list = Array.isArray(obj.bars) ? obj.bars : [obj];
    const rows = list.filter((v:any)=>v && typeof v==="object").map((b: any) => ({ ticker: cleanTicker(b.s ?? b.ticker ?? b.symbol), t: Math.round(Number(b.t)), o: num(b.o), h: num(b.h), l: num(b.l), c: num(b.c), v: num(b.v), tf: String(obj.tf ?? b.tf ?? "1").slice(0, 6), received_at: new Date().toISOString() }))
      .filter((b: any) => b.ticker && isFinite(b.t) && b.t > 1.5e12 && b.c != null && b.c > 0);
    if (!rows.length) return json({ok:false,error:"no_valid_bars",message:"No valid bridge candles were supplied."},400);
    const r = await fetch(`${URL_}/rest/v1/indai_tv_bars?on_conflict=ticker,t`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    if (!r.ok) return json({ error:"store",message:"The bridge write failed.",detail:"" }, 500);
    return json({ ok: true, bars: rows.length });
  }
  const text = String(obj?.text ?? obj?.message ?? obj?.msg ?? obj?.alert ?? raw).trim().slice(0, 600) || "TradingView alert";
  let ticker = cleanTicker(obj?.ticker ?? obj?.symbol ?? obj?.tv_ticker);
  if (!ticker) {
    const m = text.match(/\b(?:[A-Z]+:)?([A-Z]{1,5})\b/g) || [];
    for (const w of m) { const t = cleanTicker(w); if (t && !NOT_TICKERS.has(t)) { ticker = t; break; } }
  }
  const levels = grabLevels(text, obj);
  const price = obj?.price ?? obj?.close;
  const row = {
    ticker, text, kind: levels ? "levels" : String(obj?.kind ?? obj?.event ?? "alert").slice(0, 40),
    price: price != null && isFinite(Number(price)) ? Number(price) : null,
    levels, payload: obj ?? { raw },
  };
  const r = await fetch(`${URL_}/rest/v1/indai_tv_alerts`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (!r.ok) return json({ error:"store",message:"The bridge write failed.",detail:"" }, 500);
  return json({ ok: true, ticker, kind: row.kind });
});
