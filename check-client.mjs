import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";
import {
  createCliDiagnostics,
  createTimedReportBuilder,
  hasCliOption,
  parseJsonOutput,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
  summarizeStepResults,
  toReportJson,
} from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pnpmCommand = resolvePnpmCommand();
const cliArgs = process.argv.slice(2);
const {
  optionArgs: cliOptionArgs,
  positionalArgs,
  optionTerminatorUsed,
} = splitCliArgs(cliArgs);
const positionalArgCount = positionalArgs.length;
const noBuildOptionAliases = ["--verify"];
const optionAliases = {
  "--no-build": noBuildOptionAliases,
};
const canonicalCliOptions = [
  "--compact",
  "--json",
  "--no-build",
  "--output",
  "--quiet",
];
const isQuiet = cliOptionArgs.includes("--quiet");
const isJson = cliOptionArgs.includes("--json");
const isNoBuild = hasCliOption(cliOptionArgs, "--no-build", noBuildOptionAliases);
const isCompact = cliOptionArgs.includes("--compact");
const jsonFormat = { compact: isCompact };
const { outputPath, error: outputPathError } = resolveOutputPath(cliOptionArgs);
const {
  availableCliOptionAliases,
  availableCliOptionCanonicalMap,
  supportedCliOptions,
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
  optionAliases,
  optionsWithValues: ["--output"],
  outputPathError,
});
const normalizedValidationErrorCode =
  outputPathError !== null ? "output_option_missing_value" : validationErrorCode;
const buildTimedReport = createTimedReportBuilder();
const stepResults = [];
let exitCode = 0;

if (isJson && (outputPathError !== null || unsupportedOptionsError !== null)) {
  console.log(
    toReportJson(
      buildTimedReport({
        passed: false,
        exitCode: 1,
        optionTerminatorUsed,
        positionalArgs,
        positionalArgCount,
        noBuild: isNoBuild,
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
        availableCliOptionAliases,
        availableCliOptionCanonicalMap,
        validationErrorCode: normalizedValidationErrorCode,
        steps: [],
        ...summarizeStepResults([]),
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

const addSkippedStep = (name, reason) => {
  if (!isJson) {
    return;
  }

  stepResults.push({
    name,
    passed: false,
    exitCode: null,
    skipped: true,
    reason,
    report: null,
    output: null,
  });
};

const runStep = (name, command, args) => {
  if (!isQuiet && !isJson) {
    console.log(`Running client check step: ${name}`);
  }

  const result = isJson
    ? spawnSync(command, args, {
        encoding: "utf8",
        shell: false,
        cwd: __dirname,
      })
    : spawnSync(command, args, {
        stdio: "inherit",
        shell: false,
        cwd: __dirname,
      });

  const resolvedStatus = result.status ?? 1;
  if (isJson) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const report = parseJsonOutput(output);
    stepResults.push({
      name,
      passed: resolvedStatus === 0,
      exitCode: resolvedStatus,
      skipped: false,
      reason: null,
      report,
      output: report === null ? output : null,
    });
  }

  if (resolvedStatus === 0) {
    return true;
  }

  exitCode = resolvedStatus;
  if (isJson) {
    return false;
  }

  console.error(`Client check failed: ${name}`);
  process.exit(exitCode);
};

const wasmPreflightPassed = runStep(
  "WASM artifact preflight",
  process.execPath,
  [
    path.resolve(__dirname, "./examples/client/scripts/check-wasm-mesher.mjs"),
    ...(isJson ? ["--json", "--compact"] : []),
    ...(isNoBuild ? ["--no-build"] : []),
  ]
);

if (wasmPreflightPassed) {
  runStep("TypeScript typecheck", pnpmCommand, [
    "--dir",
    "./examples/client",
    "run",
    "typecheck",
  ]);
} else {
  addSkippedStep("TypeScript typecheck", "WASM artifact preflight failed");
}

if (isJson) {
  const stepSummary = summarizeStepResults(stepResults);
  const report = buildTimedReport({
    passed: exitCode === 0,
    exitCode,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    noBuild: isNoBuild,
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
    availableCliOptionAliases,
    availableCliOptionCanonicalMap,
    validationErrorCode: null,
    steps: stepResults,
    ...stepSummary,
  });
  const { reportJson, writeError } = serializeReportWithOptionalWrite(report, {
    jsonFormat,
    outputPath,
    buildTimedReport,
  });

  console.log(reportJson);
  process.exit(writeError === null ? exitCode : 1);
}

if (!isQuiet) {
  console.log("Client checks passed.");
}
