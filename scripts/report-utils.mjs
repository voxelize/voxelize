import fs from "node:fs";
import path from "node:path";

export const REPORT_SCHEMA_VERSION = 1;
const ANSI_CSI_ESCAPE_SEQUENCE_REGEX =
  /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_ESCAPE_SEQUENCE_REGEX =
  /(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)/g;
const NON_JSON_CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F-\u009F]/g;
const UTF8_BOM_PREFIX_REGEX = /^\uFEFF+/;
const UTF8_BOM_LINE_PREFIX_REGEX = /\n\uFEFF+/g;

const sanitizeOutputForJsonParsing = (value) => {
  return value
    .replace(UTF8_BOM_PREFIX_REGEX, "")
    .replace(UTF8_BOM_LINE_PREFIX_REGEX, "\n")
    .replace(ANSI_OSC_ESCAPE_SEQUENCE_REGEX, "")
    .replace(ANSI_CSI_ESCAPE_SEQUENCE_REGEX, "")
    .replace(/\r/g, "\n")
    .replace(NON_JSON_CONTROL_CHAR_REGEX, "");
};

const isObjectLikeJsonValue = (value) => {
  return value !== null && typeof value === "object";
};

export const parseJsonOutput = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const sanitizedValue = sanitizeOutputForJsonParsing(value);

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

    for (let start = 0; start < sanitizedValue.length; start += 1) {
      const startToken = sanitizedValue[start];
      if (startToken !== "{" && startToken !== "[") {
        continue;
      }
      const endToken = startToken === "{" ? "}" : "]";

      for (let end = sanitizedValue.length - 1; end >= start; end -= 1) {
        if (sanitizedValue[end] !== endToken) {
          continue;
        }

        const candidate = sanitizedValue.slice(start, end + 1).trim();
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

export const countRecordEntries = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  return Object.keys(value).length;
};

export const summarizeStepResults = (steps) => {
  const passedSteps = steps
    .filter((step) => {
      return step.passed && step.skipped === false;
    })
    .map((step) => step.name);
  const failedSteps = steps
    .filter((step) => {
      return !step.passed && step.skipped === false;
    })
    .map((step) => step.name);
  const skippedSteps = steps
    .filter((step) => {
      return step.skipped === true;
    })
    .map((step) => step.name);
  const passedStepCount = passedSteps.length;
  const failedStepCount = failedSteps.length;
  const skippedStepCount = skippedSteps.length;
  const firstFailedStep = failedSteps[0] ?? null;

  return {
    totalSteps: steps.length,
    passedStepCount,
    failedStepCount,
    skippedStepCount,
    firstFailedStep,
    passedSteps,
    failedSteps,
    skippedSteps,
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

export const extractWasmPackCheckSummaryFromReport = (report) => {
  if (
    report === null ||
    typeof report !== "object" ||
    Array.isArray(report)
  ) {
    return {
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    };
  }

  const wasmPackCheckStatus =
    typeof report.wasmPackCheckStatus === "string"
      ? report.wasmPackCheckStatus
      : null;
  const wasmPackCheckCommand =
    typeof report.wasmPackCheckCommand === "string"
      ? report.wasmPackCheckCommand
      : null;
  const wasmPackCheckArgs = Array.isArray(report.wasmPackCheckArgs)
    ? [...report.wasmPackCheckArgs]
    : null;
  const wasmPackCheckArgCount =
    typeof report.wasmPackCheckArgCount === "number"
      ? report.wasmPackCheckArgCount
      : wasmPackCheckArgs?.length ?? null;
  const wasmPackCheckExitCode =
    typeof report.wasmPackCheckExitCode === "number"
      ? report.wasmPackCheckExitCode
      : null;
  const wasmPackCheckOutputLine =
    typeof report.wasmPackCheckOutputLine === "string"
      ? report.wasmPackCheckOutputLine
      : null;

  return {
    wasmPackCheckStatus,
    wasmPackCheckCommand,
    wasmPackCheckArgs,
    wasmPackCheckArgCount,
    wasmPackCheckExitCode,
    wasmPackCheckOutputLine,
  };
};

export const createPrefixedWasmPackCheckSummary = (report, prefix = "") => {
  const keyPrefix = typeof prefix === "string" ? prefix : "";
  const createKey = (suffix) => {
    if (keyPrefix.length === 0) {
      return `wasmPackCheck${suffix}`;
    }

    return `${keyPrefix}WasmPackCheck${suffix}`;
  };
  const summary = extractWasmPackCheckSummaryFromReport(report);

  return {
    [createKey("Status")]: summary.wasmPackCheckStatus,
    [createKey("Command")]: summary.wasmPackCheckCommand,
    [createKey("Args")]: summary.wasmPackCheckArgs,
    [createKey("ArgCount")]: summary.wasmPackCheckArgCount,
    [createKey("ExitCode")]: summary.wasmPackCheckExitCode,
    [createKey("OutputLine")]: summary.wasmPackCheckOutputLine,
  };
};

export const normalizeTsCorePayloadIssues = (payloadIssues) => {
  if (!Array.isArray(payloadIssues)) {
    return null;
  }

  const seenPayloadIssues = new Set();
  const normalizedPayloadIssues = [];
  for (const payloadIssue of payloadIssues) {
    if (typeof payloadIssue !== "string") {
      continue;
    }

    const normalizedPayloadIssue = payloadIssue.trim();
    if (normalizedPayloadIssue.length === 0) {
      continue;
    }

    if (seenPayloadIssues.has(normalizedPayloadIssue)) {
      continue;
    }

    seenPayloadIssues.add(normalizedPayloadIssue);
    normalizedPayloadIssues.push(normalizedPayloadIssue);
  }

  return normalizedPayloadIssues;
};

export const extractTsCoreExampleSummaryFromReport = (report) => {
  if (
    report === null ||
    typeof report !== "object" ||
    Array.isArray(report)
  ) {
    return {
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: null,
      exampleStatus: null,
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: null,
    };
  }

  const exampleCommand =
    typeof report.exampleCommand === "string" ? report.exampleCommand : null;
  const exampleArgs = Array.isArray(report.exampleArgs) ? [...report.exampleArgs] : null;
  const exampleArgCount =
    typeof report.exampleArgCount === "number"
      ? report.exampleArgCount
      : exampleArgs?.length ?? null;
  const exampleAttempted =
    typeof report.exampleAttempted === "boolean" ? report.exampleAttempted : null;
  const exampleExitCode =
    typeof report.exampleExitCode === "number" ? report.exampleExitCode : null;
  const exampleDurationMs =
    typeof report.exampleDurationMs === "number" ? report.exampleDurationMs : null;
  const exampleOutputLine =
    typeof report.exampleOutputLine === "string" ? report.exampleOutputLine : null;
  const exampleRuleMatched =
    typeof report.exampleRuleMatched === "boolean" ? report.exampleRuleMatched : null;
  const examplePayloadValid =
    typeof report.examplePayloadValid === "boolean"
      ? report.examplePayloadValid
      : null;
  const rawExamplePayloadIssues = normalizeTsCorePayloadIssues(
    report.examplePayloadIssues
  );
  const examplePayloadIssues =
    examplePayloadValid === true ? [] : rawExamplePayloadIssues;
  const examplePayloadIssueCount =
    examplePayloadIssues === null
      ? typeof report.examplePayloadIssueCount === "number"
        ? report.examplePayloadIssueCount
        : null
      : examplePayloadIssues.length;
  const exampleStatus =
    report.exampleStatus === "ok" ||
    report.exampleStatus === "failed" ||
    report.exampleStatus === "skipped"
      ? report.exampleStatus
      : exampleAttempted === null
        ? null
        : exampleAttempted
          ? exampleExitCode === 0 &&
            exampleRuleMatched === true &&
            examplePayloadValid === true
            ? "ok"
            : "failed"
          : "skipped";

  return {
    exampleCommand,
    exampleArgs,
    exampleArgCount,
    exampleAttempted,
    exampleStatus,
    exampleRuleMatched,
    examplePayloadValid,
    examplePayloadIssues,
    examplePayloadIssueCount,
    exampleExitCode,
    exampleDurationMs,
    exampleOutputLine,
  };
};

export const createPrefixedTsCoreExampleSummary = (report, prefix = "") => {
  const keyPrefix = typeof prefix === "string" ? prefix : "";
  const createKey = (suffix) => {
    if (keyPrefix.length === 0) {
      return `example${suffix}`;
    }

    return `${keyPrefix}Example${suffix}`;
  };
  const summary = extractTsCoreExampleSummaryFromReport(report);

  return {
    [createKey("Command")]: summary.exampleCommand,
    [createKey("Args")]: summary.exampleArgs,
    [createKey("ArgCount")]: summary.exampleArgCount,
    [createKey("Attempted")]: summary.exampleAttempted,
    [createKey("Status")]: summary.exampleStatus,
    [createKey("RuleMatched")]: summary.exampleRuleMatched,
    [createKey("PayloadValid")]: summary.examplePayloadValid,
    [createKey("PayloadIssues")]: summary.examplePayloadIssues,
    [createKey("PayloadIssueCount")]: summary.examplePayloadIssueCount,
    [createKey("ExitCode")]: summary.exampleExitCode,
    [createKey("DurationMs")]: summary.exampleDurationMs,
    [createKey("OutputLine")]: summary.exampleOutputLine,
  };
};

const resolveFirstNonEmptyOutputLine = (output) => {
  if (typeof output !== "string" || output.length === 0) {
    return null;
  }

  const nonEmptyLines = sanitizeOutputForJsonParsing(output)
    .split(/\r?\n/)
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return line.length > 0;
    });
  const [firstNonEmptyLine] = nonEmptyLines;
  return firstNonEmptyLine ?? null;
};
const isNumberVec3 = (value) => {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => {
      return typeof entry === "number" && Number.isFinite(entry);
    })
  );
};
const isIntegerInRange = (value, min, max) => {
  return Number.isInteger(value) && value >= min && value <= max;
};
export const summarizeTsCoreExampleOutput = (output) => {
  const parsedOutput = parseJsonOutput(output);
  if (parsedOutput === null || typeof parsedOutput !== "object") {
    return {
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: resolveFirstNonEmptyOutputLine(output),
    };
  }
  if (Array.isArray(parsedOutput)) {
    return {
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: JSON.stringify(parsedOutput),
    };
  }

  const exampleRuleMatched =
    "ruleMatched" in parsedOutput && typeof parsedOutput.ruleMatched === "boolean"
      ? parsedOutput.ruleMatched
      : null;
  const examplePayloadIssues = [];
  const voxelValue = "voxel" in parsedOutput ? parsedOutput.voxel : null;
  const voxelObjectValid =
    voxelValue !== null &&
    typeof voxelValue === "object" &&
    !Array.isArray(voxelValue);
  let voxelValid = false;
  if (!voxelObjectValid) {
    examplePayloadIssues.push("voxel");
  } else {
    const voxelIdValid = "id" in voxelValue && isIntegerInRange(voxelValue.id, 0, 0xffff);
    if (!voxelIdValid) {
      examplePayloadIssues.push("voxel.id");
    }

    const voxelStageValid =
      "stage" in voxelValue && isIntegerInRange(voxelValue.stage, 0, 15);
    if (!voxelStageValid) {
      examplePayloadIssues.push("voxel.stage");
    }

    const voxelRotationValue = "rotation" in voxelValue ? voxelValue.rotation : null;
    const voxelRotationObjectValid =
      voxelRotationValue !== null &&
      typeof voxelRotationValue === "object" &&
      !Array.isArray(voxelRotationValue);
    if (!voxelRotationObjectValid) {
      examplePayloadIssues.push("voxel.rotation");
    }

    let voxelRotationValueValid = false;
    let voxelRotationYRotationValid = false;
    if (voxelRotationObjectValid) {
      voxelRotationValueValid =
        "value" in voxelRotationValue &&
        isIntegerInRange(voxelRotationValue.value, 0, 5);
      if (!voxelRotationValueValid) {
        examplePayloadIssues.push("voxel.rotation.value");
      }

      voxelRotationYRotationValid =
        "yRotation" in voxelRotationValue &&
        typeof voxelRotationValue.yRotation === "number" &&
        Number.isFinite(voxelRotationValue.yRotation);
      if (!voxelRotationYRotationValid) {
        examplePayloadIssues.push("voxel.rotation.yRotation");
      }
    }

    voxelValid =
      voxelIdValid &&
      voxelStageValid &&
      voxelRotationObjectValid &&
      voxelRotationValueValid &&
      voxelRotationYRotationValid;
  }

  const lightValue = "light" in parsedOutput ? parsedOutput.light : null;
  const lightObjectValid =
    lightValue !== null &&
    typeof lightValue === "object" &&
    !Array.isArray(lightValue);
  let lightValid = false;
  if (!lightObjectValid) {
    examplePayloadIssues.push("light");
  } else {
    const sunlightValid =
      "sunlight" in lightValue && isIntegerInRange(lightValue.sunlight, 0, 15);
    if (!sunlightValid) {
      examplePayloadIssues.push("light.sunlight");
    }

    const redValid = "red" in lightValue && isIntegerInRange(lightValue.red, 0, 15);
    if (!redValid) {
      examplePayloadIssues.push("light.red");
    }

    const greenValid =
      "green" in lightValue && isIntegerInRange(lightValue.green, 0, 15);
    if (!greenValid) {
      examplePayloadIssues.push("light.green");
    }

    const blueValid =
      "blue" in lightValue && isIntegerInRange(lightValue.blue, 0, 15);
    if (!blueValid) {
      examplePayloadIssues.push("light.blue");
    }

    lightValid = sunlightValid && redValid && greenValid && blueValid;
  }

  const rotatedAabbValue =
    "rotatedAabb" in parsedOutput ? parsedOutput.rotatedAabb : null;
  const rotatedAabbObjectValid =
    rotatedAabbValue !== null &&
    typeof rotatedAabbValue === "object" &&
    !Array.isArray(rotatedAabbValue);
  let rotatedAabbValid = false;
  if (!rotatedAabbObjectValid) {
    examplePayloadIssues.push("rotatedAabb");
  } else {
    const rotatedAabbMinValid =
      "min" in rotatedAabbValue && isNumberVec3(rotatedAabbValue.min);
    if (!rotatedAabbMinValid) {
      examplePayloadIssues.push("rotatedAabb.min");
    }

    const rotatedAabbMaxValid =
      "max" in rotatedAabbValue && isNumberVec3(rotatedAabbValue.max);
    if (!rotatedAabbMaxValid) {
      examplePayloadIssues.push("rotatedAabb.max");
    }

    const rotatedAabbBoundsOrdered =
      rotatedAabbMinValid &&
      rotatedAabbMaxValid &&
      rotatedAabbValue.min.every((minValue, index) => {
        return minValue <= rotatedAabbValue.max[index];
      });
    if (!rotatedAabbBoundsOrdered && rotatedAabbMinValid && rotatedAabbMaxValid) {
      examplePayloadIssues.push("rotatedAabb.bounds");
    }

    rotatedAabbValid =
      rotatedAabbMinValid && rotatedAabbMaxValid && rotatedAabbBoundsOrdered;
  }
  const examplePayloadValid =
    voxelValid && lightValid && rotatedAabbValid && examplePayloadIssues.length === 0;
  const normalizedExamplePayloadIssues =
    normalizeTsCorePayloadIssues(examplePayloadIssues) ?? [];
  const exampleOutputLine =
    typeof exampleRuleMatched === "boolean"
      ? `ruleMatched=${exampleRuleMatched ? "true" : "false"}`
      : resolveFirstNonEmptyOutputLine(output);

  return {
    exampleRuleMatched,
    examplePayloadValid,
    examplePayloadIssues: normalizedExamplePayloadIssues,
    exampleOutputLine,
  };
};

