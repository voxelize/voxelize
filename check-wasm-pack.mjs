import { spawnSync } from "node:child_process";

import { resolveCommand } from "./scripts/command-utils.mjs";
import { toReportJson } from "./scripts/report-utils.mjs";

const wasmPackCommand = resolveCommand("wasm-pack");
const isQuiet = process.argv.includes("--quiet");
const isJson = process.argv.includes("--json");

const versionCheck = isJson
  ? spawnSync(wasmPackCommand, ["--version"], {
      encoding: "utf8",
      shell: false,
    })
  : spawnSync(wasmPackCommand, ["--version"], {
      stdio: "ignore",
      shell: false,
    });
const checkStatus = versionCheck.status ?? 1;
const output = `${versionCheck.stdout ?? ""}${versionCheck.stderr ?? ""}`;
const firstLine =
  output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;

if (checkStatus === 0) {
  if (isJson) {
    console.log(
      toReportJson({
        passed: true,
        exitCode: 0,
        command: wasmPackCommand,
        version: firstLine,
      })
    );
  }
  process.exit(0);
}

const failureMessage = `wasm-pack is required for wasm build commands (expected command: ${wasmPackCommand}). Install it from https://rustwasm.github.io/wasm-pack/installer/.`;

if (isJson) {
  console.log(
    toReportJson({
      passed: false,
      exitCode: checkStatus,
      command: wasmPackCommand,
      version: null,
      message: failureMessage,
    })
  );
} else if (!isQuiet) {
  console.error(failureMessage);
}
process.exit(checkStatus);
