// The real indai-brain function, served locally, for the conversation about an idea and the spoken-only door.
// Claude, the database and INDAI's price service are stand-ins that record every call.
// deno run -A supabase/checks/idea-wiring.ts "$PWD/supabase/indai-brain/index.ts"   (not part of `deno test`: it serves on port 8000)
import assert from "node:assert/strict";
const real = globalThis.fetch;
const OWNER = "11111111-1111-4111-8111-111111111111";
const seen: { url: string; method: string; body: any; headers: Record<string, string> }[] = [];
let ideaRow: any = null, ideaDown = false, claudeText = "", turns: any[] = [];
const verdict = { rag: "AMBER", confidence: 58, headline: "Mixed", spoken: "This one is amber.", summary: ["Below VWAP"], bullish: [], bearish: [], news: [], events: [], watch: [], plan_notes: "" };
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input instanceof Request ? input.url : input), method = init.method ?? "GET";
  if (url.startsWith("http://127.0.0.1:8000")) return real(input, init);
  const body = init.body ? JSON.parse(String(init.body)) : null, u = new URL(url);
  seen.push({ url, method, body, headers: Object.fromEntries(new Headers(init.headers).entries()) });
  if (u.pathname === "/rest/v1/rpc/indai_take_request") return Response.json(true);
  if (u.pathname === "/rest/v1/rpc/indai_reserve_tokens") return Response.json("11111111-1111-4111-8111-111111111111");
  if (u.pathname === "/rest/v1/rpc/indai_settle_tokens") return new Response("", { status: 200 });
  if (u.pathname === "/rest/v1/indai_owner") return Response.json([{ user_id: OWNER }]);
  if (u.pathname === "/rest/v1/indai_memory") return Response.json([]);
  if (u.pathname === "/rest/v1/indai_turns") { if (method === "POST") { turns.push(...body); return new Response("", { status: 201 }); } return Response.json(turns.filter((t) => "eq." + t.session === u.searchParams.get("session")).slice().reverse()); }
  if (u.pathname === "/rest/v1/indai_last_idea") {
    if (ideaDown) return Response.json({ message: "relation does not exist" }, { status: 404 });
    assert.equal(method === "POST" ? body.user_id : u.searchParams.get("user_id"), method === "POST" ? OWNER : "eq." + OWNER);
    if (method === "POST") { assert.match(u.search, /on_conflict=user_id/); ideaRow = { ...body }; return new Response("", { status: 201 }); }
    if (method === "PATCH") { if (ideaRow && "eq." + ideaRow.at === u.searchParams.get("at")) Object.assign(ideaRow, body); return new Response(null, { status: 204 }); }
    const since = (u.searchParams.get("at") ?? "").replace("gte.", "");
    return Response.json(ideaRow && ideaRow.at >= since ? [ideaRow] : []);
  }
  if (u.pathname === "/functions/v1/indai-market") return Response.json({ source: "Schwab", delay: 0, quotes: u.searchParams.get("symbols")!.split(",").map((symbol) => ({ symbol, ok: true, price: symbol === "TSLA" ? 404 : 700, prevClose: symbol === "TSLA" ? 400 : 707 })) });
  if (url === "https://api.anthropic.com/v1/messages") {
    const text = claudeText || (String(body.system).startsWith("You are INDAI, the voice") ? JSON.stringify({ spoken: "Here is my read.", summary: ["Break-even 666.40"], command: "show QQQ" }) : JSON.stringify(verdict));
    return Response.json({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 3000, output_tokens: 200 } });
  }
  throw new Error("unexpected outside call: " + method + " " + url);
}) as typeof fetch;
Deno.env.set("SUPABASE_URL", "http://rest.invalid"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service"); Deno.env.set("SUPABASE_ANON_KEY", "public-key");
Deno.env.set("ANTHROPIC_API_KEY", "ant-key"); Deno.env.set("INDAI_PASSCODE", "open sesame");
for (const k of ["PERPLEXITY_API_KEY", "OPENAI_API_KEY", "INDAI_SECOND_OPINION", "INDAI_SECOND_MODEL"]) Deno.env.delete(k);
await import(Deno.args[0]);
await new Promise((r) => setTimeout(r, 300));
let n = 0; const ok = (name: string) => console.log(`ok ${++n} ${name}`);
const post = async (body: unknown, headers: Record<string, string> = { "x-indai-pass": "open sesame" }) => { seen.length = 0; const r = await real("http://127.0.0.1:8000", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer public-key", ...headers }, body: JSON.stringify(body) }); const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch { /* plain words */ } return { status: r.status, type: r.headers.get("content-type"), text, j }; };
const claude = () => seen.filter((s) => s.url.includes("anthropic")).map((s) => s.body);
const asked = (what: string) => seen.filter((s) => s.url.includes(what));
const appContext = { watchlist: { QQQ: { price: 663.2, pct: -0.4 } }, market: "Open", lastAnalysis: { idea: { sym: "QQQ" }, rag: "AMBER", score: 55 } };
const talk = (question: string, more: Record<string, unknown> = {}) => ({ mode: "talk", name: "Bongs", question, history: [], context: appContext, search: false, ...more });
const trade = { mode: "trade", depth: "fast", name: "Bongs", question: "QQQ calls expiring today 665 strike", idea: { sym: "QQQ", type: "C", strike: 665, expiry: "2026-11-20" }, context: { symbol: "QQQ", spot: 663.2, breakeven: 666.4, popExpiry: 0.31, riskBreaker: { state: "armed" } } };

// 1. no idea yet: conversation is what it was
let r = await post(talk("good morning"));
assert.deepEqual([r.status, r.j.mode, r.j.model, r.j.about, r.j.result.spoken], [200, "talk", "claude-haiku-5-5", undefined, "Here is my read."]);
let c = claude()[0];
assert.deepEqual([c.model, c.max_tokens, /idea_under_discussion|think an idea through/.test(c.system), asked("indai-market").length], ["claude-haiku-5-5", 700, false, 0]);
assert.match(c.messages.at(-1).content, /context = \{"watchlist":\{"QQQ"/);
ok("with no idea on record, a conversation turn is asked exactly as before (quick model, the app's context)");

// 2. a trade idea is kept, with her verdict
r = await post(trade);
assert.deepEqual([r.status, r.j.result.rag, Object.keys(r.j).sort()], [200, "AMBER", ["brains", "mode", "model", "result", "sources", "usage"]]);
assert.deepEqual([ideaRow.user_id, ideaRow.question, ideaRow.idea, ideaRow.numbers, ideaRow.verdict.rag, ideaRow.talked_at], [OWNER, trade.question, trade.idea, JSON.stringify(trade.context), "AMBER", null]);
assert.deepEqual(asked("indai_last_idea").map((s) => s.method), ["POST", "PATCH"]);
ok("a trade idea is kept for its owner: the words, the parsed idea, the numbers, and the verdict once it is given");

// 3. the next question is reasoned by the stronger model with all of it
r = await post(talk("why is it amber and where does it break even"));
assert.deepEqual([r.status, r.j.model, r.j.about, r.j.result.spoken], [200, "claude-sonnet-5-5", "idea", "Here is my read."]);
c = claude()[0];
assert.deepEqual([c.model, c.max_tokens], ["claude-sonnet-5-5", 1500]);
assert.match(c.system, /think an idea through with you/);
assert.match(c.system, /idea_under_discussion = asked 0 minutes ago; their words: "QQQ calls expiring today 665 strike"; parsed: \{"sym":"QQQ","type":"C","strike":665/);
assert.match(c.system, /your_verdict_then = \{"rag":"AMBER","confidence":58/);
assert.match(c.system, /numbers_then = \{"symbol":"QQQ","spot":663\.2,"breakeven":666\.4/);
assert.ok(!/read aloud by the phone/.test(c.system) && typeof ideaRow.talked_at === "string");
ok("a question about it goes to the stronger model with the idea, the numbers and her verdict, and says so in the answer");

// 4. spoken-only, with no app: plain words, live prices fetched as the same person, its own conversation
r = await post({ mode: "talk", question: "What's Tesla doing?", format: "text", session: "siri" });
assert.deepEqual([r.status, r.type, r.text], [200, "text/plain; charset=utf-8", "Here is my read."]);
const market = asked("indai-market")[0];
assert.deepEqual([market.url, market.headers["x-indai-pass"], market.headers.authorization, market.headers.apikey], ["http://rest.invalid/functions/v1/indai-market?kind=snapshot&symbols=TSLA,QQQ,SPY,IWM", "open sesame", "Bearer public-key", "public-key"]);
c = claude()[0];
assert.match(c.system, /read aloud by the phone with no screen/);
assert.match(c.messages.at(-1).content, /context = \{"market":"[a-z ()-]+ by the clock \(holidays are not known to you\)","screen":"none: the trader is talking to you without the app open","prices":\{"TSLA":\{"price":404,"pct":1,/);
assert.deepEqual(turns.filter((t) => t.session === "siri").map((t) => [t.role, t.text]), [["user", "What's Tesla doing?"], ["assistant", "Here is my read."]]);
r = await post({ mode: "talk", question: "and the Q's?", format: "text", session: "siri" });
assert.deepEqual(claude()[0].messages.map((m: any) => m.role), ["user", "assistant", "user"], "the second question carries the first exchange");
r = await post({ mode: "talk", question: "hello", format: "text", session: "siri", stream: true });
assert.deepEqual([r.status, r.type, r.text], [200, "text/plain; charset=utf-8", "Here is my read."], "spoken-only is never a stream");
ok("format text: her words only, as plain text, with prices she fetched herself and a conversation of its own");

// 5. its failures are plain words too
r = await post({ mode: "talk", question: "hello", format: "text" }, { "x-indai-pass": "guess" });
assert.deepEqual([r.status, r.type, r.text, claude().length], [401, "text/plain; charset=utf-8", "INDAI did not accept the passcode saved in this shortcut.", 0]);
r = await post({ mode: "talk", question: "hello" }, { "x-indai-pass": "guess" });
assert.deepEqual([r.status, r.j.error], [401, "passcode"]);
ok("a refused spoken-only request says why in plain words; an ordinary one is refused as before");

// 6. the research does not finish: the idea is still there to talk about, and she is told there was no verdict
claudeText = '{"rag":"GRE';
r = await post({ ...trade, question: "SPY puts 690 tomorrow", idea: { sym: "SPY", type: "P", strike: 690 } });
assert.deepEqual([r.status, r.j.error, ideaRow.question, ideaRow.verdict], [502, "parse", "SPY puts 690 tomorrow", null]);
claudeText = "";
r = await post(talk("what if I take the 685 instead"));
assert.match(claude()[0].system, /their words: "SPY puts 690 tomorrow"[\s\S]*your_verdict_then = "none: the research did not finish/);
ok("an idea whose research failed can still be talked through from its numbers");

// 7. the idea table missing or down changes nothing else
ideaDown = true;
r = await post(trade); assert.deepEqual([r.status, r.j.result.rag], [200, "AMBER"]);
r = await post(talk("good morning")); assert.deepEqual([r.status, r.j.model, r.j.about], [200, "claude-haiku-5-5", undefined]);
ok("if the idea cannot be kept or read, verdicts and conversation go on as before");
console.log("ALL IDEA WIRING CHECKS PASSED");
Deno.exit(0);