export const extractWasmPackStatusFromReport = (report) => {
  if (
    report === null ||
    typeof report !== "object" ||
    Array.isArray(report)
  ) {
    return null;
  }

  if (typeof report.wasmPackCheckStatus === "string") {
    return report.wasmPackCheckStatus;
  }

  const checkStatusMap =
    report.checkStatusMap !== null &&
    typeof report.checkStatusMap === "object" &&
    !Array.isArray(report.checkStatusMap)
      ? report.checkStatusMap
      : null;
  if (checkStatusMap === null) {
    return null;
  }

  const wasmPackStatus = checkStatusMap["wasm-pack"];
  return typeof wasmPackStatus === "string" ? wasmPackStatus : null;
};

export const deriveWasmPackCheckStatus = ({
  wasmPackCheckExitCode,
  wasmPackCheckReport,
}) => {
  const reportStatus = extractWasmPackStatusFromReport(wasmPackCheckReport);
  if (reportStatus !== null) {
    return reportStatus;
  }

  if (wasmPackCheckExitCode === null) {
    return "skipped";
  }

  if (wasmPackCheckExitCode === 0) {
    return "ok";
  }

  return "unavailable";
};

export const summarizeStepFailureResults = (steps) => {
  return steps
    .filter((step) => {
      return !step.passed && step.skipped === false;
    })
    .map((step) => {
      const reportMessage = deriveFailureMessageFromReport(step.report);
      const outputMessage =
        typeof step.output === "string" && step.output.length > 0
          ? step.output
          : null;
      const defaultMessage =
        typeof step.exitCode === "number"
          ? `Step failed with exit code ${step.exitCode}.`
          : "Step failed.";

      return {
        name: step.name,
        scriptName: step.scriptName,
        supportsNoBuild: step.supportsNoBuild === true,
        stepIndex: step.stepIndex,
        checkCommand:
          typeof step.checkCommand === "string" ? step.checkCommand : "",
        checkArgs: Array.isArray(step.checkArgs) ? step.checkArgs : [],
        checkArgCount:
          typeof step.checkArgCount === "number"
            ? step.checkArgCount
            : Array.isArray(step.checkArgs)
              ? step.checkArgs.length
              : 0,
        exitCode: typeof step.exitCode === "number" ? step.exitCode : 1,
        message: reportMessage ?? outputMessage ?? defaultMessage,
      };
    });
};

