import { HttpError } from "./http.ts";

export const legacyId = "00000000-0000-4000-8000-000000000001";
export const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export async function db(path: string, query: Record<string, string> = {}, init: RequestInit = {}) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const base = Deno.env.get("SUPABASE_URL");
  if (!key || !base) throw new HttpError(503, "not_configured", "Database access is unavailable.");
  const url = new URL("/rest/v1/" + path, base);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (error.message === "profile_too_large") {
      throw new HttpError(413, "too_large", "The merged profile exceeds 64 KiB.");
    }
    if (error.message === "invalid_profile") {
      throw new HttpError(400, "bad_profile", "The speech profile has invalid counters or fixes.");
    }
    throw new HttpError(502, "database", "The database operation failed.");
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export const rpc = (name: string, args: Record<string, unknown> = {}) =>
  db("rpc/" + name, {}, { method: "POST", body: JSON.stringify(args) });

export async function account(req: Request) {
  const pass = Deno.env.get("INDAI_PASSCODE");
  if (pass && req.headers.get("x-indai-pass") === pass) return legacyId;
  throw new HttpError(401, "passcode", "Use the owner passcode to access saved data.");
}
