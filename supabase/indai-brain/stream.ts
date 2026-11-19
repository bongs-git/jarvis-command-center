import Anthropic from "npm:@anthropic-ai/sdk@0.74.0";

const encoder = new TextEncoder();
const frame = (value: unknown) => encoder.encode("data: " + JSON.stringify(value) + "\n\n");

// Decode only the leading spoken string. Hold incomplete JSON escapes and surrogate pairs.
export function spokenPrefix(raw: string): string {
  const match = raw.match(
    /^\s*(?:```(?:json)?\s*)?\{\s*"spoken"\s*:\s*"((?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*)/,
  );
  return match ? JSON.parse('"' + match[1] + '"').replace(/[\uD800-\uDBFF]$/, "") : "";
}

type TalkOptions = {
  key: string;
  model: string;
  system: string;
  history: Anthropic.MessageParam[];
  userText: string;
  search: boolean;
  signal: AbortSignal;
  headers: HeadersInit;
  finish: (
    result: Record<string, any>,
    sources: { title: string; url: string }[],
    usage: any,
  ) => Promise<unknown>;
};

export async function streamTalk(opts: TalkOptions) {
  const controller = new AbortController();
  const signal = AbortSignal.any([opts.signal, controller.signal, AbortSignal.timeout(110_000)]);
  const client = new Anthropic({ apiKey: opts.key, maxRetries: 0 });
  const messages: Anthropic.MessageParam[] = [...opts.history, { role: "user", content: opts.userText }];
  const sources: { title: string; url: string }[] = [];
  const run = async function* () {
    let sent = "";
    for (let step = 0; step < 4; step++) {
      const stream = client.messages.stream({
        model: opts.model,
        max_tokens: 700,
        messages,
        system: opts.system + '\nPut the "spoken" property first. Start with the JSON object.',
        ...(opts.search
          ? { tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 2 }] }
          : {}),
      }, { signal });
      let raw = "";
      for await (const event of stream) {
        if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
        raw += event.delta.text;
        const prefix = spokenPrefix(raw);
        if (prefix.length > sent.length && prefix.startsWith(sent)) {
          const delta = prefix.slice(sent.length);
          sent = prefix;
          yield frame({ delta });
        }
      }
      const message = await stream.finalMessage();
      for (const block of message.content) {
        if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
        for (const s of block.content) {
          if (s.url && sources.length < 12 && !sources.some((x) => x.url === s.url)) {
            sources.push({ title: s.title, url: s.url });
          }
        }
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const first = raw.indexOf("{"), last = raw.lastIndexOf("}");
      const result = JSON.parse(raw.slice(first, last + 1));
      if (typeof result?.spoken !== "string" || !result.spoken || !result.spoken.startsWith(sent)) {
        throw new Error("Invalid spoken result");
      }
      if (result.spoken.length > sent.length) yield frame({ delta: result.spoken.slice(sent.length) });
      yield frame(await opts.finish(result, sources, message.usage));
      yield encoder.encode("data: [DONE]\n\n");
      return;
    }
    throw new Error("Search continuation limit");
  };
  const events = run();
  // An upstream rejection before audio starts can still use a real HTTP error status.
  const first = await events.next();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      if (!first.done) c.enqueue(first.value);
    },
    async pull(c) {
      try {
        const next = await events.next();
        if (next.done) c.close();
        else c.enqueue(next.value);
      } catch {
        if (!signal.aborted || !controller.signal.aborted) {
          c.enqueue(
            frame({ error: "stream_interrupted", message: "The reply was interrupted. Please try again." }),
          );
          c.close();
        }
      }
    },
    async cancel() {
      controller.abort();
      await events.return(undefined);
    },
  });
  return new Response(body, {
    headers: {
      ...opts.headers,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
