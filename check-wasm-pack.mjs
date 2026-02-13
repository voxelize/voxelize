import { spawnSync } from "node:child_process";

import { resolveCommand } from "./scripts/command-utils.mjs";
import {
  resolveOutputPath,
  toReportJson,
  writeReportToPath,
} from "./scripts/report-utils.mjs";

const wasmPackCommand = resolveCommand("wasm-pack");
const cliArgs = process.argv.slice(2);
const isQuiet = cliArgs.includes("--quiet");
const isJson = cliArgs.includes("--json");
const isCompact = cliArgs.includes("--compact");
const jsonFormat = { compact: isCompact };
const { outputPath, error: outputPathError } = resolveOutputPath(cliArgs);

if (isJson && outputPathError !== null) {
  console.log(
    toReportJson({
      passed: false,
      exitCode: 1,
      command: wasmPackCommand,
      version: null,
      outputPath: null,
      message: outputPathError,
    }, jsonFormat)
  );
  process.exit(1);
}

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
    const report = {
      passed: true,
      exitCode: 0,
      command: wasmPackCommand,
      version: firstLine,
      outputPath,
    };
    const reportJson = toReportJson(report, jsonFormat);

    if (outputPath !== null) {
      const writeError = writeReportToPath(reportJson, outputPath);
      if (writeError !== null) {
        console.log(
          toReportJson({
            ...report,
            passed: false,
            exitCode: 1,
            version: null,
            message: writeError,
          }, jsonFormat)
        );
        process.exit(1);
      }
    }

    console.log(reportJson);
  }
  process.exit(0);
}

const failureMessage = `wasm-pack is required for wasm build commands (expected command: ${wasmPackCommand}). Install it from https://rustwasm.github.io/wasm-pack/installer/.`;

if (isJson) {
  const report = {
    passed: false,
    exitCode: checkStatus,
    command: wasmPackCommand,
    version: null,
    outputPath,
    message: failureMessage,
  };
  const reportJson = toReportJson(report, jsonFormat);

  if (outputPath !== null) {
    const writeError = writeReportToPath(reportJson, outputPath);
    if (writeError !== null) {
      console.log(
        toReportJson({
          ...report,
          exitCode: 1,
          message: writeError,
        }, jsonFormat)
      );
      process.exit(1);
    }
  }

  console.log(reportJson);
} else if (!isQuiet) {
  console.error(failureMessage);
}
process.exit(checkStatus);
