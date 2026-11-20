import { serve, markMode } from "../_shared/http.ts";
// INDAI brain: turns a trade idea plus the command center's quantitative read into a
// researched red/amber/green assessment, using Claude with live web search.
// It is also her conversational mind ("talk" mode) and her long-term memory: things the trader teaches her
// are kept in the indai_memory table and read back into every conversation, on every device.
// With more keys set, a researched answer uses three brains (see super.ts): Perplexity researches, Claude
// judges, ChatGPT gives a second opinion and stands in when Claude cannot answer.
// Secrets (set in the Supabase dashboard): ANTHROPIC_API_KEY (required for thinking; memory works without it),
// INDAI_PASSCODE (optional), PERPLEXITY_API_KEY (optional), OPENAI_API_KEY (optional).
import { reserveTokens } from "../_shared/budget.ts";
import { clean, ids, memAdd, memForget, memList } from "./memory.ts";
import { account, rateLimit } from "../_shared/auth.ts";
import { rpc, uuid } from "../_shared/db.ts";
import { clearHistory, recentTurns, saveTurns, sessionName } from "./history.ts";
import { failure, HttpError, objectBody } from "../_shared/http.ts";
import { profile } from "./profile.ts";
import { streamTalk } from "./stream.ts";
import { brainStatus, extractJson, think } from "./super.ts";

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

