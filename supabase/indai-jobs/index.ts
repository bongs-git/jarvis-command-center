import { markMode, serve } from "../_shared/http.ts";
import { db, rpc, uuid } from "../_shared/db.ts";
import { CORS, failure, HttpError, json, objectBody } from "../_shared/http.ts";
import { scanPush } from "./push.ts";
import { refreshGex } from "./gex.ts";
import { compactMemory } from "./memory.ts";

const runners: Record<string, (args: any) => Promise<{ ok: boolean; detail: string }>> = {
  memory: compactMemory,
  "gex-batch": refreshGex,
  push: scanPush,
};
serve("indai-jobs", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "method", "Use POST.");
    const token = req.headers.get("x-indai-job");
    if (!token || !(await rpc("indai_job_authorized", { p_token: token }))) {
      throw new HttpError(401, "unauthorized", "Scheduler authorization is required.");
    }
    const { id, job } = await objectBody(req, 2048);
    markMode(req, job);
    if (!uuid.test(id) || !Object.hasOwn(runners, job)) {
      throw new HttpError(400, "bad_job", "Invalid scheduled run.");
    }
    const patch = (state: string, changes: object) =>
      db("indai_job_log", { id: "eq." + id, job: "eq." + job, state: "eq." + state }, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(changes),
      });
    const claim = await patch("queued", { state: "running", detail: "running" });
    if (!claim.length) return json({ accepted: false });
    let result;
    try {
      result = await runners[job](claim[0].args);
    } catch {
      result = { ok: false, detail: "Job failed. Check Edge Function logs and provider connectivity." };
    }
    await patch("running", { ...result, state: result.ok ? "done" : "failed" });
    if (!result.ok) throw new HttpError(502, "job_failed", result.detail);
    return json(result);
  } catch (e) {
    return failure(e);
  }
});
