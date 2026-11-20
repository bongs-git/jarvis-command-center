import { serve } from "../_shared/http.ts";
// INDAI <-> Schwab: the owner's sign-in to his own Schwab account, so INDAI can read live quotes, option chains
// and candles for him (supabase/indai-market reads them; see _shared/schwab.ts for the tokens).
//   POST {op:"status"}             is the app set up, is he signed in, and until when
//   POST {op:"start"}              the address at Schwab where he signs in
//   POST {op:"finish", url}        the address his browser ended on (it holds a one-time code): INDAI keeps the tokens
//   POST {op:"disconnect"}         forget the tokens
//   POST {op:"check"}              does Schwab recognise the app's key and secret (for when its sign-in page refuses)
// Every request needs the owner: his passcode header or his own sign-in. Tokens are never sent back.
// Secrets he sets in Supabase himself: SCHWAB_APP_KEY, SCHWAB_APP_SECRET (and SCHWAB_CALLBACK if it is not https://127.0.0.1).
import { account } from "../_shared/auth.ts";
import { db, rpc } from "../_shared/db.ts";
import { failure, HttpError, objectBody } from "../_shared/http.ts";
import { appRecognised, authorizeUrl, codeFrom, MARKET, schwabApp, schwabSession } from "../_shared/schwab.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-indai-pass",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

serve("indai-schwab", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method", message: "Use POST." }, 405);
  try {
    const body = await objectBody(req, 8000);
    const user = await account(req);
    const [owner] = await db("indai_owner", { select: "user_id", limit: "1" });
    if (!owner || owner.user_id !== user) throw new HttpError(403, "forbidden", "Only the owner connects Schwab.");
    if (!await rpc("indai_take_request", { p_user: user, p_bucket: "schwab", p_limit: 60 })) throw new HttpError(429, "rate_limited", "Hourly request limit reached. Try again later.");
    const app = schwabApp(), session = schwabSession({ app });
    if (body.op === "status") return json(await session.status());
    if (!app) throw new HttpError(503, "not_configured", "Add SCHWAB_APP_KEY and SCHWAB_APP_SECRET to the Supabase secrets first.");
    if (body.op === "start") return json({ url: authorizeUrl(app), callback: app.callback });
    if (body.op === "check") return json({ callback: app.callback, ...await appRecognised(app) });
    if (body.op === "disconnect") { await session.disconnect(); return json(await session.status()); }
    if (body.op !== "finish") throw new HttpError(400, "bad_request", "Choose status, start, check, finish or disconnect.");
    const code = codeFrom(body.url ?? body.code);
    if (!code) throw new HttpError(400, "no_code", "That is not the address Schwab sent you to. After you approve, copy the whole address of the page that fails to load (it starts with " + app.callback + ") and paste it here.");
    const token = await session.connect(code);
    // One real request, so the page can say at once whether Schwab's data is flowing and whether it is live.
    let test: Record<string, unknown>;
    try {
      const r = await fetch(MARKET + "/quotes?symbols=SPY&fields=quote&indicative=false", { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      const row = r.ok ? (await r.json())?.SPY : null;
      test = row?.quote ? { ok: true, symbol: "SPY", price: row.quote.lastPrice ?? null, realtime: row.realtime === true } : { ok: false, status: r.status };
    } catch { test = { ok: false, status: 0 }; }
    return json({ ...await session.status(), test });
  } catch (e) { return failure(e); }
});
