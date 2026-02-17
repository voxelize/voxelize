import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";
import {
  countRecordEntries,
  createPrefixedWasmPackCheckSummary,
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
const wasmArtifactCheckArgs = [
  path.resolve(__dirname, "./examples/client/scripts/check-wasm-mesher.mjs"),
  ...(isJson ? ["--json", "--compact"] : []),
  ...(isNoBuild ? ["--no-build"] : []),
];
const typecheckCheckArgs = ["--dir", "./examples/client", "run", "typecheck"];
const availableStepMetadata = {
  "WASM artifact preflight": {
    scriptName: "examples/client/scripts/check-wasm-mesher.mjs",
    supportsNoBuild: true,
    checkCommand: process.execPath,
    checkArgs: wasmArtifactCheckArgs,
    checkArgCount: wasmArtifactCheckArgs.length,
  },
  "TypeScript typecheck": {
    scriptName: "examples/client:typecheck",
    supportsNoBuild: false,
    checkCommand: pnpmCommand,
    checkArgs: typecheckCheckArgs,
    checkArgCount: typecheckCheckArgs.length,
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
const availableStepCheckCommandMap = Object.fromEntries(
  availableSteps.map((stepName) => {
    return [stepName, availableStepMetadata[stepName].checkCommand];
  })
);
const availableStepCheckCommandMapCount = countRecordEntries(
  availableStepCheckCommandMap
);
const availableStepCheckArgsMap = Object.fromEntries(
  availableSteps.map((stepName) => {
    return [stepName, availableStepMetadata[stepName].checkArgs];
  })
);
const availableStepCheckArgsMapCount = countRecordEntries(
  availableStepCheckArgsMap
);
const availableStepCheckArgCountMap = Object.fromEntries(
  availableSteps.map((stepName) => {
    return [stepName, availableStepMetadata[stepName].checkArgCount];
  })
);
const availableStepCheckArgCountMapCount = countRecordEntries(
  availableStepCheckArgCountMap
);
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
    checkCommand: stepMetadata.checkCommand,
    checkArgs: stepMetadata.checkArgs,
    checkArgCount: stepMetadata.checkArgCount,
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
const mapStepNamesToCheckCommandMap = (stepNames) => {
  return Object.fromEntries(
    stepNames.map((stepName) => {
      return [stepName, resolveStepDetails(stepName).checkCommand];
    })
  );
};
const mapStepNamesToCheckArgsMap = (stepNames) => {
  return Object.fromEntries(
    stepNames.map((stepName) => {
      return [stepName, resolveStepDetails(stepName).checkArgs];
    })
  );
};
const mapStepNamesToCheckArgCountMap = (stepNames) => {
  return Object.fromEntries(
    stepNames.map((stepName) => {
      return [stepName, resolveStepDetails(stepName).checkArgCount];
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
      const {
        scriptName,
        supportsNoBuild,
        checkCommand,
        checkArgs,
        checkArgCount,
      } = resolveStepDetails(stepName);
      return [
        stepName,
        {
          scriptName,
          supportsNoBuild,
          checkCommand,
          checkArgs,
          checkArgCount,
        },
      ];
    })
  );
};
const mapStepResultsToCheckCommandMap = (results) => {
  return Object.fromEntries(
    results.map((stepResult) => {
      return [stepResult.name, stepResult.checkCommand];
    })
  );
};
const mapStepResultsToCheckArgsMap = (results) => {
  return Object.fromEntries(
    results.map((stepResult) => {
      return [stepResult.name, stepResult.checkArgs];
    })
  );
};
const mapStepResultsToCheckArgCountMap = (results) => {
  return Object.fromEntries(
    results.map((stepResult) => {
      return [stepResult.name, stepResult.checkArgCount];
    })
  );
};
const mapStepResultsToStatusMap = (results) => {
  return Object.fromEntries(
    results.map((stepResult) => {
      const status = stepResult.skipped
        ? "skipped"
        : stepResult.passed
          ? "passed"
          : "failed";
      return [stepResult.name, status];
    })
  );
};
const createStepStatusCountMap = (stepSummary) => {
  return {
    passed: stepSummary.passedStepCount,
    failed: stepSummary.failedStepCount,
    skipped: stepSummary.skippedStepCount,
  };
};
const resolveWasmPackCheckMetadataFromStepResults = (results) => {
  const wasmArtifactStepResult = results.find((stepResult) => {
    return stepResult.name === "WASM artifact preflight";
  });

  if (
    wasmArtifactStepResult === undefined ||
    wasmArtifactStepResult.report === null ||
    typeof wasmArtifactStepResult.report !== "object"
  ) {
    return createPrefixedWasmPackCheckSummary(null);
  }

  return createPrefixedWasmPackCheckSummary(wasmArtifactStepResult.report);
};
const emptyWasmPackCheckSummary = createPrefixedWasmPackCheckSummary(null);
const stepResults = [];
let exitCode = 0;

if (isJson && validationFailureMessage !== null) {
  const validationStepSummary = summarizeStepResults([]);
  const validationStepStatusCountMap = createStepStatusCountMap(
    validationStepSummary
  );
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
    availableStepCheckCommandMap,
    availableStepCheckCommandMapCount,
    availableStepCheckArgsMap,
    availableStepCheckArgsMapCount,
    availableStepCheckArgCountMap,
    availableStepCheckArgCountMapCount,
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
    passedStepCheckCommandMap: {},
    passedStepCheckCommandMapCount: 0,
    passedStepCheckArgsMap: {},
    passedStepCheckArgsMapCount: 0,
    passedStepCheckArgCountMap: {},
    passedStepCheckArgCountMapCount: 0,
    passedStepIndices: [],
    passedStepIndexCount: 0,
    passedStepIndexMap: {},
    passedStepIndexMapCount: 0,
    failedStepScripts: [],
    failedStepScriptCount: 0,
    failedStepScriptMap: {},
    failedStepScriptMapCount: 0,
    failedStepCheckCommandMap: {},
    failedStepCheckCommandMapCount: 0,
    failedStepCheckArgsMap: {},
    failedStepCheckArgsMapCount: 0,
    failedStepCheckArgCountMap: {},
    failedStepCheckArgCountMapCount: 0,
    failedStepIndices: [],
    failedStepIndexCount: 0,
    failedStepIndexMap: {},
    failedStepIndexMapCount: 0,
    skippedStepScripts: [],
    skippedStepScriptCount: 0,
    skippedStepScriptMap: {},
    skippedStepScriptMapCount: 0,
    skippedStepCheckCommandMap: {},
    skippedStepCheckCommandMapCount: 0,
    skippedStepCheckArgsMap: {},
    skippedStepCheckArgsMapCount: 0,
    skippedStepCheckArgCountMap: {},
    skippedStepCheckArgCountMapCount: 0,
    skippedStepIndices: [],
    skippedStepIndexCount: 0,
    skippedStepIndexMap: {},
    skippedStepIndexMapCount: 0,
    stepCheckCommandMap: {},
    stepCheckCommandMapCount: 0,
    stepCheckArgsMap: {},
    stepCheckArgsMapCount: 0,
    stepCheckArgCountMap: {},
    stepCheckArgCountMapCount: 0,
    failureSummaries: [],
    failureSummaryCount: 0,
    stepStatusMap: {},
    stepStatusMapCount: 0,
    stepStatusCountMap: validationStepStatusCountMap,
    stepStatusCountMapCount: countRecordEntries(validationStepStatusCountMap),
    passedStepMetadata: {},
    passedStepMetadataCount: 0,
    failedStepMetadata: {},
    failedStepMetadataCount: 0,
    skippedStepMetadata: {},
    skippedStepMetadataCount: 0,
    ...emptyWasmPackCheckSummary,
    ...validationStepSummary,
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
  const {
    scriptName,
    supportsNoBuild,
    checkCommand,
    checkArgs,
    checkArgCount,
    stepIndex,
  } = resolveStepDetails(name);

  stepResults.push({
    name,
    scriptName,
    supportsNoBuild,
    checkCommand,
    checkArgs,
    checkArgCount,
    stepIndex,
    passed: false,
    exitCode: null,
    skipped: true,
    reason,
    report: null,
    output: null,
  });
};

const runStep = (name) => {
  const {
    scriptName,
    supportsNoBuild,
    checkCommand,
    checkArgs,
    checkArgCount,
    stepIndex,
  } = resolveStepDetails(name);

  if (!isQuiet && !isJson) {
    console.log(`Running client check step: ${name}`);
  }

  const result = isJson
    ? spawnSync(checkCommand, checkArgs, {
        encoding: "utf8",
        shell: false,
        cwd: __dirname,
      })
    : spawnSync(checkCommand, checkArgs, {
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
      scriptName,
      supportsNoBuild,
      checkCommand,
      checkArgs,
      checkArgCount,
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

const wasmPreflightPassed = runStep("WASM artifact preflight");

if (wasmPreflightPassed) {
  runStep("TypeScript typecheck");
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
  const passedStepCheckCommandMap = mapStepNamesToCheckCommandMap(
    stepSummary.passedSteps
  );
  const failedStepCheckCommandMap = mapStepNamesToCheckCommandMap(
    stepSummary.failedSteps
  );
  const skippedStepCheckCommandMap = mapStepNamesToCheckCommandMap(
    stepSummary.skippedSteps
  );
  const passedStepCheckArgsMap = mapStepNamesToCheckArgsMap(stepSummary.passedSteps);
  const failedStepCheckArgsMap = mapStepNamesToCheckArgsMap(stepSummary.failedSteps);
  const skippedStepCheckArgsMap = mapStepNamesToCheckArgsMap(
    stepSummary.skippedSteps
  );
  const passedStepCheckArgCountMap = mapStepNamesToCheckArgCountMap(
    stepSummary.passedSteps
  );
  const failedStepCheckArgCountMap = mapStepNamesToCheckArgCountMap(
    stepSummary.failedSteps
  );
  const skippedStepCheckArgCountMap = mapStepNamesToCheckArgCountMap(
    stepSummary.skippedSteps
  );
  const passedStepIndices = mapStepNamesToIndices(stepSummary.passedSteps);
  const failedStepIndices = mapStepNamesToIndices(stepSummary.failedSteps);
  const skippedStepIndices = mapStepNamesToIndices(stepSummary.skippedSteps);
  const passedStepIndexMap = mapStepNamesToIndexMap(stepSummary.passedSteps);
  const failedStepIndexMap = mapStepNamesToIndexMap(stepSummary.failedSteps);
  const skippedStepIndexMap = mapStepNamesToIndexMap(stepSummary.skippedSteps);
  const passedStepMetadata = mapStepNamesToMetadata(stepSummary.passedSteps);
  const failedStepMetadata = mapStepNamesToMetadata(stepSummary.failedSteps);
  const skippedStepMetadata = mapStepNamesToMetadata(stepSummary.skippedSteps);
  const stepStatusMap = mapStepResultsToStatusMap(stepResults);
  const stepCheckCommandMap = mapStepResultsToCheckCommandMap(stepResults);
  const stepCheckArgsMap = mapStepResultsToCheckArgsMap(stepResults);
  const stepCheckArgCountMap = mapStepResultsToCheckArgCountMap(stepResults);
  const stepStatusCountMap = createStepStatusCountMap(stepSummary);
  const failureSummaries = summarizeStepFailureResults(stepResults);
  const wasmPackCheckSummary = resolveWasmPackCheckMetadataFromStepResults(
    stepResults
  );
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
    availableStepCheckCommandMap,
    availableStepCheckCommandMapCount,
    availableStepCheckArgsMap,
    availableStepCheckArgsMapCount,
    availableStepCheckArgCountMap,
    availableStepCheckArgCountMapCount,
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
    passedStepCheckCommandMap,
    passedStepCheckCommandMapCount: countRecordEntries(
      passedStepCheckCommandMap
    ),
    passedStepCheckArgsMap,
    passedStepCheckArgsMapCount: countRecordEntries(passedStepCheckArgsMap),
    passedStepCheckArgCountMap,
    passedStepCheckArgCountMapCount: countRecordEntries(
      passedStepCheckArgCountMap
    ),
    passedStepIndices,
    passedStepIndexCount: passedStepIndices.length,
    passedStepIndexMap,
    passedStepIndexMapCount: countRecordEntries(passedStepIndexMap),
    failedStepScripts,
    failedStepScriptCount: failedStepScripts.length,
    failedStepScriptMap,
    failedStepScriptMapCount: countRecordEntries(failedStepScriptMap),
    failedStepCheckCommandMap,
    failedStepCheckCommandMapCount: countRecordEntries(
      failedStepCheckCommandMap
    ),
    failedStepCheckArgsMap,
    failedStepCheckArgsMapCount: countRecordEntries(failedStepCheckArgsMap),
    failedStepCheckArgCountMap,
    failedStepCheckArgCountMapCount: countRecordEntries(
      failedStepCheckArgCountMap
    ),
    failedStepIndices,
    failedStepIndexCount: failedStepIndices.length,
    failedStepIndexMap,
    failedStepIndexMapCount: countRecordEntries(failedStepIndexMap),
    skippedStepScripts,
    skippedStepScriptCount: skippedStepScripts.length,
    skippedStepScriptMap,
    skippedStepScriptMapCount: countRecordEntries(skippedStepScriptMap),
    skippedStepCheckCommandMap,
    skippedStepCheckCommandMapCount: countRecordEntries(
      skippedStepCheckCommandMap
    ),
    skippedStepCheckArgsMap,
    skippedStepCheckArgsMapCount: countRecordEntries(skippedStepCheckArgsMap),
    skippedStepCheckArgCountMap,
    skippedStepCheckArgCountMapCount: countRecordEntries(
      skippedStepCheckArgCountMap
    ),
    skippedStepIndices,
    skippedStepIndexCount: skippedStepIndices.length,
    skippedStepIndexMap,
    skippedStepIndexMapCount: countRecordEntries(skippedStepIndexMap),
    stepCheckCommandMap,
    stepCheckCommandMapCount: countRecordEntries(stepCheckCommandMap),
    stepCheckArgsMap,
    stepCheckArgsMapCount: countRecordEntries(stepCheckArgsMap),
    stepCheckArgCountMap,
    stepCheckArgCountMapCount: countRecordEntries(stepCheckArgCountMap),
    failureSummaries,
    failureSummaryCount: failureSummaries.length,
    stepStatusMap,
    stepStatusMapCount: countRecordEntries(stepStatusMap),
    stepStatusCountMap,
    stepStatusCountMapCount: countRecordEntries(stepStatusCountMap),
    passedStepMetadata,
    passedStepMetadataCount: countRecordEntries(passedStepMetadata),
    failedStepMetadata,
    failedStepMetadataCount: countRecordEntries(failedStepMetadata),
    skippedStepMetadata,
    skippedStepMetadataCount: countRecordEntries(skippedStepMetadata),
    ...wasmPackCheckSummary,
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
