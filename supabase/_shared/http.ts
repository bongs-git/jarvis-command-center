export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-indai-pass",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
export function failure(error: unknown) {
  return error instanceof HttpError
    ? json({ error: error.code, message: error.message }, error.status)
    : json({ error: "upstream", message: "The requested service is temporarily unavailable." }, 502);
}
export async function bytes(req: Request, max: number) {
  const tooLarge = () => new HttpError(413, "too_large", "The request exceeds the size limit.");
  if (Number(req.headers.get("content-length")) > max) throw tooLarge();
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "bad_request", "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function objectBody(req: Request, max = 100_000) {
  const raw = await bytes(req, max);
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch { /* invalid JSON */ }
  throw new HttpError(400, "bad_request", "Expected a JSON object.");
}

const modes = new WeakMap<Request, string>();
const known = new Set([
  "talk",
  "trade",
  "chat",
  "history",
  "memory",
  "profile",
  "bars",
  "alerts",
  "snapshot",
  "daily",
  "quote",
  "chain",
  "news",
  "debug",
  "health",
  "gex-batch",
  "push",
  "test",
  "subscribe",
  "unsubscribe",
]);
export function markMode(req: Request, value: unknown) {
  modes.set(req, typeof value === "string" && known.has(value) ? value : "unknown");
}
export function serve(name: string, handle: (req: Request) => Response | Promise<Response>) {
  return Deno.serve(async (req) => {
    const start = performance.now();
    let response: Response;
    try {
      response = await handle(req);
    } catch (e) {
      response = failure(e);
    }
    console.info(
      JSON.stringify({
        fn: name,
        mode: modes.get(req) ?? req.method,
        ms: Math.round(performance.now() - start),
        status: response.status,
      }),
    );
    return response;
  });
}
