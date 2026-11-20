// The Market Pattern Atlas, answered without a model call: POST indai-brain {mode:"atlas", op:...}.
// The knowledge base is the owner's private data. It is read from the table indai_atlas once per cold start and
// only ever leaves here as the engine's answer to one question: a rule, a cell, a read. Never the whole of it.
//   op "lookup"   one rule's numbers, with its trend/volatility cell when both bins are given
//   op "read"     the six-hat read with its red/amber/green light
//   op "combine"  several signals at once: overlapping names count once, an untested mix gets no number
//   op "scan"     the patterns the website found in a capture, one short read each
import "../_shared/atlas/indai_atlas_engine.js";
import { account } from "../_shared/auth.ts";
import { db, rpc } from "../_shared/db.ts";
import { HttpError, json } from "../_shared/http.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export const createAtlas = (globalThis as Any).createAtlas as (kb: unknown) => Any;

const TRENDS = ["above", "below"];
const VOLS: Record<string, string> = { low: "low", l: "low", mid: "mid", middle: "mid", m: "mid", high: "high", h: "high" };
const HORIZONS = [1, 5, 20];
const bad = (message: string) => new HttpError(400, "bad_request", message);
const text = (v: unknown, max: number) => typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const round = (v: unknown, places: number) => typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(places)) : null;

// The bins and horizon of a request. `strict` refuses a value that is not one of the atlas's; otherwise it is dropped.
function bins(b: Any, strict: boolean) {
  const t = typeof b.trend === "string" ? b.trend.toLowerCase().trim() : b.trend;
  const v = typeof b.vol === "string" ? VOLS[b.vol.toLowerCase().trim()] : b.vol;
  if (strict && b.trend != null && !TRENDS.includes(t)) throw bad("trend is above or below.");
  if (strict && b.vol != null && !v) throw bad("vol is low, mid or high.");
  const h = b.horizon == null ? 5 : Number(b.horizon);
  if (!HORIZONS.includes(h)) throw bad("horizon is 1, 5 or 20 sessions.");
  return { trend: TRENDS.includes(t) ? t as string : undefined, vol: typeof v === "string" ? v : undefined, horizon: h };
}
const number = (v: unknown, lo: number, hi: number, name: string) => {
  if (v == null) return undefined;
  const n = Number(v);
  if (typeof v === "boolean" || v === "" || !Number.isFinite(n) || n < lo || n > hi) throw bad(name + " is out of range.");
  return n;
};
function dailyBars(v: unknown) {
  if (v == null) return undefined;
  if (!Array.isArray(v) || v.length > 600) throw bad("bars is a list of at most 600 daily candles.");
  return v.map((b: Any) => {
    const bar = { O: Number(b?.O ?? b?.o), H: Number(b?.H ?? b?.h), L: Number(b?.L ?? b?.l), C: Number(b?.C ?? b?.c) };
    if (![bar.O, bar.H, bar.L, bar.C].every((x) => Number.isFinite(x) && x > 0)) throw bad("Each candle needs O, H, L and C.");
    return bar;
  });
}

// One pattern from a capture. Only a code that is exactly one of the tested rules gets numbers.
function scanOne(atlas: Any, p: Any, intraday: boolean) {
  const sent = typeof p?.code === "string" ? p.code.trim().slice(0, 30) : "";
  const code = sent.toUpperCase();
  const at = typeof p?.at === "string" && p.at.length <= 40 && Number.isFinite(Date.parse(p.at)) ? p.at : undefined;
  const out: Record<string, unknown> = { code: /^[A-Za-z0-9_]+$/.test(sent) ? sent : code.replace(/[^A-Z0-9_]/g, ""), at };
  if (!/^[A-Z0-9]+$/.test(code) || !Object.hasOwn(atlas.kb.rules, code)) {
    return { ...out, light: "NONE", line: "Not one of the patterns the atlas tested, so there is no number for it." };
  }
  const { trend, vol } = bins({ trend: p.trendBin, vol: p.volBin }, false);
  const L = atlas.lookup({ rule: code, trend, vol, horizon: 5 });
  const cell = L.cell?.later, useCell = !!(cell && cell.n > 0);
  const row = useCell ? cell : L.pooled.later;
  const sparse = !row || !(row.n >= 30);
  const light = sparse ? "GREY" : useCell ? L.cellGrade : L.grade;
  const why = !row || row.n === 0
    ? "No cases: there is nothing to estimate."
    : sparse ? `Too few cases to call it a rate (n=${row.n}).` : useCell ? L.cellGradeReason : L.gradeReason;
  const scope = useCell
    ? null
    : trend && vol ? `No cases in your bin (${trend}/${vol}), so this is the rule's overall row.` : "No trend and volatility bin was sent, so this is the rule's overall row.";
  const daily = intraday ? "Measured on daily stock candles: on this timeframe the logic carries over, the percentages do not." : null;
  return {
    ...out, name: L.name, side: L.side, light, win: round(row?.win, 4), base: round(row?.base, 4), n: row?.n ?? 0,
    lift: round(row?.lift, 4), net: round(row?.net, 5), horizon: 5, scope: useCell ? "cell" : "overall",
    cellKey: useCell ? L.cellKey : undefined, line: [why, scope, daily].filter(Boolean).join(" "),
  };
}

