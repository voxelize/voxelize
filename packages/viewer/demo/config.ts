/**
 * The viewer demo: the demo server's own worlds (`examples/server/worlds`),
 * generated through their real pipelines by the `viewer-backend` example.
 *
 *   pnpm --filter @voxelize/viewer demo          # http://127.0.0.1:4820
 *   pnpm --filter @voxelize/viewer demo:shot     # a labelled capture
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ResolvedSource, ViewerConfigModule } from "../src/node";

const PACKAGE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ROOT = path.resolve(PACKAGE, "../..");
const WORK = path.join(ROOT, "target", "viewer-demo");
const BINARY = path.join(
  ROOT,
  "target",
  "release-dev",
  "examples",
  "viewer-backend",
);

let building: Promise<void> | null = null;

/** Builds the example backend when its sources are newer than the binary. */
function ensureBackend(): Promise<void> {
  building ??= new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      ["build", "--profile", "release-dev", "--example", "viewer-backend"],
      { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("exit", (code) => {
      building = null;
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `cargo build --example viewer-backend failed (exit ${code})`,
          ),
        );
    });
  });
  return building;
}

async function resolveSource(spec: string): Promise<ResolvedSource> {
  const world = spec === "flat" ? "flat" : "terrain";
  await ensureBackend();
  const built = fs.statSync(BINARY).mtimeMs;
  const id = crypto
    .createHash("sha256")
    .update(`${world}:${built}`)
    .digest("hex")
    .slice(0, 12);
  return {
    id,
    label: `demo ${world}`,
    world,
    spawn: (launchFile) => ({ command: BINARY, args: [launchFile], cwd: ROOT }),
    launch: { world },
    provenance: {
      world,
      binary: BINARY,
      builtAt: new Date(built).toISOString(),
    },
  };
}

const config: ViewerConfigModule = {
  port: 4820,
  server: {
    cacheDir: WORK,
    page: {
      entry: path.join(PACKAGE, "demo", "main.ts"),
      alias: {
        three: path.join(PACKAGE, "node_modules", "three"),
        "@voxelize/core": path.join(
          ROOT,
          "packages",
          "core",
          "dist",
          "index.mjs",
        ),
      },
      define: { "process.env": "{}" },
      assetRoots: [path.join(ROOT, "examples", "client", "src")],
      images: "url",
      title: "Voxelize · world viewer demo",
    },
    resolveSource,
    defaultSource: "terrain",
    bookmarks: [
      {
        id: "origin",
        label: "Origin",
        preset: "orbit",
        pose: { eye: [90, 140, 90], look: [0, 60, 0] },
      },
      {
        id: "overview",
        label: "Overview",
        preset: "iso",
        pose: { eye: [230, 290, 230], look: [0, 60, 0] },
      },
    ],
    stamp: "VOXELIZE VIEWER DEMO — not a game client",
    captureDir: () => path.join(WORK, "captures"),
    idleTtlMs: 30 * 60_000,
  },
};

export default config;
