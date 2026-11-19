import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
const c = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "indai" });
await c.connect();
try {
  await c.query("begin");
  const result = await c.query(readFileSync(process.env.SPLINTER_SQL, "utf8"));
  const all = (Array.isArray(result) ? result : [result]).flatMap((x) => x.rows ?? []);
  const rows = all.filter((x) => JSON.stringify(x.metadata).includes("indai_"));
  const counts = {};
  for (const x of rows) counts[x.level + " " + x.name] = (counts[x.level + " " + x.name] ?? 0) + 1;
  console.log("Supabase Splinter on migrated tables:", counts);
  for (const x of rows.filter((x) => x.level !== "INFO")) console.log(x.level, x.detail);
  writeFileSync(
    process.env.LAB_DIR + "/advisors-result.json",
    JSON.stringify(rows.map(({ level, name, detail }) => ({ level, name, detail })), null, 2),
  );
  if (rows.some((x) => x.level !== "INFO")) process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
}