export const summarizeCheckFailureResults = (checks) => {
  return checks
    .filter((check) => !check.passed)
    .map((check) => {
      const reportMessage = deriveFailureMessageFromReport(check.report);
      const outputMessage =
        typeof check.output === "string" && check.output.length > 0
          ? check.output
          : null;
      const defaultMessage =
        typeof check.exitCode === "number"
          ? `Preflight check failed with exit code ${check.exitCode}.`
          : "Preflight check failed.";

      return {
        name: check.name,
        scriptName: check.scriptName,
        supportsNoBuild: check.supportsNoBuild === true,
        checkIndex: typeof check.checkIndex === "number" ? check.checkIndex : null,
        checkCommand:
          typeof check.checkCommand === "string" ? check.checkCommand : "",
        checkArgs: Array.isArray(check.checkArgs) ? check.checkArgs : [],
        checkArgCount:
          typeof check.checkArgCount === "number"
            ? check.checkArgCount
            : Array.isArray(check.checkArgs)
              ? check.checkArgs.length
              : 0,
        exitCode: typeof check.exitCode === "number" ? check.exitCode : 1,
        message: reportMessage ?? outputMessage ?? defaultMessage,
      };
    });
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
    canonicalMap.set(canonicalOption, canonicalOption);
    for (const alias of aliases) {
      canonicalMap.set(alias, canonicalOption);
    }
  }

  return canonicalMap;
};

