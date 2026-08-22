#!/usr/bin/env node
// Builds any workspace dependency of @voxelize/core whose dist/ is missing or
// older than its sources, before the parallel TS watches start.
//
// `pnpm watch` fans every package's watch script out at once, so
// @voxelize/core's tsc can read a stale @voxelize/protocol dist/*.d.ts before
// protocol's own watch has rewritten it. tsc --watch never recovers from that:
// the resulting TS2307/TS2339 errors ("Cannot find module '@voxelize/protocol'",
// "Property 'normals' does not exist on type 'GeometryProtocol'") persist for
// the whole session even once protocol finishes writing. The dists therefore
// have to be correct *before* any watch starts.
//
// Only stale packages are rebuilt, so an already-warm tree costs ~nothing.
//
// Usage: node scripts/ensure-deps-built.mjs [--root-package @voxelize/core]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = path.join(ROOT, "packages");
const IGNORED_DIRS = new Set(["dist", "node_modules", ".turbo", ".git"]);
// tsc writes its incremental cache *after* the files in dist, so counting it as
// an input would leave every package permanently stale.
const IGNORED_INPUTS = /\.tsbuildinfo$/;

// Inputs that live outside a package but still invalidate its build.
const EXTRA_INPUTS = {
  "@voxelize/protocol": [path.join(ROOT, "messages.proto")],
};

const rootFlagIndex = process.argv.indexOf("--root-package");
const ROOT_PACKAGE =
  rootFlagIndex === -1 ? "@voxelize/core" : process.argv[rootFlagIndex + 1];

// Only packages/* are considered. @voxelize/wasm-mesher lives in crates/ and is
// built ahead of this by `build:wasm:dev`.
function readWorkspacePackages() {
  const byName = new Map();
  for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PACKAGES_DIR, entry.name);
    const manifestPath = path.join(dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    byName.set(manifest.name, { dir, manifest });
  }
  return byName;
}

function workspaceDepsOf(manifest) {
  const all = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };
  return Object.entries(all)
    .filter(([, range]) => String(range).startsWith("workspace:"))
    .map(([name]) => name);
}

// Transitive closure of ROOT_PACKAGE's workspace deps, excluding itself.
function collectDependencies(byName, rootName) {
  const seen = new Set();
  const queue = [rootName];
  while (queue.length > 0) {
    const name = queue.shift();
    const pkg = byName.get(name);
    if (!pkg) continue;
    for (const dep of workspaceDepsOf(pkg.manifest)) {
      if (seen.has(dep) || !byName.has(dep)) continue;
      seen.add(dep);
      queue.push(dep);
    }
  }
  return [...seen];
}

function newestMtime(target, { skipIgnoredInputs = false } = {}) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) {
    if (skipIgnoredInputs && IGNORED_INPUTS.test(target)) return 0;
    return stat.mtimeMs;
  }
  let newest = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const mtime = newestMtime(path.join(target, entry.name), {
      skipIgnoredInputs,
    });
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

function newestInput(name, dir) {
  let newest = newestMtime(dir, { skipIgnoredInputs: true });
  for (const extra of EXTRA_INPUTS[name] ?? []) {
    const mtime = newestMtime(extra, { skipIgnoredInputs: true });
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

// The *newest* dist file stands in for "when did this package last build".
// Comparing against the oldest instead would misread orphaned artifacts from
// long-dead build configs (packages/physics-engine/dist/index.mjs, say) as
// proof that the whole dist is stale, and rebuild on every single run.
function lastBuiltAt(dir) {
  const dist = path.join(dir, "dist");
  if (!fs.existsSync(dist)) return null;
  const newest = newestMtime(dist);
  return newest === 0 ? null : newest;
}

function isStale(name, dir) {
  const built = lastBuiltAt(dir);
  if (built === null) return "no dist";
  if (newestInput(name, dir) > built) return "sources changed since last build";
  return null;
}

const byName = readWorkspacePackages();
if (!byName.has(ROOT_PACKAGE)) {
  console.error(`[deps] unknown package ${ROOT_PACKAGE}`);
  process.exit(1);
}

const stale = [];
for (const name of collectDependencies(byName, ROOT_PACKAGE)) {
  const { dir } = byName.get(name);
  const reason = isStale(name, dir);
  if (reason) stale.push({ name, reason });
}

if (stale.length === 0) {
  console.log(`[deps] ${ROOT_PACKAGE} dependencies are up to date`);
  process.exit(0);
}

for (const { name, reason } of stale) {
  console.log(`[deps] rebuilding ${name} (${reason})`);
}

// One recursive call so pnpm resolves the topological build order itself.
const filters = stale.flatMap(({ name }) => ["--filter", name]);
const result = spawnSync(
  "pnpm",
  ["-r", "--workspace-concurrency=1", ...filters, "build"],
  { cwd: ROOT, stdio: "inherit" },
);

if (result.error) {
  console.error(`[deps] failed to run pnpm: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
