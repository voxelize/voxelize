import { spawnSync } from "node:child_process";

import { resolveCommand } from "./scripts/command-utils.mjs";
import {
  countRecordEntries,
  createCliDiagnostics,
  deriveCliValidationFailureMessage,
  createTimedReportBuilder,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
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
const canonicalCliOptions = ["--compact", "--json", "--output", "--quiet"];
const { outputPath, error: outputPathError } = resolveOutputPath(
  cliOptionArgs,
  process.cwd(),
  canonicalCliOptions
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
  optionsWithValues: ["--output"],
  optionsWithStrictValues: ["--output"],
  outputPathError,
});
const buildTimedReport = createTimedReportBuilder();
const validationFailureMessage = deriveCliValidationFailureMessage({
  outputPathError,
  unsupportedOptionsError,
});
const checkName = "wasm-pack";
const checkArgs = ["--version"];
const availableChecks = [checkName];
const availableCheckCommandMap = {
  [checkName]: wasmPackCommand,
};
const availableCheckArgsMap = {
  [checkName]: checkArgs,
};
const availableCheckArgCountMap = {
  [checkName]: checkArgs.length,
};
const availableCheckIndexMap = {
  [checkName]: 0,
};
const availableCheckIndices = Object.values(availableCheckIndexMap);
const availableCheckMetadata = {
  [checkName]: {
    checkIndex: availableCheckIndexMap[checkName],
    command: wasmPackCommand,
    args: [...checkArgs],
    argCount: checkArgs.length,
    checkCommand: wasmPackCommand,
    checkArgs: [...checkArgs],
    checkArgCount: checkArgs.length,
  },
};
const summarizeCheckResult = ({
  includeCheck,
  status,
  exitCode,
  version,
  outputLine,
  message,
}) => {
  if (includeCheck === false) {
    return {
      checkLabels: [],
      checkCount: 0,
      checkIndices: [],
      checkIndexCount: 0,
      checkIndexMap: {},
      checkIndexMapCount: 0,
      checkCommandMap: {},
      checkCommandMapCount: 0,
      checkArgsMap: {},
      checkArgsMapCount: 0,
      checkArgCountMap: {},
      checkArgCountMapCount: 0,
      checkMetadata: {},
      checkMetadataCount: 0,
      checkStatusMap: {},
      checkStatusMapCount: 0,
      checkStatusCountMap: {},
      checkStatusCountMapCount: 0,
      checkVersionMap: {},
      checkVersionMapCount: 0,
      checkExitCodeMap: {},
      checkExitCodeMapCount: 0,
      checkOutputLineMap: {},
      checkOutputLineMapCount: 0,
      passedChecks: [],
      passedCheckCount: 0,
      passedCheckIndices: [],
      passedCheckIndexCount: 0,
      passedCheckIndexMap: {},
      passedCheckIndexMapCount: 0,
      passedCheckCommandMap: {},
      passedCheckCommandMapCount: 0,
      passedCheckArgsMap: {},
      passedCheckArgsMapCount: 0,
      passedCheckArgCountMap: {},
      passedCheckArgCountMapCount: 0,
      passedCheckMetadata: {},
      passedCheckMetadataCount: 0,
      failedChecks: [],
      failedCheckCount: 0,
      failedCheckIndices: [],
      failedCheckIndexCount: 0,
      failedCheckIndexMap: {},
      failedCheckIndexMapCount: 0,
      failedCheckCommandMap: {},
      failedCheckCommandMapCount: 0,
      failedCheckArgsMap: {},
      failedCheckArgsMapCount: 0,
      failedCheckArgCountMap: {},
      failedCheckArgCountMapCount: 0,
      failedCheckMetadata: {},
      failedCheckMetadataCount: 0,
      failureSummaries: [],
      failureSummaryCount: 0,
    };
  }

  const checkLabels = [checkName];
  const checkIndices = [availableCheckIndexMap[checkName]];
  const checkIndexMap = {
    [checkName]: availableCheckIndexMap[checkName],
  };
  const checkCommandMap = {
    [checkName]: wasmPackCommand,
  };
  const checkArgsMap = {
    [checkName]: [...checkArgs],
  };
  const checkArgCountMap = {
    [checkName]: checkArgs.length,
  };
  const checkMetadata = {
    [checkName]: {
      checkIndex: availableCheckIndexMap[checkName],
      command: wasmPackCommand,
      args: [...checkArgs],
      argCount: checkArgs.length,
      checkCommand: wasmPackCommand,
      checkArgs: [...checkArgs],
      checkArgCount: checkArgs.length,
    },
  };
  const checkStatusMap = {
    [checkName]: status,
  };
  const checkStatusCountMap = {
    [status]: 1,
  };
  const checkVersionMap = {
    [checkName]: version,
  };
  const checkExitCodeMap = {
    [checkName]: exitCode,
  };
  const checkOutputLineMap = {
    [checkName]: outputLine,
  };
  const passedChecks = status === "ok" ? [checkName] : [];
  const passedCheckIndices = status === "ok" ? [...checkIndices] : [];
  const passedCheckIndexMap =
    status === "ok"
      ? {
          ...checkIndexMap,
        }
      : {};
  const passedCheckCommandMap =
    status === "ok"
      ? {
          ...checkCommandMap,
        }
      : {};
  const passedCheckArgsMap =
    status === "ok"
      ? {
          ...checkArgsMap,
        }
      : {};
  const passedCheckArgCountMap =
    status === "ok"
      ? {
          ...checkArgCountMap,
        }
      : {};
  const passedCheckMetadata =
    status === "ok"
      ? {
          ...checkMetadata,
        }
      : {};
  const failedChecks = status === "ok" ? [] : [checkName];
  const failedCheckIndices = status === "ok" ? [] : [...checkIndices];
  const failedCheckIndexMap =
    status === "ok"
      ? {}
      : {
          ...checkIndexMap,
        };
  const failedCheckCommandMap =
    status === "ok"
      ? {}
      : {
          ...checkCommandMap,
        };
  const failedCheckArgsMap =
    status === "ok"
      ? {}
      : {
          ...checkArgsMap,
        };
  const failedCheckArgCountMap =
    status === "ok"
      ? {}
      : {
          ...checkArgCountMap,
        };
  const failedCheckMetadata =
    status === "ok"
      ? {}
      : {
          ...checkMetadata,
        };
  const failureSummaries =
    status === "ok"
      ? []
      : [
          {
            name: checkName,
            checkIndex: availableCheckIndexMap[checkName],
            command: wasmPackCommand,
            args: [...checkArgs],
            argCount: checkArgs.length,
            checkCommand: wasmPackCommand,
            checkArgs: [...checkArgs],
            checkArgCount: checkArgs.length,
            exitCode,
            status,
            message,
          },
        ];

  return {
    checkLabels,
    checkCount: checkLabels.length,
    checkIndices,
    checkIndexCount: checkIndices.length,
    checkIndexMap,
    checkIndexMapCount: countRecordEntries(checkIndexMap),
    checkCommandMap,
    checkCommandMapCount: countRecordEntries(checkCommandMap),
    checkArgsMap,
    checkArgsMapCount: countRecordEntries(checkArgsMap),
    checkArgCountMap,
    checkArgCountMapCount: countRecordEntries(checkArgCountMap),
    checkMetadata,
    checkMetadataCount: countRecordEntries(checkMetadata),
    checkStatusMap,
    checkStatusMapCount: countRecordEntries(checkStatusMap),
    checkStatusCountMap,
    checkStatusCountMapCount: countRecordEntries(checkStatusCountMap),
    checkVersionMap,
    checkVersionMapCount: countRecordEntries(checkVersionMap),
    checkExitCodeMap,
    checkExitCodeMapCount: countRecordEntries(checkExitCodeMap),
    checkOutputLineMap,
    checkOutputLineMapCount: countRecordEntries(checkOutputLineMap),
    passedChecks,
    passedCheckCount: passedChecks.length,
    passedCheckIndices,
    passedCheckIndexCount: passedCheckIndices.length,
    passedCheckIndexMap,
    passedCheckIndexMapCount: countRecordEntries(passedCheckIndexMap),
    passedCheckCommandMap,
    passedCheckCommandMapCount: countRecordEntries(passedCheckCommandMap),
    passedCheckArgsMap,
    passedCheckArgsMapCount: countRecordEntries(passedCheckArgsMap),
    passedCheckArgCountMap,
    passedCheckArgCountMapCount: countRecordEntries(passedCheckArgCountMap),
    passedCheckMetadata,
    passedCheckMetadataCount: countRecordEntries(passedCheckMetadata),
    failedChecks,
    failedCheckCount: failedChecks.length,
    failedCheckIndices,
    failedCheckIndexCount: failedCheckIndices.length,
    failedCheckIndexMap,
    failedCheckIndexMapCount: countRecordEntries(failedCheckIndexMap),
    failedCheckCommandMap,
    failedCheckCommandMapCount: countRecordEntries(failedCheckCommandMap),
    failedCheckArgsMap,
    failedCheckArgsMapCount: countRecordEntries(failedCheckArgsMap),
    failedCheckArgCountMap,
    failedCheckArgCountMapCount: countRecordEntries(failedCheckArgCountMap),
    failedCheckMetadata,
    failedCheckMetadataCount: countRecordEntries(failedCheckMetadata),
    failureSummaries,
    failureSummaryCount: failureSummaries.length,
  };
};

