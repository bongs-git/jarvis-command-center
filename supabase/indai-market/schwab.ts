// Schwab as the owner's market data: quotes, one-minute and daily candles, and option chains, in the shapes the
// rest of this function already works with. Used only for the owner (index.ts decides); see _shared/schwab.ts.
import { MARKET } from "../_shared/schwab.ts";

export const SCHWAB = "Schwab";
const INDEX = new Set(["SPX", "NDX", "RUT", "VIX", "XSP", "DJX", "OEX"]);
const theirs = (symbol: string) => (INDEX.has(symbol) ? "$" + symbol : symbol);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v !== -999 ? v : 0);   // Schwab writes -999 for "not available"
const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function clock(ms: number) {
  const p = Object.fromEntries(ny.formatToParts(ms).map((x) => [x.type, x.value]));
  return { day: p.year + "-" + p.month + "-" + p.day, minute: Number(p.hour) * 60 + Number(p.minute) };
}
const iso = (ms: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);

async function get(path: string, query: Record<string, string>, token: string, timeout = 8000) {
  const r = await fetch(MARKET + path + "?" + new URLSearchParams(query), { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error("Schwab " + r.status + " for " + path);
  return await r.json();
}

// ---- quotes
// deno-lint-ignore no-explicit-any
export function quoteFrom(symbol: string, row: any) {
  const q = row?.quote ?? {}, price = n(q.lastPrice) || n(q.mark) || n(q.closePrice);
  if (!(price > 0)) throw new Error("Schwab has no quote for " + symbol);
  const at = iso(q.tradeTime) ?? iso(q.quoteTime) ?? new Date().toISOString(), live = row.realtime === true;
  return {
    symbol, ok: true, timestamp: at, price, change: n(q.netChange), changePct: n(q.netPercentChange), open: n(q.openPrice), high: n(q.highPrice), low: n(q.lowPrice),
    prevClose: n(q.closePrice), close: price, volume: n(q.totalVolume), iv30: 0, iv30Change: 0, lastTrade: at, iv30Available: false,
    delay: live ? 0 : 900, source: SCHWAB,
  };
}
export async function schwabQuotes(symbols: string[], token: string) {
  const body = await get("/quotes", { symbols: symbols.map(theirs).join(","), fields: "quote", indicative: "false" }, token);
  return symbols.map((s) => { try { return quoteFrom(s, body?.[theirs(s)]); } catch (e) { return { symbol: s, ok: false as const, error: String((e as Error).message) }; } });
}

// ---- candles
// deno-lint-ignore no-explicit-any
const candles = (body: any): any[] => (Array.isArray(body?.candles) ? body.candles : []).filter((c: any) => c && n(c.close) > 0 && n(c.datetime) > 0);
// deno-lint-ignore no-explicit-any
export function minutesFrom(body: any, live: boolean) {
  const rows = candles(body);
  if (!rows.length) throw new Error("Schwab has no candles");
  const day = clock(rows[rows.length - 1].datetime).day;
  const bars = rows.filter((c) => clock(c.datetime).day === day).map((c) => [clock(c.datetime).minute, n(c.open), n(c.high), n(c.low), n(c.close), n(c.volume), 0, 0]);
  return { session: day, bars, timestamp: new Date(rows[rows.length - 1].datetime).toISOString(), optionVolumeAvailable: false, delay: live ? 0 : 900, source: SCHWAB };
}
export async function schwabMinutes(symbol: string, token: string, live: boolean) {
  // Without an end date Schwab answers with the last finished session; with "now" it answers with today's, up to this minute.
  return minutesFrom(await get("/pricehistory", { symbol: theirs(symbol), periodType: "day", period: "1", frequencyType: "minute", frequency: "1", endDate: String(Date.now()), needExtendedHoursData: "false", needPreviousClose: "false" }, token), live);
}
// deno-lint-ignore no-explicit-any
export const dailyFrom = (body: any, days: number) => candles(body).slice(-days).map((c) => [clock(c.datetime).day, n(c.open), n(c.high), n(c.low), n(c.close), n(c.volume)]);
export async function schwabDaily(symbol: string, days: number, token: string) {
  const years = [1, 2, 3, 5, 10, 15, 20].find((y) => y * 250 >= days) ?? 20;
  const rows = dailyFrom(await get("/pricehistory", { symbol: theirs(symbol), periodType: "year", period: String(years), frequencyType: "daily", frequency: "1", endDate: String(Date.now()), needPreviousClose: "false" }, token, 15_000), days);
  if (!rows.length) throw new Error("Schwab has no daily candles");
  return rows;
}

// ---- option chains
// One contract, as the chain reader in index.ts expects it. Adjusted and odd-lot contracts are left out.
// deno-lint-ignore no-explicit-any
function contract(c: any) {
  const name = String(c?.symbol ?? "").replace(/\s+/g, "");
  if (!name || (c.multiplier != null && c.multiplier !== 100) || c.nonStandard === true || c.mini === true) return null;
  return {
    option: name, bid: n(c.bid ?? c.bidPrice), ask: n(c.ask ?? c.askPrice), last_trade_price: n(c.last ?? c.lastPrice), volume: n(c.totalVolume),
    open_interest: n(c.openInterest), iv: n(c.volatility), delta: n(c.delta), gamma: n(c.gamma), theta: n(c.theta), vega: n(c.vega),
  };
}
// deno-lint-ignore no-explicit-any
export function chainFrom(bodies: any[], quote: { timestamp: string; price: number; prevClose: number; open: number; high: number; low: number; close: number; volume: number; change: number; changePct: number }) {
  const seen = new Map<string, NonNullable<ReturnType<typeof contract>>>();
  for (const body of bodies) {
    for (const side of [body?.callExpDateMap, body?.putExpDateMap]) {
      for (const strikes of Object.values(side ?? {})) {
        for (const at of Object.values(strikes ?? {})) for (const c of Array.isArray(at) ? at : [at]) { const o = contract(c); if (o) seen.set(o.option, o); }
      }
    }
  }
  const options = [...seen.values()];
  if (!options.length) throw new Error("Schwab sent an empty option chain");
  // Schwab gives implied volatility in percent (23.4); the reader wants a fraction (0.234). Told apart by the middle value.
  const ivs = options.map((o) => o.iv).filter((v) => v > 0).sort((a, b) => a - b);
  if (ivs.length && ivs[Math.floor(ivs.length / 2)] > 3) for (const o of options) o.iv = o.iv / 100;
  const spot = n(bodies.find((b) => n(b?.underlyingPrice) > 0)?.underlyingPrice) || quote.price;
  return {
    timestamp: quote.timestamp,
    data: { current_price: spot, prev_day_close: quote.prevClose, open: quote.open, high: quote.high, low: quote.low, close: quote.close, volume: quote.volume, price_change: quote.change, price_change_percent: quote.changePct, options },
  };
}
// Schwab cannot send a big chain whole, so the request names its days and how many strikes around the price.
// `upTo` reaches a later expiry when the app asks for one. If the whole stretch is refused it is asked in four parts.
export function chainAsks(today: string, upTo: string | null, strikes = 120) {
  const day = (d: number) => new Date(Date.parse(today + "T12:00:00Z") + d * 86400_000).toISOString().slice(0, 10);
  const last = upTo && upTo > day(46) ? upTo : day(46);
  const ask = (from: string, to: string) => ({ contractType: "ALL", strategy: "SINGLE", includeUnderlyingQuote: "true", strikeCount: String(strikes), fromDate: from, toDate: to });
  return { whole: [ask(today, last)], parts: [ask(today, day(3)), ask(day(4), day(10)), ask(day(11), day(24)), ask(day(25), last)] };
}
export async function schwabChain(symbol: string, token: string, quote: Parameters<typeof chainFrom>[1], upTo: string | null) {
  const asks = chainAsks(clock(Date.now()).day, upTo);
  const run = (list: Record<string, string>[]) => Promise.all(list.map((q) => get("/chains", { symbol: theirs(symbol), ...q }, token, 20_000)));
  let bodies: unknown[];
  try { bodies = await run(asks.whole); } catch { bodies = await run(asks.parts); }
  return chainFrom(bodies, quote);
}