// The answer to one request, given the engine. No network and no clock: the checks call this directly.
export function atlasAnswer(atlas: Any, b: Any, version: string | null = null): Record<string, unknown> {
  if (b.op === "scan") {
    if (!Array.isArray(b.patterns) || !b.patterns.length || b.patterns.length > 40) throw bad("patterns is a list of 1 to 40 patterns.");
    return {
      reads: b.patterns.map((p: Any) => scanOne(atlas, p, b.intraday === true)),
      note: "Each read stands alone. Names that fire on the same candle count as one event, and the atlas has no number for a combination it did not test.",
      version,
    };
  }
  if (b.op === "combine") {
    const signals = Array.isArray(b.signals) ? b.signals.map((s: unknown) => text(s, 60)) : [];
    if (!signals.length || signals.length > 12 || signals.includes(null)) throw bad("signals is a list of 1 to 12 names.");
    return { result: atlas.combine(signals, bins(b, true)), version };
  }
  const rule = text(b.rule, 60);
  if (b.op !== "lookup" && b.op !== "read") throw bad("Choose lookup, read, combine or scan.");
  if (!rule) throw bad("Name a rule, for example hammer.");
  const at = bins(b, true);
  if (b.op === "lookup") return { result: atlas.lookup({ rule, ...at }), version };
  return {
    result: atlas.read({
      rule, ...at, bars: dailyBars(b.bars), vix: number(b.vix, 0, 200, "vix"), aaiiSpread: number(b.aaiiSpread, -100, 100, "aaiiSpread"),
      sequence: text(b.sequence, 60) ?? undefined, instrument: text(b.instrument, 40) ?? undefined,
      intraday: b.intraday === true, options: b.options === true,
    }),
    version,
  };
}

// The engine over the stored knowledge base: read once, kept for the life of this instance. A failed read is
// forgotten, so the next request tries again.
let ready: Promise<{ atlas: Any; version: string | null }> | null = null;
export function storedAtlas() {
  if (!ready) {
    const mine = ready = (async () => {
      const [row] = await db("indai_atlas", { key: "eq.kb", select: "value,version" });
      if (!row?.value?.rules) throw new HttpError(503, "atlas_unavailable", "The atlas has not been loaded.");
      return { atlas: createAtlas(row.value), version: row.version ?? null };
    })();
    mine.catch(() => { if (ready === mine) ready = null; });
  }
  return ready;
}

// Only the owner: his sign-in, or his passcode. Another signed-in account is refused.
export async function atlasMode(req: Request, body: Any) {
  const user = await account(req);
  const [owner] = await db("indai_owner", { select: "user_id", limit: "1" });
  if (!owner || owner.user_id !== user) throw new HttpError(403, "forbidden", "The atlas answers only its owner.");
  if (!await rpc("indai_take_request", { p_user: user, p_bucket: "atlas", p_limit: 600 })) {
    throw new HttpError(429, "rate_limited", "Hourly request limit reached. Try again later.");
  }
  const { atlas, version } = await storedAtlas();
  return json(atlasAnswer(atlas, body, version));
}
