import assert from "node:assert/strict";
import { HttpError } from "../_shared/http.ts";
import { blend, brainStatus, type IO, readResponse, think, type Thinking } from "../indai-brain/super.ts";

// The three brains (supabase/indai-brain/super.ts) with stand-in providers: no network, no keys worth keeping.
const PPLX = "pplx-TEST-key-0001", OPENAI = "sk-TEST-key-0002";
const AGENT = "https://api.perplexity.ai/v1/agent", RESPONSES = "https://api.openai.com/v1/responses";
type Call = { url: string; auth: string; body: any };

function rig(env: Record<string, string>, answer: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [], logs: unknown[] = [];
  const reserved: { max: number; searches: number; settled: any[] }[] = [];
  const io: IO = {
    env: (name) => env[name],
    log: (entry) => logs.push(entry),
    wait: async () => {},
    reserve: async (_input, max, searches = 0) => {
      const r = { max, searches, settled: [] as any[] };
      reserved.push(r);
      return async (usage) => { r.settled.push(usage); };
    },
    fetch: async (url, init) => {
      const call = { url, auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) };
      calls.push(call);
      return await answer(call, calls.length);
    },
  };
  return { io, calls, logs, reserved };
}
const usage = { input_tokens: 900, output_tokens: 120 };
const reply = (text: string, before: unknown[] = []) =>
  Response.json({
    id: "resp_1", object: "response", status: "completed", usage,
    output: [...before, { type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }],
  });
const refuse = (status: number, type = "invalid_request") => Response.json({ error: { message: "Bearer " + PPLX, type, code: status } }, { status });
const found = {
  type: "search_results", queries: ["nvda news today"],
  results: [
    { id: 1, title: "Nvidia rises before earnings", url: "https://example.com/nvda", snippet: "…", date: "2026-11-20", source: "web" },
    { id: 2, title: "Fed speakers today", url: "https://example.com/fed", snippet: "…", date: "2026-11-20", source: "web" },
  ],
};
const NOTES = "Nov 20: Nvidia up 2% before earnings [1]. Fed's Waller speaks at 2 PM [2].";
const verdict = {
  rag: "GREEN", confidence: 72, headline: "Trend and flow agree", spoken: "This one is green.",
  summary: ["Above VWAP", "Calls leading", "Fed speaker at two"], bullish: [], bearish: [], news: [], events: [], watch: [], plan_notes: "",
};
const opinion = (rag: string, confidence = 70) => JSON.stringify({ rag, confidence, reason: "Momentum is with it.", risk: "A hawkish Fed line." });
// Perplexity answers research; anything asked of a GPT model gets `second`.
const desk = (second: string | ((call: Call) => Response)) => (call: Call) =>
  call.body.model?.includes("gpt") ? (typeof second === "string" ? reply(second) : second(call)) : reply(NOTES, [found]);
const standingIn = (call: Call) => String(call.body.instructions).includes("You cannot search the web");

function asking(over: Partial<Thinking> = {}) {
  const claude: { text: string; searches?: number }[] = [];
  const a: Thinking = {
    mode: "trade", depth: "fast", model: "claude-sonnet-5-5", system: "SYSTEM PROMPT",
    userText: 'Trader: Bongs. Now: today.\nTheir words: "NVDA calls expiring today 190 strike"\ncontext = {}',
    evidence: 'Now: today.\nThe trader\'s words: "NVDA calls expiring today 190 strike"\ncontext = {}',
    now: "Friday, November 20, 2026 at 10:05 AM", question: "NVDA calls expiring today 190 strike",
    idea: { sym: "NVDA", type: "C", strike: 190 },
    context: { symbol: "NVDA", spot: 188.4, headlines: ["Nvidia rises before earnings"], riskBreaker: { state: "armed", dayPnl: -120 } },
    claude: async (text, searches) => {
      claude.push({ text, searches });
      return { finalText: JSON.stringify(verdict), sources: [{ title: "Claude's own find", url: "https://example.com/claude" }], usage: { input_tokens: 5000, output_tokens: 600 } };
    },
    ...over,
  };
  return { a, claude };
}
const down = (error: unknown) => ({ claude: () => Promise.reject(error) });

