import { account } from "../_shared/auth.ts";
import { db, rpc, uuid } from "../_shared/db.ts";
import { HttpError, json } from "../_shared/http.ts";

const aliases: Record<string, string> = { speech: "indai.speech.v1", ears: "indai.ears.v1" };
const keys = new Set(["indai.speech.v1", "indai.ears.v1", "plan", "watchlist"]);
export async function profile(req: Request, body: Record<string, any>) {
  const user = await account(req);
  const key = Object.hasOwn(aliases, body.key) ? aliases[body.key] : body.key;
  if (!keys.has(key)) throw new HttpError(400, "bad_key", "Unknown profile key.");
  if (body.op === "get") {
    const [row] = await db("indai_profile", {
      user_id: "eq." + user,
      key: "eq." + key,
      select: "key,value,updated_at",
    });
    return json(row ?? { key, value: null, updated_at: null });
  }
  if (
    body.op !== "put" || !body.value || typeof body.value !== "object" || Array.isArray(body.value) ||
    (body.mutation_id != null && !uuid.test(body.mutation_id))
  ) throw new HttpError(400, "bad_request", "Supply a profile object and a valid operation.");
  return json(
    await rpc("indai_put_profile", {
      p_user: user,
      p_key: key,
      p_value: body.value,
      p_mutation: body.mutation_id ?? null,
    }),
  );
}
