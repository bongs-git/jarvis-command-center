import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createECDH } from "node:crypto";
const dir = process.env.LAB_DIR;
function roleToken(role) {
  const b = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const prefix = b({ alg: "HS256", typ: "JWT" }) + "." +
    b({ role, exp: Math.floor(Date.now() / 1000) + 3600, iss: "supabase" });
  return prefix + "." + createHmac("sha256", process.env.LOCAL_JWT_SECRET).update(prefix).digest("base64url");
}
const keys = createECDH("prime256v1");
keys.generateKeys();
const vapid = {
  publicKey: keys.getPublicKey().toString("base64url"),
  privateKey: keys.getPrivateKey().toString("base64url"),
};
writeFileSync(
  dir + "/credentials",
  Object.entries({
    SUPABASE_ANON_KEY: roleToken("anon"),
    SUPABASE_SERVICE_ROLE_KEY: roleToken("service_role"),
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
  }).map(([k, v]) => k + "=" + v).join("\n"),
  { mode: 0o600 },
);
