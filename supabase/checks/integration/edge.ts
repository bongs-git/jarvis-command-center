const realServe = Deno.serve;
const handlers = new Map<string, (r: Request) => Response | Promise<Response>>();
let name = "";
(Deno as any).serve = (handler: any) => {
  handlers.set(name, handler);
  return {};
};
for (name of ["indai-brain", "indai-market", "indai-tv", "indai-push", "indai-jobs", "indai-ears"]) {
  await import("../../" + name + "/index.ts");
}
(Deno as any).serve = realServe;
const native = globalThis.fetch;
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
let fixtureMode = "normal";
let fixed = 0;
const BaseDate = Date;
class FixtureDate extends BaseDate {
  constructor(...args: any[]) {
    if (args.length) super(...args as [string]);
    else super(fixed || BaseDate.now());
  }
  static now() {
    return fixed || BaseDate.now();
  }
}
globalThis.Date = FixtureDate;
const log = (entry: unknown) =>
  Deno.writeTextFileSync(Deno.env.get("LAB_DIR") + "/provider.ndjson", JSON.stringify(entry) + "\n", {
    append: true,
  });
globalThis.fetch = async (input, init) => {
  const r = new Request(input, init), u = new URL(r.url);
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
    if (fixed && u.pathname === "/rest/v1/rpc/indai_market_session") {
      return native(u, {
        method: "POST",
        headers: r.headers,
        body: JSON.stringify({ p_now: new Date(fixed).toISOString() }),
      });
    }
    return native(r);
  }
  if (u.hostname === "api.anthropic.com") {
    const b = await r.json();
    const history = b.messages.slice(0, -1);
    const last = b.messages.at(-1).content;
    let reply: any = {
      spoken: history.length ? "I remember the earlier word Juniper." : "Good morning, Bongs.",
      summary: ["Fixture summary"],
    };
    if (b.system.includes('"groups"')) {
      const rows = JSON.parse(last);
      reply = {
        groups: [
          rows.filter((x: any) =>
            x.text.toLowerCase().includes("first five") || x.text.toLowerCase().includes("opening five")
          ).map((i: any) => i.id),
        ],
      };
    } else if (b.system.includes("evidence-based risk")) {
      reply = {
        rag: "AMBER",
        confidence: 50,
        headline: "Fixture",
        spoken: "Fixture.",
        summary: [],
        bullish: [],
        bearish: [],
        news: [],
        events: [],
        watch: [],
        plan_notes: "Fixture.",
      };
    } else if (last.includes("remember Juniper")) {
      reply = {
        spoken: "I will remember Juniper.",
        remember: ["Juniper is the session word."],
        remember_kinds: ["fact"],
      };
    }
    if (b.system.includes("Juniper is the session word.")) {
      const m = b.system.match(/memory = (.*)\nspeech_habits/);
      if (m) {
        const row = JSON.parse(m[1]).find((x: any) => x.text.includes("Juniper"));
        if (row) reply.used_ids = [row.id];
      }
    }
    const raw = JSON.stringify(reply);
    log({ vendor: "anthropic", tools: !!b.tools, stream: b.stream === true, turns: b.messages.length });
    const usage = { input_tokens: 40, output_tokens: 14 };
    if (!b.stream) {
      return json({
        type: "message",
        content: [{ type: "text", text: raw }],
        stop_reason: "end_turn",
        usage,
      });
    }
    const event = (type: string, extras: any) =>
      "event: " + type + "\ndata: " + JSON.stringify({ type, ...extras }) + "\n\n";
    const chunks = [
      event("message_start", {
        message: {
          id: "msg_local",
          role: "assistant",
          type: "message",
          model: b.model,
          content: [],
          usage,
          stop_reason: null,
        },
      }),
      event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ...Array.from({ length: Math.ceil(raw.length / 6) }, (_, i) =>
        event("content_block_delta", {
          index: 0,
          delta: { type: "text_delta", text: raw.slice(i * 6, i * 6 + 6) },
        })),
      event("content_block_stop", { index: 0 }),
      event("message_delta", {
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 14 },
      }),
      event("message_stop", {}),
    ];
    return new Response(
      new ReadableStream({
        async pull(c) {
          await new Promise((r) => setTimeout(r, 12));
          if (chunks.length) c.enqueue(new TextEncoder().encode(chunks.shift()));
          else c.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  }
  if (u.hostname === "api.deepgram.com") {
    log({
      vendor: "deepgram",
      terms: u.searchParams.getAll("keyterm"),
      bytes: (await r.arrayBuffer()).byteLength,
    });
    return json({
      results: {
        channels: [{
          alternatives: [{ transcript: "QQQ calls expiring today 665 strike" }, {
            transcript: "QQQ calls expiring today six sixty five strike",
          }],
        }],
      },
    });
  }
  if (u.hostname === "fcm.googleapis.com") {
    const encrypted = new Uint8Array(await r.arrayBuffer());
    log({
      vendor: "push",
      vapid: r.headers.has("authorization"),
      encoding: r.headers.get("content-encoding"),
      bytes: encrypted.length,
    });
    return new Response(null, { status: 201 });
  }
  if (u.hostname === "api.massive.com") {
    const q = u.searchParams.get("ticker.any_of") || "QQQ";
    if (u.pathname === "/v3/snapshot") {
      return json({
        results: q.split(",").map((ticker) => ({
          ticker,
          last_trade: {
            price: 100,
            timeframe: fixtureMode === "delayed" ? "DELAYED" : "REAL-TIME",
            last_updated: Date.now() * 1e6,
          },
          session: { change: 1, volume: 1000, previous_close: 99, open: 99, high: 101, low: 98, close: 100 },
        })),
      });
    }
    if (u.pathname.startsWith("/v2/aggs/")) {
      return json({ results: [{ t: Date.now() - 60_000, o: 99, h: 101, l: 98, c: 100, v: 123 }] });
    }
    const expiry = new Date(Date.now() + 7 * 86400e3).toISOString().slice(2, 10).replaceAll("-", "");
    const second = u.searchParams.has("cursor");
    return json({
      results: [{
        details: {
          ticker: "O:QQQ" + expiry + (second ? "P00099000" : "C00101000"),
          shares_per_contract: 100,
        },
        last_quote: { bid: 1, ask: 2, timeframe: "REAL-TIME" },
        last_trade: { price: 1.5, timeframe: "REAL-TIME" },
        greeks: { delta: 0.5, gamma: 0.03 },
        day: { volume: 5 },
        implied_volatility: .3,
        open_interest: 100,
      }],
      next_url: second ? null : "https://api.massive.com/v3/snapshot/options/QQQ?cursor=2",
    });
  }
  if (u.hostname === "cdn.cboe.com") {
    const sym = u.pathname.split("/").at(-1)!.replace(".json", "").replace("_", "");
    const exp = new Date(Date.now() + 7 * 86400e3).toISOString().slice(2, 10).replaceAll("-", "");
    return json({
      timestamp: new Date().toISOString(),
      data: {
        current_price: 100,
        close: 100,
        prev_day_close: 99,
        options: ["C00101000", "P00099000"].map((option) => ({
          option: sym + exp + option,
          bid: 1,
          ask: 2,
          open_interest: 100,
          iv: .25,
          last_trade_price: 1.5,
        })),
      },
    });
  }
  throw new Error("Unexpected fixture host");
};
realServe({ hostname: "127.0.0.1", port: 55435 }, async (r) => {
  const u = new URL(r.url);
  if (u.pathname === "/test-mode") {
    fixtureMode = u.searchParams.get("mode") || "normal";
    fixed = Number(u.searchParams.get("at")) || 0;
    if (u.searchParams.has("budget")) Deno.env.set("INDAI_DAILY_TOKEN_BUDGET", u.searchParams.get("budget")!);
    return json({ ok: true });
  }
  if (u.pathname.startsWith("/functions/v1/")) return await handlers.get(u.pathname.split("/")[3])!(r);
  const auth = u.pathname.startsWith("/auth/v1/");
  const path = u.pathname.replace(auth ? "/auth/v1" : "/rest/v1", "");
  const dest = "http://127.0.0.1:" + (auth ? "55434" : "55433") + path + u.search;
  return native(dest, {
    method: r.method,
    headers: r.headers,
    body: r.method === "GET" || r.method === "HEAD" ? undefined : r.body,
    redirect: "manual",
  });
});