Include used_ids for supplied memories that actually informed this reply, and remember_kinds (fact, preference, rule, vocabulary) aligned with remember.
Reply with ONLY one JSON object, no markdown:
{"spoken":"what you say out loud: 1-3 natural sentences, no lists or symbols","summary":["optional: up to 4 short lines of detail for the screen"],"command":"optional: one command to run, in plain words","heard_as":"optional: if the speech recognizer clearly garbled their words, what they actually said","remember":["optional: new things to keep in long-term memory"],"forget":["optional: memory ids to delete, only when the trader asks you to forget something"]}`;

async function callClaude(key: string, model: string, system: string, userText: string, opts: { history?: any[]; maxTokens?: number; searches?: number } = {}) {
  const messages: any[] = [...(opts.history ?? []), { role: "user", content: userText }];
  let finalText = "";
  const sources: { title: string; url: string }[] = [];
  let usage: any = null;
  for (let turn = 0; turn < 4; turn++) {
    const settle = await reserveTokens({system,messages}, opts.maxTokens ?? 2500, opts.searches ?? 5);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal:AbortSignal.timeout(90_000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: opts.maxTokens ?? 2500, system, messages,
        ...(opts.searches === 0 ? {} : { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: opts.searches ?? 5 }] }),
      }),
    });
    const j = await r.json();
    if (!r.ok) { await settle({input_tokens:0,output_tokens:0}); throw new HttpError(502,"upstream","The language provider rejected the request."); }
    await settle(j.usage);
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

serve("indai-brain",async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const pass = Deno.env.get("INDAI_PASSCODE") ?? "";
  if (req.method === "GET") return json({ configured: !!key, passcode: !!pass, memory: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), brains: brainStatus(!!key) });
  if (req.method !== "POST") return json({error:"method",message:"Use GET or POST."},405);
  let body: any, session = "default", talkUser: string | null = null;
  try {
    body = await objectBody(req);
    markMode(req,body.mode??"trade");
    if (body.mode === "talk" || body.mode === "history") session = sessionName(body.session);
    if (body.mode === "history") {
      const user = await account(req);
      if (body.op === "clear") { await clearHistory(user, session); return json({turns:[]}); }
      if (body.op === "list") return json({turns:await recentTurns(user, session)});
      throw new HttpError(400,"bad_request","Choose list or clear.");
    }
    if (body.mode === "talk") {
      if (body.request_id != null && !uuid.test(body.request_id)) throw new HttpError(400,"bad_request","request_id must be a UUID.");
    }
    if (body.mode === "profile") return await profile(req, body);
  } catch (e) { return failure(e); }
  // Memory works whether or not the thinking key is set, so teaching INDAI never fails.
  if (body?.mode === "memory") {
    try {
      const user = await account(req);
      if (body.op === "add") return json({ added: await memAdd(user,[body.text],[body.kind]), memory: await memList(user) });
      if (body.op === "forget") { await memForget(user,body.ids ?? []); return json({ memory: await memList(user) }); }
      return json({ memory: await memList(user) });
    } catch(e) { return failure(e); }
  }
  if (!key) return json({ error: "not_configured", message: "INDAI's research needs an Anthropic API key saved as the ANTHROPIC_API_KEY secret." }, 503);
  const streaming = body?.mode === "talk" && body.stream === true;
  try {
    talkUser = await account(req,true);
    // Stateless streams combine their rate check with their first token reservation.
    if (talkUser || !streaming) await rateLimit(talkUser);
  } catch(e) { return failure(e); }
  if (body?.mode === "talk") {
    const name = String(body?.name ?? "there").slice(0, 30);
    const now = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }).format(new Date());
    let memory: any[] = [];
    let prior = Array.isArray(body.history) ? body.history : [];
    try {
      if (talkUser) [memory, prior] = await Promise.all([
        memList(talkUser, 40),
        prior.length ? Promise.resolve(prior) : recentTurns(talkUser, session),
      ]);
    } catch(e) { return failure(e); }
    const history = prior.slice(-16)
      .filter((h: any) => h && typeof h === "object")
      .map((h: any) => ({ role: h.role === "assistant" ? "assistant" : "user", content: clean(h.text) })).filter((h: any) => h.content);
    // the API wants alternating turns that start with the user
    const turns: any[] = [];
    for (const h of history) { if (turns.length && turns[turns.length - 1].role === h.role) turns[turns.length - 1].content += " " + h.content; else turns.push(h); }
    while (turns.length && turns[0].role !== "user") turns.shift();
    while (turns.length && turns[turns.length - 1].role !== "assistant") turns.pop();
    const system = `${TALK_SYSTEM}\n\nTrader: ${name}. Now: ${now} (New York).\nmemory = ${JSON.stringify(memory.map((m: any) => ({ id: m.id, kind: m.kind, text: m.text })))}\nspeech_habits = ${JSON.stringify(body?.speech ?? {}).slice(0, 1500)}`;
    const userText = `They said (as heard): "${clean(body?.question).slice(0, 600)}"\ncontext = ${JSON.stringify(body?.context ?? {}).slice(0, 12000)}`;
    try {
      const finish = async (parsed: any, sources: any[], usage: any) => {
        let remembered: any[] = [];
        if (talkUser) {
          if (Array.isArray(parsed.remember) && parsed.remember.length) remembered = await memAdd(talkUser,parsed.remember,Array.isArray(parsed.remember_kinds) ? parsed.remember_kinds : []);
          const known = new Set(memory.map(m=>Number(m.id)));
          const used = ids(parsed.used_ids).filter(id=>known.has(id));
          if (used.length) await rpc("indai_use_memories",{p_user:talkUser,p_ids:used});
          await memForget(talkUser,ids(parsed.forget).filter(id=>known.has(id)));
        }
        if (talkUser) await saveTurns(talkUser,session,clean(body.question),String(parsed.spoken),body.request_id ?? null);
        return { mode: "talk", model: MODELS.talk, result: parsed, remembered, sources, usage };
      };
      if (body.stream === true) return await streamTalk({key, model: MODELS.talk, system, userText, history: turns, search: body.search !== false, admitGuest: talkUser === null, signal: req.signal, headers: CORS, finish});
      const { finalText, sources, usage } = await callClaude(key, MODELS.talk, system, userText, { history: turns, maxTokens: 700, searches: body.search === false ? 0 : 2 });
      const parsed = extractJson(finalText) ?? { spoken: finalText.replace(/[{}"]/g, "").slice(0, 400) };
      return json(await finish(parsed, sources, usage));
    } catch(e) { return failure(e); }
  }
  const mode = body?.mode === "chat" ? "chat" : "trade";
  const depth = body?.depth === "deep" ? "deep" : "fast";
  const model = MODELS[depth];
  const name = String(body?.name ?? "there").slice(0, 30);
  const now = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }).format(new Date());
  const ctx = JSON.stringify(body?.context ?? {}).slice(0, 24000);
  const question = String(body?.question ?? "").slice(0, 600);
  const userText = mode === "trade"
    ? `Trader: ${name}. Now: ${now} (New York).\nTheir words: "${question}"\nParsed idea: ${JSON.stringify(body?.idea ?? {})}\ncontext = ${ctx}\nResearch what you need, then give the JSON assessment.`
    : `Trader: ${name}. Now: ${now} (New York).\nQuestion: "${question}"\ncontext = ${ctx}`;
  // The other brains get the same evidence without the trader's name.
  const evidence = mode === "trade"
    ? `Now: ${now} (New York).\nThe trader's words: "${question}"\nParsed idea: ${JSON.stringify(body?.idea ?? {}).slice(0, 2000)}\ncontext = ${ctx}`
    : `Now: ${now} (New York).\nQuestion: "${question}"\ncontext = ${ctx}`;
  const system = mode === "trade" ? SYSTEM : CHAT_SYSTEM;
  try {
    const answer = await think({
      mode, depth, model, system, userText, evidence, now, question, idea: body?.idea, context: body?.context,
      claude: (text, searches) => callClaude(key, model, system, text, searches == null ? {} : { searches }),
    });
    return json(answer.body, answer.status);
  } catch (e) {
    return failure(e);
  }
});
