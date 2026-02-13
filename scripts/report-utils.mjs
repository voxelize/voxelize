import fs from "node:fs";
import path from "node:path";

export const REPORT_SCHEMA_VERSION = 1;
const ANSI_ESCAPE_SEQUENCE_REGEX = /\u001b\[[0-?]*[ -/]*[@-~]/g;

const isObjectLikeJsonValue = (value) => {
  return value !== null && typeof value === "object";
};

export const parseJsonOutput = (value) => {
  if (value.length === 0) {
    return null;
  }
  const sanitizedValue = value.replace(ANSI_ESCAPE_SEQUENCE_REGEX, "");

  try {
    const parsedValue = JSON.parse(sanitizedValue);
    return isObjectLikeJsonValue(parsedValue) ? parsedValue : null;
  } catch {
    const rawLines = sanitizedValue.split("\n");
    let bestMatch = null;

    for (let start = 0; start < rawLines.length; start += 1) {
      const trimmedStart = rawLines[start].trim();
      if (
        !trimmedStart.startsWith("{") &&
        !trimmedStart.startsWith("[")
      ) {
        continue;
      }
      const requiredEndToken = trimmedStart.startsWith("{") ? "}" : "]";

      for (let end = start; end < rawLines.length; end += 1) {
        const trimmedEnd = rawLines[end].trim();
        if (!trimmedEnd.endsWith(requiredEndToken)) {
          continue;
        }

        const candidate = rawLines.slice(start, end + 1).join("\n").trim();
        if (candidate.length === 0) {
          continue;
        }

        try {
          const parsedCandidate = JSON.parse(candidate);
          if (!isObjectLikeJsonValue(parsedCandidate)) {
            continue;
          }
          if (
            bestMatch === null ||
            end > bestMatch.end ||
            (end === bestMatch.end && start < bestMatch.start)
          ) {
            bestMatch = {
              parsedCandidate,
              start,
              end,
            };
          }
        } catch {
          continue;
        }
      }
    }

    if (bestMatch !== null) {
      return bestMatch.parsedCandidate;
    }

    const lines = rawLines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsedLine = JSON.parse(lines[index]);
        if (isObjectLikeJsonValue(parsedLine)) {
          return parsedLine;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
};

export const toReport = (report) => {
  return {
    ...report,
    schemaVersion: REPORT_SCHEMA_VERSION,
  };
};

export const toReportJson = (report, options = {}) => {
  const compact = options.compact === true;
  return JSON.stringify(toReport(report), null, compact ? 0 : 2);
};

export const createTimedReportBuilder = (
  now = () => Date.now(),
  toIsoString = (value) => new Date(value).toISOString()
) => {
  const startedAtMs = now();
  const startedAt = toIsoString(startedAtMs);

  return (report) => {
    const endedAtMs = now();

    return {
      ...report,
      startedAt,
      endedAt: toIsoString(endedAtMs),
      durationMs: endedAtMs - startedAtMs,
    };
  };
};

export const summarizeStepResults = (steps) => {
  const passedStepCount = steps.filter((step) => {
    return step.passed && step.skipped === false;
  }).length;
  const failedStepCount = steps.filter((step) => {
    return !step.passed && step.skipped === false;
  }).length;
  const skippedStepCount = steps.filter((step) => {
    return step.skipped === true;
  }).length;
  const firstFailedStep =
    steps.find((step) => {
      return !step.passed && step.skipped === false;
    })?.name ?? null;

  return {
    totalSteps: steps.length,
    passedStepCount,
    failedStepCount,
    skippedStepCount,
    firstFailedStep,
  };
};

export const summarizeCheckResults = (checks) => {
  const passedChecks = checks.filter((check) => check.passed).map((check) => check.name);
  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);

  return {
    totalChecks: checks.length,
    passedCheckCount: passedChecks.length,
    failedCheckCount: failedChecks.length,
    firstFailedCheck: failedChecks[0] ?? null,
    passedChecks,
    failedChecks,
  };
};

export const deriveFailureMessageFromReport = (report) => {
  if (report === null || typeof report !== "object") {
    return null;
  }

  if ("message" in report && typeof report.message === "string") {
    return report.message;
  }

  if (
    "requiredFailures" in report &&
    typeof report.requiredFailures === "number"
  ) {
    return `${report.requiredFailures} required check(s) failed.`;
  }

  if ("steps" in report && Array.isArray(report.steps)) {
    const firstFailedStep = report.steps.find((step) => {
      return (
        step !== null &&
        typeof step === "object" &&
        "passed" in step &&
        step.passed === false &&
        (!("skipped" in step) || step.skipped !== true)
      );
    });

    if (
      firstFailedStep !== undefined &&
      firstFailedStep !== null &&
      typeof firstFailedStep === "object" &&
      "name" in firstFailedStep &&
      typeof firstFailedStep.name === "string"
    ) {
      if (
        "report" in firstFailedStep &&
        firstFailedStep.report !== null &&
        typeof firstFailedStep.report === "object" &&
        "message" in firstFailedStep.report &&
        typeof firstFailedStep.report.message === "string"
      ) {
        return `${firstFailedStep.name}: ${firstFailedStep.report.message}`;
      }

      if ("reason" in firstFailedStep && typeof firstFailedStep.reason === "string") {
        return `${firstFailedStep.name}: ${firstFailedStep.reason}`;
      }

      return `${firstFailedStep.name} failed.`;
    }
  }

  return null;
};

export const splitCliArgs = (args) => {
  const optionTerminatorIndex = args.indexOf("--");
  if (optionTerminatorIndex === -1) {
    return {
      optionArgs: args,
      positionalArgs: [],
      optionTerminatorUsed: false,
    };
  }

  return {
    optionArgs: args.slice(0, optionTerminatorIndex),
    positionalArgs: args.slice(optionTerminatorIndex + 1),
    optionTerminatorUsed: true,
  };
};

export const hasCliOption = (args, canonicalOption, aliases = []) => {
  const { optionArgs } = splitCliArgs(args);
  if (optionArgs.includes(canonicalOption)) {
    return true;
  }

  return aliases.some((alias) => optionArgs.includes(alias));
};

const createCanonicalOptionMap = (canonicalOptions, optionAliases = {}) => {
  const canonicalMap = new Map(canonicalOptions.map((option) => [option, option]));

  for (const [canonicalOption, aliases] of Object.entries(optionAliases)) {
    for (const alias of aliases) {
      canonicalMap.set(alias, canonicalOption);
    }
  }

  return canonicalMap;
};

const createSupportedCliOptions = (canonicalOptions, optionAliases = {}) => {
  return [...canonicalOptions, ...Object.values(optionAliases).flat()].filter(
    (optionToken, index, allOptions) => {
      return allOptions.indexOf(optionToken) === index;
    }
  );
};

export const createCliOptionCatalog = ({
  canonicalOptions = [],
  optionAliases = {},
} = {}) => {
  const supportedCliOptions = createSupportedCliOptions(
    canonicalOptions,
    optionAliases
  );
  const canonicalOptionMap = createCanonicalOptionMap(
    canonicalOptions,
    optionAliases
  );
  const availableCliOptionCanonicalMap = Object.fromEntries(
    supportedCliOptions.map((optionToken) => {
      const canonicalOption = canonicalOptionMap.get(optionToken);
      return [
        optionToken,
        canonicalOption === undefined ? optionToken : canonicalOption,
      ];
    })
  );

  return {
    supportedCliOptions,
    availableCliOptionAliases: optionAliases,
    availableCliOptionCanonicalMap,
  };
};

const resolveCanonicalOptionToken = (
  optionToken,
  canonicalOptionMap,
  optionsWithValues
) => {
  const canonicalOption = canonicalOptionMap.get(optionToken);
  if (canonicalOption !== undefined) {
    return {
      canonicalOption,
      hasInlineValue: false,
    };
  }

  for (const optionWithValue of optionsWithValues) {
    if (optionToken.startsWith(`${optionWithValue}=`)) {
      return {
        canonicalOption: optionWithValue,
        hasInlineValue: true,
      };
    }
  }

  return null;
};

export const parseUnknownCliOptions = (
  args,
  {
    canonicalOptions = [],
    optionAliases = {},
    optionsWithValues = [],
  } = {}
) => {
  const { optionArgs } = splitCliArgs(args);
  const canonicalOptionMap = createCanonicalOptionMap(
    canonicalOptions,
    optionAliases
  );
  const valueOptions = new Set(optionsWithValues);
  const unknownOptions = [];
  const seenUnknownOptions = new Set();

  for (let index = 0; index < optionArgs.length; index += 1) {
    const optionToken = optionArgs[index];
    if (
      !optionToken.startsWith("-") ||
      optionToken === "-" ||
      optionToken === "--"
    ) {
      continue;
    }

    const resolvedOption = resolveCanonicalOptionToken(
      optionToken,
      canonicalOptionMap,
      valueOptions
    );
    if (resolvedOption !== null) {
      if (
        valueOptions.has(resolvedOption.canonicalOption) &&
        !resolvedOption.hasInlineValue
      ) {
        const nextArg = optionArgs[index + 1] ?? null;
        if (nextArg !== null && !nextArg.startsWith("--")) {
          index += 1;
        }
      }
      continue;
    }

    if (seenUnknownOptions.has(optionToken)) {
      continue;
    }
    seenUnknownOptions.add(optionToken);
    unknownOptions.push(optionToken);
  }

  return unknownOptions;
};

export const createCliOptionValidation = (
  args,
  {
    canonicalOptions = [],
    optionAliases = {},
    optionsWithValues = [],
    outputPathError = null,
  } = {}
) => {
  const { supportedCliOptions } = createCliOptionCatalog({
    canonicalOptions,
    optionAliases,
  });
  const unknownOptions = parseUnknownCliOptions(args, {
    canonicalOptions,
    optionAliases,
    optionsWithValues,
  });
  const unknownOptionCount = unknownOptions.length;
  const unsupportedOptionsError =
    unknownOptionCount === 0
      ? null
      : `Unsupported option(s): ${unknownOptions.join(", ")}. Supported options: ${supportedCliOptions.join(", ")}.`;
  const validationErrorCode =
    outputPathError !== null
      ? "output_option_missing_value"
      : unsupportedOptionsError !== null
        ? "unsupported_options"
        : null;

  return {
    supportedCliOptions,
    unknownOptions,
    unknownOptionCount,
    unsupportedOptionsError,
    validationErrorCode,
  };
};

export const parseActiveCliOptionMetadata = (
  args,
  {
    canonicalOptions = [],
    optionAliases = {},
    optionsWithValues = [],
  } = {}
) => {
  const { optionArgs } = splitCliArgs(args);
  const canonicalOptionMap = createCanonicalOptionMap(
    canonicalOptions,
    optionAliases
  );
  const valueOptions = new Set(optionsWithValues);
  const activeCliOptionsSet = new Set();
  const activeCliOptionTokens = [];
  const seenActiveTokens = new Set();
  const activeCliOptionOccurrences = [];

  for (let index = 0; index < optionArgs.length; index += 1) {
    const token = optionArgs[index];
    const resolvedOption = resolveCanonicalOptionToken(
      token,
      canonicalOptionMap,
      valueOptions
    );
    if (resolvedOption === null) {
      continue;
    }

    activeCliOptionsSet.add(resolvedOption.canonicalOption);
    if (!seenActiveTokens.has(token)) {
      seenActiveTokens.add(token);
      activeCliOptionTokens.push(token);
    }
    activeCliOptionOccurrences.push({
      token,
      canonicalOption: resolvedOption.canonicalOption,
      index,
    });

    if (
      valueOptions.has(resolvedOption.canonicalOption) &&
      !resolvedOption.hasInlineValue
    ) {
      const nextArg = optionArgs[index + 1] ?? null;
      if (nextArg !== null && !nextArg.startsWith("--")) {
        index += 1;
      }
    }
  }

  const uniqueCanonicalOptions = canonicalOptions.filter((optionToken, index) => {
    return canonicalOptions.indexOf(optionToken) === index;
  });
  const activeCliOptions = uniqueCanonicalOptions.filter((optionToken) => {
    return activeCliOptionsSet.has(optionToken);
  });
  const activeCliOptionResolutions = activeCliOptionTokens.map((token) => {
    const resolvedOption = resolveCanonicalOptionToken(
      token,
      canonicalOptionMap,
      valueOptions
    );
    return {
      token,
      canonicalOption:
        resolvedOption === null ? token : resolvedOption.canonicalOption,
    };
  });

  return {
    activeCliOptions,
    activeCliOptionCount: activeCliOptions.length,
    activeCliOptionTokens,
    activeCliOptionResolutions,
    activeCliOptionResolutionCount: activeCliOptionResolutions.length,
    activeCliOptionOccurrences,
    activeCliOptionOccurrenceCount: activeCliOptionOccurrences.length,
  };
};

export const resolveLastOptionValue = (args, optionName) => {
  const { optionArgs } = splitCliArgs(args);
  const inlineOptionPrefix = `${optionName}=`;
  let hasOption = false;
  let resolvedValue = null;
  let missingValue = false;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const token = optionArgs[index];

    if (token === optionName) {
      hasOption = true;
      const nextArg = optionArgs[index + 1] ?? null;
      if (nextArg === null || nextArg.startsWith("--")) {
        resolvedValue = null;
        missingValue = true;
      } else {
        resolvedValue = nextArg;
        missingValue = false;
        index += 1;
      }
      continue;
    }

    if (!token.startsWith(inlineOptionPrefix)) {
      continue;
    }

    hasOption = true;
    const inlineValue = token.slice(inlineOptionPrefix.length);
    if (inlineValue.length === 0) {
      resolvedValue = null;
      missingValue = true;
      continue;
    }

    resolvedValue = inlineValue;
    missingValue = false;
  }

  return {
    hasOption,
    value: resolvedValue,
    error: hasOption && missingValue ? `Missing value for ${optionName} option.` : null,
  };
};

export const resolveOutputPath = (args, cwd = process.cwd()) => {
  const outputPathValue = resolveLastOptionValue(args, "--output");
  if (!outputPathValue.hasOption) {
    return {
      outputPath: null,
      error: null,
    };
  }

  if (outputPathValue.error !== null || outputPathValue.value === null) {
    return {
      outputPath: null,
      error: outputPathValue.error ?? "Missing value for --output option.",
    };
  }

  return {
    outputPath: path.resolve(cwd, outputPathValue.value),
    error: null,
  };
};

export const writeReportToPath = (reportJson, outputPath) => {
  if (outputPath === null) {
    return null;
  }

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, reportJson);
    return null;
  } catch (error) {
    const detail =
      error instanceof Error && error.message.length > 0
        ? ` ${error.message}`
        : "";
    return `Failed to write report to ${outputPath}.${detail}`;
  }
};

export const serializeReportWithOptionalWrite = (
  report,
  { jsonFormat, outputPath, buildTimedReport }
) => {
  const reportJson = toReportJson(report, jsonFormat);

  if (outputPath === null) {
    return {
      reportJson,
      writeError: null,
    };
  }

  const writeError = writeReportToPath(reportJson, outputPath);
  if (writeError === null) {
    return {
      reportJson,
      writeError: null,
    };
  }

  return {
    reportJson: toReportJson(
      buildTimedReport({
        ...report,
        passed: false,
        exitCode: 1,
        writeError,
        message: writeError,
      }),
      jsonFormat
    ),
    writeError,
  };
};
