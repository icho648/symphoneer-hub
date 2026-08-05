import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const migrationNames = (await readdir(migrationsFolder))
  .filter((name) => /^\d{4,14}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (migrationNames.length === 0) throw new Error("no SQL migrations found");

const { client } = createDatabase(databaseUrl);
const advisoryLockId = 648_037_001;
let locked = false;

try {
  await client.unsafe(`
    create table if not exists public.symphoneer_hub_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
  await client`select pg_advisory_lock(${advisoryLockId})`;
  locked = true;

  const appliedRows = await client<{ name: string; checksum: string }[]>`
    select name, checksum from public.symphoneer_hub_migrations
  `;
  const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));

  for (const name of migrationNames) {
    const sql = await readFile(`${migrationsFolder}/${name}`, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = applied.get(name);
    if (existing && existing !== checksum) {
      throw new Error(`migration ${name} changed after it was applied`);
    }
    if (existing) continue;

    await client.begin(async (transaction) => {
      await transaction.unsafe(sql);
      await transaction`
        insert into public.symphoneer_hub_migrations (name, checksum)
        values (${name}, ${checksum})
      `;
    });
    console.log(`applied ${name}`);
  }
  console.log("database migrations are current");
} finally {
  try {
    if (locked) await client`select pg_advisory_unlock(${advisoryLockId})`;
  } finally {
    await client.end();
  }
}
