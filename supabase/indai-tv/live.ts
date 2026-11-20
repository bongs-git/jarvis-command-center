// The candle that is still forming. Between candle closes the bridge sends the current one-minute candle a few
// times a minute ({"kind":"live", ...}); it is kept in indai_tv_live, one row per ticker, apart from the finished
// candles in indai_tv_bars. The apps read both with one request and say what they have already seen.

// How long a forming candle is worth showing. After that the apps are better served by the last finished one.
export const LIVE_FOR = 90_000;
// The cursor never comes closer to the present than this, so a write that lands a moment late is still picked up.
// The price is that a row can be sent twice while it is this young; the apps skip what they already have.
const SETTLE = 1500;

export type LiveRow = { ticker: string; t: number; o: number | null; h: number | null; l: number | null; c: number; v: number | null; received_at: string };

// The forming candles in a bridge message that are worth keeping: one-minute candles of the minute now running
// (or just ended), with a price. `clean` and `num` are the webhook's own ticker and number readers.
export function liveRows(
  list: unknown[],
  tf: unknown,
  now: number,
  clean: (t: unknown) => string | null,
  num: (v: unknown) => number | null,
): LiveRow[] {
  if (String(tf ?? "1") !== "1") return [];
  const received_at = new Date(now).toISOString(), out: LiveRow[] = [];
  for (const b of list) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    const ticker = clean(r.s ?? r.ticker ?? r.symbol), t = Math.round(Number(r.t)), c = num(r.c);
    if (!ticker || !Number.isFinite(t) || t % 60_000 !== 0 || c == null || !(c > 0)) continue;
    if (now - t < -5000 || now - t > 150_000) continue; // not the candle that is forming now
    out.push({ ticker, t, o: num(r.o), h: num(r.h), l: num(r.l), c, v: num(r.v), received_at });
  }
  return out;
}

// `seen` is the cursor an app got with its last answer. Returns the time to read from, or null when there is no
// usable cursor and the app should get everything in the window.
export function seenAfter(seen: string | null, now: number): string | null {
  if (!seen) return null;
  const at = Date.parse(seen);
  if (!Number.isFinite(at) || at > now + 5000 || at < now - 3 * 3600e3) return null;
  return new Date(at).toISOString();
}

// The cursor for the next request: the newest time anything in this answer was stored, held a moment short of
// now, and never earlier than the cursor the app came with.
export function cursorOf(seen: string | null, now: number, ...lists: { received_at?: string }[][]): string | null {
  const came = seenAfter(seen, now) ? Date.parse(seen as string) : 0;
  let max = 0;
  for (const list of lists) for (const row of list) { const at = Date.parse(String(row?.received_at ?? "")); if (at > max) max = at; }
  const next = Math.max(came, Math.min(max, now - SETTLE));
  return next ? new Date(next).toISOString() : null;
}
