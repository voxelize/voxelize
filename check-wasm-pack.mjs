import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const wasmPackCommand = isWindows ? "wasm-pack.exe" : "wasm-pack";

const versionCheck = spawnSync(wasmPackCommand, ["--version"], {
  stdio: "ignore",
  shell: false,
});

if (versionCheck.status === 0) {
  process.exit(0);
}

console.error(
  "wasm-pack is required for wasm build commands. Install it from https://rustwasm.github.io/wasm-pack/installer/."
);
process.exit(versionCheck.status ?? 1);
