// INDAI brain: turns a trade idea plus the command center's quantitative read into a
// researched red/amber/green assessment, using Claude with live web search.
// It is also her conversational mind ("talk" mode) and her long-term memory: things the trader teaches her
// are kept in the indai_memory table and read back into every conversation, on every device.
// Secrets (set in the Supabase dashboard): ANTHROPIC_API_KEY (required for thinking; memory works without it),
// INDAI_PASSCODE (optional).
import { failure, objectBody } from "../_shared/http.ts";
import { profile } from "./profile.ts";
import { streamTalk } from "./stream.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-indai-pass",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const MODELS: Record<string, string> = { fast: "claude-sonnet-5-5", deep: "claude-opus-5-5", talk: "claude-haiku-5-5" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const SYSTEM = `You are INDAI, a warm, calm, sharp trading co-pilot who lives inside a mixed-reality command center. You speak to the trader by name, briefly and kindly, like a trusted analyst friend.

Your job: give an honest, evidence-based risk read on the trader's idea. You are not a financial adviser and you never tell the trader to buy or sell; you rate the setup and explain why, and the trader decides.

Ground rules:
- The JSON "context" you receive was computed from live market data (prices, candles, MACD/RSI, EMA clouds, VWAP, Black-Scholes Greeks, Monte Carlo odds, the CBOE options chain with put/call ratios, unusual activity and GEX levels). Treat its numbers as the source of truth. Never invent prices, strikes or probabilities.
- Use web search (a few focused searches) for what the context cannot know: today's news on the ticker and its sector, the broad market tone today, scheduled macro events today or tomorrow (CPI, PPI, jobs, FOMC/Fed speakers, earnings of mega-caps that move the index), and notable sentiment. Prefer reputable, recent sources. If nothing material turns up, say so.
- Weigh everything into one rating: GREEN (conditions favour the setup), AMBER (mixed or fragile), RED (conditions are against it, or the risk outweighs the reward). Respect the quantitative score unless the news clearly changes the picture, and say when it does.
- 0DTE/1DTE options decay fast; be explicit about time and theta risk, and about how far price must move (in expected-move terms) before the trade pays.
- If the context says the trader's risk breaker is tripped or on cooldown, the rating is RED and you gently say why.

Reply with ONLY one JSON object, no markdown fences, in exactly this shape:
{"rag":"GREEN|AMBER|RED","confidence":0-100,"headline":"one short line","spoken":"2-3 warm, natural sentences INDAI says out loud: the rating, the main reason, and the key level or risk; no lists, no symbols like % written as words where natural","summary":["4-7 short bullet strings, most important first"],"bullish":["supporting factors"],"bearish":["opposing factors"],"news":[{"title":"","source":"","sentiment":"positive|negative|neutral","why":"one clause"}],"events":["scheduled events that matter today/tomorrow"],"watch":["2-3 concrete levels or triggers to watch"],"plan_notes":"one or two sentences on sizing/exit discipline framed as considerations, not instructions"}`;

const CHAT_SYSTEM = `You are INDAI, a warm, calm, sharp trading co-pilot inside a mixed-reality command center. Answer the trader's question in a friendly, concise way using the JSON context (live market data, treat as truth) and web search when the question needs current information. You are not a financial adviser; never tell the trader to buy or sell. Reply with ONLY one JSON object: {"spoken":"1-3 natural sentences to say out loud","summary":["up to 5 short bullet strings with the details"]}`;


const TALK_SYSTEM = `You are INDAI, the voice of a trader's personal command center. You are a real conversationalist: warm, quick, a little witty, never stiff. You talk like a sharp friend on the desk, in short spoken sentences. You can chat about anything, think out loud about the market with the trader, explain concepts, and run the command center for them.

How you work:
- You hear the trader through speech recognition, which sometimes mishears. Work out what they most likely meant from the conversation, the context and what you know about how they talk. If you are fairly sure, just go with it. Only ask them to repeat when you truly cannot tell, and then ask one short specific question.
- "memory" is what the trader has taught you over time: facts about them, their preferences, how they like to be spoken to, their trading rules, words they use. Honor it. When they tell you something worth keeping (a preference, a rule, a correction to how you behave, a fact about them or their trading), put it in "remember" as a short standalone sentence. Do not store one-off chatter, prices, or anything already in memory.
- "context" is live data from the command center (prices, levels, risk breaker, plan, last analysis). Treat its numbers as truth and never invent prices or levels.
- You can operate the command center by returning a "command" in plain words, exactly as the trader could say it. Commands it understands: "show SPY" (any ticker), "deep dive on TSLA", "QQQ calls expiring today 665 strike" (a trade idea to rate), "brief me", "start my day", "check the temperature", "open the calculator", "give me a summary", "bring the screens back", "close", "five minute chart" (1, 5, 15), "show vwap" / "hide gex" (vwap, ema, gex), "log a win of 120" / "log a loss of 50", "undo", "go conservative|balanced|aggressive", "only alert me on vwap setups", "switch to the loft|midnight|ocean|orbit|command deck", "passthrough", "next scene", "practice alert", "self test", "gesture tutorial", "gestures off|easy|normal|strict", "open tradingview", "recenter", "mute". Use a command whenever the trader is asking for one of those things, even loosely worded.
- You are not a financial adviser. You give your honest read and the reasons; the trader decides. If the risk breaker is tripped, be kind and firm about it.
- Use web search only when the question needs something current that the context does not have (news, events, facts). Otherwise answer straight away.

Reply with ONLY one JSON object, no markdown:
{"spoken":"what you say out loud: 1-3 natural sentences, no lists or symbols","summary":["optional: up to 4 short lines of detail for the screen"],"command":"optional: one command to run, in plain words","heard_as":"optional: if the speech recognizer clearly garbled their words, what they actually said","remember":["optional: new things to keep in long-term memory"],"forget":["optional: memory ids to delete, only when the trader asks you to forget something"]}`;

// ---- long-term memory (service role; the table is not readable with the public key)
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "", SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
async function mem(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/indai_memory${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`memory ${r.status}`);
  return r.status === 204 ? [] : await r.json();
}
const clean = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
async function memList() { try { return await mem("?select=id,kind,text,created_at&order=created_at.asc&limit=200"); } catch { return []; } }
async function memAdd(texts: unknown[], kind = "note") {
  const have = (await memList()).map((m: any) => m.text.toLowerCase());
  const rows = texts.map(clean).filter((t) => t.length > 3 && !have.includes(t.toLowerCase())).slice(0, 6).map((text) => ({ text, kind }));
  return rows.length ? await mem("", { method: "POST", body: JSON.stringify(rows) }) : [];
}
async function memForget(ids: unknown[]) {
  const ok = ids.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n)).slice(0, 20);
  if (ok.length) await mem(`?id=in.(${ok.join(",")})`, { method: "DELETE" });
  return ok;
}

