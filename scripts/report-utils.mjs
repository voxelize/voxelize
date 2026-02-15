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
    .replace(/\r/g, "\n")
    .replace(UTF8_BOM_PREFIX_REGEX, "")
    .replace(UTF8_BOM_LINE_PREFIX_REGEX, "\n")
    .replace(ANSI_OSC_ESCAPE_SEQUENCE_REGEX, "")
    .replace(ANSI_CSI_ESCAPE_SEQUENCE_REGEX, "")
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

  try {
    return Object.keys(value).length;
  } catch {
    return 0;
  }
};

export const summarizeStepResults = (steps) => {
  const stepEntries = cloneArraySafely(steps) ?? [];
  const passedSteps = [];
  const failedSteps = [];
  const skippedSteps = [];

  for (const step of stepEntries) {
    if (!isObjectRecord(step)) {
      continue;
    }

    const name = safeReadProperty(step, "name");
    if (typeof name !== "string") {
      continue;
    }

    const skipped = safeReadProperty(step, "skipped");
    if (skipped === true) {
      skippedSteps.push(name);
      continue;
    }

    if (skipped !== false) {
      continue;
    }

    const passed = safeReadProperty(step, "passed");
    if (Boolean(passed)) {
      passedSteps.push(name);
      continue;
    }

    failedSteps.push(name);
  }

  const passedStepCount = passedSteps.length;
  const failedStepCount = failedSteps.length;
  const skippedStepCount = skippedSteps.length;
  const firstFailedStep = failedSteps[0] ?? null;

  return {
    totalSteps: stepEntries.length,
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
  const checkEntries = cloneArraySafely(checks) ?? [];
  const passedChecks = [];
  const failedChecks = [];

  for (const check of checkEntries) {
    if (!isObjectRecord(check)) {
      continue;
    }

    const name = safeReadProperty(check, "name");
    if (typeof name !== "string") {
      continue;
    }

    if (Boolean(safeReadProperty(check, "passed"))) {
      passedChecks.push(name);
      continue;
    }

    failedChecks.push(name);
  }

  return {
    totalChecks: checkEntries.length,
    passedCheckCount: passedChecks.length,
    failedCheckCount: failedChecks.length,
    firstFailedCheck: failedChecks[0] ?? null,
    passedChecks,
    failedChecks,
  };
};

const isObjectRecord = (value) => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const safeObjectKeys = (value) => {
  if (!isObjectRecord(value)) {
    return [];
  }

  try {
    return Object.keys(value);
  } catch {
    return [];
  }
};

const safeReadProperty = (value, key) => {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  try {
    return value[key];
  } catch {
    return undefined;
  }
};

const MAX_ARRAY_LENGTH_FALLBACK_SCAN = 10_000;

const cloneArrayFromLengthFallback = (value) => {
  let lengthValue = 0;
  try {
    lengthValue = value.length;
  } catch {
    return null;
  }

  if (
    !Number.isSafeInteger(lengthValue) ||
    lengthValue < 0 ||
    lengthValue > MAX_ARRAY_LENGTH_FALLBACK_SCAN
  ) {
    return null;
  }

  const clonedArray = [];
  for (let arrayIndex = 0; arrayIndex < lengthValue; arrayIndex += 1) {
    try {
      clonedArray.push(value[arrayIndex]);
    } catch {
      continue;
    }
  }

  return clonedArray;
};

const cloneArrayFromIndexedAccess = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }

  let indexKeys = [];
  try {
    indexKeys = Object.keys(value);
  } catch {
    return cloneArrayFromLengthFallback(value);
  }

  const orderedIndices = indexKeys
    .map((indexKey) => {
      if (!/^(0|[1-9]\d*)$/.test(indexKey)) {
        return Number.NaN;
      }

      const numericIndex = Number(indexKey);
      return Number.isSafeInteger(numericIndex) ? numericIndex : Number.NaN;
    })
    .filter((indexValue) => {
      return Number.isInteger(indexValue) && indexValue >= 0;
    })
    .sort((leftIndex, rightIndex) => leftIndex - rightIndex);

  const clonedArray = [];
  for (const arrayIndex of orderedIndices) {
    try {
      clonedArray.push(value[arrayIndex]);
    } catch {
      continue;
    }
  }

  return clonedArray;
};

