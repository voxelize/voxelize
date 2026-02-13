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
const isJson = process.argv.includes("--json");

const parseJsonOutput = (value) => {
  if (value.length === 0) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const finish = (report) => {
  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!report.passed) {
    console.error(report.message);
  }

  process.exit(report.exitCode);
};

if (fs.existsSync(wasmMesherEntry)) {
  finish({
    passed: true,
    exitCode: 0,
    artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
    artifactFound: true,
    attemptedBuild: false,
    wasmPackAvailable: null,
    wasmPackCheckReport: null,
    buildOutput: null,
    message: "WASM mesher artifact already exists.",
  });
}

const wasmPackCheck = isJson
  ? spawnSync(process.execPath, [rootWasmCheckScript, "--json"], {
      encoding: "utf8",
      shell: false,
    })
  : spawnSync(process.execPath, [rootWasmCheckScript, "--quiet"], {
      stdio: "inherit",
      shell: false,
    });
const wasmPackCheckStatus = wasmPackCheck.status ?? 1;
const wasmPackCheckOutput = `${wasmPackCheck.stdout ?? ""}${wasmPackCheck.stderr ?? ""}`.trim();
const wasmPackCheckReport = isJson ? parseJsonOutput(wasmPackCheckOutput) : null;

if (wasmPackCheckStatus !== 0) {
  finish({
    passed: false,
    exitCode: wasmPackCheckStatus,
    artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
    artifactFound: false,
    attemptedBuild: false,
    wasmPackAvailable: false,
    wasmPackCheckReport,
    buildOutput: null,
    message:
      "Missing crates/wasm-mesher/pkg/voxelize_wasm_mesher.js. Install wasm-pack, then run `pnpm build:wasm:dev` from the repository root.",
  });
}

const buildResult = isJson
  ? spawnSync(pnpmCommand, ["--dir", repositoryRoot, "build:wasm:dev"], {
      encoding: "utf8",
      shell: false,
    })
  : spawnSync(pnpmCommand, ["--dir", repositoryRoot, "build:wasm:dev"], {
      stdio: "inherit",
      shell: false,
    });
const buildStatus = buildResult.status ?? 1;
const buildOutput = `${buildResult.stdout ?? ""}${buildResult.stderr ?? ""}`.trim();

if (buildStatus === 0 && fs.existsSync(wasmMesherEntry)) {
  finish({
    passed: true,
    exitCode: 0,
    artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
    artifactFound: true,
    attemptedBuild: true,
    wasmPackAvailable: true,
    wasmPackCheckReport,
    buildOutput: isJson ? buildOutput : null,
    message: "WASM mesher artifact is available.",
  });
}

finish({
  passed: false,
  exitCode: buildStatus,
  artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
  artifactFound: fs.existsSync(wasmMesherEntry),
  attemptedBuild: true,
  wasmPackAvailable: true,
  wasmPackCheckReport,
  buildOutput: isJson ? buildOutput : null,
  message:
    "Failed to generate crates/wasm-mesher/pkg/voxelize_wasm_mesher.js with `pnpm build:wasm:dev`.",
});