async function callClaude(key: string, model: string, system: string, userText: string, opts: { history?: any[]; maxTokens?: number; searches?: number } = {}) {
  const messages: any[] = [...(opts.history ?? []), { role: "user", content: userText }];
  let finalText = "";
  const sources: { title: string; url: string }[] = [];
  let usage: any = null;
  for (let turn = 0; turn < 4; turn++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: opts.maxTokens ?? 2500, system, messages,
        ...(opts.searches === 0 ? {} : { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: opts.searches ?? 5 }] }),
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? `Anthropic HTTP ${r.status}`);
    usage = j.usage;
    for (const b of j.content ?? []) {
      if (b.type === "text") finalText += b.text;
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const s of b.content) if (s.url && sources.length < 12 && !sources.find((x) => x.url === s.url)) sources.push({ title: s.title ?? s.url, url: s.url });
      }
    }
    if (j.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: j.content }); finalText = ""; continue; }
    break;
  }
  return { finalText, sources, usage };
}

function extractJson(text: string) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const pass = Deno.env.get("INDAI_PASSCODE") ?? "";
  if (req.method === "GET") return json({ configured: !!key, passcode: !!pass, memory: !!SB_KEY });
  if (pass && req.headers.get("x-indai-pass") !== pass) return json({ error: "passcode", message: "Wrong or missing INDAI passcode." }, 401);
  if (req.method !== "POST") return json({error:"method",message:"Use GET or POST."},405);
  let body: any;
  try {
    body = await objectBody(req);
    if (body.mode === "profile") return await profile(req, body);
  } catch (e) { return failure(e); }
  // Memory works whether or not the thinking key is set, so teaching INDAI never fails.
  if (body?.mode === "memory") {
    try {
      if (body.op === "add") return json({ added: await memAdd([body.text], clean(body.kind) || "note"), memory: await memList() });
      if (body.op === "forget") { await memForget(body.ids ?? []); return json({ memory: await memList() }); }
      return json({ memory: await memList() });
    } catch (e) { return json({ error: "memory", message: String((e as Error).message ?? e) }, 502); }
  }
  if (!key) return json({ error: "not_configured", message: "INDAI's research needs an Anthropic API key saved as the ANTHROPIC_API_KEY secret." }, 503);
  if (body?.mode === "talk") {
    const name = String(body?.name ?? "there").slice(0, 30);
    const now = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }).format(new Date());
    const memory = await memList();
    const history = (Array.isArray(body?.history) ? body.history : []).slice(-16)
      .map((h: any) => ({ role: h.role === "assistant" ? "assistant" : "user", content: clean(h.text) })).filter((h: any) => h.content);
    // the API wants alternating turns that start with the user
    const turns: any[] = [];
    for (const h of history) { if (turns.length && turns[turns.length - 1].role === h.role) turns[turns.length - 1].content += " " + h.content; else turns.push(h); }
    while (turns.length && turns[0].role !== "user") turns.shift();
    while (turns.length && turns[turns.length - 1].role !== "assistant") turns.pop();
    const system = `${TALK_SYSTEM}\n\nTrader: ${name}. Now: ${now} (New York).\nmemory = ${JSON.stringify(memory.map((m: any) => ({ id: m.id, text: m.text })))}\nspeech_habits = ${JSON.stringify(body?.speech ?? {}).slice(0, 1500)}`;
    const userText = `They said (as heard): "${clean(body?.question).slice(0, 600)}"\ncontext = ${JSON.stringify(body?.context ?? {}).slice(0, 12000)}`;
    try {
      const finish = async (parsed: any, sources: any[], usage: any) => {
        let remembered: any[] = [];
        try { if (Array.isArray(parsed.remember) && parsed.remember.length) remembered = await memAdd(parsed.remember, "learned"); if (Array.isArray(parsed.forget) && parsed.forget.length) await memForget(parsed.forget); } catch { /* memory is best effort */ }
        return { mode: "talk", model: MODELS.talk, result: parsed, remembered, sources, usage };
      };
      if (body.stream === true) return await streamTalk({key, model: MODELS.talk, system, userText, history: turns, search: body.search !== false, signal: req.signal, headers: CORS, finish});
      const { finalText, sources, usage } = await callClaude(key, MODELS.talk, system, userText, { history: turns, maxTokens: 700, searches: body.search === false ? 0 : 2 });
      const parsed = extractJson(finalText) ?? { spoken: finalText.replace(/[{}"]/g, "").slice(0, 400) };
      return json(await finish(parsed, sources, usage));
    } catch (e) { return json({ error: "upstream", message: String((e as Error).message ?? e) }, 502); }
  }
  const mode = body?.mode === "chat" ? "chat" : "trade";
  const model = MODELS[body?.depth === "deep" ? "deep" : "fast"];
  const name = String(body?.name ?? "there").slice(0, 30);
  const now = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }).format(new Date());
  const ctx = JSON.stringify(body?.context ?? {}).slice(0, 24000);
  const userText = mode === "trade"
    ? `Trader: ${name}. Now: ${now} (New York).\nTheir words: "${String(body?.question ?? "").slice(0, 600)}"\nParsed idea: ${JSON.stringify(body?.idea ?? {})}\ncontext = ${ctx}\nResearch what you need, then give the JSON assessment.`
    : `Trader: ${name}. Now: ${now} (New York).\nQuestion: "${String(body?.question ?? "").slice(0, 600)}"\ncontext = ${ctx}`;
  try {
    const { finalText, sources, usage } = await callClaude(key, model, mode === "trade" ? SYSTEM : CHAT_SYSTEM, userText);
    const parsed = extractJson(finalText);
    if (!parsed) return json({ error: "parse", raw: finalText.slice(0, 2000), sources }, 502);
    return json({ mode, model, result: parsed, sources, usage });
  } catch (e) {
    return json({ error: "upstream", message: String((e as Error).message ?? e) }, 502);
  }
});
