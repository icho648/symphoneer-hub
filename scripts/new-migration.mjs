import { access, writeFile } from "node:fs/promises";

const raw = process.argv[2]?.trim().toLowerCase() ?? "";
const name = raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
if (!name) throw new Error("usage: pnpm db:new <descriptive-name>");

const now = new Date();
const prefix = [
  now.getUTCFullYear(),
  String(now.getUTCMonth() + 1).padStart(2, "0"),
  String(now.getUTCDate()).padStart(2, "0"),
  String(now.getUTCHours()).padStart(2, "0"),
  String(now.getUTCMinutes()).padStart(2, "0"),
  String(now.getUTCSeconds()).padStart(2, "0"),
].join("");
const path = new URL(`../packages/database/migrations/${prefix}_${name}.sql`, import.meta.url);
try {
  await access(path);
  throw new Error(`migration already exists: ${path.pathname}`);
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}
await writeFile(path, `-- ${name}\n\n`, { flag: "wx" });
console.log(path.pathname);
