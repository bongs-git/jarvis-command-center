import assert from "node:assert/strict";
import { HttpError } from "../_shared/http.ts";
import { atlasAnswer, atlasMode, createAtlas } from "../indai-brain/atlas.ts";

// mode "atlas" (supabase/indai-brain/atlas.ts). The knowledge base here is a stand-in with made-up numbers in the
// real layout: the owner's data is private and is never in this repository. Set ATLAS_KB=/path/atlas_kb.json to
// also check the book's published example against the real file.
const cell = (n: number, wins: number, base: number, net: number) =>
  n ? { n, wins, win: wins / n, base, net, lift: wins / n - base } : { n: 0, wins: 0, win: null, base: null, net: null, lift: null };
const BINS = ["above/low", "above/mid", "above/high", "below/low", "below/mid", "below/high"], HZ = ["1", "5", "20"];
function rule(code: string, name: string, side: string, grade: string, special: Record<string, ReturnType<typeof cell>> = {}) {
  const grid = (era: string) =>
    Object.fromEntries(BINS.map((b) => [b, Object.fromEntries(HZ.map((h) => [h, special[`${era}/${b}/${h}`] ?? cell(200, 104, 0.5, 0.001)]))]));
  const row = (era: string) => Object.fromEntries(HZ.map((h) => [h, { ...(special[`${era}/pooled/${h}`] ?? cell(1200, 636, 0.5, 0.002)), ci: null }]));
  return {
    code, name, kind: "candle", side, side_rule: "stand-in", long_short: [1, 0], grade, grade_reason: `${grade} for the stand-in ${name}.`,
    pooled: { early: row("early"), later: row("later") }, matrix: { early: grid("early"), later: grid("later") },
    read: "stand-in read", confirm_fail: "stand-in confirm and fail",
    cell_grades: Object.fromEntries(BINS.flatMap((b) => HZ.map((h) => [`${b}/${h}`, "AMBER"]))),
  };
}
const KB = {
  meta: { title: "stand-in", marker: "WHOLE-KB-MARKER" },
  rules: {
    CDLHAMMER: rule("CDLHAMMER", "Hammer", "long", "AMBER", {
      "later/below/high/5": cell(1000, 570, 0.54, 0.0012),   // beats its base later...
      "early/below/high/5": cell(900, 430, 0.5, -0.001),     // ...but not earlier: no tested edge
      "later/above/low/5": cell(12, 9, 0.5, 0.01),           // too few cases
      "later/above/mid/5": cell(0, 0, 0, 0),                 // no cases
    }),
    CDLDOJI: rule("CDLDOJI", "Doji", "long+short", "RED"),
    CDLLONGLEGGEDDOJI: rule("CDLLONGLEGGEDDOJI", "Long-legged doji", "long+short", "RED"),
    CDLTHIN: rule("CDLTHIN", "Thin rule", "long", "GREY", { "later/pooled/5": cell(9, 5, 0.5, 0.001) }),
  },
  brackets: [], direction_split: [], sentiment: [], macd: [], cross_market: [],
  charts: [{ name: "Double bottom", family: "reversal", bias: "bull", shape: "Two lows.", confirm: "Close above the middle peak.", fail: "Close below both lows.", measure: "Height added." }],
};
const atlas = createAtlas(KB);
const refused = (fn: () => unknown, status: number, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof HttpError && e.status === status && e.code === code);
const hammer = (extra: Record<string, unknown> = {}) => ({ code: "CDLHAMMER", name: "Hammer", at: "2026-11-19T19:30:00.000Z", side: "long", trendBin: "below", volBin: "high", confirm: 671.2, fail: 668.9, alsoFired: [], ...extra });
const scan = (patterns: unknown[], extra: Record<string, unknown> = {}) => atlasAnswer(atlas, { mode: "atlas", op: "scan", symbol: "SPY", timeframe: "15min", patterns, ...extra }, "stand-in") as any;

