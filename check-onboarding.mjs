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
  summarizeStepFailureResults,
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
const availableSteps = [
  "Developer environment preflight",
  "TypeScript core checks",
  "Runtime library checks",
  "Client checks",
];
const availableStepMetadata = {
  "Developer environment preflight": {
    scriptName: "check-dev-env.mjs",
    supportsNoBuild: false,
  },
  "TypeScript core checks": {
    scriptName: "check-ts-core.mjs",
    supportsNoBuild: true,
  },
  "Runtime library checks": {
    scriptName: "check-runtime-libraries.mjs",
    supportsNoBuild: true,
  },
  "Client checks": {
    scriptName: "check-client.mjs",
    supportsNoBuild: true,
  },
};
const availableStepMetadataCount = Object.keys(availableStepMetadata).length;
const availableStepScripts = availableSteps.map((stepName) => {
  return availableStepMetadata[stepName].scriptName;
});
const availableStepScriptMap = Object.fromEntries(
  availableSteps.map((stepName) => {
    return [stepName, availableStepMetadata[stepName].scriptName];
  })
);
const availableStepScriptMapCount = Object.keys(availableStepScriptMap).length;
const availableStepSupportsNoBuildMap = Object.fromEntries(
  availableSteps.map((stepName) => {
    return [stepName, availableStepMetadata[stepName].supportsNoBuild];
  })
);
const availableStepSupportsNoBuildMapCount = Object.keys(
  availableStepSupportsNoBuildMap
).length;
const availableStepIndices = availableSteps.map((_, index) => {
  return index;
});
const availableStepIndexMap = new Map(
  availableSteps.map((stepName, index) => {
    return [stepName, index];
  })
);
const availableStepIndexMapReport = Object.fromEntries(availableStepIndexMap);
const availableStepIndexMapCount = Object.keys(availableStepIndexMapReport).length;
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
const mapStepNamesToIndices = (stepNames) => {
  return stepNames.map((stepName) => {
    return resolveStepDetails(stepName).stepIndex;
  });
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
    const { scriptName, supportsNoBuild, stepIndex } = resolveStepDetails(name);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const parsedReport = parseJsonOutput(output);
    stepResults.push({
      name,
      scriptName,
      supportsNoBuild,
      stepIndex,
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
    passedStepMetadataCount: Object.keys(passedStepMetadata).length,
    failedStepMetadata,
    failedStepMetadataCount: Object.keys(failedStepMetadata).length,
    skippedStepMetadata,
    skippedStepMetadataCount: Object.keys(skippedStepMetadata).length,
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