const cloneArraySafely = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }

  try {
    return Array.from(value);
  } catch {
    return cloneArrayFromIndexedAccess(value);
  }
};

const toNonNegativeIntegerOrNull = (value) => {
  return Number.isInteger(value) && value >= 0 ? value : null;
};

const toFiniteNumberOrNull = (value) => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export const deriveFailureMessageFromReport = (report) => {
  if (!isObjectRecord(report)) {
    return null;
  }

  const reportMessage = safeReadProperty(report, "message");
  if (typeof reportMessage === "string") {
    return reportMessage;
  }

  const requiredFailures = safeReadProperty(report, "requiredFailures");
  if (typeof requiredFailures === "number") {
    return `${requiredFailures} required check(s) failed.`;
  }

  const steps = cloneArraySafely(safeReadProperty(report, "steps"));
  if (steps !== null) {
    for (const step of steps) {
      if (!isObjectRecord(step)) {
        continue;
      }

      const passedValue = safeReadProperty(step, "passed");
      if (passedValue !== false) {
        continue;
      }

      if (safeReadProperty(step, "skipped") === true) {
        continue;
      }

      const stepName = safeReadProperty(step, "name");
      if (typeof stepName !== "string") {
        continue;
      }

      const stepReportMessage = safeReadProperty(
        safeReadProperty(step, "report"),
        "message"
      );
      if (typeof stepReportMessage === "string") {
        return `${stepName}: ${stepReportMessage}`;
      }

      const stepReason = safeReadProperty(step, "reason");
      if (typeof stepReason === "string") {
        return `${stepName}: ${stepReason}`;
      }

      return `${stepName} failed.`;
    }
  }

  return null;
};

const toStringArrayOrNull = (value) => {
  const clonedArray = cloneArraySafely(value);
  if (clonedArray === null) {
    return null;
  }

  return clonedArray.filter((entry) => {
    return typeof entry === "string";
  });
};

const toStringArrayOrEmpty = (value) => {
  return toStringArrayOrNull(value) ?? [];
};

