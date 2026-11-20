// Thinking an idea through with the trader, and answering when there is no app on screen.
//   - The idea they last asked about is kept (one row per account): their words, the parsed idea, the numbers the
//     command center worked out, and her verdict. A later question about it is answered by the stronger model with
//     all of that in front of it, so "why amber?", "what if I go out a week?" or "where does it break even?" can be
//     reasoned, not guessed.
//   - A question that arrives with no context (Siri on a locked phone) gets what the server can see for itself:
//     the clock, and live prices for the tickers in the question.
import { db } from "../_shared/db.ts";

export type LastIdea = { at: string; talked_at: string | null; question: string; idea: unknown; numbers: string; verdict: unknown };
export const KEEP_MS = 8 * 3600_000;   // an idea is something to come back to for the rest of the session, not tomorrow
export const FRESH_MS = 30 * 60_000;   // this soon after it (or after the last question about it) the next question is taken to be about it

// ---- the stored idea
export async function saveIdea(user: string, question: unknown, idea: unknown, numbers: string, now = Date.now()) {
  const at = new Date(now).toISOString();
  await db("indai_last_idea", { on_conflict: "user_id" }, {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: user, at, talked_at: null, question: String(question ?? "").slice(0, 600), idea: small(idea, 2000), numbers: numbers.slice(0, 24000), verdict: null }),
  });
  return at;
}
// Her verdict goes onto the idea it was given for, and onto no other (a newer idea may have arrived meanwhile).
export async function saveVerdict(user: string, at: string, verdict: unknown) {
  await db("indai_last_idea", { user_id: "eq." + user, at: "eq." + at }, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ verdict: small(verdict, 6000) }) });
}
export async function lastIdea(user: string, now = Date.now()): Promise<LastIdea | null> {
  const [row] = await db("indai_last_idea", { user_id: "eq." + user, at: "gte." + new Date(now - KEEP_MS).toISOString(), select: "at,talked_at,question,idea,numbers,verdict", limit: "1" });
  return row ?? null;
}
export async function markTalked(user: string, at: string, now = Date.now()) {
  await db("indai_last_idea", { user_id: "eq." + user, at: "eq." + at }, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ talked_at: new Date(now).toISOString() }) });
}
// Something to store as JSON, or nothing when it is too big to be what it claims to be.
function small(value: unknown, max: number) {
  if (value == null || typeof value !== "object") return null;
  try { return JSON.stringify(value).length <= max ? value : null; } catch { return null; }
}

// ---- is this question about the idea?
// Words that point at an idea once it is no longer fresh. Everyday words (why, should, think) are left out on purpose:
// an unrelated question keeps the quick model.
const IDEA_WORDS = /\b(idea|trade|setup|set up|verdict|rating|rated?|what if|risk|risky|stop|target|strikes?|expir\w*|theta|delta|gamma|vega|premium|contracts?|break ?even|odds|chance|probab\w*|size|sizing|scale|exit|hold|roll|hedge|calls?|puts?|green|amber|red|worth it|make sense)\b/i;
export function symbolOf(idea: unknown): string {
  const s = (idea as any)?.sym ?? (idea as any)?.symbol ?? "";
  return typeof s === "string" && /^[A-Za-z.]{1,6}$/.test(s) ? s.toUpperCase() : "";
}
export function aboutIdea(question: string, idea: LastIdea | null, now = Date.now()): boolean {
  if (!idea) return false;
  const last = Math.max(Date.parse(idea.at), idea.talked_at ? Date.parse(idea.talked_at) : 0);
  if (!(now - Date.parse(idea.at) < KEEP_MS)) return false;
  if (now - last < FRESH_MS) return true;
  const sym = symbolOf(idea.idea);
  return IDEA_WORDS.test(question) || (!!sym && new RegExp("\\b" + sym.replace(".", "\\.") + "\\b", "i").test(question));
}
// What she is told about the idea, and how to talk about it.
export const IDEA_TALK = `
- The trader may want to think an idea through with you. "idea_under_discussion" holds the idea they last asked about, the numbers the command center worked out for it at the time, and your verdict if you gave one. When their question is about it, reason with them like a sharp colleague: answer what they asked first; use those numbers and do the arithmetic out loud in plain words (break-even, how far price has to move and by when, what a different strike or expiry changes, what the stop costs in dollars); say what would change your read and what you cannot know. If the live context shows the price has moved since, say what that does to the idea. You may disagree with your earlier verdict: say so and why. Ask one short question back when their answer would change yours.
- For a question like that "spoken" may run to five sentences, and the figures go in "summary". You still never tell them to buy or sell: you give your honest read and they decide.`;
export function ideaBrief(idea: LastIdea, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(idea.at)) / 60_000));
  const verdict = idea.verdict ? JSON.stringify(idea.verdict).slice(0, 5000) : '"none: the research did not finish, so only the numbers below stand"';
  return `\nidea_under_discussion = asked ${mins} minute${mins === 1 ? "" : "s"} ago; their words: ${JSON.stringify(idea.question)}; parsed: ${JSON.stringify(idea.idea ?? {}).slice(0, 1500)}\nyour_verdict_then = ${verdict}\nnumbers_then = ${idea.numbers.slice(0, 12000)}`;
}

