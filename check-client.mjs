import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";
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
  summarizeStepFailureResults,
  summarizeStepResults,
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
const availableSteps = ["WASM artifact preflight", "TypeScript typecheck"];
const availableStepMetadata = {
  "WASM artifact preflight": {
    scriptName: "examples/client/scripts/check-wasm-mesher.mjs",
    supportsNoBuild: true,
  },
  "TypeScript typecheck": {
    scriptName: "examples/client:typecheck",
    supportsNoBuild: false,
  },
};
const availableStepScripts = availableSteps.map((stepName) => {
  return availableStepMetadata[stepName].scriptName;
});
const availableStepIndices = availableSteps.map((_, index) => {
  return index;
});
const availableStepIndexMap = new Map(
  availableSteps.map((stepName, index) => {
    return [stepName, index];
  })
);
const mapStepNamesToScripts = (stepNames) => {
  return stepNames.map((stepName) => {
    return availableStepMetadata[stepName].scriptName;
  });
};
const mapStepNamesToIndices = (stepNames) => {
  return stepNames.map((stepName) => {
    const stepIndex = availableStepIndexMap.get(stepName);
    if (stepIndex === undefined) {
      throw new Error(`Missing step index metadata for ${stepName}.`);
    }
    return stepIndex;
  });
};
const mapStepNamesToMetadata = (stepNames) => {
  return Object.fromEntries(
    stepNames.map((stepName) => {
      return [stepName, availableStepMetadata[stepName]];
    })
  );
};
const resolveStepDetails = (stepName) => {
  const stepMetadata = availableStepMetadata[stepName];
  const stepIndex = availableStepIndexMap.get(stepName);

  if (stepMetadata === undefined || stepIndex === undefined) {
    throw new Error(`Missing step metadata for ${stepName}.`);
  }

  return {
    scriptName: stepMetadata.scriptName,
    supportsNoBuild: stepMetadata.supportsNoBuild,
    stepIndex,
  };
};
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
    availableSteps,
    availableStepCount: availableSteps.length,
    availableStepScripts,
    availableStepScriptCount: availableStepScripts.length,
    availableStepIndices,
    availableStepIndexCount: availableStepIndices.length,
    availableStepMetadata,
    steps: [],
    passedStepScripts: [],
    passedStepScriptCount: 0,
    passedStepIndices: [],
    passedStepIndexCount: 0,
    failedStepScripts: [],
    failedStepScriptCount: 0,
    failedStepIndices: [],
    failedStepIndexCount: 0,
    skippedStepScripts: [],
    skippedStepScriptCount: 0,
    skippedStepIndices: [],
    skippedStepIndexCount: 0,
    failureSummaries: [],
    failureSummaryCount: 0,
    passedStepMetadata: {},
    failedStepMetadata: {},
    skippedStepMetadata: {},
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
  const { scriptName, supportsNoBuild, stepIndex } = resolveStepDetails(name);

  stepResults.push({
    name,
    scriptName,
    supportsNoBuild,
    stepIndex,
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
    const { scriptName, supportsNoBuild, stepIndex } = resolveStepDetails(name);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const report = parseJsonOutput(output);
    stepResults.push({
      name,
      scriptName,
      supportsNoBuild,
      stepIndex,
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
  const passedStepScripts = mapStepNamesToScripts(stepSummary.passedSteps);
  const failedStepScripts = mapStepNamesToScripts(stepSummary.failedSteps);
  const skippedStepScripts = mapStepNamesToScripts(stepSummary.skippedSteps);
  const passedStepIndices = mapStepNamesToIndices(stepSummary.passedSteps);
  const failedStepIndices = mapStepNamesToIndices(stepSummary.failedSteps);
  const skippedStepIndices = mapStepNamesToIndices(stepSummary.skippedSteps);
  const passedStepMetadata = mapStepNamesToMetadata(stepSummary.passedSteps);
  const failedStepMetadata = mapStepNamesToMetadata(stepSummary.failedSteps);
  const skippedStepMetadata = mapStepNamesToMetadata(stepSummary.skippedSteps);
  const failureSummaries = summarizeStepFailureResults(stepResults);
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
    availableSteps,
    availableStepCount: availableSteps.length,
    availableStepScripts,
    availableStepScriptCount: availableStepScripts.length,
    availableStepIndices,
    availableStepIndexCount: availableStepIndices.length,
    availableStepMetadata,
    steps: stepResults,
    passedStepScripts,
    passedStepScriptCount: passedStepScripts.length,
    passedStepIndices,
    passedStepIndexCount: passedStepIndices.length,
    failedStepScripts,
    failedStepScriptCount: failedStepScripts.length,
    failedStepIndices,
    failedStepIndexCount: failedStepIndices.length,
    skippedStepScripts,
    skippedStepScriptCount: skippedStepScripts.length,
    skippedStepIndices,
    skippedStepIndexCount: skippedStepIndices.length,
    failureSummaries,
    failureSummaryCount: failureSummaries.length,
    passedStepMetadata,
    failedStepMetadata,
    skippedStepMetadata,
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