export const extractWasmPackCheckSummaryFromReport = (report) => {
  if (!isObjectRecord(report)) {
    return {
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    };
  }

  const wasmPackCheckStatusValue = safeReadProperty(report, "wasmPackCheckStatus");
  const wasmPackCheckStatus =
    typeof wasmPackCheckStatusValue === "string"
      ? wasmPackCheckStatusValue
      : null;
  const wasmPackCheckCommandValue = safeReadProperty(report, "wasmPackCheckCommand");
  const wasmPackCheckCommand =
    typeof wasmPackCheckCommandValue === "string"
      ? wasmPackCheckCommandValue
      : null;
  const wasmPackCheckArgs = toStringArrayOrNull(
    safeReadProperty(report, "wasmPackCheckArgs")
  );
  const wasmPackCheckArgCountValue = safeReadProperty(report, "wasmPackCheckArgCount");
  const wasmPackCheckArgCount =
    toNonNegativeIntegerOrNull(wasmPackCheckArgCountValue) ??
    wasmPackCheckArgs?.length ??
    null;
  const wasmPackCheckExitCodeValue = safeReadProperty(report, "wasmPackCheckExitCode");
  const wasmPackCheckExitCode =
    toNonNegativeIntegerOrNull(wasmPackCheckExitCodeValue);
  const wasmPackCheckOutputLineValue = safeReadProperty(
    report,
    "wasmPackCheckOutputLine"
  );
  const wasmPackCheckOutputLine =
    typeof wasmPackCheckOutputLineValue === "string"
      ? wasmPackCheckOutputLineValue
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
  const clonedPayloadIssues = cloneArraySafely(payloadIssues);
  if (clonedPayloadIssues === null) {
    return null;
  }

  const seenPayloadIssues = new Set();
  const normalizedPayloadIssues = [];
  for (const payloadIssue of clonedPayloadIssues) {
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
  if (!isObjectRecord(report)) {
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

  const exampleCommandValue = safeReadProperty(report, "exampleCommand");
  const exampleCommand =
    typeof exampleCommandValue === "string" ? exampleCommandValue : null;
  const exampleArgs = toStringArrayOrNull(safeReadProperty(report, "exampleArgs"));
  const exampleArgCountValue = safeReadProperty(report, "exampleArgCount");
  const exampleArgCount =
    toNonNegativeIntegerOrNull(exampleArgCountValue) ?? exampleArgs?.length ?? null;
  const exampleAttemptedValue = safeReadProperty(report, "exampleAttempted");
  const exampleAttempted =
    typeof exampleAttemptedValue === "boolean" ? exampleAttemptedValue : null;
  const exampleExitCodeValue = safeReadProperty(report, "exampleExitCode");
  const exampleExitCode =
    toNonNegativeIntegerOrNull(exampleExitCodeValue);
  const exampleDurationMsValue = safeReadProperty(report, "exampleDurationMs");
  const exampleDurationMs =
    toFiniteNumberOrNull(exampleDurationMsValue);
  const exampleOutputLineValue = safeReadProperty(report, "exampleOutputLine");
  const exampleOutputLine =
    typeof exampleOutputLineValue === "string" ? exampleOutputLineValue : null;
  const exampleRuleMatchedValue = safeReadProperty(report, "exampleRuleMatched");
  const exampleRuleMatched =
    typeof exampleRuleMatchedValue === "boolean" ? exampleRuleMatchedValue : null;
  const examplePayloadValidValue = safeReadProperty(report, "examplePayloadValid");
  const examplePayloadValid =
    typeof examplePayloadValidValue === "boolean"
      ? examplePayloadValidValue
      : null;
  const rawExamplePayloadIssues = normalizeTsCorePayloadIssues(
    safeReadProperty(report, "examplePayloadIssues")
  );
  const examplePayloadIssueCountValue = safeReadProperty(
    report,
    "examplePayloadIssueCount"
  );
  const examplePayloadIssues =
    examplePayloadValid === true ? [] : rawExamplePayloadIssues;
  const examplePayloadIssueCount =
    examplePayloadIssues === null
      ? toNonNegativeIntegerOrNull(examplePayloadIssueCountValue)
      : examplePayloadIssues.length;
  const exampleStatusValue = safeReadProperty(report, "exampleStatus");
  const exampleStatus =
    exampleStatusValue === "ok" ||
    exampleStatusValue === "failed" ||
    exampleStatusValue === "skipped"
      ? exampleStatusValue
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
  let patternMatchedValid = true;
  if ("patternMatched" in parsedOutput) {
    patternMatchedValid = parsedOutput.patternMatched === true;
    if (!patternMatchedValid) {
      examplePayloadIssues.push("patternMatched");
    }
  }
  const examplePayloadValid =
    voxelValid &&
    lightValid &&
    rotatedAabbValid &&
    patternMatchedValid &&
    examplePayloadIssues.length === 0;
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
  if (!isObjectRecord(report)) {
    return null;
  }

  const directStatus = safeReadProperty(report, "wasmPackCheckStatus");
  if (typeof directStatus === "string") {
    return directStatus;
  }

  const checkStatusMap = safeReadProperty(report, "checkStatusMap");
  if (!isObjectRecord(checkStatusMap)) {
    return null;
  }

  const wasmPackStatus = safeReadProperty(checkStatusMap, "wasm-pack");
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
  const stepEntries = cloneArraySafely(steps) ?? [];
  const failureSummaries = [];

  for (const step of stepEntries) {
    if (!isObjectRecord(step)) {
      continue;
    }

    const passed = safeReadProperty(step, "passed");
    if (passed !== false) {
      continue;
    }

    const skipped = safeReadProperty(step, "skipped");
    if (skipped !== false) {
      continue;
    }

    const name = safeReadProperty(step, "name");
    if (typeof name !== "string") {
      continue;
    }

    const reportMessage = deriveFailureMessageFromReport(
      safeReadProperty(step, "report")
    );
    const output = safeReadProperty(step, "output");
    const outputMessage =
      typeof output === "string" && output.length > 0 ? output : null;
    const normalizedExitCode = toNonNegativeIntegerOrNull(
      safeReadProperty(step, "exitCode")
    );
    const defaultMessage =
      normalizedExitCode !== null
        ? `Step failed with exit code ${normalizedExitCode}.`
        : "Step failed.";
    const checkArgs = toStringArrayOrEmpty(safeReadProperty(step, "checkArgs"));
    const checkArgCount =
      toNonNegativeIntegerOrNull(safeReadProperty(step, "checkArgCount")) ??
      checkArgs.length;
    const scriptNameValue = safeReadProperty(step, "scriptName");
    const stepIndexValue = safeReadProperty(step, "stepIndex");
    const checkCommandValue = safeReadProperty(step, "checkCommand");

    failureSummaries.push({
      name,
      scriptName: typeof scriptNameValue === "string" ? scriptNameValue : "",
      supportsNoBuild: safeReadProperty(step, "supportsNoBuild") === true,
      stepIndex: toNonNegativeIntegerOrNull(stepIndexValue),
      checkCommand:
        typeof checkCommandValue === "string" ? checkCommandValue : "",
      checkArgs,
      checkArgCount,
      exitCode: normalizedExitCode ?? 1,
      message: reportMessage ?? outputMessage ?? defaultMessage,
    });
  }

  return failureSummaries;
};

export const summarizeCheckFailureResults = (checks) => {
  const checkEntries = cloneArraySafely(checks) ?? [];
  const failureSummaries = [];

  for (const check of checkEntries) {
    if (!isObjectRecord(check)) {
      continue;
    }

    const passed = safeReadProperty(check, "passed");
    if (passed !== false) {
      continue;
    }

    const name = safeReadProperty(check, "name");
    if (typeof name !== "string") {
      continue;
    }

    const reportMessage = deriveFailureMessageFromReport(
      safeReadProperty(check, "report")
    );
    const output = safeReadProperty(check, "output");
    const outputMessage =
      typeof output === "string" && output.length > 0 ? output : null;
    const normalizedExitCode = toNonNegativeIntegerOrNull(
      safeReadProperty(check, "exitCode")
    );
    const defaultMessage =
      normalizedExitCode !== null
        ? `Preflight check failed with exit code ${normalizedExitCode}.`
        : "Preflight check failed.";
    const checkArgs = toStringArrayOrEmpty(safeReadProperty(check, "checkArgs"));
    const checkArgCount =
      toNonNegativeIntegerOrNull(safeReadProperty(check, "checkArgCount")) ??
      checkArgs.length;
    const checkIndex = toNonNegativeIntegerOrNull(
      safeReadProperty(check, "checkIndex")
    );
    const scriptNameValue = safeReadProperty(check, "scriptName");
    const checkCommandValue = safeReadProperty(check, "checkCommand");

    failureSummaries.push({
      name,
      scriptName: typeof scriptNameValue === "string" ? scriptNameValue : "",
      supportsNoBuild: safeReadProperty(check, "supportsNoBuild") === true,
      checkIndex,
      checkCommand:
        typeof checkCommandValue === "string" ? checkCommandValue : "",
      checkArgs,
      checkArgCount,
      exitCode: normalizedExitCode ?? 1,
      message: reportMessage ?? outputMessage ?? defaultMessage,
    });
  }

  return failureSummaries;
};

export const splitCliArgs = (args) => {
  const normalizedArgs = toStringArrayOrEmpty(args);
  const optionTerminatorIndex = normalizedArgs.indexOf("--");
  if (optionTerminatorIndex === -1) {
    return {
      optionArgs: normalizedArgs,
      positionalArgs: [],
      optionTerminatorUsed: false,
    };
  }

  return {
    optionArgs: normalizedArgs.slice(0, optionTerminatorIndex),
    positionalArgs: normalizedArgs.slice(optionTerminatorIndex + 1),
    optionTerminatorUsed: true,
  };
};

export const hasCliOption = (args, canonicalOption, aliases = []) => {
  const { optionArgs } = splitCliArgs(args);
  if (optionArgs.includes(canonicalOption)) {
    return true;
  }

  const aliasTokens = toStringArrayOrEmpty(aliases);
  return aliasTokens.some((alias) => optionArgs.includes(alias));
};

const dedupeStringList = (tokens) => {
  const seenTokens = new Set();
  const uniqueTokens = [];

  for (const token of tokens) {
    if (token.length === 0 || seenTokens.has(token)) {
      continue;
    }

    seenTokens.add(token);
    uniqueTokens.push(token);
  }

  return uniqueTokens;
};

const normalizeCliOptionTokenList = (tokens) => {
  return dedupeStringList(toStringArrayOrEmpty(tokens));
};

const normalizeCliOptionAliases = (optionAliases) => {
  if (!isObjectRecord(optionAliases)) {
    return {};
  }

  const aliasEntries = safeObjectKeys(optionAliases)
    .map((canonicalOption) => {
      if (canonicalOption.length === 0) {
        return null;
      }

      const aliases = safeReadProperty(optionAliases, canonicalOption);
      if (aliases === undefined) {
        return null;
      }

      return [
        canonicalOption,
        normalizeCliOptionTokenList(aliases),
      ];
    })
    .filter((entry) => {
      return entry !== null;
    });

  return Object.fromEntries(aliasEntries);
};

const createCanonicalOptionMap = (canonicalOptions, optionAliases = {}) => {
  const normalizedCanonicalOptions = normalizeCliOptionTokenList(canonicalOptions);
  const normalizedOptionAliases = normalizeCliOptionAliases(optionAliases);
  const canonicalMap = new Map(
    normalizedCanonicalOptions.map((option) => [option, option])
  );

  for (const [canonicalOption, aliases] of Object.entries(normalizedOptionAliases)) {
    canonicalMap.set(canonicalOption, canonicalOption);
    for (const alias of aliases) {
      canonicalMap.set(alias, canonicalOption);
    }
  }

  return canonicalMap;
};

const createSupportedCliOptions = (canonicalOptions, optionAliases = {}) => {
  const normalizedCanonicalOptions = normalizeCliOptionTokenList(canonicalOptions);
  const normalizedOptionAliases = normalizeCliOptionAliases(optionAliases);

  return dedupeStringList([
    ...normalizedCanonicalOptions,
    ...Object.keys(normalizedOptionAliases),
    ...Object.values(normalizedOptionAliases).flat(),
  ]);
};

export const createCliOptionCatalog = ({
  canonicalOptions = [],
  optionAliases = {},
} = {}) => {
  const normalizedOptionAliases = normalizeCliOptionAliases(optionAliases);
  const supportedCliOptions = createSupportedCliOptions(
    canonicalOptions,
    normalizedOptionAliases
  );
  const canonicalOptionMap = createCanonicalOptionMap(
    canonicalOptions,
    normalizedOptionAliases
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
    availableCliOptionAliases: normalizedOptionAliases,
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
  const normalizedOptionsWithValues = normalizeCliOptionTokenList(optionsWithValues);
  const normalizedOptionsWithStrictValues = normalizeCliOptionTokenList(
    optionsWithStrictValues
  );
  const canonicalValueOptions = new Set(
    normalizedOptionsWithValues.map((optionWithValue) => {
      return canonicalOptionMap.get(optionWithValue) ?? optionWithValue;
    })
  );
  const canonicalStrictValueOptions = new Set(
    normalizedOptionsWithStrictValues
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
    precomputedSupportedCliOptions === null
      ? createCliOptionCatalog({
          canonicalOptions,
          optionAliases,
        }).supportedCliOptions
      : normalizeCliOptionTokenList(precomputedSupportedCliOptions);
  const unknownOptions = parseUnknownCliOptions(args, {
    canonicalOptions,
    optionAliases,
    optionsWithValues,
    optionsWithStrictValues,
  });
  const unknownOptionCount = unknownOptions.length;
  const supportedOptionList =
    supportedCliOptions.length > 0 ? supportedCliOptions.join(", ") : "(none)";
  const unsupportedOptionsError =
    unknownOptionCount === 0
      ? null
      : `Unsupported option(s): ${unknownOptions.join(", ")}. Supported options: ${supportedOptionList}.`;
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
  const normalizedCanonicalOptions = normalizeCliOptionTokenList(canonicalOptions);
  const normalizedOptionAliases = normalizeCliOptionAliases(optionAliases);
  const canonicalOptionMap = createCanonicalOptionMap(
    normalizedCanonicalOptions,
    normalizedOptionAliases
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

  const canonicalOptionCandidates = createSupportedCliOptions(
    normalizedCanonicalOptions,
    normalizedOptionAliases
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
  const recognizedOptionTokenSet = new Set(
    normalizeCliOptionTokenList(recognizedOptionTokens)
  );
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
