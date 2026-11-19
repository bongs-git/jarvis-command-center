// Optional Massive adapter. Use the vendor's timeframe fields to verify the entitlement.
import { account } from "../_shared/auth.ts";
import { db } from "../_shared/db.ts";

const origin = "https://api.massive.com";
const indices = new Set(["SPX", "NDX", "RUT", "VIX", "XSP", "DJX", "OEX"]);
const vendorSymbol = (symbol: string) => indices.has(symbol) ? "I:" + symbol : symbol;
const iso = (ns: number) => new Date(Math.trunc(ns / 1e6)).toISOString();
const ny = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function clock(ms: number) {
  const p = Object.fromEntries(ny.formatToParts(ms).map((x) => [x.type, x.value]));
  return { day: p.year + "-" + p.month + "-" + p.day, minute: Number(p.hour) * 60 + Number(p.minute) };
}
export async function licensedKey(req: Request) {
  const key = Deno.env.get("MASSIVE_API_KEY");
  if (!key || Deno.env.get("INDAI_MARKET_PROVIDER") !== "massive") return null;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (
    !req.headers.has("x-indai-pass") &&
    (!bearer || bearer === Deno.env.get("SUPABASE_ANON_KEY") ||
      bearer === Deno.env.get("INDAI_PUBLISHABLE_KEY"))
  ) return null;
  const user = await account(req);
  const [owner] = await db("indai_owner", { select: "user_id", limit: "1" });
  const licensed = (Deno.env.get("INDAI_MARKET_LICENSED_USERS") ?? "").split(",").map((x) => x.trim());
  return user === owner?.user_id || licensed.includes(user) ? key : null;
}
async function get(url: URL, key: string, signal?: AbortSignal) {
  if (url.origin !== origin || url.username || url.password) throw new Error("Unexpected vendor URL");
  const r = await fetch(url, {
    headers: { Authorization: "Bearer " + key, Accept: "application/json" },
    redirect: "error",
    signal: signal ?? AbortSignal.timeout(7000),
  });
  if (!r.ok) throw new Error("Licensed feed unavailable");
  const body = await r.json();
  if (!Array.isArray(body.results) || !body.results.length) throw new Error("No licensed data");
  return body;
}
export async function quotes(symbols: string[], key: string) {
  const url = new URL("/v3/snapshot", origin);
  url.search = new URLSearchParams({
    "ticker.any_of": symbols.map(vendorSymbol).join(","),
    limit: String(symbols.length),
  }).toString();
  const { results } = await get(url, key);
  return symbols.map((symbol) => {
    const row = results.find((r: any) => r.ticker === vendorSymbol(symbol));
    const t = row?.last_trade, s = row?.session;
    if (t?.timeframe !== "REAL-TIME" || !(t.price > 0) || !t.last_updated || !s) {
      throw new Error("Real-time entitlement unavailable");
    }
    return {
      symbol,
      ok: true,
      timestamp: iso(t.last_updated),
      price: t.price,
      change: s.change ?? 0,
      changePct: s.change_percent ?? 0,
      open: s.open ?? 0,
      high: s.high ?? 0,
      low: s.low ?? 0,
      prevClose: s.previous_close ?? 0,
      close: s.close ?? 0,
      volume: s.volume ?? 0,
      iv30: 0,
      iv30Change: 0,
      lastTrade: iso(t.last_updated),
      iv30Available: false,
      delay: 0,
      source: "Massive",
    };
  });
}
export async function minuteBars(quote: Awaited<ReturnType<typeof quotes>>[number], key: string) {
  const day = clock(Date.parse(quote.lastTrade)).day;
  const url = new URL(
    "/v2/aggs/ticker/" + encodeURIComponent(vendorSymbol(quote.symbol)) + "/range/1/minute/" + day + "/" +
      day,
    origin,
  );
  url.search = "adjusted=true&sort=asc&limit=50000";
  const { results } = await get(url, key);
  const bars = results.map((b: any) => [clock(b.t).minute, b.o, b.h, b.l, b.c, b.v ?? 0, 0, 0]);
  return {
    session: day,
    bars,
    timestamp: new Date(results[results.length - 1].t).toISOString(),
    optionVolumeAvailable: false,
    delay: 0,
    source: "Massive",
  };
}
export async function optionsRaw(
  symbol: string,
  key: string,
  quote: Awaited<ReturnType<typeof quotes>>[number],
) {
  let url: URL | null = new URL("/v3/snapshot/options/" + encodeURIComponent(vendorSymbol(symbol)), origin);
  url.search = "limit=250";
  const deadline = AbortSignal.timeout(22_000), seen = new Set<string>(), options: any[] = [];
  let hasQuotes = false;
  while (url) {
    if (seen.has(url.href) || seen.size >= 100 || !url.pathname.startsWith("/v3/snapshot/options/")) {
      throw new Error("Incomplete option chain");
    }
    seen.add(url.href);
    const page = await get(url, key, deadline);
    for (const opt of page.results) {
      const q = opt.last_quote, t = opt.last_trade;
      if ((q && q.timeframe !== "REAL-TIME") || (t && t.timeframe !== "REAL-TIME")) {
        throw new Error("Delayed derivatives");
      }
      hasQuotes ||= !!q;
      if (opt.details?.shares_per_contract !== 100 || !opt.details?.ticker) continue;
      options.push({
        option: opt.details.ticker.replace(/^O:/, ""),
        bid: q?.bid,
        ask: q?.ask,
        last_trade_price: t?.price ?? opt.day?.close,
        volume: opt.day?.volume,
        open_interest: opt.open_interest,
        iv: opt.implied_volatility,
        ...opt.greeks,
      });
    }
    url = page.next_url ? new URL(page.next_url, origin) : null;
  }
  if (!hasQuotes || !options.length) throw new Error("Option quote entitlement unavailable");
  return {
    timestamp: quote.timestamp,
    data: {
      current_price: quote.price,
      prev_day_close: quote.prevClose,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
      price_change: quote.change,
      price_change_percent: quote.changePct,
      options,
    },
  };
}
