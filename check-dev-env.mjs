import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCommand } from "./scripts/command-utils.mjs";
import {
  formatSemver,
  isSemverAtLeast,
  loadWorkspaceMinimumVersions,
  parseSemver,
} from "./scripts/dev-env-utils.mjs";
import {
  countRecordEntries,
  createCliDiagnostics,
  deriveCliValidationFailureMessage,
  createTimedReportBuilder,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
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
const minimumVersions = loadWorkspaceMinimumVersions(__dirname);

const checks = [
  {
    label: "node",
    command: process.execPath,
    args: ["--version"],
    required: true,
    minVersion: minimumVersions.node,
    hint: "Install Node.js: https://nodejs.org/en/download/",
  },
  {
    label: "pnpm",
    command: resolveCommand("pnpm"),
    args: ["--version"],
    required: true,
    minVersion: minimumVersions.pnpm,
    hint: "Install pnpm: https://pnpm.io/installation",
  },
  {
    label: "cargo",
    command: resolveCommand("cargo"),
    args: ["--version"],
    required: true,
    hint: "Install Rust toolchain: https://www.rust-lang.org/tools/install",
  },
  {
    label: "wasm-pack",
    command: resolveCommand("wasm-pack"),
    args: ["--version"],
    required: true,
    hint: "Install wasm-pack: https://rustwasm.github.io/wasm-pack/installer/",
  },
  {
    label: "protoc",
    command: resolveCommand("protoc"),
    args: ["--version"],
    required: true,
    hint: "Install protoc: https://grpc.io/docs/protoc-installation/",
  },
  {
    label: "cargo watch",
    command: resolveCommand("cargo"),
    args: ["watch", "--version"],
    required: false,
    hint: "Install cargo-watch: https://crates.io/crates/cargo-watch",
  },
];
const mapChecksToIndexMap = (checkEntries) => {
  return Object.fromEntries(
    checkEntries.map((check, index) => {
      return [check.label, index];
    })
  );
};
const mapChecksToRecord = (checkEntries, resolveValue) => {
  return Object.fromEntries(
    checkEntries.map((check, index) => {
      return [check.label, resolveValue(check, index)];
    })
  );
};
const mapCheckLabelsToIndices = (checkLabels, checkIndexMap) => {
  return checkLabels.map((checkLabel) => {
    const checkIndex = checkIndexMap[checkLabel];
    if (checkIndex === undefined) {
      throw new Error(`Missing check index metadata for ${checkLabel}.`);
    }
    return checkIndex;
  });
};
const mapCheckLabelsToIndexMap = (checkLabels, checkIndexMap) => {
  return Object.fromEntries(
    checkLabels.map((checkLabel) => {
      const checkIndex = checkIndexMap[checkLabel];
      if (checkIndex === undefined) {
        throw new Error(`Missing check index metadata for ${checkLabel}.`);
      }
      return [checkLabel, checkIndex];
    })
  );
};
const mapCheckLabelsToValueMap = (checkLabels, checkValueMap, valueLabel) => {
  return Object.fromEntries(
    checkLabels.map((checkLabel) => {
      const checkValue = checkValueMap[checkLabel];
      if (checkValue === undefined) {
        throw new Error(`Missing ${valueLabel} metadata for ${checkLabel}.`);
      }
      return [checkLabel, checkValue];
    })
  );
};
const countChecksByStatus = (checkEntries) => {
  return checkEntries.reduce((statusCounts, check) => {
    const currentCount = statusCounts[check.status] ?? 0;
    statusCounts[check.status] = currentCount + 1;
    return statusCounts;
  }, {});
};
const availableChecks = checks.map((check) => {
  return check.label;
});
const availableCheckIndexMap = mapChecksToIndexMap(checks);
const availableCheckCommandMap = mapChecksToRecord(checks, (check) => {
  return check.command;
});
const availableCheckArgsMap = mapChecksToRecord(checks, (check) => {
  return check.args;
});
const availableCheckArgCountMap = mapChecksToRecord(checks, (check) => {
  return check.args.length;
});
const availableCheckRequiredMap = mapChecksToRecord(checks, (check) => {
  return check.required;
});
const availableCheckHintMap = mapChecksToRecord(checks, (check) => {
  return check.hint;
});
const availableCheckMinimumVersionMap = mapChecksToRecord(checks, (check) => {
  if (check.minVersion === undefined) {
    return null;
  }
  return formatSemver(check.minVersion);
});
const summarizeCheckResults = (results) => {
  const checkLabels = results.map((check) => {
    return check.label;
  });
  const checkIndexMap = mapChecksToIndexMap(results);
  const checkCommandMap = mapChecksToRecord(results, (check) => {
    return check.command;
  });
  const checkArgsMap = mapChecksToRecord(results, (check) => {
    return check.args;
  });
  const checkArgCountMap = mapChecksToRecord(results, (check) => {
    return check.args.length;
  });
  const checkStatusMap = mapChecksToRecord(results, (check) => {
    return check.status;
  });
  const checkStatusCountMap = countChecksByStatus(results);
  const checkDetectedVersionMap = mapChecksToRecord(results, (check) => {
    return check.detectedVersion;
  });
  const checkMinimumVersionMap = mapChecksToRecord(results, (check) => {
    return check.minimumVersion;
  });
  const requiredCheckLabels = results
    .filter((check) => {
      return check.required;
    })
    .map((check) => {
      return check.label;
    });
  const optionalCheckLabels = results
    .filter((check) => {
      return check.required === false;
    })
    .map((check) => {
      return check.label;
    });
  const passedChecks = results
    .filter((check) => {
      return check.status === "ok";
    })
    .map((check) => {
      return check.label;
    });
  const failedChecks = results
    .filter((check) => {
      return check.status !== "ok";
    })
    .map((check) => {
      return check.label;
    });
  const requiredFailureLabels = results
    .filter((check) => {
      return check.required && check.status !== "ok";
    })
    .map((check) => {
      return check.label;
    });
  const optionalFailureLabels = results
    .filter((check) => {
      return check.required === false && check.status !== "ok";
    })
    .map((check) => {
      return check.label;
    });
  const failureSummaries = results
    .filter((check) => {
      return check.status !== "ok";
    })
    .map((check) => {
      return {
        label: check.label,
        checkIndex: check.checkIndex,
        checkCommand: check.command,
        checkArgs: check.args,
        checkArgCount: check.args.length,
        required: check.required,
        status: check.status,
        message: check.message,
        hint: check.hint,
      };
    });
  const checkIndices = mapCheckLabelsToIndices(checkLabels, checkIndexMap);
  const requiredCheckIndices = mapCheckLabelsToIndices(
    requiredCheckLabels,
    checkIndexMap
  );
  const optionalCheckIndices = mapCheckLabelsToIndices(
    optionalCheckLabels,
    checkIndexMap
  );
  const passedCheckIndices = mapCheckLabelsToIndices(passedChecks, checkIndexMap);
  const failedCheckIndices = mapCheckLabelsToIndices(failedChecks, checkIndexMap);
  const requiredFailureIndices = mapCheckLabelsToIndices(
    requiredFailureLabels,
    checkIndexMap
  );
  const optionalFailureIndices = mapCheckLabelsToIndices(
    optionalFailureLabels,
    checkIndexMap
  );
  const requiredCheckIndexMap = mapCheckLabelsToIndexMap(
    requiredCheckLabels,
    checkIndexMap
  );
  const requiredCheckCommandMap = mapCheckLabelsToValueMap(
    requiredCheckLabels,
    checkCommandMap,
    "check command"
  );
  const requiredCheckArgsMap = mapCheckLabelsToValueMap(
    requiredCheckLabels,
    checkArgsMap,
    "check args"
  );
  const requiredCheckArgCountMap = mapCheckLabelsToValueMap(
    requiredCheckLabels,
    checkArgCountMap,
    "check argument count"
  );
  const optionalCheckIndexMap = mapCheckLabelsToIndexMap(
    optionalCheckLabels,
    checkIndexMap
  );
  const optionalCheckCommandMap = mapCheckLabelsToValueMap(
    optionalCheckLabels,
    checkCommandMap,
    "check command"
  );
  const optionalCheckArgsMap = mapCheckLabelsToValueMap(
    optionalCheckLabels,
    checkArgsMap,
    "check args"
  );
  const optionalCheckArgCountMap = mapCheckLabelsToValueMap(
    optionalCheckLabels,
    checkArgCountMap,
    "check argument count"
  );
  const passedCheckIndexMap = mapCheckLabelsToIndexMap(
    passedChecks,
    checkIndexMap
  );
  const passedCheckCommandMap = mapCheckLabelsToValueMap(
    passedChecks,
    checkCommandMap,
    "check command"
  );
  const passedCheckArgsMap = mapCheckLabelsToValueMap(
    passedChecks,
    checkArgsMap,
    "check args"
  );
  const passedCheckArgCountMap = mapCheckLabelsToValueMap(
    passedChecks,
    checkArgCountMap,
    "check argument count"
  );
  const failedCheckIndexMap = mapCheckLabelsToIndexMap(
    failedChecks,
    checkIndexMap
  );
  const failedCheckCommandMap = mapCheckLabelsToValueMap(
    failedChecks,
    checkCommandMap,
    "check command"
  );
  const failedCheckArgsMap = mapCheckLabelsToValueMap(
    failedChecks,
    checkArgsMap,
    "check args"
  );
  const failedCheckArgCountMap = mapCheckLabelsToValueMap(
    failedChecks,
    checkArgCountMap,
    "check argument count"
  );
  const requiredFailureIndexMap = mapCheckLabelsToIndexMap(
    requiredFailureLabels,
    checkIndexMap
  );
  const requiredFailureCommandMap = mapCheckLabelsToValueMap(
    requiredFailureLabels,
    checkCommandMap,
    "check command"
  );
  const requiredFailureArgsMap = mapCheckLabelsToValueMap(
    requiredFailureLabels,
    checkArgsMap,
    "check args"
  );
  const requiredFailureArgCountMap = mapCheckLabelsToValueMap(
    requiredFailureLabels,
    checkArgCountMap,
    "check argument count"
  );
  const optionalFailureIndexMap = mapCheckLabelsToIndexMap(
    optionalFailureLabels,
    checkIndexMap
  );
  const optionalFailureCommandMap = mapCheckLabelsToValueMap(
    optionalFailureLabels,
    checkCommandMap,
    "check command"
  );
  const optionalFailureArgsMap = mapCheckLabelsToValueMap(
    optionalFailureLabels,
    checkArgsMap,
    "check args"
  );
  const optionalFailureArgCountMap = mapCheckLabelsToValueMap(
    optionalFailureLabels,
    checkArgCountMap,
    "check argument count"
  );

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
    checkStatusMap,
    checkStatusMapCount: countRecordEntries(checkStatusMap),
    checkStatusCountMap,
    checkStatusCountMapCount: countRecordEntries(checkStatusCountMap),
    checkDetectedVersionMap,
    checkDetectedVersionMapCount: countRecordEntries(checkDetectedVersionMap),
    checkMinimumVersionMap,
    checkMinimumVersionMapCount: countRecordEntries(checkMinimumVersionMap),
    requiredCheckLabels,
    requiredCheckCount: requiredCheckLabels.length,
    requiredCheckIndices,
    requiredCheckIndexCount: requiredCheckIndices.length,
    requiredCheckIndexMap,
    requiredCheckIndexMapCount: countRecordEntries(requiredCheckIndexMap),
    requiredCheckCommandMap,
    requiredCheckCommandMapCount: countRecordEntries(requiredCheckCommandMap),
    requiredCheckArgsMap,
    requiredCheckArgsMapCount: countRecordEntries(requiredCheckArgsMap),
    requiredCheckArgCountMap,
    requiredCheckArgCountMapCount: countRecordEntries(requiredCheckArgCountMap),
    optionalCheckLabels,
    optionalCheckCount: optionalCheckLabels.length,
    optionalCheckIndices,
    optionalCheckIndexCount: optionalCheckIndices.length,
    optionalCheckIndexMap,
    optionalCheckIndexMapCount: countRecordEntries(optionalCheckIndexMap),
    optionalCheckCommandMap,
    optionalCheckCommandMapCount: countRecordEntries(optionalCheckCommandMap),
    optionalCheckArgsMap,
    optionalCheckArgsMapCount: countRecordEntries(optionalCheckArgsMap),
    optionalCheckArgCountMap,
    optionalCheckArgCountMapCount: countRecordEntries(optionalCheckArgCountMap),
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
    requiredFailureLabels,
    requiredFailureCount: requiredFailureLabels.length,
    requiredFailureIndices,
    requiredFailureIndexCount: requiredFailureIndices.length,
    requiredFailureIndexMap,
    requiredFailureIndexMapCount: countRecordEntries(requiredFailureIndexMap),
    requiredFailureCommandMap,
    requiredFailureCommandMapCount: countRecordEntries(requiredFailureCommandMap),
    requiredFailureArgsMap,
    requiredFailureArgsMapCount: countRecordEntries(requiredFailureArgsMap),
    requiredFailureArgCountMap,
    requiredFailureArgCountMapCount: countRecordEntries(
      requiredFailureArgCountMap
    ),
    optionalFailureLabels,
    optionalFailureCount: optionalFailureLabels.length,
    optionalFailureIndices,
    optionalFailureIndexCount: optionalFailureIndices.length,
    optionalFailureIndexMap,
    optionalFailureIndexMapCount: countRecordEntries(optionalFailureIndexMap),
    optionalFailureCommandMap,
    optionalFailureCommandMapCount: countRecordEntries(optionalFailureCommandMap),
    optionalFailureArgsMap,
    optionalFailureArgsMapCount: countRecordEntries(optionalFailureArgsMap),
    optionalFailureArgCountMap,
    optionalFailureArgCountMapCount: countRecordEntries(
      optionalFailureArgCountMap
    ),
    failureSummaries,
    failureSummaryCount: failureSummaries.length,
  };
};