Deno.test("scan: a tested pattern gets its cell, rounded, with the engine's light", () => {
  const a = scan([hammer()], { intraday: true });
  const r = a.reads[0];
  assert.deepEqual([r.code, r.at, r.name, r.light, r.win, r.base, r.n, r.lift, r.net, r.horizon, r.scope, r.cellKey],
    ["CDLHAMMER", "2026-11-19T19:30:00.000Z", "Hammer", "RED", 0.57, 0.54, 1000, 0.03, 0.0012, 5, "cell", "below/high/5"]);
  assert.match(r.line, /^No tested edge: the early-era result went the other way\. Measured on daily stock candles/);
  assert.equal(a.version, "stand-in");
  assert.doesNotMatch(scan([hammer()]).reads[0].line, /daily stock candles/);   // only said on an intraday capture
});

Deno.test("scan: an untested or misspelt code gets no numbers", () => {
  for (const code of ["CDLUNKNOWN", "HAMMER", "hammer", "DOJI", "CDL", "", "constructor", "__proto__", "CDLHAMMER; drop"]) {
    const [r] = scan([hammer({ code })]).reads;
    assert.equal(r.light, "NONE", code);
    assert.deepEqual(Object.keys(r).filter((k) => r[k] !== undefined).sort(), ["at", "code", "light", "line"], code);
    assert.match(r.code, /^[A-Za-z0-9_]*$/);
  }
  assert.equal(scan([{ code: 7 }]).reads[0].light, "NONE");
  assert.equal(scan([null]).reads[0].light, "NONE");
  assert.equal(scan([hammer({ code: "cdlhammer" })]).reads[0].light, "RED");   // the same rule, whatever the case
  assert.equal(scan([hammer({ at: "not a time" })]).reads[0].at, undefined);
});