if (isJson && validationFailureMessage !== null) {
  const report = buildTimedReport({
    passed: false,
    exitCode: 1,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    command: wasmPackCommand,
    version: null,
    availableChecks,
    availableCheckCount: availableChecks.length,
    availableCheckCommandMap,
    availableCheckCommandMapCount: countRecordEntries(availableCheckCommandMap),
    availableCheckArgsMap,
    availableCheckArgsMapCount: countRecordEntries(availableCheckArgsMap),
    availableCheckArgCountMap,
    availableCheckArgCountMapCount: countRecordEntries(availableCheckArgCountMap),
    availableCheckIndices,
    availableCheckIndexCount: availableCheckIndices.length,
    availableCheckMetadata,
    availableCheckMetadataCount: countRecordEntries(availableCheckMetadata),
    availableCheckIndexMap,
    availableCheckIndexMapCount: countRecordEntries(availableCheckIndexMap),
    ...summarizeCheckResult({
      includeCheck: false,
    }),
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

const versionCheck = isJson
  ? spawnSync(wasmPackCommand, checkArgs, {
      encoding: "utf8",
      shell: false,
    })
  : spawnSync(wasmPackCommand, checkArgs, {
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
const checkStatusKind =
  checkStatus === 0
    ? "ok"
    : versionCheck.error !== undefined
      ? "missing"
      : "unavailable";

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
      availableChecks,
      availableCheckCount: availableChecks.length,
      availableCheckCommandMap,
      availableCheckCommandMapCount: countRecordEntries(availableCheckCommandMap),
      availableCheckArgsMap,
      availableCheckArgsMapCount: countRecordEntries(availableCheckArgsMap),
      availableCheckArgCountMap,
      availableCheckArgCountMapCount: countRecordEntries(availableCheckArgCountMap),
      availableCheckIndices,
      availableCheckIndexCount: availableCheckIndices.length,
      availableCheckMetadata,
      availableCheckMetadataCount: countRecordEntries(availableCheckMetadata),
      availableCheckIndexMap,
      availableCheckIndexMapCount: countRecordEntries(availableCheckIndexMap),
      ...summarizeCheckResult({
        includeCheck: true,
        status: checkStatusKind,
        exitCode: checkStatus,
        version: firstLine,
        outputLine: firstLine,
        message: null,
      }),
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
    availableChecks,
    availableCheckCount: availableChecks.length,
    availableCheckCommandMap,
    availableCheckCommandMapCount: countRecordEntries(availableCheckCommandMap),
    availableCheckArgsMap,
    availableCheckArgsMapCount: countRecordEntries(availableCheckArgsMap),
    availableCheckArgCountMap,
    availableCheckArgCountMapCount: countRecordEntries(availableCheckArgCountMap),
    availableCheckIndices,
    availableCheckIndexCount: availableCheckIndices.length,
    availableCheckMetadata,
    availableCheckMetadataCount: countRecordEntries(availableCheckMetadata),
    availableCheckIndexMap,
    availableCheckIndexMapCount: countRecordEntries(availableCheckIndexMap),
    ...summarizeCheckResult({
      includeCheck: true,
      status: checkStatusKind,
      exitCode: checkStatus,
      version: null,
      outputLine: firstLine,
      message: failureMessage,
    }),
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