const createSupportedCliOptions = (canonicalOptions, optionAliases = {}) => {
  return [
    ...canonicalOptions,
    ...Object.keys(optionAliases),
    ...Object.values(optionAliases).flat(),
  ].filter(
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
    supportedCliOptionCount: supportedCliOptions.length,
    availableCliOptionAliases: optionAliases,
    availableCliOptionCanonicalMap,
  };
};

const resolveCanonicalOptionToken = (
  optionToken,
  canonicalOptionMap,
  inlineValueTokenCanonicalMap
) => {
  const canonicalOption = canonicalOptionMap.get(optionToken);
  if (canonicalOption !== undefined) {
    return {
      canonicalOption,
      hasInlineValue: false,
    };
  }

  for (const [valueOptionToken, valueOptionCanonical] of inlineValueTokenCanonicalMap) {
    if (optionToken.startsWith(`${valueOptionToken}=`)) {
      return {
        canonicalOption: valueOptionCanonical,
        hasInlineValue: true,
      };
    }
  }

  return null;
};

const parseInlineOptionName = (optionToken) => {
  const equalsIndex = optionToken.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }

  return optionToken.slice(0, equalsIndex);
};

const isKnownOptionTokenLike = (optionToken, canonicalOptionMap) => {
  if (canonicalOptionMap.has(optionToken)) {
    return true;
  }

  const inlineOptionName = parseInlineOptionName(optionToken);
  if (inlineOptionName === null) {
    return false;
  }

  return canonicalOptionMap.has(inlineOptionName);
};

