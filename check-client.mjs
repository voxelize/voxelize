import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";
import {
  countRecordEntries,
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
const availableStepMetadataCount = countRecordEntries(availableStepMetadata);
const availableStepScripts = availableSteps.map((stepName) => {
  return availableStepMetadata[stepName].scriptName;
});
const availableStepScriptMap = Object.fromEntries(
  availableSteps.map((stepName) => {
    return [stepName, availableStepMetadata[stepName].scriptName];
  })
);
const availableStepScriptMapCount = countRecordEntries(availableStepScriptMap);
const availableStepSupportsNoBuildMap = Object.fromEntries(
  availableSteps.map((stepName) => {
    return [stepName, availableStepMetadata[stepName].supportsNoBuild];
  })
);
const availableStepSupportsNoBuildMapCount = countRecordEntries(
  availableStepSupportsNoBuildMap
);
const availableStepIndices = availableSteps.map((_, index) => {
  return index;
});
const availableStepIndexMap = new Map(
  availableSteps.map((stepName, index) => {
    return [stepName, index];
  })
);
const availableStepIndexMapReport = Object.fromEntries(availableStepIndexMap);
const availableStepIndexMapCount = countRecordEntries(availableStepIndexMapReport);
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
const mapStepNamesToScripts = (stepNames) => {
  return stepNames.map((stepName) => {
    return resolveStepDetails(stepName).scriptName;
  });
};
const mapStepNamesToScriptMap = (stepNames) => {
  return Object.fromEntries(
    stepNames.map((stepName) => {
      return [stepName, resolveStepDetails(stepName).scriptName];
    })
  );
};
const mapStepNamesToIndices = (stepNames) => {
  return stepNames.map((stepName) => {
    return resolveStepDetails(stepName).stepIndex;
  });
};
const mapStepNamesToIndexMap = (stepNames) => {
  return Object.fromEntries(
    stepNames.map((stepName) => {
      return [stepName, resolveStepDetails(stepName).stepIndex];
    })
  );
};
const mapStepNamesToMetadata = (stepNames) => {
  return Object.fromEntries(
    stepNames.map((stepName) => {
      const { scriptName, supportsNoBuild } = resolveStepDetails(stepName);
      return [stepName, { scriptName, supportsNoBuild }];
    })
  );
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
    availableStepScriptMap,
    availableStepScriptMapCount,
    availableStepSupportsNoBuildMap,
    availableStepSupportsNoBuildMapCount,
    availableStepIndices,
    availableStepIndexCount: availableStepIndices.length,
    availableStepIndexMap: availableStepIndexMapReport,
    availableStepIndexMapCount,
    availableStepMetadata,
    availableStepMetadataCount,
    steps: [],
    passedStepScripts: [],
    passedStepScriptCount: 0,
    passedStepScriptMap: {},
    passedStepScriptMapCount: 0,
    passedStepIndices: [],
    passedStepIndexCount: 0,
    passedStepIndexMap: {},
    passedStepIndexMapCount: 0,
    failedStepScripts: [],
    failedStepScriptCount: 0,
    failedStepScriptMap: {},
    failedStepScriptMapCount: 0,
    failedStepIndices: [],
    failedStepIndexCount: 0,
    failedStepIndexMap: {},
    failedStepIndexMapCount: 0,
    skippedStepScripts: [],
    skippedStepScriptCount: 0,
    skippedStepScriptMap: {},
    skippedStepScriptMapCount: 0,
    skippedStepIndices: [],
    skippedStepIndexCount: 0,
    skippedStepIndexMap: {},
    skippedStepIndexMapCount: 0,
    failureSummaries: [],
    failureSummaryCount: 0,
    passedStepMetadata: {},
    passedStepMetadataCount: 0,
    failedStepMetadata: {},
    failedStepMetadataCount: 0,
    skippedStepMetadata: {},
    skippedStepMetadataCount: 0,
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
  const passedStepScriptMap = mapStepNamesToScriptMap(stepSummary.passedSteps);
  const failedStepScriptMap = mapStepNamesToScriptMap(stepSummary.failedSteps);
  const skippedStepScriptMap = mapStepNamesToScriptMap(stepSummary.skippedSteps);
  const passedStepIndices = mapStepNamesToIndices(stepSummary.passedSteps);
  const failedStepIndices = mapStepNamesToIndices(stepSummary.failedSteps);
  const skippedStepIndices = mapStepNamesToIndices(stepSummary.skippedSteps);
  const passedStepIndexMap = mapStepNamesToIndexMap(stepSummary.passedSteps);
  const failedStepIndexMap = mapStepNamesToIndexMap(stepSummary.failedSteps);
  const skippedStepIndexMap = mapStepNamesToIndexMap(stepSummary.skippedSteps);
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
    availableStepScriptMap,
    availableStepScriptMapCount,
    availableStepSupportsNoBuildMap,
    availableStepSupportsNoBuildMapCount,
    availableStepIndices,
    availableStepIndexCount: availableStepIndices.length,
    availableStepIndexMap: availableStepIndexMapReport,
    availableStepIndexMapCount,
    availableStepMetadata,
    availableStepMetadataCount,
    steps: stepResults,
    passedStepScripts,
    passedStepScriptCount: passedStepScripts.length,
    passedStepScriptMap,
    passedStepScriptMapCount: countRecordEntries(passedStepScriptMap),
    passedStepIndices,
    passedStepIndexCount: passedStepIndices.length,
    passedStepIndexMap,
    passedStepIndexMapCount: countRecordEntries(passedStepIndexMap),
    failedStepScripts,
    failedStepScriptCount: failedStepScripts.length,
    failedStepScriptMap,
    failedStepScriptMapCount: countRecordEntries(failedStepScriptMap),
    failedStepIndices,
    failedStepIndexCount: failedStepIndices.length,
    failedStepIndexMap,
    failedStepIndexMapCount: countRecordEntries(failedStepIndexMap),
    skippedStepScripts,
    skippedStepScriptCount: skippedStepScripts.length,
    skippedStepScriptMap,
    skippedStepScriptMapCount: countRecordEntries(skippedStepScriptMap),
    skippedStepIndices,
    skippedStepIndexCount: skippedStepIndices.length,
    skippedStepIndexMap,
    skippedStepIndexMapCount: countRecordEntries(skippedStepIndexMap),
    failureSummaries,
    failureSummaryCount: failureSummaries.length,
    passedStepMetadata,
    passedStepMetadataCount: countRecordEntries(passedStepMetadata),
    failedStepMetadata,
    failedStepMetadataCount: countRecordEntries(failedStepMetadata),
    skippedStepMetadata,
    skippedStepMetadataCount: countRecordEntries(skippedStepMetadata),
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
