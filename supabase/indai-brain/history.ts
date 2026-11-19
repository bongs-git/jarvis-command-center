import { db } from "../_shared/db.ts";
import { HttpError } from "../_shared/http.ts";

export function sessionName(value: unknown) {
  if (value == null) return "default";
  if (typeof value === "string" && /^[a-zA-Z0-9._:-]{1,100}$/.test(value)) return value;
  throw new HttpError(400, "bad_session", "Use a session name of 1 to 100 letters, digits or . _ : -.");
}
export async function recentTurns(user: string, session: string) {
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const rows = await db("indai_turns", {
    user_id: "eq." + user,
    session: "eq." + session,
    created_at: "gte." + since,
    order: "created_at.desc,id.desc",
    limit: "16",
    select: "id,session,role,text,created_at",
  });
  return rows.reverse();
}
export async function clearHistory(user: string, session: string) {
  await db("indai_turns", { user_id: "eq." + user, session: "eq." + session }, { method: "DELETE" });
}
export async function saveTurns(
  user: string,
  session: string,
  question: string,
  spoken: string,
  requestId: string | null,
) {
  const common = { user_id: user, session, request_id: requestId };
  await db("indai_turns", { on_conflict: "user_id,session,request_id,role" }, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify([{ ...common, role: "user", text: question }, {
      ...common,
      role: "assistant",
      text: spoken,
    }]),
  });
}