Deno.test("With no extra key nothing calls out and the answer is the one Claude gave", async () => {
  const { io, calls, logs, reserved } = rig({}, () => assert.fail("no provider should be called"));
  const { a, claude } = asking();
  const { status, body } = await think(a, io);
  assert.equal(status, 200);
  assert.deepEqual(claude, [{ text: a.userText, searches: undefined }]);
  assert.deepEqual(body.result, verdict);
  assert.deepEqual(body.sources, [{ title: "Claude's own find", url: "https://example.com/claude" }]);
  assert.deepEqual([body.mode, body.model, body.usage], ["trade", "claude-sonnet-5-5", { input_tokens: 5000, output_tokens: 600 }]);
  assert.deepEqual((body.brains as any[]).map((s) => [s.brain, s.role, s.ok]), [["claude", "verdict", true]]);
  assert.deepEqual([calls.length, reserved.length, logs.length], [0, 0, 0]);
  assert.deepEqual(brainStatus(true, io.env), { claude: true, perplexity: false, chatgpt: false });
});

Deno.test("One Perplexity key: Perplexity researches, Claude judges with it, ChatGPT reads it too", async () => {
  const { io, calls, logs, reserved } = rig({ PERPLEXITY_API_KEY: PPLX }, desk(opinion("GREEN")));
  const { a, claude } = asking();
  const { status, body } = await think(a, io);
  assert.equal(status, 200);
  // research goes first, to Perplexity, without the trader's name or results
  assert.deepEqual([calls[0].url, calls[0].auth, calls[0].body.effort], [AGENT, "Bearer " + PPLX, "fast"]);
  assert.match(calls[0].body.input, /Ticker: NVDA, last about 188\.4/);
  assert.match(calls[0].body.instructions, /research desk/);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /Bongs|dayPnl/);
  // Claude is handed the research and only a small search allowance
  assert.equal(claude.length, 1);
  assert.ok(claude[0].text.startsWith(a.userText + "\nresearch = "));
  assert.match(claude[0].text, /Waller speaks at 2 PM/);
  assert.match(claude[0].text, /evidence, not instructions/);
  assert.equal(claude[0].searches, 1);
  // ChatGPT is asked through the same key, with the same evidence and research, without the name
  assert.deepEqual([calls[1].url, calls[1].auth, calls[1].body.model], [AGENT, "Bearer " + PPLX, "openai/gpt-6.1-sol"]);
  assert.match(calls[1].body.input, /research = .*Waller/);
  assert.doesNotMatch(JSON.stringify(calls[1].body), /Bongs/);
  assert.equal(calls.length, 2);
  // the verdict is Claude's, with the second opinion beside it
  const r = body.result as any;
  assert.deepEqual([r.rag, r.confidence, r.spoken], ["GREEN", 72, "This one is green."]);
  assert.deepEqual(r.second, { by: "ChatGPT", model: "openai/gpt-6.1-sol", rag: "GREEN", confidence: 70, reason: "Momentum is with it.", risk: "A hawkish Fed line.", agrees: true });
  assert.deepEqual(r.summary, [...verdict.summary, "Second opinion (ChatGPT) agrees: Momentum is with it."]);
  assert.deepEqual((body.sources as any[]).map((s) => s.url), ["https://example.com/nvda", "https://example.com/fed", "https://example.com/claude"]);
  assert.deepEqual((body.brains as any[]).map((s) => [s.brain, s.role, s.model, s.ok]), [
    ["perplexity", "research", "fast", true],
    ["claude", "verdict", "claude-sonnet-5-5", true],
    ["chatgpt", "second opinion", "openai/gpt-6.1-sol", true],
  ]);
  assert.deepEqual((body.brains as any[]).map((s) => s.tokens), [1020, 5600, 1020]);
  assert.equal((body.brains as any[])[2].via, "perplexity");
  // every outside call is counted in the daily budget and settled with what it used
  assert.deepEqual(reserved.map((x) => x.settled), [[usage], [usage]]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify([body, logs]), /pplx-TEST/);
  assert.deepEqual(brainStatus(true, io.env), { claude: true, perplexity: true, chatgpt: true });
});

