import { access, readFile } from "node:fs/promises";

const required = [
  ".nvmrc",
  ".symphoneer/WORKFLOW.md",
  "apps/api/src/server.ts",
  "apps/connector/src/index.ts",
  "apps/web/app/page.tsx",
  "apps/web/vercel.json",
  "apps/worker/src/index.ts",
  "packages/contracts/src/index.ts",
  "packages/database/src/schema.ts",
  "packages/relay/src/index.ts",
  "fixtures/smoke-app/src/counter.ts",
  "docs/ARCHITECTURE.md",
  "docs/RUNBOOK.md",
  "VALIDATION.md",
  "scripts/verify-symphoneer.mjs",
  "scripts/new-migration.mjs",
  "packages/database/migrations/0000_initial.sql"
];

await Promise.all(required.map((path) => access(new URL(`../${path}`, import.meta.url))));

const forbiddenChecks = [
  ["apps/api/src", "@symphoneer/runtime"],
  ["apps/worker/src", "@symphoneer/runtime"],
  ["packages/database/src", "@symphoneer/runtime"],
  ["packages/relay/src", "@symphoneer/runtime"]
];

for (const [directory, token] of forbiddenChecks) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(new URL(`../${directory}`, import.meta.url), { recursive: true });
  for (const entry of entries) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    const content = await readFile(new URL(`../${directory}/${entry}`, import.meta.url), "utf8");
    if (content.includes(token)) {
      throw new Error(`${directory}/${entry} must not import ${token}; Hub is a Runtime client`);
    }
  }
}

const sourceRoots = ["apps/api/src", "apps/connector/src", "apps/worker/src", "packages"];
for (const directory of sourceRoots) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(new URL(`../${directory}`, import.meta.url), { recursive: true });
  for (const entry of entries) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    const content = await readFile(new URL(`../${directory}/${entry}`, import.meta.url), "utf8");
    if (/from ["']\.{1,2}\/[^"']+\.ts["']/.test(content)) {
      throw new Error(`${directory}/${entry} must use .js specifiers for emitted Node ESM`);
    }
  }
}

const workflow = await readFile(new URL("../.symphoneer/WORKFLOW.md", import.meta.url), "utf8");
if (!workflow.includes("repo: icho648/symphoneer-hub")) {
  throw new Error("WORKFLOW.md must target icho648/symphoneer-hub");
}
if (!workflow.includes("argv: [pnpm, verify:symphoneer]")) {
  throw new Error("WORKFLOW.md must use scope-aware Symphoneer verification");
}

console.log("project structure and authority boundaries are valid");
