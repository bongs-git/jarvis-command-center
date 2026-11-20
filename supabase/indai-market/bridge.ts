// When CBOE refuses a request, answer from the one-minute candles the TradingView bridge has stored
// (public.indai_tv_bars). Same shapes as the CBOE answers, marked with their own source and delay.
// The bridge carries prices and candles only: there is no option chain here.
import { db } from "../_shared/db.ts";

export type BridgeBar = { t: number; o: number; h: number; l: number; c: number; v: number };
export const BRIDGE = "TradingView bridge";
const OPEN = 570, CLOSE = 960; // 9:30 and 16:00 in minutes after midnight, New York

const ny = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
// New York's offset from UTC, worked out once per hour (it only ever changes on the hour).
const offsets = new Map<number, number>();
function offset(ms: number) {
  const hour = Math.floor(ms / 3600000);
  let off = offsets.get(hour);
  if (off === undefined) {
    const p = Object.fromEntries(ny.formatToParts(hour * 3600000).map((x) => [x.type, x.value]));
    off = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - hour * 3600000;
    if (offsets.size > 500) offsets.clear();
    offsets.set(hour, off);
  }
  return off;
}
export function clock(ms: number) {
  const local = new Date(ms + offset(ms));
  return {
    day: local.toISOString().slice(0, 10),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    weekend: local.getUTCDay() === 0 || local.getUTCDay() === 6,
  };
}
const regular = (b: BridgeBar) => {
  const m = clock(b.t).minute;
  return m >= OPEN && m < CLOSE;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

// Sorts stored candles into New York days. `latest` is the newest day with any candle, `session` the newest day
// with at least one regular-hours candle (before the open that is still the previous trading day).
export function days(rows: BridgeBar[]) {
  const clean = rows
    .map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v) || 0 }))
    .filter((b) => Number.isFinite(b.t) && b.t % 60000 === 0 && b.c > 0 && b.o > 0 && b.h > 0 && b.l > 0)
    .sort((a, b) => a.t - b.t);
  const byDay = new Map<string, BridgeBar[]>();
  for (const b of clean) {
    const day = clock(b.t).day;
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const order = [...byDay.keys()].sort();
  const latest = order[order.length - 1] ?? null;
  const session = [...order].reverse().find((d) => byDay.get(d)!.some(regular)) ?? null;
  return { byDay, order, latest, session, newest: clean[clean.length - 1] ?? null };
}

// One-minute regular-hours candles of the newest session, in the shape of the CBOE bars answer. The minute is the
// one the candle ends in, as CBOE gives it. Extended-hours candles reach the apps through indai-tv instead.
export function bridgeBars(rows: BridgeBar[]) {
  const d = days(rows);
  if (!d.session) return null;
  const list = d.byDay.get(d.session)!.filter(regular);
  return {
    session: d.session,
    bars: list.map((b) => [clock(b.t).minute + 1, b.o, b.h, b.l, b.c, b.v, 0, 0]),
    timestamp: new Date(list[list.length - 1].t + 60000).toISOString(),
    optionVolumeAvailable: false,
    delay: 0,
    source: BRIDGE,
  };
}

// A quote in the shape of the CBOE snapshot entry. `price` is the newest candle's close (extended hours included),
// `close` the last regular-hours close, and the day's open, high and low come from regular hours of the newest day.
// During regular trading a quote is only given while the bridge is current, so an old candle is never shown as live.
export function bridgeQuote(symbol: string, rows: BridgeBar[], prevClose: number, now: number) {
  const d = days(rows);
  if (!d.newest || !d.latest) return null;
  const at = clock(now);
  const trading = !at.weekend && at.minute >= OPEN && at.minute < CLOSE;
  if (trading && now - (d.newest.t + 60000) > 10 * 60000) return null;
  const today = d.byDay.get(d.latest)!.filter(regular);
  // The day's open, high and low are only known when the bridge was running from the opening minute.
  const whole = today.length > 0 && clock(today[0].t).minute === OPEN;
  const sessionBars = d.session ? d.byDay.get(d.session)!.filter(regular) : [];
  const close = sessionBars.length ? sessionBars[sessionBars.length - 1].c : 0;
  // Before the open the newest regular close is the previous day's close.
  const prev = d.session && d.session !== d.latest ? close : prevClose > 0 ? prevClose : 0;
  const price = d.newest.c;
  const stamp = new Date(d.newest.t + 60000).toISOString();
  return {
    symbol,
    ok: true,
    timestamp: stamp,
    price,
    change: prev > 0 ? r2(price - prev) : 0,
    changePct: prev > 0 ? r4((price - prev) / prev * 100) : 0,
    open: whole ? today[0].o : 0,
    high: whole ? Math.max(...today.map((b) => b.h)) : 0,
    low: whole ? Math.min(...today.map((b) => b.l)) : 0,
    prevClose: prev,
    close,
    volume: whole ? today.reduce((sum, b) => sum + b.v, 0) : 0,
    iv30: 0,
    lastTrade: stamp,
    iv30Available: false,
    delay: 0,
    source: BRIDGE,
  };
}

const select = "t,o,h,l,c,v";
// The newest stored candles for a ticker: enough for the latest day and, before the open, the day before.
export const bridgeRows = (symbol: string): Promise<BridgeBar[]> =>
  db("indai_tv_bars", { ticker: "eq." + symbol, tf: "eq.1", order: "t.desc", limit: "1000", select });

// The regular-hours close of the day before `latest`, taken from that day's final minutes, or 0 when the stored
// candles do not reach it (the bridge was off, or stopped before the close).
export function closeBefore(rows: BridgeBar[], latest: string) {
  const d = days(rows);
  const day = [...d.order].reverse().find((x) => x < latest);
  if (!day) return 0;
  const reg = d.byDay.get(day)!.filter(regular);
  return reg.length && clock(reg[reg.length - 1].t).minute >= CLOSE - 5 ? reg[reg.length - 1].c : 0;
}
export async function bridgePrevClose(symbol: string, rows: BridgeBar[]) {
  const d = days(rows);
  if (!d.latest) return 0;
  const known = closeBefore(rows, d.latest);
  if (known) return known;
  const first = d.byDay.get(d.latest)![0].t;
  const older: BridgeBar[] = await db("indai_tv_bars", {
    ticker: "eq." + symbol,
    tf: "eq.1",
    t: "lt." + first,
    order: "t.desc",
    limit: "400",
    select,
  });
  return closeBefore(older, d.latest);
}