// ---- with no app on screen: what the server can see for itself
const NAMES: Record<string, string> = {
  spy: "SPY", spiders: "SPY", "s and p": "SPX", "s&p": "SPX", spx: "SPX", qqq: "QQQ", "triple q": "QQQ", "the q's": "QQQ", "the qs": "QQQ", nasdaq: "QQQ", russell: "IWM", iwm: "IWM",
  tesla: "TSLA", nvidia: "NVDA", apple: "AAPL", amazon: "AMZN", microsoft: "MSFT", meta: "META", facebook: "META", google: "GOOGL", alphabet: "GOOGL", netflix: "NFLX", amd: "AMD", palantir: "PLTR", vix: "VIX",
};
const NOT_TICKERS = new Set(["I", "A", "AM", "PM", "ET", "OK", "US", "USA", "CEO", "CPI", "PPI", "FOMC", "FED", "GDP", "AI", "IV", "DTE", "ATM", "OTM", "ITM", "GEX", "RSI", "MACD", "VWAP", "EMA", "INDAI", "SIRI", "HEY", "THE", "AND", "FOR", "ARE", "IS", "IT", "TO", "ON", "AT", "IN", "OF", "MY", "ME", "DO", "UP", "IF", "OR", "SO", "NO", "GO", "BE", "CALL", "CALLS", "PUT", "PUTS", "BUY", "SELL", "STOP", "WHAT", "WHY", "HOW", "WHEN", "NOW"]);
// The tickers a spoken question is about: company and index names, and words written as tickers. Three market
// tickers always come along so she can speak to the day.
export function tickersIn(question: string, also: string[] = []): string[] {
  const out: string[] = [], add = (s: string) => { if (s && !out.includes(s) && out.length < 8) out.push(s); };
  const low = " " + question.toLowerCase().replace(/[^a-z0-9&' ]+/g, " ") + " ";
  for (const [name, sym] of Object.entries(NAMES)) if (low.includes(" " + name + " ") || low.includes(" " + name + "'s ")) add(sym);
  for (const w of question.match(/\b[A-Z]{2,5}\b/g) ?? []) if (!NOT_TICKERS.has(w)) add(w);
  for (const s of also) add(s);
  for (const s of ["SPY", "QQQ", "IWM"]) add(s);
  return out;
}
// What the clock says about the market in New York. Holidays are not known here, and she is told so.
export function marketClock(now = Date.now()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  const mins = Number(p.hour) * 60 + Number(p.minute);
  if (p.weekday === "Sat" || p.weekday === "Sun") return "closed (weekend)";
  return mins < 240 ? "closed (overnight)" : mins < 570 ? "pre-market" : mins < 960 ? "regular session open" : mins < 1200 ? "after hours" : "closed (overnight)";
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
// Live prices from INDAI's own price service, asked as the same person who asked the question.
export async function serverContext(req: Request, question: string, idea: LastIdea | null, io: { fetch?: Fetch; env?: (name: string) => string | undefined; now?: number } = {}) {
  const env = io.env ?? ((n: string) => Deno.env.get(n)), f: Fetch = io.fetch ?? ((u, i) => fetch(u, i)), now = io.now ?? Date.now();
  const context: Record<string, unknown> = { market: marketClock(now) + " by the clock (holidays are not known to you)", screen: "none: the trader is talking to you without the app open" };
  const base = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY") ?? "";
  if (!base) return context;
  const symbols = tickersIn(question, idea ? [symbolOf(idea.idea)] : []);
  try {
    const own = req.headers.get("authorization"), pass = req.headers.get("x-indai-pass");
    const r = await f(new URL("/functions/v1/indai-market?kind=snapshot&symbols=" + symbols.join(","), base).href, {
      headers: { apikey: anon, Authorization: own && !pass ? own : "Bearer " + anon, ...(pass ? { "x-indai-pass": pass } : {}) }, signal: AbortSignal.timeout(5000),
    });
    const j = r.ok ? await r.json() : null, prices: Record<string, unknown> = {};
    for (const q of Array.isArray(j?.quotes) ? j.quotes : []) {
      if (!q?.ok || !(q.price > 0)) continue;
      const pct = q.prevClose > 0 ? Math.round((q.price / q.prevClose - 1) * 10000) / 100 : null;
      prices[q.symbol] = { price: q.price, pct, high: q.high ?? null, low: q.low ?? null, prevClose: q.prevClose ?? null };
    }
    if (Object.keys(prices).length) { context.prices = prices; context.dataNote = j.delay > 0 ? `Prices are delayed about ${Math.round(j.delay / 60)} minutes.` : "Prices are live" + (j.source ? " (" + j.source + ")." : "."); }
    else context.dataNote = "No prices could be read just now.";
  } catch { context.dataNote = "No prices could be read just now."; }
  return context;
}
// A reply for something that only speaks: her words and nothing else.
export const SPOKEN_ONLY = `
- This reply will be read aloud by the phone with no screen to look at: put everything worth saying into "spoken" (up to five sentences, figures said the way a person says them), leave "summary" empty and give no "command".`;
