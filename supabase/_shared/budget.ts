import { rpc } from "./db.ts";
import { HttpError } from "./http.ts";

export async function reserveTokens(input: unknown, maxOutput: number, searches = 0) {
  const limit = Number(Deno.env.get("INDAI_DAILY_TOKEN_BUDGET") ?? 250000);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new HttpError(503, "not_configured", "The daily token budget is invalid.");
  }
  // UTF-8 bytes conservatively reserve text input, with headroom for server-side search.
  // Reconcile provider usage per turn, including cached input. Interrupted calls keep their reservation.
  const estimate = new TextEncoder().encode(JSON.stringify(input)).length + maxOutput + 256 + searches * 4096;
  const id = await rpc("indai_reserve_tokens", { p_amount: estimate, p_limit: limit });
  if (!id) throw new HttpError(429, "budget", "INDAI's daily token budget is exhausted.");
  return async (usage: any) => {
    let actual: number | null = null;
    if (Number.isFinite(usage?.input_tokens) && Number.isFinite(usage?.output_tokens)) {
      actual = usage.input_tokens + usage.output_tokens + (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
    }
    await rpc("indai_settle_tokens", { p_id: id, p_actual: actual });
  };
}
