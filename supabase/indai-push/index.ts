import { markMode, serve } from "../_shared/http.ts";
import { account, rateLimit } from "../_shared/auth.ts";
import { db, rpc } from "../_shared/db.ts";
import { CORS, failure, HttpError, json, objectBody } from "../_shared/http.ts";
import { endpoint, pushConfig, sendPush, subscription } from "./webpush.ts";

serve("indai-push", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method === "GET") return json({ publicKey: pushConfig().publicKey });
    if (req.method !== "POST") throw new HttpError(405, "method", "Use GET or POST.");
    const user = await account(req);
    const body = await objectBody(req, 8192);
    markMode(req, body.op);
    if (body.op === "subscribe") {
      pushConfig();
      const s = subscription(body.subscription ?? body);
      if (!await rpc("indai_register_push", { p_user: user, p_endpoint: s.endpoint, p_keys: s.keys })) {
        throw new HttpError(
          409,
          "subscription_in_use",
          "Create a new browser subscription for this account.",
        );
      }
      return json({ subscribed: true });
    }
    const filter: Record<string, string> = { user_id: "eq." + user };
    if (body.op === "unsubscribe") {
      filter.endpoint = "eq." + endpoint(body.endpoint ?? body.subscription?.endpoint);
      await db("indai_push_subs", filter, { method: "DELETE" });
      return json({ subscribed: false });
    }
    if (body.op !== "test") throw new HttpError(400, "bad_request", "Choose subscribe, unsubscribe or test.");
    pushConfig();
    await rateLimit(user, "push-test");
    if (body.endpoint) filter.endpoint = "eq." + endpoint(body.endpoint);
    const rows = await db("indai_push_subs", { ...filter, select: "endpoint,keys" });
    if (!rows.length) throw new HttpError(404, "no_subscription", "Subscribe a browser first.");
    let accepted = 0;
    for (const row of rows) {
      const outcome = await sendPush(row, {
        title: "INDAI",
        body: "Test notification from your command center.",
        tag: "indai-test",
      });
      if (outcome === "expired") {
        await db("indai_push_subs", { user_id: "eq." + user, endpoint: "eq." + row.endpoint }, {
          method: "DELETE",
        });
      } else accepted++;
    }
    if (!accepted) throw new HttpError(410, "subscription_expired", "Subscribe this browser again.");
    return json({ accepted });
  } catch (e) {
    return failure(e);
  }
});