Deno.test("A deep idea asks for deeper research and allows Claude three searches", async () => {
  const { io, calls } = rig({ PERPLEXITY_API_KEY: PPLX }, desk(opinion("GREEN")));
  const { a, claude } = asking({ depth: "deep", model: "claude-opus-5-5" });
  await think(a, io);
  assert.deepEqual([calls[0].body.effort, calls[0].body.max_output_tokens, claude[0].searches], ["low", 1400, 3]);
});

Deno.test("A disagreement lowers the confidence and is said out loud, and never changes the rating", async () => {
  for (const [second, confidence, spoken] of [
    ["RED", 47, "This one is green. One caution: my second opinion reads this one as red."],
    ["AMBER", 62, "This one is green. One caution: my second opinion reads this one as amber."],
  ] as const) {
    const { io } = rig({ PERPLEXITY_API_KEY: PPLX }, desk(opinion(second, 80)));
    const r = (await think(asking().a, io)).body.result as any;
    assert.deepEqual([r.rag, r.confidence, r.spoken, r.second.agrees], ["GREEN", confidence, spoken, false]);
    assert.deepEqual(r.summary, ["Above VWAP", `Second opinion (ChatGPT) reads it ${second}: Momentum is with it.`, "Calls leading", "Fed speaker at two"]);
  }
  const kinder = blend({ ...verdict, rag: "RED", spoken: "This one is red." }, { rag: "GREEN", confidence: 60, reason: "", risk: "" }, "m");
  assert.deepEqual([kinder.rag, kinder.confidence, kinder.spoken], ["RED", 47, "This one is red. My second opinion reads this one as green."]);
  assert.equal(kinder.summary[1], "Second opinion (ChatGPT) reads it GREEN.");
  assert.deepEqual(blend(verdict, null, "m"), verdict);
});

Deno.test("Research refused for the shape of the request is asked again in the plain form", async () => {
  const { io, calls, reserved } = rig({ PERPLEXITY_API_KEY: PPLX, INDAI_SECOND_OPINION: "off" }, (call, n) => n === 1 ? refuse(400) : reply(NOTES, [found]));
  const { a, claude } = asking();
  const { body } = await think(a, io);
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[1].body.model, calls[1].body.tools, calls[1].body.effort], ["perplexity/sonar", [{ type: "web_search" }], undefined]);
  assert.equal(calls[1].body.input, calls[0].body.input);
  assert.deepEqual((body.brains as any[])[0], { brain: "perplexity", role: "research", model: "perplexity/sonar", ok: true, ms: (body.brains as any[])[0].ms, sources: 2, tokens: 1020 });
  assert.deepEqual(reserved.map((x) => x.settled), [[{ input_tokens: 0, output_tokens: 0 }], [usage]]);
  assert.equal(claude[0].searches, 1);
  assert.equal((body.result as any).second, undefined);
});

