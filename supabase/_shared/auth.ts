import { createHash, timingSafeEqual } from "node:crypto";
import { db, rpc, uuid } from "./db.ts";
import { HttpError } from "./http.ts";
export const guestId = "00000000-0000-4000-8000-000000000002";

export function sameSecret(expected: string, supplied: string) {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return expected.length > 0 && timingSafeEqual(hash(expected), hash(supplied));
}
// Public legacy token shipped with the headset. Hosted runtime keys can have a different issued-at claim.
export function publicBearer(token: string) {
  return token === Deno.env.get("SUPABASE_ANON_KEY") || token === Deno.env.get("INDAI_PUBLISHABLE_KEY") ||
    createHash("sha256").update(token).digest("hex") === "6a6b324814cf4774c09ccc5903126703a2480298c3a422a4c9cbaf3dff11245e";
}
export function account(req: Request): Promise<string>;
export function account(req: Request, allowGuest: true): Promise<string | null>;
export async function account(req: Request, allowGuest = false) {
  const header = req.headers.get("authorization");
  const bearer = header?.match(/^Bearer (\S+)$/i)?.[1];
  if (header && !bearer) throw new HttpError(401, "unauthorized", "Invalid authorization header.");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (bearer && !publicBearer(bearer)) {
    const r = await fetch(new URL("/auth/v1/user", Deno.env.get("SUPABASE_URL")), {
      headers: { apikey: anon ?? "", Authorization: "Bearer " + bearer },
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 401 || r.status === 403 || r.status === 400) {
      throw new HttpError(401, "unauthorized", "The sign-in token is invalid or expired.");
    }
    if (!r.ok) throw new HttpError(502, "auth", "Account validation is unavailable.");
    const user = await r.json();
    if (!uuid.test(user.id) || user.is_anonymous === true) {
      throw new HttpError(401, "unauthorized", "Sign in with email.");
    }
    return user.id as string;
  }
  const pass = Deno.env.get("INDAI_PASSCODE");
  if (pass) {
    if (!sameSecret(pass, req.headers.get("x-indai-pass") ?? "")) {
      throw new HttpError(401, "passcode", "Wrong or missing INDAI passcode.");
    }
    const [owner] = await db("indai_owner", { select: "user_id", limit: "1" });
    return owner.user_id as string;
  }
  if (allowGuest) return null;
  throw new HttpError(401, "sign_in_required", "Sign in or configure the owner passcode to use saved data.");
}
export async function rateLimit(user: string | null, bucket = "brain") {
  if (!await rpc("indai_take_request", { p_user: user ?? guestId, p_bucket: bucket, p_limit: 60 })) {
    throw new HttpError(429, "rate_limited", "Hourly request limit reached. Try again later.");
  }
}
