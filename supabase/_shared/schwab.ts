// Schwab's Trader API for one account holder: the sign-in, and keeping its tokens fresh.
// Schwab hands out an access token that lasts thirty minutes and a refresh token that lasts seven days. After
// seven days the account holder signs in again; nothing can renew that. The tokens live in the table
// indai_schwab, which only the service role can read, and never leave the back end.
import { db } from "./db.ts";
import { HttpError } from "./http.ts";

export const OAUTH = "https://api.schwabapi.com/v1/oauth";
export const MARKET = "https://api.schwabapi.com/marketdata/v1";
export const SIGN_IN_MS = 7 * 86400_000;
const EARLY_MS = 2 * 60_000;   // an access token is renewed two minutes before it runs out

export type App = { key: string; secret: string; callback: string };
export type Tokens = { refresh_token: string; signed_in_at: string; access_token: string | null; access_until: string | null };
export type Store = { read(): Promise<Tokens | null>; write(t: Tokens): Promise<void>; clear(): Promise<void> };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// The app the owner registered with Schwab. Its key and secret are Supabase secrets he types in himself.
export function schwabApp(env: (name: string) => string | undefined = (n) => Deno.env.get(n)): App | null {
  const key = env("SCHWAB_APP_KEY")?.trim(), secret = env("SCHWAB_APP_SECRET")?.trim();
  return key && secret ? { key, secret, callback: env("SCHWAB_CALLBACK")?.trim() || "https://127.0.0.1" } : null;
}
export const authorizeUrl = (a: App) =>
  OAUTH + "/authorize?" + new URLSearchParams({ response_type: "code", client_id: a.key, redirect_uri: a.callback });

// The one-time code from what the owner pastes: the whole address his browser ended on, its query, or the code.
export function codeFrom(pasted: unknown): string | null {
  if (typeof pasted !== "string") return null;
  const text = pasted.trim();
  if (!text || text.length > 2000) return null;
  let code: string | null = null;
  if (/^https?:\/\//i.test(text)) { try { code = new URL(text).searchParams.get("code"); } catch { return null; } }
  else if (/(^|[?&])code=/.test(text)) code = new URLSearchParams(text.replace(/^[^?]*\?/, "")).get("code");
  else { try { code = /%[0-9a-f]{2}/i.test(text) ? decodeURIComponent(text) : text; } catch { return null; } }
  return code && code.length >= 8 && code.length <= 800 && !/\s/.test(code) ? code : null;
}

async function tokenCall(a: App, form: Record<string, string>, f: Fetch) {
  const r = await f(OAUTH + "/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(a.key + ":" + a.secret), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, error: typeof j?.error === "string" ? j.error.slice(0, 60) : null, access: typeof j?.access_token === "string" ? j.access_token as string : null, refresh: typeof j?.refresh_token === "string" ? j.refresh_token as string : null, seconds: Number(j?.expires_in) > 0 ? Number(j.expires_in) : 1800 };
}
// Does Schwab know this app's key and secret? Asked with a refresh token that cannot be real: Schwab answers 401
// (invalid_client) when it does not recognise the app, and 400 when it does and, rightly, refuses the token.
export async function appRecognised(a: App, f: Fetch = (u, i) => fetch(u, i)) {
  try {
    const r = await tokenCall(a, { grant_type: "refresh_token", refresh_token: "indai-check-not-a-token" }, f);
    const unknown = r.status === 401 || r.error === "invalid_client";
    return { recognised: unknown ? false : r.status === 400 ? true : null, status: r.status, error: r.error };
  } catch { return { recognised: null, status: 0, error: null }; }
}

export const tokenStore: Store = {
  read: async () => (await db("indai_schwab", { id: "eq.owner", select: "refresh_token,signed_in_at,access_token,access_until" }))[0] ?? null,
  write: async (t) => { await db("indai_schwab", { on_conflict: "id" }, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "owner", ...t, updated_at: new Date().toISOString() }) }); },
  clear: async () => { await db("indai_schwab", { id: "eq.owner" }, { method: "DELETE", headers: { Prefer: "return=minimal" } }); },
};

export function schwabSession(io: { app: App | null; store?: Store; fetch?: Fetch; now?: () => number }) {
  const store = io.store ?? tokenStore, f: Fetch = io.fetch ?? ((u, i) => fetch(u, i)), now = io.now ?? (() => Date.now());
  let held: Tokens | null | undefined, renewing: Promise<string | null> | null = null;
  const alive = (t: Tokens | null | undefined): t is Tokens => !!t && now() - Date.parse(t.signed_in_at) < SIGN_IN_MS;
  const usable = (t: Tokens) => t.access_token && t.access_until && Date.parse(t.access_until) - now() > EARLY_MS ? t.access_token : null;
  async function renew(): Promise<string | null> {
    held = await store.read();   // another instance may have renewed it a moment ago
    if (!alive(held)) return null;
    const fresh = usable(held);
    if (fresh) return fresh;
    const r = await tokenCall(io.app!, { grant_type: "refresh_token", refresh_token: held.refresh_token }, f);
    if (!r.access) {
      // Schwab refusing the refresh token means the sign-in is over; anything else may pass, so the tokens are kept.
      if (r.status === 400 || r.status === 401) { held = null; await store.clear().catch(() => {}); }
      return null;
    }
    held = { refresh_token: r.refresh ?? held.refresh_token, signed_in_at: held.signed_in_at, access_token: r.access, access_until: new Date(now() + r.seconds * 1000).toISOString() };
    await store.write(held).catch(() => {});
    return r.access;
  }
  return {
    // A token to call Schwab with, or null when there is no sign-in to use.
    async token(): Promise<string | null> {
      if (!io.app) return null;
      if (held === undefined) held = await store.read();
      if (!alive(held)) return null;
      return usable(held) ?? await (renewing ??= renew().finally(() => { renewing = null; }));
    },
    // The step after the owner signs in at Schwab: trade the one-time code for tokens and keep them.
    async connect(code: string) {
      if (!io.app) throw new HttpError(503, "not_configured", "Schwab's app key and secret are not set.");
      const r = await tokenCall(io.app, { grant_type: "authorization_code", code, redirect_uri: io.app.callback }, f);
      if (!r.access || !r.refresh) {
        throw r.status === 400 || r.status === 401
          ? new HttpError(400, "code_rejected", "Schwab did not accept that code. It works once and only for about 30 seconds: sign in again and paste the new address straight away.")
          : new HttpError(502, "schwab", "Schwab's sign-in service did not answer. Try again in a minute.");
      }
      held = { refresh_token: r.refresh, signed_in_at: new Date(now()).toISOString(), access_token: r.access, access_until: new Date(now() + r.seconds * 1000).toISOString() };
      await store.write(held);
      return r.access;
    },
    async status() {
      const t = io.app ? await store.read() : null, on = alive(t), by = on ? Date.parse(t.signed_in_at) + SIGN_IN_MS : null;
      return { configured: !!io.app, connected: on, signed_in_at: on ? t.signed_in_at : null, sign_in_by: by ? new Date(by).toISOString() : null, days_left: by ? Math.max(0, Math.round((by - now()) / 8640000) / 10) : null };
    },
    async disconnect() { held = null; await store.clear(); },
  };
}
