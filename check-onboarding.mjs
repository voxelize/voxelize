import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCliOptionCatalog,
  createCliDiagnostics,
  deriveCliValidationFailureMessage,
  createTimedReportBuilder,
  hasCliOption,
  parseJsonOutput,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
  summarizeStepResults,
} from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
const { supportedCliOptions: supportedCliOptionTokens } = createCliOptionCatalog({
  canonicalOptions: canonicalCliOptions,
  optionAliases,
});
const { outputPath, error: outputPathError } = resolveOutputPath(
  cliOptionArgs,
  process.cwd(),
  supportedCliOptionTokens
);
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
  optionAliases,
  optionsWithValues: ["--output"],
  optionsWithStrictValues: ["--output"],
  outputPathError,
});
const buildTimedReport = createTimedReportBuilder();
const validationFailureMessage = deriveCliValidationFailureMessage({
  outputPathError,
  unsupportedOptionsError,
});
const stepResults = [];
let exitCode = 0;

if (isJson && validationFailureMessage !== null) {
  const report = buildTimedReport({
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
    supportedCliOptionCount,
    availableCliOptionAliases,
    availableCliOptionCanonicalMap,
    validationErrorCode,
    steps: [],
    ...summarizeStepResults([]),
    message: validationFailureMessage,
  });
  const { reportJson } = serializeReportWithOptionalWrite(report, {
    jsonFormat,
    outputPath: outputPathError === null ? outputPath : null,
    buildTimedReport,
  });

  console.log(reportJson);
  process.exit(1);
}

if (!isJson && validationFailureMessage !== null) {
  console.error(validationFailureMessage);
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

const runStep = (name, scriptPath, extraArgs = []) => {
  if (!isQuiet && !isJson) {
    console.log(`Running onboarding step: ${name}`);
  }

  const scriptArgs = isJson
    ? [scriptPath, "--json", "--compact", ...extraArgs]
    : isQuiet
      ? [scriptPath, "--quiet", ...extraArgs]
      : [scriptPath, ...extraArgs];
  const result = isJson
    ? spawnSync(process.execPath, scriptArgs, {
        encoding: "utf8",
        shell: false,
        cwd: __dirname,
      })
    : spawnSync(process.execPath, scriptArgs, {
        stdio: "inherit",
        shell: false,
        cwd: __dirname,
      });

  const resolvedStatus = result.status ?? 1;
  if (isJson) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const parsedReport = parseJsonOutput(output);
    stepResults.push({
      name,
      passed: resolvedStatus === 0,
      exitCode: resolvedStatus,
      skipped: false,
      reason: null,
      report: parsedReport,
      output: parsedReport === null ? output : null,
    });
  }

  if (resolvedStatus === 0) {
    return true;
  }

  exitCode = resolvedStatus;
  if (isJson) {
    return false;
  }

  console.error(`Onboarding check failed: ${name}`);
  process.exit(exitCode);
};

const devEnvPassed = runStep(
  "Developer environment preflight",
  path.resolve(__dirname, "check-dev-env.mjs")
);

if (!devEnvPassed) {
  addSkippedStep("TypeScript core checks", "Developer environment preflight failed");
  addSkippedStep(
    "Runtime library checks",
    "Developer environment preflight failed"
  );
  addSkippedStep("Client checks", "Developer environment preflight failed");
} else {
  const tsCorePassed = runStep(
    "TypeScript core checks",
    path.resolve(__dirname, "check-ts-core.mjs"),
    [
      ...(isNoBuild ? ["--no-build"] : []),
    ]
  );
  if (tsCorePassed) {
    const runtimeLibrariesPassed = runStep(
      "Runtime library checks",
      path.resolve(__dirname, "check-runtime-libraries.mjs"),
      [
        ...(isNoBuild ? ["--no-build"] : []),
      ]
    );
    if (runtimeLibrariesPassed) {
      runStep("Client checks", path.resolve(__dirname, "check-client.mjs"), [
        ...(isNoBuild ? ["--no-build"] : []),
      ]);
    } else {
      addSkippedStep("Client checks", "Runtime library checks failed");
    }
  } else {
    addSkippedStep("Runtime library checks", "TypeScript core checks failed");
    addSkippedStep("Client checks", "TypeScript core checks failed");
  }
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
    supportedCliOptionCount,
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
  console.log("Onboarding checks passed.");
}
