// INDAI <- TradingView: receives TradingView alert webhooks and stores them for the command center.
//   POST /functions/v1/indai-tv?key=<webhook key>   body: any alert text, or JSON like
//        {"ticker":"{{ticker}}","price":{{close}},"text":"QQQ crossed VWAP","cw":700,"pw":650,"zg":676}
//        or candles from the INDAI Bridge Pine indicator:
//        {"kind":"bars","tf":"1","bars":[{"s":"SPY","t":1795000000000,"o":1,"h":1,"l":1,"c":1,"v":100}, ...]}
//   GET  /functions/v1/indai-tv?since=<ISO time>    recent alerts (last 2 days) for the app
//   GET  /functions/v1/indai-tv?bars=1&since=<ms>   bridge candles newer than <ms> (bar open time)
// The webhook key lives in public.indai_private_config (readable only by the service role).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("bars")) {
    const since = Math.max(Number(url.searchParams.get("since")) || 0, Date.now() - 3 * 3600e3);
    const r = await fetch(`${URL_}/rest/v1/indai_tv_bars?select=ticker,t,o,h,l,c,v,tf,received_at&t=gt.${since}&order=t.asc&limit=1500`, { headers: H });
    const rows = await r.json();
    return new Response(JSON.stringify({ bars: Array.isArray(rows) ? rows : [], now: Date.now() }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (req.method === "GET") {
    const since = url.searchParams.get("since");
    const sinceQ = since && !isNaN(Date.parse(since)) ? `&received_at=gt.${encodeURIComponent(new Date(since).toISOString())}` : "";
    const r = await fetch(`${URL_}/rest/v1/indai_tv_alerts?select=id,received_at,ticker,kind,text,price,levels&received_at=gt.${encodeURIComponent(new Date(Date.now() - 2 * 864e5).toISOString())}${sinceQ}&order=received_at.desc&limit=50`, { headers: H });
    const rows = await r.json();
    return new Response(JSON.stringify({ alerts: Array.isArray(rows) ? rows : [] }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=5" } });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const key = await webhookKey();
  if (!key || url.searchParams.get("key") !== key) return json({ error: "unauthorized" }, 401);
  const raw = (await req.text()).slice(0, 4000);
  let obj: Record<string, unknown> | null = null;
  try { const p = JSON.parse(raw); if (p && typeof p === "object" && !Array.isArray(p)) obj = p; } catch { /* plain text alert */ }
  if (obj && (obj.kind === "bars" || obj.kind === "bar")) {
    const list = Array.isArray(obj.bars) ? obj.bars : [obj];
    const rows = list.map((b: any) => ({ ticker: cleanTicker(b.s ?? b.ticker ?? b.symbol), t: Math.round(Number(b.t)), o: num(b.o), h: num(b.h), l: num(b.l), c: num(b.c), v: num(b.v), tf: String(obj.tf ?? b.tf ?? "1").slice(0, 6), received_at: new Date().toISOString() }))
      .filter((b: any) => b.ticker && isFinite(b.t) && b.t > 1.5e12 && b.c != null && b.c > 0);
    if (!rows.length) return json({ ok: false, error: "no valid bars" }, 400);
    const r = await fetch(`${URL_}/rest/v1/indai_tv_bars?on_conflict=ticker,t`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    if (!r.ok) return json({ error: "store", detail: (await r.text()).slice(0, 300) }, 500);
    if (Math.random() < 0.02) fetch(`${URL_}/rest/v1/indai_tv_bars?received_at=lt.${encodeURIComponent(new Date(Date.now() - 3 * 864e5).toISOString())}`, { method: "DELETE", headers: H }).catch(() => {});
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
  if (!r.ok) return json({ error: "store", detail: (await r.text()).slice(0, 300) }, 500);
  return json({ ok: true, ticker, kind: row.kind });
});
