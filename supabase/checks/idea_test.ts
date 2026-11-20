import assert from "node:assert/strict";
import { aboutIdea, FRESH_MS, ideaBrief, KEEP_MS, type LastIdea, marketClock, serverContext, symbolOf, tickersIn } from "../indai-brain/idea.ts";

// Thinking an idea through, and answering with no app on screen (supabase/indai-brain/idea.ts). No network.
const T0 = Date.parse("2026-11-20T15:00:00-05:00");   // Friday 3:00 PM in New York
const idea = (over: Partial<LastIdea> = {}): LastIdea => ({ at: new Date(T0).toISOString(), talked_at: null, question: "QQQ calls expiring today 665 strike", idea: { sym: "QQQ", type: "C", strike: 665, expiry: "2026-11-20" }, numbers: '{"spot":663.2,"breakeven":666.4,"popExpiry":0.31}', verdict: { rag: "AMBER", confidence: 55, spoken: "Amber." }, ...over });
const MIN = 60_000;

Deno.test("a question is taken to be about the idea while it is fresh, and later only when it says so", () => {
  assert.equal(aboutIdea("good morning", null, T0), false);
  assert.equal(aboutIdea("how are you", idea(), T0 + 5 * MIN), true, "minutes after the idea, the next question is about it");
  assert.equal(aboutIdea("how are you", idea(), T0 + FRESH_MS + MIN), false);
  assert.equal(aboutIdea("how are you", idea({ talked_at: new Date(T0 + 40 * MIN).toISOString() }), T0 + 60 * MIN), true, "still talking about it");
  for (const q of ["why is it amber", "what if I go out a week", "where does it break even", "should I size down", "is the stop too tight", "how are the Q Q Q calls looking", "what about QQQ now"]) assert.equal(aboutIdea(q, idea(), T0 + 3 * 3600_000), true, q);
  for (const q of ["good morning", "what time is it", "show Tesla", "how is Nvidia doing today", "why is the market down", "what do you think of the day so far"]) assert.equal(aboutIdea(q, idea(), T0 + 3 * 3600_000), false, q);
  assert.equal(aboutIdea("why is it amber", idea(), T0 + KEEP_MS + MIN), false, "yesterday's idea is not today's conversation");
  assert.deepEqual([symbolOf({ sym: "qqq" }), symbolOf({ symbol: "BRK.B" }), symbolOf({ sym: "DROP TABLE" }), symbolOf(null)], ["QQQ", "BRK.B", "", ""]);
});

