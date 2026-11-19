// Use the standard Web Push encryption/VAPID implementation, and restrict network destinations.
import { Buffer } from "node:buffer";
import { createECDH } from "node:crypto";
import { HttpError } from "../_shared/http.ts";

export type Subscription = { endpoint: string; keys: { auth: string; p256dh: string } };
export function pushConfig() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY"),
    privateKey = Deno.env.get("VAPID_PRIVATE_KEY"),
    subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    throw new HttpError(503, "not_configured", "Web Push has not been enabled.");
  }
  return { publicKey, privateKey, subject };
}
export function endpoint(value: unknown) {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value);
    const host = url.hostname;
    const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host === "web.push.apple.com" || host.endsWith(".push.apple.com") ||
      host.endsWith(".notify.windows.com");
    if (
      !allowed || url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      url.pathname === "/"
    ) throw new Error();
    return url.href;
  } catch {
    throw new HttpError(400, "bad_subscription", "A supported HTTPS browser push endpoint is required.");
  }
}
export function subscription(input: any): Subscription {
  const address = endpoint(input?.endpoint), keys = input?.keys;
  const valid = (s: unknown, n: number) =>
    typeof s === "string" && /^[\w-]+={0,2}$/.test(s) && s.length < 130 &&
    Buffer.from(s, "base64url").length === n;
  if (!valid(keys?.auth, 16) || !valid(keys?.p256dh, 65)) {
    throw new HttpError(400, "bad_subscription", "The browser subscription keys are invalid.");
  }
  try {
    const point = Buffer.from(keys.p256dh, "base64url");
    if (point[0] !== 4) throw new Error();
    const test = createECDH("prime256v1");
    test.generateKeys();
    test.computeSecret(point);
  } catch {
    throw new HttpError(400, "bad_subscription", "The browser public key is invalid.");
  }
  return { endpoint: address, keys: { auth: keys.auth, p256dh: keys.p256dh } };
}
export async function sendPush(sub: Subscription, payload: unknown) {
  const target = endpoint(sub.endpoint);
  const { default: webpush } = await import("npm:web-push@3.6.7");
  const request = webpush.generateRequestDetails(sub, JSON.stringify(payload), {
    vapidDetails: pushConfig(),
    TTL: 300,
    urgency: "normal",
  });
  const response = await fetch(target, {
    method: "POST",
    headers: request.headers,
    body: new Uint8Array(request.body!),
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) return "expired";
  if (!response.ok) {
    throw new HttpError(502, "delivery", "The browser push service did not accept the notification.");
  }
  return "accepted";
}
