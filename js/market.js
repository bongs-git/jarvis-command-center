// US equity market clock (Eastern Time), holidays, and indicator math.

const TZ = 'America/New_York';
const fmtParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etParts(ms = Date.now()) {
  const o = {};
  for (const p of fmtParts.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second,
    dow: DOW[o.weekday], ymd: `${o.year}-${o.month}-${o.day}`,
  };
}

// Convert an Eastern wall-clock time to a UTC timestamp (ms).
export function etToMs(y, m, d, h = 0, mi = 0, s = 0) {
  let guess = Date.UTC(y, m - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const p = etParts(guess);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    guess += Date.UTC(y, m - 1, d, h, mi, s) - asUtc;
  }
  return guess;
}

// NYSE full-day closures and 1:00 PM early closes (2026–2027).
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'MLK Day', '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving', '2026-12-25': 'Christmas',
  '2027-01-01': "New Year's Day", '2027-01-18': 'MLK Day', '2027-02-15': "Presidents' Day",
  '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving', '2027-12-24': 'Christmas (observed)',
};
export const EARLY_CLOSE = { '2026-11-27': 'Day after Thanksgiving', '2026-12-24': 'Christmas Eve', '2027-11-26': 'Day after Thanksgiving' };

function ymdOf(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

export function isTradingDay(y, m, d) {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !HOLIDAYS[ymdOf(y, m, d)];
}

export function sessionTimes(y, m, d) {
  const ymd = ymdOf(y, m, d);
  const closeH = EARLY_CLOSE[ymd] ? 13 : 16;
  return {
    ymd,
    pre: etToMs(y, m, d, 4, 0), open: etToMs(y, m, d, 9, 30), close: etToMs(y, m, d, closeH, 0),
    post: etToMs(y, m, d, 20, 0), early: !!EARLY_CLOSE[ymd],
  };
}

function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

export function prevTradingDay(y, m, d) {
  let [a, b, c] = addDays(y, m, d, -1);
  for (let i = 0; i < 10 && !isTradingDay(a, b, c); i++) [a, b, c] = addDays(a, b, c, -1);
  return [a, b, c];
}
export function nextTradingDay(y, m, d) {
  let [a, b, c] = addDays(y, m, d, 1);
  for (let i = 0; i < 10 && !isTradingDay(a, b, c); i++) [a, b, c] = addDays(a, b, c, 1);
  return [a, b, c];
}

// The session the chart should show: today's if it has started, else the last completed one.
export function chartSession(now = Date.now()) {
  const p = etParts(now);
  if (isTradingDay(p.y, p.m, p.d)) {
    const s = sessionTimes(p.y, p.m, p.d);
    if (now >= s.open) return s;
  }
  const [a, b, c] = prevTradingDay(p.y, p.m, p.d);
  return sessionTimes(a, b, c);
}

export function marketStatus(now = Date.now()) {
  const p = etParts(now);
  const today = isTradingDay(p.y, p.m, p.d) ? sessionTimes(p.y, p.m, p.d) : null;
  const holiday = HOLIDAYS[p.ymd];
  let state, label, nextEvent, nextAt;
  if (today && now >= today.open && now < today.close) {
    state = 'open'; label = today.early ? 'MARKET OPEN · EARLY CLOSE 1:00 PM' : 'MARKET OPEN';
    nextEvent = 'close'; nextAt = today.close;
  } else if (today && now >= today.pre && now < today.open) {
    state = 'pre'; label = 'PRE-MARKET'; nextEvent = 'open'; nextAt = today.open;
  } else if (today && now >= today.close && now < today.post) {
    state = 'post'; label = 'AFTER HOURS'; nextEvent = 'next open';
    const [a, b, c] = nextTradingDay(p.y, p.m, p.d); nextAt = sessionTimes(a, b, c).open;
  } else {
    state = 'closed'; label = holiday ? `CLOSED · ${holiday.toUpperCase()}` : 'MARKET CLOSED';
    let target;
    if (today && now < today.pre) target = today;
    else { const [a, b, c] = nextTradingDay(p.y, p.m, p.d); target = sessionTimes(a, b, c); }
    nextEvent = 'open'; nextAt = target.open;
  }
  // Upcoming closures in the next 10 days (useful for 0DTE planning).
  const upcoming = [];
  let [a, b, c] = [p.y, p.m, p.d];
  for (let i = 0; i < 10; i++) {
    [a, b, c] = addDays(a, b, c, 1);
    const k = ymdOf(a, b, c);
    if (HOLIDAYS[k]) upcoming.push({ date: k, text: `Closed ${HOLIDAYS[k]}` });
    if (EARLY_CLOSE[k]) upcoming.push({ date: k, text: `1:00 PM close (${EARLY_CLOSE[k]})` });
  }
  return { state, label, nextEvent, nextAt, msToNext: nextAt - now, upcoming, et: p };
}

export function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s % 60}s`;
}

export function fmtClock(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
}
export function fmtHM(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

// ---- indicators ----
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out[i] = i >= Math.min(period - 1, values.length - 1) ? prev : null;
  }
  return out;
}

export function vwap(bars) {
  let pv = 0, vol = 0;
  return bars.map(b => {
    const tp = (b.h + b.l + b.c) / 3;
    const v = b.v > 0 ? b.v : 1;
    pv += tp * v; vol += v;
    return pv / vol;
  });
}

export const INTERVAL_MS = { '1min': 60e3, '5min': 300e3, '15min': 900e3 };
export const INTERVAL_LABEL = { '1min': '1m', '5min': '5m', '15min': '15m' };

export function aggregate(bars, intervalMs) {
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.t / intervalMs) * intervalMs;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v;
    } else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  }
  return out;
}