const shouldConsumeSplitOptionValue = (
  nextArg,
  canonicalOption,
  canonicalOptionMap,
  canonicalStrictValueOptions
) => {
  if (nextArg === null || nextArg.startsWith("--")) {
    return false;
  }

  if (!canonicalStrictValueOptions.has(canonicalOption)) {
    return true;
  }

  return !isKnownOptionTokenLike(nextArg, canonicalOptionMap);
};

const createValueOptionMetadata = (
  optionsWithValues,
  optionsWithStrictValues,
  canonicalOptionMap
) => {
  const canonicalValueOptions = new Set(
    optionsWithValues.map((optionWithValue) => {
      return canonicalOptionMap.get(optionWithValue) ?? optionWithValue;
    })
  );
  const canonicalStrictValueOptions = new Set(
    optionsWithStrictValues
      .map((strictValueOption) => {
        return canonicalOptionMap.get(strictValueOption) ?? strictValueOption;
      })
      .filter((strictValueOption) => {
        return canonicalValueOptions.has(strictValueOption);
      })
  );
  const inlineValueTokenCanonicalMap = new Map(
    Array.from(canonicalValueOptions).map((canonicalOption) => {
      return [canonicalOption, canonicalOption];
    })
  );

  for (const [optionToken, canonicalOption] of canonicalOptionMap.entries()) {
    if (!canonicalValueOptions.has(canonicalOption)) {
      continue;
    }
    inlineValueTokenCanonicalMap.set(optionToken, canonicalOption);
  }

  return {
    canonicalValueOptions,
    canonicalStrictValueOptions,
    inlineValueTokenCanonicalMap,
  };
};