Deno.test("scan: too few cases is GREY, and a missing cell falls back to the rule's overall row and says so", () => {
  const few = scan([hammer({ trendBin: "above", volBin: "low" })]).reads[0];
  assert.deepEqual([few.light, few.n, few.win, few.scope, few.cellKey], ["GREY", 12, 0.75, "cell", "above/low/5"]);
  assert.match(few.line, /^Too few cases to call it a rate \(n=12\)\./);
  const none = scan([hammer({ trendBin: "above", volBin: "mid" })]).reads[0];
  assert.deepEqual([none.light, none.n, none.win, none.scope, none.cellKey], ["AMBER", 1200, 0.53, "overall", undefined]);
  assert.match(none.line, /No cases in your bin \(above\/mid\), so this is the rule's overall row\./);
  for (const bins of [{ trendBin: undefined, volBin: undefined }, { trendBin: "sideways", volBin: "high" }, { trendBin: "below", volBin: 3 }]) {
    const r = scan([hammer(bins)]).reads[0];
    assert.deepEqual([r.scope, r.n, r.cellKey], ["overall", 1200, undefined]);
    assert.match(r.line, /No trend and volatility bin was sent/);
  }
  const thin = scan([hammer({ code: "CDLTHIN", trendBin: null, volBin: null })]).reads[0];
  assert.deepEqual([thin.light, thin.n], ["GREY", 9]);
});

Deno.test("scan: one read per pattern, 1 to 40 of them", () => {
  assert.equal(scan(Array.from({ length: 40 }, () => hammer())).reads.length, 40);
  refused(() => scan([]), 400, "bad_request");
  refused(() => scan(Array.from({ length: 41 }, () => hammer())), 400, "bad_request");
  refused(() => atlasAnswer(atlas, { op: "scan", patterns: "CDLHAMMER" }), 400, "bad_request");
});

Deno.test("lookup, read and combine hand back the engine's answer", () => {
  const look = (atlasAnswer(atlas, { op: "lookup", rule: "hammer", trend: "below", vol: "high", horizon: 5 }) as any).result;
  assert.deepEqual([look.found, look.code, look.cellKey, look.cell.later.n, look.cellGrade], [true, "CDLHAMMER", "below/high/5", 1000, "RED"]);
  assert.equal((atlasAnswer(atlas, { op: "lookup", rule: "hammer", trend: "Below", vol: "H", horizon: "20" }) as any).result.cellKey, "below/high/20");
  assert.equal((atlasAnswer(atlas, { op: "lookup", rule: "flying saucer" }) as any).result.found, false);
  const read = (atlasAnswer(atlas, { op: "read", rule: "hammer", trend: "below", vol: "high", intraday: true, options: true, vix: 27 }) as any).result;
  assert.equal(read.verdict.light, "RED");
  assert.match(read.verdict.text, /DAILY bars/);
  assert.match(read.verdict.text, /Delta is not a win probability/);
  assert.deepEqual(Object.keys(read.hats).sort(), ["black", "blue", "green", "red", "white", "yellow"]);
  const card = (atlasAnswer(atlas, { op: "read", rule: "double bottom" }) as any).result;
  assert.deepEqual([card.lookup, card.chart.name, card.verdict.grade], [null, "Double bottom", "GREY"]);
  const mix = (atlasAnswer(atlas, { op: "combine", signals: ["doji", "long-legged doji", "hammer"], trend: "below", vol: "high" }) as any).result;
  assert.equal(mix.independentSignals, 2);   // the two dojis are one event
  assert.match(mix.joint, /^UNTESTED joint/);
});

Deno.test("what is not a question the atlas answers is refused", () => {
  for (const b of [
    { op: "enumerate" }, { op: "kb" }, {}, { op: "lookup" }, { op: "lookup", rule: "" }, { op: "lookup", rule: "x".repeat(61) },
    { op: "lookup", rule: "hammer", trend: "sideways" }, { op: "lookup", rule: "hammer", vol: "huge" }, { op: "lookup", rule: "hammer", horizon: 7 },
    { op: "read", rule: "hammer", vix: "high" }, { op: "read", rule: "hammer", vix: 900 }, { op: "read", rule: "hammer", bars: [{ O: 1, H: 2, L: 0, C: 1 }] },
    { op: "read", rule: "hammer", bars: Array.from({ length: 601 }, () => ({ O: 1, H: 2, L: 1, C: 1 })) },
    { op: "combine" }, { op: "combine", signals: [] }, { op: "combine", signals: ["hammer", 5] }, { op: "combine", signals: Array(13).fill("hammer") },
  ]) refused(() => atlasAnswer(atlas, b), 400, "bad_request");
});

Deno.test("no answer carries the knowledge base", () => {
  const answers = [
    scan([hammer(), hammer({ code: "CDLDOJI" }), hammer({ code: "NOPE" })]),
    atlasAnswer(atlas, { op: "lookup", rule: "hammer", trend: "below", vol: "high" }),
    atlasAnswer(atlas, { op: "read", rule: "hammer", trend: "below", vol: "high" }),
    atlasAnswer(atlas, { op: "combine", signals: ["hammer", "doji"] }),
  ];
  const whole = JSON.stringify(KB).length;
  for (const a of answers) {
    const s = JSON.stringify(a);
    assert.ok(!s.includes("WHOLE-KB-MARKER") && !s.includes('"matrix"') && !s.includes('"cell_grades"'));
    assert.ok(s.length < whole / 3, `an answer of ${s.length} characters from a knowledge base of ${whole}`);
  }
});

Deno.test("the engine the function runs is the one in atlas/", async () => {
  const here = new URL(".", import.meta.url);
  assert.equal(await Deno.readTextFile(new URL("../_shared/atlas/indai_atlas_engine.js", here)), await Deno.readTextFile(new URL("../../atlas/indai_atlas_engine.js", here)));
});

// The mode itself, with the database and the sign-in service replaced by stand-ins.
Deno.test("only the owner is answered, and the stored knowledge base is read once", async () => {
  const OWNER = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
  const real = globalThis.fetch, calls: string[] = [];
  let stored: unknown[] = [], allow = true;
  Deno.env.set("SUPABASE_URL", "http://rest.invalid"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
  Deno.env.set("SUPABASE_ANON_KEY", "public-key"); Deno.env.set("INDAI_PASSCODE", "open sesame");
  globalThis.fetch = ((input: Request | URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/user") {
      const token = new Headers(init.headers).get("Authorization");
      return Promise.resolve(token === "Bearer owner-token" ? Response.json({ id: OWNER }) : token === "Bearer other-token" ? Response.json({ id: OTHER }) : new Response("{}", { status: 401 }));
    }
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer service");
    if (url.pathname === "/rest/v1/indai_owner") return Promise.resolve(Response.json([{ user_id: OWNER }]));
    if (url.pathname === "/rest/v1/rpc/indai_take_request") {
      assert.deepEqual(JSON.parse(String(init.body)), { p_user: OWNER, p_bucket: "atlas", p_limit: 600 });
      return Promise.resolve(Response.json(allow));
    }
    if (url.pathname === "/rest/v1/indai_atlas") {
      assert.deepEqual([url.searchParams.get("key"), url.searchParams.get("select")], ["eq.kb", "value,version"]);
      return Promise.resolve(Response.json(stored));
    }
    throw new Error("unexpected outside call: " + url);
  }) as typeof fetch;
  const body = { mode: "atlas", op: "scan", patterns: [hammer()] };
  const ask = (headers: Record<string, string>) => atlasMode(new Request("http://x/", { method: "POST", headers }), body);
  const fails = async (headers: Record<string, string>, status: number, code: string) =>
    await assert.rejects(() => ask(headers), (e: unknown) => e instanceof HttpError && e.status === status && e.code === code);
  try {
    await fails({}, 401, "passcode");
    await fails({ "x-indai-pass": "guess" }, 401, "passcode");
    await fails({ Authorization: "Bearer stale-token" }, 401, "unauthorized");
    await fails({ Authorization: "Bearer other-token" }, 403, "forbidden");
    assert.ok(!calls.includes("/rest/v1/indai_atlas"), "nobody else gets as far as the data");
    await fails({ "x-indai-pass": "open sesame" }, 503, "atlas_unavailable");   // nothing loaded yet
    stored = [{ value: KB, version: "stand-in-1" }];
    calls.length = 0;
    const ways: Record<string, string>[] = [{ "x-indai-pass": "open sesame" }, { Authorization: "Bearer owner-token" }, { Authorization: "Bearer public-key", "x-indai-pass": "open sesame" }];
    for (const headers of ways) {
      const r = await ask(headers);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.deepEqual([j.version, j.reads[0].light, j.reads[0].n], ["stand-in-1", "RED", 1000]);
    }
    assert.equal(calls.filter((c) => c === "/rest/v1/indai_atlas").length, 1, "read once, then kept");
    allow = false;
    await fails({ "x-indai-pass": "open sesame" }, 429, "rate_limited");
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("the book's published example, on the real file when it is at hand", async () => {
  let path: string | undefined;
  try { path = Deno.env.get("ATLAS_KB"); } catch { /* no permission to read the environment: skip */ }
  if (!path) return;
  const real = createAtlas(JSON.parse(await Deno.readTextFile(path)));
  const [r] = (atlasAnswer(real, { op: "scan", intraday: true, patterns: [hammer()] }) as any).reads;
  assert.deepEqual([r.win, r.base, r.n, r.cellKey, r.light], [0.5731, 0.5428, 1101, "below/high/5", "RED"]);
  const look = (atlasAnswer(real, { op: "lookup", rule: "hammer", trend: "below", vol: "high", horizon: 5 }) as any).result;
  assert.deepEqual([look.cell.later.win.toFixed(3), look.cell.later.base.toFixed(3), look.cell.later.n, look.cellGrade], ["0.573", "0.543", 1101, "RED"]);
  assert.equal((atlasAnswer(real, { op: "scan", patterns: [hammer({ code: "CDLNOTREAL" })] }) as any).reads[0].light, "NONE");
});
