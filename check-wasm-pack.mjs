import { spawnSync } from "node:child_process";

import { resolveCommand } from "./scripts/command-utils.mjs";
import {
  createCliDiagnostics,
  createTimedReportBuilder,
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
const jsonFormat = { compact: isCompact };
const { outputPath, error: outputPathError } = resolveOutputPath(cliOptionArgs);
const canonicalCliOptions = ["--compact", "--json", "--output", "--quiet"];
const {
  availableCliOptionAliases,
  availableCliOptionCanonicalMap,
  supportedCliOptions,
  supportedCliOptionCount,
  unknownOptions,
  unknownOptionCount,
  unsupportedOptionsError,
  validationErrorCode,
  activeCliOptions,
  activeCliOptionCount,
  activeCliOptionTokens,
  activeCliOptionResolutions,
  activeCliOptionResolutionCount,
  activeCliOptionOccurrences,
  activeCliOptionOccurrenceCount,
} = createCliDiagnostics(cliOptionArgs, {
  canonicalOptions: canonicalCliOptions,
  optionsWithValues: ["--output"],
  outputPathError,
});
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
        activeCliOptions,
        activeCliOptionCount,
        activeCliOptionTokens,
        activeCliOptionResolutions,
        activeCliOptionResolutionCount,
        activeCliOptionOccurrences,
        activeCliOptionOccurrenceCount,
        unknownOptions,
        unknownOptionCount,
        supportedCliOptions,
        supportedCliOptionCount,
        availableCliOptionAliases,
        availableCliOptionCanonicalMap,
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
      activeCliOptions,
      activeCliOptionCount,
      activeCliOptionTokens,
      activeCliOptionResolutions,
      activeCliOptionResolutionCount,
      activeCliOptionOccurrences,
      activeCliOptionOccurrenceCount,
      unknownOptions,
      unknownOptionCount,
      supportedCliOptions,
      supportedCliOptionCount,
      availableCliOptionAliases,
      availableCliOptionCanonicalMap,
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
    activeCliOptions,
    activeCliOptionCount,
    activeCliOptionTokens,
    activeCliOptionResolutions,
    activeCliOptionResolutionCount,
    activeCliOptionOccurrences,
    activeCliOptionOccurrenceCount,
    unknownOptions,
    unknownOptionCount,
    supportedCliOptions,
    supportedCliOptionCount,
    availableCliOptionAliases,
    availableCliOptionCanonicalMap,
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
