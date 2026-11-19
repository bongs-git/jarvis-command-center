import { db, rpc } from "../_shared/db.ts";
export const clean = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
const fields = "id,kind,text,created_at,uses,last_used";
export function memList(user: string, limit = 200) {
  return db("indai_memory", {
    select: fields,
    user_id: "eq." + user,
    order: limit < 100 ? "uses.desc,last_used.desc.nullslast,created_at.desc" : "created_at.asc,id.asc",
    limit: String(limit),
  });
}
export async function memAdd(user: string, texts: unknown[], kinds: unknown[] = []) {
  const rows = await rpc("indai_learn", {
    p_user: user,
    p_items: texts.slice(0, 6).map((text, i) => ({ text: clean(text), kind: kinds[i] ?? "fact" })),
  });
  return rows.map(({ id, kind, text, created_at, uses, last_used }: any) => ({
    id,
    kind,
    text,
    created_at,
    uses,
    last_used,
  }));
}
export function ids(list: unknown): number[] {
  return Array.isArray(list)
    ? [
      ...new Set(
        list.filter((x) => typeof x === "number" || /^\d+$/.test(String(x))).map(Number).filter((x) =>
          Number.isSafeInteger(x) && x > 0
        ),
      ),
    ].slice(0, 32)
    : [];
}
export async function memForget(user: string, input: unknown) {
  const selected = ids(input);
  if (selected.length) {
    await db("indai_memory", { user_id: "eq." + user, id: "in.(" + selected.join(",") + ")" }, {
      method: "DELETE",
    });
  }
}