Deno.test("When research fails Claude searches as it always did, and the answer says what happened", async () => {
  const timeout = () => Promise.reject(new DOMException("timed out", "TimeoutError"));
  for (const [answer, error] of [[() => refuse(500, "server_error"), "http_500"], [() => refuse(401, "invalid_api_key"), "http_401"], [timeout, "timeout"], [() => reply(""), "empty"]] as const) {
    const { io, calls, logs } = rig({ PERPLEXITY_API_KEY: PPLX, INDAI_SECOND_OPINION: "off" }, answer as () => Response);
    const { a, claude } = asking();
    const { status, body } = await think(a, io);
    assert.equal(status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(claude, [{ text: a.userText, searches: undefined }]);
    assert.deepEqual(body.result, verdict);
    const step = (body.brains as any[])[0];
    assert.deepEqual([step.brain, step.ok, step.error], ["perplexity", false, error]);
    // the provider's own error text (it can quote a key) stays out of the answer and the log
    assert.doesNotMatch(JSON.stringify([body, logs]), /pplx-TEST|Bearer/);
  }
});

Deno.test("A spent budget stops the research step quietly; Claude's own budget check then decides", async () => {
  const { io, calls } = rig({ PERPLEXITY_API_KEY: PPLX }, () => assert.fail("nothing may be sent without a reservation"));
  io.reserve = () => Promise.reject(new HttpError(429, "budget", "INDAI's daily token budget is exhausted."));
  const { body } = await think(asking().a, io);
  assert.equal(calls.length, 0);
  assert.deepEqual((body.brains as any[]).map((s) => [s.brain, s.ok, s.error]), [["perplexity", false, "budget"], ["claude", true, undefined], ["chatgpt", false, "budget"]]);
  assert.deepEqual(body.result, verdict);
});

Deno.test("A second opinion that fails or rambles leaves the verdict untouched", async () => {
  for (const [second, error] of [["I think it looks fine overall.", "incomplete"], ['{"rag":"PURPLE"}', "incomplete"], [() => refuse(429, "request_rate_limit_exceeded"), "http_429"]] as const) {
    const { io, logs } = rig({ PERPLEXITY_API_KEY: PPLX }, desk(second as string));
    const { body } = await think(asking().a, io);
    assert.deepEqual(body.result, verdict);
    const step = (body.brains as any[])[2];
    assert.deepEqual([step.brain, step.role, step.ok, step.error], ["chatgpt", "second opinion", false, error]);
    if (error === "http_429") assert.equal((logs[0] as any).brains[2].detail, "request_rate_limit_exceeded");
  }
});

Deno.test("A model that does not take the reasoning setting is asked again without it", async () => {
  let asked = 0;
  const { io, calls } = rig({ PERPLEXITY_API_KEY: PPLX }, desk(() => ++asked === 1 ? refuse(400) : reply(opinion("AMBER"))));
  const { body } = await think(asking().a, io);
  assert.deepEqual(calls.slice(1).map((c) => [c.body.model, c.body.reasoning]), [["openai/gpt-6.1-sol", { effort: "low" }], ["openai/gpt-6.1-sol", undefined]]);
  assert.equal((body.result as any).second.rag, "AMBER");
});

Deno.test("When Claude is down ChatGPT stands in, in the same shape", async () => {
  const alt = { ...verdict, rag: "amber", confidence: 55, spoken: "This one is amber." };
  for (const failure of [new HttpError(502, "upstream", "The language provider rejected the request."), new DOMException("timed out", "TimeoutError")]) {
    const { io, calls, reserved } = rig({ PERPLEXITY_API_KEY: PPLX }, desk((call) => standingIn(call) ? reply("Here you go: " + JSON.stringify(alt)) : reply(opinion("GREEN"))));
    const { status, body } = await think(asking(down(failure)).a, io);
    assert.equal(status, 200);
    // Claude failed before the second opinion went out, so that request is called off and costs nothing
    assert.deepEqual(calls.map((c) => c.body.effort ?? (standingIn(c) ? "stand-in" : "second")), ["fast", "stand-in"]);
    assert.ok(calls[1].body.instructions.startsWith("SYSTEM PROMPT\nYou cannot search the web"));
    assert.match(calls[1].body.input, /research = /);
    const r = body.result as any;
    assert.deepEqual([body.model, r.rag, r.confidence, r.second], ["openai/gpt-6.1-sol", "AMBER", 55, undefined]);
    assert.equal(r.summary.at(-1), "Claude could not answer this time, so this read is ChatGPT's.");
    assert.deepEqual((body.brains as any[]).map((s) => [s.brain, s.role, s.ok, s.error]), [
      ["perplexity", "research", true, undefined], ["claude", "verdict", false, failure instanceof HttpError ? "upstream" : "failed"],
      ["chatgpt", "second opinion", false, "cancelled"], ["chatgpt", "stand-in for Claude", true, undefined],
    ]);
    assert.deepEqual(reserved.map((x) => x.settled), [[usage], [{ input_tokens: 0, output_tokens: 0 }], [usage]]);
    assert.deepEqual((body.sources as any[]).map((s) => s.url), ["https://example.com/nvda", "https://example.com/fed"]);
  }
  // a second opinion already on its way when Claude fails is left to finish and is counted, not thrown away unpaid
  const late = rig({ OPENAI_API_KEY: OPENAI }, (call) => standingIn(call) ? reply(JSON.stringify(alt)) : reply(opinion("GREEN")));
  const slow = { claude: () => new Promise<never>((_, no) => setTimeout(() => no(new HttpError(502, "upstream", "x")), 20)) };
  const { body } = await think(asking(slow).a, late.io);
  assert.deepEqual((body.brains as any[]).map((s) => [s.role, s.ok]), [["verdict", false], ["second opinion", true], ["stand-in for Claude", true]]);
  assert.deepEqual(late.reserved.map((x) => x.settled), [[usage], [usage]]);
  assert.equal((body.result as any).second, undefined);
});

Deno.test("A cut-off reply from Claude is rescued by ChatGPT, or is the same 502 as before without it", async () => {
  const cut = { claude: async () => ({ finalText: '{"rag":"GRE', sources: [], usage: null }) };
  const { io } = rig({ OPENAI_API_KEY: OPENAI, INDAI_SECOND_OPINION: "off" }, () => reply(JSON.stringify(verdict)));
  const saved = await think(asking(cut).a, io);
  assert.deepEqual([saved.status, saved.body.model, (saved.body.result as any).rag], [200, "gpt-6.1-sol", "GREEN"]);
  const alone = await think(asking(cut).a, rig({}, () => assert.fail("no provider")).io);
  assert.deepEqual([alone.status, alone.body.error, alone.body.raw, (alone.body.brains as any[])[0].error], [502, "parse", "", "incomplete"]);
  // why it was incomplete is on the step and in the log, so the next one can be diagnosed from the logs alone
  const limit = { claude: async () => ({ finalText: 'Checking the news first. {"rag":"GRE', sources: [], usage: { input_tokens: 9000, output_tokens: 6000 }, stop: "max_tokens" }) };
  const solo = rig({}, () => assert.fail("no provider"));
  const short = await think(asking(limit).a, solo.io);
  assert.deepEqual([short.status, short.body.error, short.body.message, short.body.brains], [502, "parse", "The answer was cut off before it was complete. Please ask again.", [{ brain: "claude", role: "verdict", model: "claude-sonnet-5-5", ok: false, ms: (short.body.brains as any[])[0].ms, tokens: 15000, error: "incomplete", stop: "max_tokens", out: 6000 }]]);
  assert.equal(solo.logs.length, 1);
  assert.deepEqual([(solo.logs[0] as any).fn, (solo.logs[0] as any).mode, (solo.logs[0] as any).brains[0].stop, JSON.stringify(solo.logs[0]).includes("Checking the news")], ["indai-brain", "trade", "max_tokens", false]);
  const ended = await think(asking({ claude: async () => ({ finalText: "I could not find enough.", sources: [], usage: null, stop: "end_turn" }) }).a, rig({}, () => assert.fail("no provider")).io);
  assert.deepEqual([ended.body.message, (ended.body.brains as any[])[0].stop, "out" in (ended.body.brains as any[])[0]], ["The provider returned an incomplete assessment.", "end_turn", false]);
  const both = rig({ OPENAI_API_KEY: OPENAI, INDAI_SECOND_OPINION: "off" }, () => reply("no json here"));
  const failed = await think(asking(cut).a, both.io);
  assert.deepEqual([failed.status, failed.body.error], [502, "parse"]);
});

Deno.test("A spent budget or a refused request is final: ChatGPT does not step in around it", async () => {
  for (const error of [new HttpError(429, "budget", "INDAI's daily token budget is exhausted."), new HttpError(429, "rate_limited", "Hourly request limit reached.")]) {
    const { io, calls, logs } = rig({ PERPLEXITY_API_KEY: PPLX }, desk(opinion("GREEN")));
    await assert.rejects(think(asking(down(error)).a, io), (e) => e === error);
    assert.equal(calls.length, 1); // the research only: the second opinion is called off and nobody stands in
    assert.deepEqual((logs[0] as any).brains.map((s: any) => [s.role, s.error]), [["research", undefined], ["verdict", error.code], ["second opinion", "cancelled"]]);
  }
  // and when ChatGPT cannot stand in either, the trader gets Claude's own error, as before
  const outage = new HttpError(502, "upstream", "The language provider rejected the request.");
  const last = rig({ PERPLEXITY_API_KEY: PPLX }, desk(() => refuse(503, "overloaded")));
  await assert.rejects(think(asking(down(outage)).a, last.io), (e) => e === outage);
  assert.deepEqual((last.logs[0] as any).brains.at(-1), { brain: "chatgpt", role: "stand-in for Claude", model: "openai/gpt-6.1-sol", via: "perplexity", ok: false, ms: (last.logs[0] as any).brains.at(-1).ms, error: "http_503", detail: "overloaded" });
});

Deno.test("An OpenAI key sends ChatGPT's part straight to OpenAI", async () => {
  const both = rig({ PERPLEXITY_API_KEY: PPLX, OPENAI_API_KEY: OPENAI, INDAI_SECOND_MODEL: "openai/gpt-6.2-sol" }, desk(opinion("GREEN")));
  const { body } = await think(asking().a, both.io);
  assert.deepEqual(both.calls.map((c) => [c.url, c.auth, c.body.model ?? c.body.effort]), [[AGENT, "Bearer " + PPLX, "fast"], [RESPONSES, "Bearer " + OPENAI, "gpt-6.2-sol"]]);
  assert.equal((body.brains as any[])[2].via, "openai");
  assert.doesNotMatch(JSON.stringify([body, both.logs]), /TEST-key/);
  // with only an OpenAI key there is no research desk: Claude searches as before and ChatGPT judges from the numbers
  const only = rig({ OPENAI_API_KEY: OPENAI }, desk(opinion("GREEN")));
  const { a, claude } = asking();
  await think(a, only.io);
  assert.deepEqual(claude, [{ text: a.userText, searches: undefined }]);
  assert.equal(only.calls.length, 1);
  assert.match(only.calls[0].body.input, /No web research is attached/);
  assert.deepEqual(brainStatus(false, only.io.env), { claude: false, perplexity: false, chatgpt: true });
});

Deno.test("A question (chat) gets the research but no second opinion", async () => {
  const { io, calls } = rig({ PERPLEXITY_API_KEY: PPLX }, desk(opinion("GREEN")));
  const answer = { spoken: "Waller speaks at two.", summary: ["Fed's Waller, 2 PM"] };
  const { a, claude } = asking({ mode: "chat", question: "Any Fed speakers today?", idea: undefined, claude: async (text, searches) => { claude.push({ text, searches }); return { finalText: JSON.stringify(answer), sources: [], usage: null }; } });
  const { body } = await think(a, io);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.input, /The trader's question: "Any Fed speakers today\?"/);
  assert.doesNotMatch(calls[0].body.input, /Parsed idea/);
  assert.deepEqual(body.result, answer);
  assert.deepEqual((body.brains as any[]).map((s) => [s.brain, s.role]), [["perplexity", "research"], ["claude", "answer"]]);
});

Deno.test("Replies are read in either provider's layout, and only web links become sources", () => {
  const perplexity = readResponse({ status: "completed", usage, output: [found, { type: "message", content: [{ type: "output_text", text: " A [1]. ", annotations: [] }, { type: "output_text", text: "B.", annotations: [] }] }] });
  assert.deepEqual([perplexity.text, perplexity.sources.length, perplexity.usage], ["A [1]. B.", 2, usage]);
  const openai = readResponse({
    output_text: "Whole answer.",
    output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: "Whole answer.", annotations: [
      { type: "url_citation", title: "", url: "https://example.com/a" }, { type: "url_citation", title: "Dup", url: "https://example.com/a" },
      { type: "url_citation", title: "Script", url: "javascript:alert(1)" }, { type: "file_citation", file_id: "f" },
    ] }] }],
  });
  assert.deepEqual([openai.text, openai.sources], ["Whole answer.", [{ title: "https://example.com/a", url: "https://example.com/a" }]]);
  assert.deepEqual(readResponse(null), { text: "", sources: [], usage: null, status: "completed" });
  assert.equal(readResponse({ status: "incomplete", output: [] }).status, "incomplete");
});

Deno.test("Requests to Perplexity start in turn, a little over a second apart; OpenAI is not held back", async () => {
  const waits: number[] = [];
  const { io, calls } = rig({ PERPLEXITY_API_KEY: PPLX }, desk(opinion("GREEN")));
  io.wait = async (ms) => { waits.push(ms); };
  await think(asking().a, io);
  // research just started, so the second opinion (same account) has to wait for its turn
  assert.equal(calls.length, 2);
  assert.ok(waits.length >= 1 && waits.every((ms) => ms > 0 && ms <= 1100), JSON.stringify(waits));
  const direct = rig({ OPENAI_API_KEY: OPENAI }, desk(opinion("GREEN")));
  direct.io.wait = () => assert.fail("OpenAI requests are not spaced");
  await think(asking().a, direct.io);
  assert.equal(direct.calls.length, 1);
});
