import { execFileSync, spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);

function git(args, { optional = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", optional ? "ignore" : "inherit"],
    });
  } catch (error) {
    if (optional) return "";
    throw error;
  }
}

function nulPaths(output) {
  return output
    .split("\0")
    .map((path) => path.trim())
    .filter(Boolean);
}

function workingTreePaths() {
  return [
    ...nulPaths(git(["diff", "--name-only", "-z", "HEAD"])),
    ...nulPaths(git(["diff", "--cached", "--name-only", "-z"])),
    ...nulPaths(git(["ls-files", "--others", "--exclude-standard", "-z"])),
  ];
}

function branchPaths() {
  const configured = process.env.SYMPHONEER_BASE_REF?.trim();
  const candidates = [configured, "origin/main", "main"].filter(Boolean);
  for (const candidate of candidates) {
    const base = git(["merge-base", "HEAD", candidate], { optional: true }).trim();
    if (!base || base === git(["rev-parse", "HEAD"]).trim()) continue;
    return nulPaths(git(["diff", "--name-only", "-z", `${base}...HEAD`]));
  }
  return [];
}

const changed = [...new Set([...workingTreePaths(), ...branchPaths()])].sort();
if (changed.length === 0) {
  throw new Error(
    "No changed paths were found. Set SYMPHONEER_BASE_REF when verifying a committed branch.",
  );
}

const fixtureOnly = changed.every(
  (path) => path === "fixtures/smoke-app" || path.startsWith("fixtures/smoke-app/"),
);
const command = fixtureOnly ? "check:smoke" : "check";

console.log(`Changed paths (${changed.length}):`);
for (const path of changed) console.log(`- ${path}`);
console.log(`Resolved verification: pnpm ${command}`);
if (process.env.SYMPHONEER_VERIFY_DRY_RUN === "1") process.exit(0);

const result = spawnSync("pnpm", [command], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
