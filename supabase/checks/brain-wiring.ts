// End-to-end run of supabase/indai-brain/index.ts with every outside service replaced by a stand-in.
// deno run -A supabase/checks/brain-wiring.ts "$PWD/supabase/indai-brain/index.ts"   (not part of `deno test`: it serves on port 8000)
import assert from "node:assert/strict";
const real = globalThis.fetch;
const seen: { url: string; body: any; headers: Record<string, string> }[] = [];
let anthropicStatus = 200, anthropicText = "", anthropicStop = "end_turn", anthropicOut = 600;
const verdict = { rag: "GREEN", confidence: 72, headline: "Trend and flow agree", spoken: "This one is green.", summary: ["Above VWAP", "Calls leading"], bullish: [], bearish: [], news: [], events: [], watch: [], plan_notes: "" };
const usage = { input_tokens: 900, output_tokens: 120 };
const responses = (text: string, before: unknown[] = []) => Response.json({ status: "completed", usage, output: [...before, { type: "message", content: [{ type: "output_text", text, annotations: [] }] }] });
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://127.0.0.1:8000")) return real(input, init);
  const body = init.body ? JSON.parse(String(init.body)) : null;
  seen.push({ url, body, headers: Object.fromEntries(new Headers(init.headers).entries()) });
  if (url.includes("/rest/v1/rpc/indai_take_request")) return Response.json(true);
  if (url.includes("/rest/v1/rpc/indai_reserve_tokens")) return Response.json("11111111-1111-4111-8111-111111111111");
  if (url.includes("/rest/v1/rpc/indai_settle_tokens")) return new Response("", { status: 200 });
  if (url === "https://api.anthropic.com/v1/messages") {
    if (anthropicStatus !== 200) return Response.json({ type: "error", error: { type: "overloaded_error" } }, { status: anthropicStatus });
    return Response.json({ content: [
      { type: "web_search_tool_result", content: [{ title: "Claude's own find", url: "https://example.com/claude" }] },
      { type: "text", text: anthropicText || JSON.stringify(verdict) },
    ], stop_reason: anthropicStop, usage: { input_tokens: 5000, output_tokens: anthropicOut } });
  }
  if (url === "https://api.perplexity.ai/v1/agent") {
    if (body.effort) return responses("Nov 20: Nvidia up 2% before earnings [1].", [{ type: "search_results", results: [{ id: 1, title: "Nvidia rises", url: "https://example.com/nvda" }] }]);
    if (String(body.instructions).startsWith("You are the second analyst")) return responses(JSON.stringify({ rag: "AMBER", confidence: 60, reason: "Fed speaker at two.", risk: "Theta." }));
    return responses(JSON.stringify({ ...verdict, rag: "AMBER", spoken: "Amber from the stand-in." }));
  }
  throw new Error("unexpected outside call: " + url);
}) as typeof fetch;
Deno.env.set("SUPABASE_URL", "http://rest.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("ANTHROPIC_API_KEY", "ant-key");
for (const k of ["PERPLEXITY_API_KEY", "OPENAI_API_KEY", "INDAI_PASSCODE", "INDAI_SECOND_OPINION", "INDAI_SECOND_MODEL"]) Deno.env.delete(k);
await import(Deno.args[0]);
await new Promise((r) => setTimeout(r, 300));
const base = "http://127.0.0.1:8000";
const post = async (body: unknown) => { seen.length = 0; const r = await real(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
const trade = { mode: "trade", depth: "fast", name: "Bongs", question: "NVDA calls expiring today 190 strike", idea: { sym: "NVDA", type: "C", strike: 190 }, context: { symbol: "NVDA", spot: 188.4, riskBreaker: { state: "armed" } } };
const anthropic = () => seen.filter((s) => s.url.includes("anthropic"));
const outside = () => seen.filter((s) => !s.url.includes("rest.invalid")).map((s) => s.url.replace("https://", "").split("/")[0]);
let n = 0; const ok = (name: string) => console.log(`ok ${++n} ${name}`);

// A. no extra keys: the request to Claude and the answer are what they were before this change
let s = await (await real(base)).json();
assert.deepEqual(s, { configured: true, passcode: false, memory: true, brains: { claude: true, perplexity: false, chatgpt: false }, modes: ["talk", "trade", "chat", "memory", "profile", "history", "atlas"] });
let r = await post(trade);
assert.equal(r.status, 200);
assert.deepEqual(outside(), ["api.anthropic.com"]);
let a = anthropic()[0].body;
assert.deepEqual([a.model, a.max_tokens, a.tools], ["claude-sonnet-5-5", 6000, [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]]);
assert.match(a.messages[0].content, /^Trader: Bongs\. Now: .* \(New York\)\.\nTheir words: "NVDA calls expiring today 190 strike"\nParsed idea: \{"sym":"NVDA","type":"C","strike":190\}\ncontext = \{"symbol":"NVDA","spot":188\.4,"riskBreaker":\{"state":"armed"\}\}\nResearch what you need, then give the JSON assessment\.$/);
assert.deepEqual(Object.keys(r.j), ["mode", "model", "result", "sources", "usage", "brains"]);
assert.deepEqual([r.j.mode, r.j.model, r.j.result, r.j.sources, r.j.usage], ["trade", "claude-sonnet-5-5", verdict, [{ title: "Claude's own find", url: "https://example.com/claude" }], { input_tokens: 5000, output_tokens: 600 }]);
assert.deepEqual(r.j.brains.map((x: any) => x.brain), ["claude"]);
ok("no extra keys: Claude is asked exactly as before, same answer plus brains");

// B. talk is untouched
r = await post({ mode: "talk", name: "Bongs", question: "good morning", history: [], context: {}, search: false });
assert.equal(r.status, 200);
assert.deepEqual(outside(), ["api.anthropic.com"]);
assert.deepEqual([anthropic()[0].body.model, anthropic()[0].body.max_tokens, anthropic()[0].body.tools, r.j.brains], ["claude-haiku-5-5", 700, undefined, undefined]);
ok("talk mode unchanged");

// C. Perplexity key: three brains
Deno.env.set("PERPLEXITY_API_KEY", "pplx-key");
s = await (await real(base)).json();
assert.deepEqual(s.brains, { claude: true, perplexity: true, chatgpt: true });
r = await post(trade);
assert.equal(r.status, 200);
assert.deepEqual(outside().sort(), ["api.anthropic.com", "api.perplexity.ai", "api.perplexity.ai"]);
a = anthropic()[0].body;
assert.equal(a.tools[0].max_uses, 1);
assert.match(a.messages[0].content, /give the JSON assessment\.\nresearch = \{"by":"Perplexity, live web search, moments ago","notes":"Nov 20: Nvidia up 2% before earnings \[1\]\."/);
const pplx = seen.filter((x) => x.url.includes("perplexity"));
assert.ok(pplx.every((x) => x.headers.authorization === "Bearer pplx-key" && !JSON.stringify(x.body).includes("Bongs")));
assert.deepEqual([r.j.result.rag, r.j.result.confidence, r.j.result.second.rag, r.j.result.second.agrees], ["GREEN", 62, "AMBER", false]);
assert.equal(r.j.result.spoken, "This one is green. One caution: my second opinion reads this one as amber.");
assert.deepEqual(r.j.sources.map((x: any) => x.url), ["https://example.com/nvda", "https://example.com/claude"]);
assert.deepEqual(r.j.brains.map((x: any) => [x.brain, x.role, x.ok]), [["perplexity", "research", true], ["claude", "verdict", true], ["chatgpt", "second opinion", true]]);
const reserves = seen.filter((x) => x.url.includes("indai_reserve_tokens")).length, settles = seen.filter((x) => x.url.includes("indai_settle_tokens")).length;
assert.deepEqual([reserves, settles], [3, 3]);
assert.ok(!JSON.stringify(r.j).includes("pplx-key"));
ok("Perplexity key: research, Claude's verdict with one search, ChatGPT's second opinion, all budgeted");

// D. Claude overloaded: ChatGPT stands in
anthropicStatus = 529;
r = await post(trade);
assert.equal(r.status, 200);
assert.deepEqual([r.j.model, r.j.result.rag, r.j.result.spoken], ["openai/gpt-6.1-sol", "AMBER", "Amber from the stand-in."]);
assert.deepEqual(r.j.brains.map((x: any) => [x.role, x.ok]), [["research", true], ["verdict", false], ["second opinion", false], ["stand-in for Claude", true]]);
assert.deepEqual(outside().sort(), ["api.anthropic.com", "api.perplexity.ai", "api.perplexity.ai"]);
ok("Claude overloaded: ChatGPT stands in");

// E. Claude overloaded and no other brain: the same 502 as before
Deno.env.delete("PERPLEXITY_API_KEY");
r = await post(trade);
assert.deepEqual([r.status, r.j], [502, { error: "upstream", message: "The language provider rejected the request." }]);
ok("Claude overloaded, no other brain: 502 upstream as before");

// F. cut-off reply, no other brain: the same 502 parse as before (plus brains)
anthropicStatus = 200; anthropicText = '{"rag":"GRE';
r = await post(trade);
assert.deepEqual([r.status, r.j.error, r.j.raw, r.j.sources.length], [502, "parse", "", 1]);
ok("cut-off reply, no other brain: 502 parse as before");
// G. cut off at the reply limit: said in plain words, with the reason on the step, and the limit is the new one
anthropicStop = "max_tokens"; anthropicOut = 6000;
r = await post(trade);
assert.deepEqual([r.status, r.j.error, r.j.message, r.j.brains[0].stop, r.j.brains[0].out, anthropic()[0].body.max_tokens], [502, "parse", "The answer was cut off before it was complete. Please ask again.", "max_tokens", 6000, 6000]);
r = await post({ ...trade, mode: "chat", idea: undefined, question: "Any Fed speakers today?" });
assert.deepEqual([anthropic()[0].body.max_tokens, r.status], [6000, 502]);
ok("a reply cut off at the limit says so, and the limit for researched replies is 6,000");
console.log("ALL WIRING CHECKS PASSED");
Deno.exit(0);
