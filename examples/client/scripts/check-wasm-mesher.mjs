import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wasmMesherEntry = path.resolve(
  __dirname,
  "../../../crates/wasm-mesher/pkg/voxelize_wasm_mesher.js"
);
const repositoryRoot = path.resolve(__dirname, "../../..");
const isWindows = process.platform === "win32";
const wasmPackCommand = isWindows ? "wasm-pack.exe" : "wasm-pack";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";

if (fs.existsSync(wasmMesherEntry)) {
  process.exit(0);
}

const wasmPackCheck = spawnSync(wasmPackCommand, ["--version"], {
  stdio: "ignore",
  shell: false,
});

if (wasmPackCheck.status === 0) {
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

  process.exit(buildResult.status ?? 1);
}

console.error(
  "Missing crates/wasm-mesher/pkg/voxelize_wasm_mesher.js and wasm-pack is unavailable. Install wasm-pack, then run `pnpm build:wasm:dev` from the repository root."
);
process.exit(1);