let requiredFailures = 0;
const checkResults = [];

if (isJson && validationFailureMessage !== null) {
  const report = buildTimedReport({
    passed: false,
    exitCode: 1,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    requiredFailures: 0,
    availableChecks,
    availableCheckCount: availableChecks.length,
    availableCheckIndexMap,
    availableCheckIndexMapCount: countRecordEntries(availableCheckIndexMap),
    availableCheckCommandMap,
    availableCheckCommandMapCount: countRecordEntries(availableCheckCommandMap),
    availableCheckArgsMap,
    availableCheckArgsMapCount: countRecordEntries(availableCheckArgsMap),
    availableCheckArgCountMap,
    availableCheckArgCountMapCount: countRecordEntries(
      availableCheckArgCountMap
    ),
    availableCheckRequiredMap,
    availableCheckRequiredMapCount: countRecordEntries(availableCheckRequiredMap),
    availableCheckHintMap,
    availableCheckHintMapCount: countRecordEntries(availableCheckHintMap),
    availableCheckMinimumVersionMap,
    availableCheckMinimumVersionMapCount: countRecordEntries(
      availableCheckMinimumVersionMap
    ),
    checks: [],
    ...summarizeCheckResults([]),
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

for (const check of checks) {
  const checkIndex = availableCheckIndexMap[check.label];
  if (checkIndex === undefined) {
    throw new Error(`Missing check index metadata for ${check.label}.`);
  }
  const result = spawnSync(check.command, check.args, {
    encoding: "utf8",
    shell: false,
  });

  const commandFailed = result.status !== 0 || result.error !== undefined;
  const output = `${result.stdout}${result.stderr}`;
  const firstLine =
    output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "ok";

  let status = "ok";
  let message = firstLine;
  let detectedVersion = null;
  let minimumVersion = null;

  if (commandFailed) {
    if (result.error !== undefined) {
      status = "missing";
      message = "missing";
    } else {
      const failureDetail =
        firstLine === "ok" ? "command returned non-zero status" : firstLine;
      status = "unavailable";
      message = `unavailable (${failureDetail})`;
    }
  } else if (check.minVersion !== undefined) {
    const parsedVersion = parseSemver(firstLine);
    minimumVersion = formatSemver(check.minVersion);
    if (parsedVersion === null) {
      status = "unparseable_version";
      message = `unable to parse version from "${firstLine}"`;
    } else {
      detectedVersion = formatSemver(parsedVersion);
      if (!isSemverAtLeast(parsedVersion, check.minVersion)) {
        status = "version_below_minimum";
        message = `version ${detectedVersion} is below ${minimumVersion}`;
      }
    }
  }

  if (status !== "ok" && check.required) {
    requiredFailures += 1;
  }

  checkResults.push({
    label: check.label,
    checkIndex,
    command: check.command,
    args: [...check.args],
    required: check.required,
    status,
    message,
    hint: check.hint,
    detectedVersion,
    minimumVersion,
  });

  if (isJson) {
    continue;
  }

  if (status === "ok") {
    if (!isQuiet) {
      console.log(`✓ ${check.label}: ${firstLine}`);
    }
    continue;
  }

  const statusSymbol = check.required ? "✗" : "!";
  const requirement = check.required ? "required" : "optional";
  console.error(`${statusSymbol} ${check.label}: ${message} (${requirement})`);
  console.error(`  ${check.hint}`);
}

if (isJson) {
  const report = buildTimedReport({
    passed: requiredFailures === 0,
    exitCode: requiredFailures > 0 ? 1 : 0,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    requiredFailures,
    availableChecks,
    availableCheckCount: availableChecks.length,
    availableCheckIndexMap,
    availableCheckIndexMapCount: countRecordEntries(availableCheckIndexMap),
    availableCheckCommandMap,
    availableCheckCommandMapCount: countRecordEntries(availableCheckCommandMap),
    availableCheckArgsMap,
    availableCheckArgsMapCount: countRecordEntries(availableCheckArgsMap),
    availableCheckArgCountMap,
    availableCheckArgCountMapCount: countRecordEntries(
      availableCheckArgCountMap
    ),
    availableCheckRequiredMap,
    availableCheckRequiredMapCount: countRecordEntries(availableCheckRequiredMap),
    availableCheckHintMap,
    availableCheckHintMapCount: countRecordEntries(availableCheckHintMap),
    availableCheckMinimumVersionMap,
    availableCheckMinimumVersionMapCount: countRecordEntries(
      availableCheckMinimumVersionMap
    ),
    checks: checkResults,
    ...summarizeCheckResults(checkResults),
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

if (requiredFailures > 0) {
  if (!isJson) {
    console.error(
      `Environment check failed: ${requiredFailures} required check(s) failed.`
    );
  }
  process.exit(1);
}

if (!isQuiet && !isJson) {
  console.log("Environment check passed.");
}