Deno.test("what she is told about the idea: their words, the numbers, her verdict, and how long ago", () => {
  const b = ideaBrief(idea(), T0 + 12 * MIN);
  assert.match(b, /asked 12 minutes ago; their words: "QQQ calls expiring today 665 strike"; parsed: \{"sym":"QQQ"/);
  assert.match(b, /your_verdict_then = \{"rag":"AMBER"/);
  assert.match(b, /numbers_then = \{"spot":663\.2/);
  assert.match(ideaBrief(idea({ verdict: null }), T0 + MIN), /asked 1 minute ago;[\s\S]*your_verdict_then = "none: the research did not finish/);
  assert.ok(ideaBrief(idea({ numbers: "x".repeat(24000), verdict: { big: "y".repeat(9000) } }), T0).length < 20000, "what goes into the prompt is bounded");
});

Deno.test("tickers in a spoken question: names, tickers as written, and the three market tickers", () => {
  assert.deepEqual(tickersIn("What's Tesla doing and how are the Q's?"), ["QQQ", "TSLA", "SPY", "IWM"]);
  assert.deepEqual(tickersIn("Is NVDA a buy after CPI"), ["NVDA", "SPY", "QQQ", "IWM"]);
  assert.deepEqual(tickersIn("how is the market", ["AMZN", ""]), ["AMZN", "SPY", "QQQ", "IWM"]);
  assert.deepEqual(tickersIn("What is Apple's range today"), ["AAPL", "SPY", "QQQ", "IWM"]);
  assert.equal(tickersIn("AAA BBB CCC DDD EEE FFF GGG HHH III JJJ").length, 8, "never more than eight");
  assert.deepEqual(tickersIn("WHAT IS THE VIX AT NOW"), ["VIX", "SPY", "QQQ", "IWM"]);
});

Deno.test("the market by the clock in New York", () => {
  const at = (s: string) => marketClock(Date.parse(s));
  assert.deepEqual([at("2026-11-20T03:59:00-05:00"), at("2026-11-20T04:00:00-05:00"), at("2026-11-20T09:29:00-05:00"), at("2026-11-20T09:30:00-05:00"), at("2026-11-20T15:59:00-05:00"), at("2026-11-20T16:00:00-05:00"), at("2026-11-20T20:00:00-05:00"), at("2026-11-21T11:00:00-05:00"), at("2026-11-22T11:00:00-05:00")],
    ["closed (overnight)", "pre-market", "pre-market", "regular session open", "regular session open", "after hours", "closed (overnight)", "closed (weekend)", "closed (weekend)"]);
});

Deno.test("with no app on screen she is given live prices from INDAI's own price service, asked as the same person", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const env = (n: string) => ({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[n];
  const quotes = { source: "Schwab", delay: 0, quotes: [{ symbol: "TSLA", ok: true, price: 404, prevClose: 400, high: 406, low: 398 }, { symbol: "SPY", ok: true, price: 700, prevClose: 707 }, { symbol: "QQQ", ok: false, error: "x" }] };
  const io = (answer: () => Response | Promise<Response>) => ({ env, now: T0, fetch: (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string> }); return Promise.resolve(answer()); } });
  const byPass = new Request("https://x/", { method: "POST", headers: { "x-indai-pass": "open sesame", Authorization: "Bearer anon-key" } });
  let c = await serverContext(byPass, "what's Tesla doing", idea(), io(() => Response.json(quotes)));
  assert.deepEqual(seen[0], { url: "https://proj.supabase.co/functions/v1/indai-market?kind=snapshot&symbols=TSLA,QQQ,SPY,IWM", headers: { apikey: "anon-key", Authorization: "Bearer anon-key", "x-indai-pass": "open sesame" } });
  assert.deepEqual(c, { market: "regular session open by the clock (holidays are not known to you)", screen: "none: the trader is talking to you without the app open", prices: { TSLA: { price: 404, pct: 1, high: 406, low: 398, prevClose: 400 }, SPY: { price: 700, pct: -0.99, high: null, low: null, prevClose: 707 } }, dataNote: "Prices are live (Schwab)." });
  const signedIn = new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer his-own-sign-in" } });
  await serverContext(signedIn, "how is the market", null, io(() => Response.json({ delay: 900, quotes: [{ symbol: "SPY", ok: true, price: 700, prevClose: 700 }] })));
  assert.deepEqual(seen[1].headers, { apikey: "anon-key", Authorization: "Bearer his-own-sign-in" });
  c = await serverContext(byPass, "how is the market", null, io(() => Response.json({ delay: 900, source: "CBOE delayed quotes", quotes: [{ symbol: "SPY", ok: true, price: 700, prevClose: 700 }] })));
  assert.equal(c.dataNote, "Prices are delayed about 15 minutes.");
  for (const bad of [() => new Response("no", { status: 502 }), () => { throw new Error("down"); }, () => Response.json({ quotes: [] })]) {
    c = await serverContext(byPass, "how is the market", null, io(bad));
    assert.deepEqual([c.prices, c.dataNote, typeof c.market], [undefined, "No prices could be read just now.", "string"], "she still answers, and says she cannot see prices");
  }
  c = await serverContext(byPass, "hello", null, { env: () => undefined, now: T0, fetch: () => assert.fail("nothing to ask") });
  assert.deepEqual(Object.keys(c), ["market", "screen"]);
});
