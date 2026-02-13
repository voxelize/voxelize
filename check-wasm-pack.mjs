import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const wasmPackCommand = isWindows ? "wasm-pack.exe" : "wasm-pack";
const isQuiet = process.argv.includes("--quiet");

const versionCheck = spawnSync(wasmPackCommand, ["--version"], {
  stdio: "ignore",
  shell: false,
});

if (versionCheck.status === 0) {
  process.exit(0);
}

if (!isQuiet) {
  console.error(
    `wasm-pack is required for wasm build commands (expected command: ${wasmPackCommand}). Install it from https://rustwasm.github.io/wasm-pack/installer/.`
  );
}
process.exit(versionCheck.status ?? 1);