const normalizeUnknownOptionToken = (optionToken, canonicalOptionMap) => {
  const optionName = parseInlineOptionName(optionToken);
  if (optionName === null) {
    return optionToken;
  }

  if (optionName === "-" || optionName === "--") {
    return `${optionName}=<value>`;
  }

  if (canonicalOptionMap.has(optionName)) {
    const canonicalOption = canonicalOptionMap.get(optionName) ?? optionName;
    return `${canonicalOption}=<value>`;
  }

  return optionName;
};

export const parseUnknownCliOptions = (
  args,
  {
    canonicalOptions = [],
    optionAliases = {},
    optionsWithValues = [],
    optionsWithStrictValues = [],
  } = {}
) => {
  const { optionArgs } = splitCliArgs(args);
  const canonicalOptionMap = createCanonicalOptionMap(
    canonicalOptions,
    optionAliases
  );
  const {
    canonicalValueOptions,
    canonicalStrictValueOptions,
    inlineValueTokenCanonicalMap,
  } = createValueOptionMetadata(
    optionsWithValues,
    optionsWithStrictValues,
    canonicalOptionMap
  );
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
      inlineValueTokenCanonicalMap
    );
    if (resolvedOption !== null) {
      if (
        canonicalValueOptions.has(resolvedOption.canonicalOption) &&
        !resolvedOption.hasInlineValue
      ) {
        const nextArg = optionArgs[index + 1] ?? null;
        if (
          shouldConsumeSplitOptionValue(
            nextArg,
            resolvedOption.canonicalOption,
            canonicalOptionMap,
            canonicalStrictValueOptions
          )
        ) {
          index += 1;
        }
      }
      continue;
    }

    if (seenUnknownOptions.has(optionToken)) {
      continue;
    }
    const normalizedUnknownOption = normalizeUnknownOptionToken(
      optionToken,
      canonicalOptionMap
    );
    if (seenUnknownOptions.has(normalizedUnknownOption)) {
      continue;
    }
    seenUnknownOptions.add(normalizedUnknownOption);
    unknownOptions.push(normalizedUnknownOption);
  }

  return unknownOptions;
};

