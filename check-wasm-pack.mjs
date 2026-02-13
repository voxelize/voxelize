import { spawnSync } from "node:child_process";

import { resolveCommand } from "./scripts/command-utils.mjs";
import {
  createTimedReportBuilder,
  parseUnknownCliOptions,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
  toReportJson,
} from "./scripts/report-utils.mjs";

const wasmPackCommand = resolveCommand("wasm-pack");
const cliArgs = process.argv.slice(2);
const {
  optionArgs: cliOptionArgs,
  positionalArgs,
  optionTerminatorUsed,
} = splitCliArgs(cliArgs);
const positionalArgCount = positionalArgs.length;
const isQuiet = cliOptionArgs.includes("--quiet");
const isJson = cliOptionArgs.includes("--json");
const isCompact = cliOptionArgs.includes("--compact");
const supportedCliOptions = ["--compact", "--json", "--output", "--quiet"];
const unknownOptions = parseUnknownCliOptions(cliOptionArgs, {
  canonicalOptions: supportedCliOptions,
  optionsWithValues: ["--output"],
});
const unknownOptionCount = unknownOptions.length;
const unsupportedOptionsError =
  unknownOptionCount === 0
    ? null
    : `Unsupported option(s): ${unknownOptions.join(", ")}. Supported options: ${supportedCliOptions.join(", ")}.`;
const jsonFormat = { compact: isCompact };
const { outputPath, error: outputPathError } = resolveOutputPath(cliOptionArgs);
const validationErrorCode =
  outputPathError !== null
    ? "output_option_missing_value"
    : unsupportedOptionsError !== null
      ? "unsupported_options"
      : null;
const buildTimedReport = createTimedReportBuilder();

if (isJson && (outputPathError !== null || unsupportedOptionsError !== null)) {
  console.log(
    toReportJson(
      buildTimedReport({
        passed: false,
        exitCode: 1,
        optionTerminatorUsed,
        positionalArgs,
        positionalArgCount,
        command: wasmPackCommand,
        version: null,
        outputPath: outputPathError === null ? outputPath : null,
        unknownOptions,
        unknownOptionCount,
        supportedCliOptions,
        validationErrorCode,
        message: outputPathError ?? unsupportedOptionsError,
      }),
      jsonFormat
    )
  );
  process.exit(1);
}

if (!isJson && unsupportedOptionsError !== null) {
  console.error(unsupportedOptionsError);
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
    const report = buildTimedReport({
      passed: true,
      exitCode: 0,
      optionTerminatorUsed,
      positionalArgs,
      positionalArgCount,
      command: wasmPackCommand,
      version: firstLine,
      outputPath,
      unknownOptions,
      unknownOptionCount,
      supportedCliOptions,
      validationErrorCode: null,
    });
    const { reportJson, writeError } = serializeReportWithOptionalWrite(report, {
      jsonFormat,
      outputPath,
      buildTimedReport,
    });

    console.log(reportJson);
    if (writeError !== null) {
      process.exit(1);
    }
  }
  process.exit(0);
}

const failureMessage = `wasm-pack is required for wasm build commands (expected command: ${wasmPackCommand}). Install it from https://rustwasm.github.io/wasm-pack/installer/.`;

if (isJson) {
  const report = buildTimedReport({
    passed: false,
    exitCode: checkStatus,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    command: wasmPackCommand,
    version: null,
    outputPath,
    unknownOptions,
    unknownOptionCount,
    supportedCliOptions,
    validationErrorCode: null,
    message: failureMessage,
  });
  const { reportJson, writeError } = serializeReportWithOptionalWrite(report, {
    jsonFormat,
    outputPath,
    buildTimedReport,
  });

  console.log(reportJson);
  if (writeError !== null) {
    process.exit(1);
  }
} else if (!isQuiet) {
  console.error(failureMessage);
}
process.exit(checkStatus);
