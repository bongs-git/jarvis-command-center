import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
const c = new Client({
  host: "127.0.0.1",
  port: 55432,
  user: "postgres",
  password: "local-dev-only",
  database: "postgres",
});
await c.connect();
try {
  await c.query("create database indai");
} catch (e) {
  if (e.code !== "42P04") throw e;
}
await c.end();
const db = new Client({
  host: "127.0.0.1",
  port: 55432,
  user: "postgres",
  password: "local-dev-only",
  database: "indai",
});
await db.connect();
const files = [
  "supabase/checks/integration/seed.sql",
  ...readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort().map((n) =>
    "supabase/migrations/" + n
  ),
  "supabase/pending/retention_and_memory.sql",
];
try {
  for (const name of files) {
    console.log(name);
    const sql = readFileSync(name, "utf8").replace(
      /^create extension if not exists (pg_cron|pg_net|supabase_vault)[^;]*;/gmi,
      "",
    );
    await db.query(sql);
  }
  await db.query("begin");
  const activate = readFileSync("supabase/checks/schedule-target.sql", "utf8");
  await db.query(activate);
  await db.query(activate);
  await db.query("rollback");
} catch (e) {
  console.error(e.message, e.detail, e.where, e.position);
  process.exitCode = 1;
} finally {
  await db.end();
}