export const createCliOptionValidation = (
  args,
  {
    canonicalOptions = [],
    optionAliases = {},
    optionsWithValues = [],
    optionsWithStrictValues = [],
    outputPathError = null,
    supportedCliOptions: precomputedSupportedCliOptions = null,
  } = {}
) => {
  const supportedCliOptions =
    precomputedSupportedCliOptions ??
    createCliOptionCatalog({
      canonicalOptions,
      optionAliases,
    }).supportedCliOptions;
  const unknownOptions = parseUnknownCliOptions(args, {
    canonicalOptions,
    optionAliases,
    optionsWithValues,
    optionsWithStrictValues,
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
    supportedCliOptionCount: supportedCliOptions.length,
    unknownOptions,
    unknownOptionCount,
    unsupportedOptionsError,
    validationErrorCode,
  };
};

export const deriveCliValidationFailureMessage = ({
  outputPathError = null,
  unsupportedOptionsError = null,
} = {}) => {
  if (outputPathError !== null) {
    return outputPathError;
  }

  if (unsupportedOptionsError !== null) {
    return unsupportedOptionsError;
  }

  return null;
};

export const parseActiveCliOptionMetadata = (
  args,
  {
    canonicalOptions = [],
    optionAliases = {},
    optionsWithValues = [],
    optionsWithStrictValues = [],
  } = {}
) => {
  const { optionArgs } = splitCliArgs(args);
  const canonicalOptionMap = createCanonicalOptionMap(
    canonicalOptions,
    optionAliases
  );
  const {
    canonicalValueOptions,
    canonicalStrictValueOptions,
    inlineValueTokenCanonicalMap,
  } = createValueOptionMetadata(
    optionsWithValues,
    optionsWithStrictValues,
    canonicalOptionMap
  );
  const activeCliOptionsSet = new Set();
  const activeCliOptionTokens = [];
  const seenActiveTokens = new Set();
  const activeCliOptionOccurrences = [];

  for (let index = 0; index < optionArgs.length; index += 1) {
    const token = optionArgs[index];
    const resolvedOption = resolveCanonicalOptionToken(
      token,
      canonicalOptionMap,
      inlineValueTokenCanonicalMap
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
      canonicalValueOptions.has(resolvedOption.canonicalOption) &&
      !resolvedOption.hasInlineValue
    ) {
      const nextArg = optionArgs[index + 1] ?? null;
      if (
        shouldConsumeSplitOptionValue(
          nextArg,
          resolvedOption.canonicalOption,
          canonicalOptionMap,
          canonicalStrictValueOptions
        )
      ) {
        index += 1;
      }
    }
  }

  const uniqueCanonicalOptions = canonicalOptions.filter((optionToken, index) => {
    return canonicalOptions.indexOf(optionToken) === index;
  });
  const canonicalOptionCandidates = createSupportedCliOptions(
    uniqueCanonicalOptions,
    optionAliases
  )
    .map((optionToken) => {
      return canonicalOptionMap.get(optionToken) ?? optionToken;
    })
    .filter((optionToken, index, allOptions) => {
      return allOptions.indexOf(optionToken) === index;
    });
  const activeCliOptions = canonicalOptionCandidates.filter((optionToken) => {
    return activeCliOptionsSet.has(optionToken);
  });
  const activeCliOptionResolutions = activeCliOptionTokens.map((token) => {
    const resolvedOption = resolveCanonicalOptionToken(
      token,
      canonicalOptionMap,
      inlineValueTokenCanonicalMap
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

export const createCliDiagnostics = (
  args,
  {
    canonicalOptions = [],
    optionAliases = {},
    optionsWithValues = [],
    optionsWithStrictValues = [],
    outputPathError = null,
  } = {}
) => {
  const optionCatalog = createCliOptionCatalog({
    canonicalOptions,
    optionAliases,
  });
  const optionValidation = createCliOptionValidation(args, {
    canonicalOptions,
    optionAliases,
    optionsWithValues,
    optionsWithStrictValues,
    outputPathError,
    supportedCliOptions: optionCatalog.supportedCliOptions,
  });
  const activeOptionMetadata = parseActiveCliOptionMetadata(args, {
    canonicalOptions,
    optionAliases,
    optionsWithValues,
    optionsWithStrictValues,
  });

  return {
    ...optionCatalog,
    ...optionValidation,
    ...activeOptionMetadata,
  };
};

export const resolveLastOptionValue = (
  args,
  optionName,
  recognizedOptionTokens = []
) => {
  const { optionArgs } = splitCliArgs(args);
  const recognizedOptionTokenSet = new Set(recognizedOptionTokens);
  const isRecognizedOptionTokenLike = (optionToken) => {
    if (recognizedOptionTokenSet.has(optionToken)) {
      return true;
    }

    const inlineOptionName = parseInlineOptionName(optionToken);
    if (inlineOptionName === null) {
      return false;
    }

    return recognizedOptionTokenSet.has(inlineOptionName);
  };
  const inlineOptionPrefix = `${optionName}=`;
  let hasOption = false;
  let resolvedValue = null;
  let missingValue = false;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const token = optionArgs[index];

    if (token === optionName) {
      hasOption = true;
      const nextArg = optionArgs[index + 1] ?? null;
      if (
        nextArg === null ||
        nextArg.startsWith("--") ||
        isRecognizedOptionTokenLike(nextArg) ||
        nextArg.trim().length === 0
      ) {
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
    if (inlineValue.trim().length === 0) {
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

export const resolveOutputPath = (
  args,
  cwd = process.cwd(),
  recognizedOptionTokens = []
) => {
  const outputPathValue = resolveLastOptionValue(
    args,
    "--output",
    recognizedOptionTokens
  );
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
