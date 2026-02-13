import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "../../../scripts/command-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wasmMesherEntry = path.resolve(
  __dirname,
  "../../../crates/wasm-mesher/pkg/voxelize_wasm_mesher.js"
);
const repositoryRoot = path.resolve(__dirname, "../../..");
const rootWasmCheckScript = path.resolve(repositoryRoot, "check-wasm-pack.mjs");
const pnpmCommand = resolvePnpmCommand();

if (fs.existsSync(wasmMesherEntry)) {
  process.exit(0);
}

const wasmPackCheck = spawnSync(
  process.execPath,
  [rootWasmCheckScript, "--quiet"],
  {
    stdio: "inherit",
    shell: false,
  }
);

if (wasmPackCheck.status !== 0) {
  console.error(
    "Missing crates/wasm-mesher/pkg/voxelize_wasm_mesher.js. Install wasm-pack, then run `pnpm build:wasm:dev` from the repository root."
  );
  process.exit(wasmPackCheck.status ?? 1);
}

const buildResult = spawnSync(
  pnpmCommand,
  ["--dir", repositoryRoot, "build:wasm:dev"],
  {
    stdio: "inherit",
    shell: false,
  }
);

if (buildResult.status === 0 && fs.existsSync(wasmMesherEntry)) {
  process.exit(0);
}

console.error(
  "Failed to generate crates/wasm-mesher/pkg/voxelize_wasm_mesher.js with `pnpm build:wasm:dev`."
);
process.exit(buildResult.status ?? 1);
