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

const isArrayValue = (value) => {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
};

const isStringObjectValue = (value) => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  try {
    return value instanceof String;
  } catch {
    return false;
  }
};

const isNumberObjectValue = (value) => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  try {
    return value instanceof Number;
  } catch {
    return false;
  }
};

const isBooleanObjectValue = (value) => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  try {
    return value instanceof Boolean;
  } catch {
    return false;
  }
};

const isBigIntObjectValue = (value) => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  try {
    return value instanceof BigInt;
  } catch {
    return false;
  }
};

const isSymbolObjectValue = (value) => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  try {
    return value instanceof Symbol;
  } catch {
    return false;
  }
};

const toPrimitiveWrapperKindOrNull = (value) => {
  if (isStringObjectValue(value)) {
    return "string";
  }
  if (isNumberObjectValue(value)) {
    return "number";
  }
  if (isBooleanObjectValue(value)) {
    return "boolean";
  }
  if (isBigIntObjectValue(value)) {
    return "bigint";
  }
  if (isSymbolObjectValue(value)) {
    return "symbol";
  }

  return null;
};

const isPrimitiveWrapperPrimitiveValue = (value) => {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  );
};

const toIntrinsicWrapperPrimitiveOrNull = (wrapperKind, value) => {
  try {
    switch (wrapperKind) {
      case "string":
        return String.prototype.valueOf.call(value);
      case "number":
        return Number.prototype.valueOf.call(value);
      case "boolean":
        return Boolean.prototype.valueOf.call(value);
      case "bigint":
        return BigInt.prototype.valueOf.call(value);
      case "symbol":
        return Symbol.prototype.valueOf.call(value);
      default:
        return null;
    }
  } catch {
    return null;
  }
};

const toPrimitiveWrapperValueOrNull = (value) => {
  const wrapperKind = toPrimitiveWrapperKindOrNull(value);
  if (wrapperKind === null) {
    return null;
  }

  const intrinsicPrimitiveValue = toIntrinsicWrapperPrimitiveOrNull(
    wrapperKind,
    value
  );
  if (isPrimitiveWrapperPrimitiveValue(intrinsicPrimitiveValue)) {
    return intrinsicPrimitiveValue;
  }

  try {
    const valueOf = value.valueOf;
    if (typeof valueOf === "function") {
      const primitiveValue = valueOf.call(value);
      if (isPrimitiveWrapperPrimitiveValue(primitiveValue)) {
        return primitiveValue;
      }
    }
  } catch {
    return null;
  }

  return null;
};

const toPrimitiveWrapperStringOrNull = (value) => {
  const primitiveValue = toPrimitiveWrapperValueOrNull(value);
  if (primitiveValue === null) {
    return null;
  }

  try {
    const primitiveStringValue = String(primitiveValue);
    return primitiveStringValue.length > 0 ? primitiveStringValue : null;
  } catch {
    return null;
  }
};

export const parseJsonOutput = (value) => {
  let outputValue = value;
  if (typeof outputValue !== "string") {
    if (!isStringObjectValue(outputValue)) {
      return null;
    }

    const wrappedStringValue = toPrimitiveWrapperStringOrNull(outputValue);
    if (wrappedStringValue === null) {
      return null;
    }
    outputValue = wrappedStringValue;
  }

  if (typeof outputValue !== "string" || outputValue.length === 0) {
    return null;
  }
  const sanitizedValue = sanitizeOutputForJsonParsing(outputValue);

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

const toReportSnapshotOrEmpty = (report) => {
  if (report === null || typeof report !== "object") {
    return {};
  }

  try {
    if (isArrayValue(report)) {
      return {};
    }
  } catch {
    return {};
  }

  let reportKeys = [];
  try {
    reportKeys = Object.keys(report);
  } catch {
    return {};
  }

  const reportSnapshot = Object.create(null);
  for (const reportKey of reportKeys) {
    try {
      reportSnapshot[reportKey] = report[reportKey];
    } catch {
      continue;
    }
  }

  return reportSnapshot;
};

export const toReport = (report) => {
  return {
    ...toReportSnapshotOrEmpty(report),
    schemaVersion: REPORT_SCHEMA_VERSION,
  };
};

const isCompactJsonSerializationEnabled = (options) => {
  if (options === null || typeof options !== "object") {
    return false;
  }

  try {
    return options.compact === true;
  } catch {
    return false;
  }
};

const toSerializationErrorMessage = (error) => {
  const toTrimmedErrorMessageOrNull = (value) => {
    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : null;
  };

  const toPrimitiveErrorMessageOrNull = (value) => {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint" ||
      typeof value === "symbol"
    ) {
      try {
        const primitiveMessage = String(value);
        return toTrimmedErrorMessageOrNull(primitiveMessage);
      } catch {
        return null;
      }
    }

    if (value !== null && typeof value === "object") {
      const wrappedPrimitiveMessage = toPrimitiveWrapperStringOrNull(value);
      if (wrappedPrimitiveMessage !== null) {
        return toTrimmedErrorMessageOrNull(wrappedPrimitiveMessage);
      }
    }

    return null;
  };

  let isErrorValue = false;
  try {
    isErrorValue = error instanceof Error;
  } catch {
    isErrorValue = false;
  }

  if (!isErrorValue) {
    return (
      toPrimitiveErrorMessageOrNull(error) ??
      "Unknown report serialization error."
    );
  }

  let rawMessage = "";
  try {
    rawMessage = error.message;
  } catch {
    return (
      toPrimitiveErrorMessageOrNull(error) ??
      "Unknown report serialization error."
    );
  }

  if (typeof rawMessage !== "string") {
    return (
      toPrimitiveErrorMessageOrNull(rawMessage) ??
      toPrimitiveErrorMessageOrNull(error) ??
      "Unknown report serialization error."
    );
  }

  const normalizedMessage = toTrimmedErrorMessageOrNull(rawMessage);
  return normalizedMessage !== null
    ? normalizedMessage
    : "Unknown report serialization error.";
};

const serializeJsonSafely = (value, compact) => {
  try {
    const serializedValue = JSON.stringify(value, null, compact ? 0 : 2);
    return {
      json: typeof serializedValue === "string" ? serializedValue : null,
      error: null,
    };
  } catch (error) {
    return {
      json: null,
      error,
    };
  }
};

export const toReportJson = (report, options = {}) => {
  const compact = isCompactJsonSerializationEnabled(options);
  const reportSnapshot = toReport(report);
  const serializedReport = serializeJsonSafely(reportSnapshot, compact);
  if (serializedReport.json !== null) {
    return serializedReport.json;
  }

  const serializationFailureReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    passed: false,
    exitCode: 1,
    message: "Failed to serialize report JSON.",
    serializationError: toSerializationErrorMessage(serializedReport.error),
  };
  const serializedFailureReport = serializeJsonSafely(
    serializationFailureReport,
    compact
  );
  if (serializedFailureReport.json !== null) {
    return serializedFailureReport.json;
  }

  return compact
    ? `{"schemaVersion":${REPORT_SCHEMA_VERSION},"passed":false,"exitCode":1,"message":"Failed to serialize report JSON.","serializationError":"Unknown report serialization error."}`
    : `{
  "schemaVersion": ${REPORT_SCHEMA_VERSION},
  "passed": false,
  "exitCode": 1,
  "message": "Failed to serialize report JSON.",
  "serializationError": "Unknown report serialization error."
}`;
};

export const createTimedReportBuilder = (
  now = () => Date.now(),
  toIsoString = (value) => new Date(value).toISOString()
) => {
  const resolveNowMs = () => {
    let nowValue = 0;
    try {
      nowValue = now();
    } catch {
      nowValue = Date.now();
    }

    return Number.isFinite(nowValue) ? nowValue : Date.now();
  };

  const resolveIsoTimestamp = (value) => {
    const normalizedValue = Number.isFinite(value) ? value : Date.now();
    try {
      const isoTimestamp = toIsoString(normalizedValue);
      if (typeof isoTimestamp === "string" && isoTimestamp.length > 0) {
        return isoTimestamp;
      }
    } catch {
      // fall through to default ISO serialization
    }

    try {
      return new Date(normalizedValue).toISOString();
    } catch {
      return "1970-01-01T00:00:00.000Z";
    }
  };

  const startedAtMs = resolveNowMs();
  const startedAt = resolveIsoTimestamp(startedAtMs);

  return (report) => {
    const endedAtMs = resolveNowMs();
    const rawDurationMs = endedAtMs - startedAtMs;
    const durationMs =
      Number.isFinite(rawDurationMs) && rawDurationMs >= 0 ? rawDurationMs : 0;

    return {
      ...toReportSnapshotOrEmpty(report),
      startedAt,
      endedAt: resolveIsoTimestamp(endedAtMs),
      durationMs,
    };
  };
};

export const countRecordEntries = (value) => {
  if (value === null || typeof value !== "object" || isArrayValue(value)) {
    return 0;
  }

  try {
    return Object.keys(value).length;
  } catch {
    return 0;
  }
};

export const summarizeStepResults = (steps) => {
  const clonedStepEntries = cloneIndexedArraySafelyWithMetadata(steps);
  const stepEntries = clonedStepEntries?.entries ?? [];
  const stepRecordEntries = toObjectRecordEntriesOrEmpty(
    steps,
    stepEntries,
    clonedStepEntries?.fromIndexedFallback === true
  );
  const passedSteps = [];
  const failedSteps = [];
  const skippedSteps = [];

  for (const step of stepRecordEntries) {
    const name = toTrimmedStringOrNull(safeReadProperty(step, "name"));
    if (name === null) {
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
  const totalSteps = Math.max(
    stepEntries.length,
    passedStepCount + failedStepCount + skippedStepCount
  );

  return {
    totalSteps,
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
  const clonedCheckEntries = cloneIndexedArraySafelyWithMetadata(checks);
  const checkEntries = clonedCheckEntries?.entries ?? [];
  const checkRecordEntries = toObjectRecordEntriesOrEmpty(
    checks,
    checkEntries,
    clonedCheckEntries?.fromIndexedFallback === true
  );
  const passedChecks = [];
  const failedChecks = [];

  for (const check of checkRecordEntries) {
    const name = toTrimmedStringOrNull(safeReadProperty(check, "name"));
    if (name === null) {
      continue;
    }

    if (Boolean(safeReadProperty(check, "passed"))) {
      passedChecks.push(name);
      continue;
    }

    failedChecks.push(name);
  }

  return {
    totalChecks: Math.max(checkEntries.length, passedChecks.length + failedChecks.length),
    passedCheckCount: passedChecks.length,
    failedCheckCount: failedChecks.length,
    firstFailedCheck: failedChecks[0] ?? null,
    passedChecks,
    failedChecks,
  };
};

const isObjectRecord = (value) => {
  return value !== null && typeof value === "object" && !isArrayValue(value);
};

const isEmptyPlaceholderEntry = (entryValue) => {
  return entryValue === undefined || entryValue === null;
};

const isNonStringPrimitivePlaceholderEntry = (entryValue) => {
  return (
    entryValue !== null &&
    typeof entryValue !== "object" &&
    typeof entryValue !== "string"
  );
};

const isRecoverableFallbackEntry = (entryValue) => {
  return entryValue !== undefined && entryValue !== null;
};

const isStringFallbackEntry = (entryValue) => {
  return typeof entryValue === "string";
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

const MAX_ARRAY_LENGTH_FALLBACK_SCAN = 1_024;

const toIndexedArrayEntry = (index, value) => {
  return {
    index,
    value,
  };
};

const cloneArrayFromLengthFallback = (value) => {
  let lengthValue = 0;
  try {
    lengthValue = value.length;
  } catch {
    return null;
  }

  if (!Number.isSafeInteger(lengthValue) || lengthValue < 0) {
    return null;
  }

  const boundedLength = Math.min(lengthValue, MAX_ARRAY_LENGTH_FALLBACK_SCAN);
  const clonedArray = [];
  let canProbeOwnProperty = true;
  for (let arrayIndex = 0; arrayIndex < boundedLength; arrayIndex += 1) {
    let indexPresent = false;
    let requiresDirectRead = false;

    if (canProbeOwnProperty) {
      try {
        indexPresent = Object.prototype.hasOwnProperty.call(value, arrayIndex);
      } catch {
        canProbeOwnProperty = false;
        requiresDirectRead = true;
      }
    } else {
      requiresDirectRead = true;
    }

    if (!indexPresent && !requiresDirectRead) {
      continue;
    }

    try {
      const arrayEntry = value[arrayIndex];
      if (requiresDirectRead && arrayEntry === undefined) {
        continue;
      }

      clonedArray.push(toIndexedArrayEntry(arrayIndex, arrayEntry));
    } catch {
      continue;
    }
  }

  return clonedArray;
};

const toNonNegativeSafeArrayIndex = (indexKey) => {
  if (!/^(0|[1-9]\d*)$/.test(indexKey)) {
    return null;
  }

  const numericIndex = Number(indexKey);
  return Number.isSafeInteger(numericIndex) ? numericIndex : null;
};

const insertBoundedSortedIndex = (indices, arrayIndex, maxCount) => {
  let insertPosition = 0;
  let low = 0;
  let high = indices.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (indices[mid] < arrayIndex) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  insertPosition = low;

  if (indices[insertPosition] === arrayIndex) {
    return;
  }

  if (indices.length >= maxCount && insertPosition >= maxCount) {
    return;
  }

  indices.splice(insertPosition, 0, arrayIndex);
  if (indices.length > maxCount) {
    indices.pop();
  }
};

const selectSmallestArrayIndices = (indexKeys, maxCount) => {
  const smallestIndices = [];

  for (const indexKey of indexKeys) {
    const numericIndex = toNonNegativeSafeArrayIndex(indexKey);
    if (numericIndex === null) {
      continue;
    }

    insertBoundedSortedIndex(smallestIndices, numericIndex, maxCount);
  }

  return smallestIndices;
};

const cloneArrayFromIndexedKeys = (value) => {
  let indexKeys = [];
  try {
    indexKeys = Object.keys(value);
  } catch {
    return null;
  }

  const orderedIndices = selectSmallestArrayIndices(
    indexKeys,
    MAX_ARRAY_LENGTH_FALLBACK_SCAN
  );
  const clonedArray = [];
  for (const arrayIndex of orderedIndices) {
    try {
      clonedArray.push(toIndexedArrayEntry(arrayIndex, value[arrayIndex]));
    } catch {
      continue;
    }
  }

  if (orderedIndices.length > 0 && clonedArray.length === 0) {
    return null;
  }

  return clonedArray;
};

const toValuesFromIndexedArrayEntries = (entries) => {
  if (entries === null) {
    return null;
  }

  return entries.map((entry) => {
    return entry.value;
  });
};

const toOrderedValuesFromEntryMap = (entryMap, capToFallbackWindow = false) => {
  const orderedEntries = Array.from(entryMap.entries()).sort(
    (leftEntry, rightEntry) => {
      return leftEntry[0] - rightEntry[0];
    }
  );
  const boundedEntries = capToFallbackWindow
    ? orderedEntries.slice(0, MAX_ARRAY_LENGTH_FALLBACK_SCAN)
    : orderedEntries;

  return boundedEntries.map(([, entryValue]) => {
    return entryValue;
  });
};

const mergeIndexedEntriesByFirstSeen = (
  primaryEntries,
  supplementalEntries,
  capToFallbackWindow = false
) => {
  const mergedEntryMap = new Map();
  for (const entry of primaryEntries) {
    if (!mergedEntryMap.has(entry.index)) {
      mergedEntryMap.set(entry.index, entry.value);
    }
  }
  for (const entry of supplementalEntries) {
    if (!mergedEntryMap.has(entry.index)) {
      mergedEntryMap.set(entry.index, entry.value);
    }
  }

  return toOrderedValuesFromEntryMap(mergedEntryMap, capToFallbackWindow);
};

const mergeIndexedFallbackEntries = (primaryEntries, supplementalEntries) => {
  const mergedEntryMap = new Map();
  for (const entry of primaryEntries) {
    if (!mergedEntryMap.has(entry.index)) {
      mergedEntryMap.set(entry.index, entry.value);
    }
  }
  for (const entry of supplementalEntries) {
    if (!mergedEntryMap.has(entry.index)) {
      mergedEntryMap.set(entry.index, entry.value);
      continue;
    }

    const existingValue = mergedEntryMap.get(entry.index);
    if (
      isEmptyPlaceholderEntry(existingValue) &&
      isRecoverableFallbackEntry(entry.value)
    ) {
      mergedEntryMap.set(entry.index, entry.value);
      continue;
    }
    if (
      isNonStringPrimitivePlaceholderEntry(existingValue) &&
      isStringFallbackEntry(entry.value)
    ) {
      mergedEntryMap.set(entry.index, entry.value);
    }
  }

  return Array.from(mergedEntryMap.entries())
    .sort((leftEntry, rightEntry) => {
      return leftEntry[0] - rightEntry[0];
    })
    .slice(0, MAX_ARRAY_LENGTH_FALLBACK_SCAN)
    .map(([index, value]) => {
      return toIndexedArrayEntry(index, value);
    });
};

const cloneStringEntriesFromIndexedKeys = (value) => {
  if (!isArrayValue(value)) {
    return null;
  }

  let indexKeys = [];
  try {
    indexKeys = Object.keys(value);
  } catch {
    return null;
  }

  const orderedStringEntries = [];
  for (const indexKey of indexKeys) {
    const numericIndex = toNonNegativeSafeArrayIndex(indexKey);
    if (numericIndex === null) {
      continue;
    }

    let entryValue = null;
    try {
      entryValue = value[numericIndex];
    } catch {
      continue;
    }

    if (typeof entryValue !== "string") {
      continue;
    }

    let insertPosition = 0;
    let low = 0;
    let high = orderedStringEntries.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (orderedStringEntries[mid].index < numericIndex) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    insertPosition = low;

    if (orderedStringEntries[insertPosition]?.index === numericIndex) {
      continue;
    }

    if (
      orderedStringEntries.length >= MAX_ARRAY_LENGTH_FALLBACK_SCAN &&
      insertPosition >= MAX_ARRAY_LENGTH_FALLBACK_SCAN
    ) {
      continue;
    }

    orderedStringEntries.splice(insertPosition, 0, {
      index: numericIndex,
      value: entryValue,
    });
    if (orderedStringEntries.length > MAX_ARRAY_LENGTH_FALLBACK_SCAN) {
      orderedStringEntries.pop();
    }
  }

  return orderedStringEntries;
};

const cloneObjectEntriesFromIndexedKeys = (value) => {
  if (!isArrayValue(value)) {
    return null;
  }

  let indexKeys = [];
  try {
    indexKeys = Object.keys(value);
  } catch {
    return null;
  }

  const orderedObjectEntries = [];
  for (const indexKey of indexKeys) {
    const numericIndex = toNonNegativeSafeArrayIndex(indexKey);
    if (numericIndex === null) {
      continue;
    }

    let entryValue = null;
    try {
      entryValue = value[numericIndex];
    } catch {
      continue;
    }

    if (!isObjectRecord(entryValue)) {
      continue;
    }

    let insertPosition = 0;
    let low = 0;
    let high = orderedObjectEntries.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (orderedObjectEntries[mid].index < numericIndex) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    insertPosition = low;

    if (orderedObjectEntries[insertPosition]?.index === numericIndex) {
      continue;
    }

    if (
      orderedObjectEntries.length >= MAX_ARRAY_LENGTH_FALLBACK_SCAN &&
      insertPosition >= MAX_ARRAY_LENGTH_FALLBACK_SCAN
    ) {
      continue;
    }

    orderedObjectEntries.splice(insertPosition, 0, {
      index: numericIndex,
      value: entryValue,
    });
    if (orderedObjectEntries.length > MAX_ARRAY_LENGTH_FALLBACK_SCAN) {
      orderedObjectEntries.pop();
    }
  }

  return orderedObjectEntries;
};

const cloneIndexedArrayFromIndexedAccess = (value) => {
  if (!isArrayValue(value)) {
    return null;
  }

  const lengthFallbackClone = cloneArrayFromLengthFallback(value);
  const hasNonUndefinedLengthFallbackEntry =
    lengthFallbackClone !== null &&
    lengthFallbackClone.some((entry) => entry.value !== undefined);
  if (
    hasNonUndefinedLengthFallbackEntry &&
    lengthFallbackClone !== null &&
    lengthFallbackClone.length >= MAX_ARRAY_LENGTH_FALLBACK_SCAN
  ) {
    return lengthFallbackClone;
  }

  const keyFallbackClone = cloneArrayFromIndexedKeys(value);
  const lengthFallbackCloneIsEmptyArray =
    lengthFallbackClone !== null && lengthFallbackClone.length === 0;
  if (
    keyFallbackClone === null &&
    !hasNonUndefinedLengthFallbackEntry &&
    lengthFallbackCloneIsEmptyArray
  ) {
    return null;
  }

  if (keyFallbackClone !== null && keyFallbackClone.length > 0) {
    if (hasNonUndefinedLengthFallbackEntry && lengthFallbackClone !== null) {
      return mergeIndexedFallbackEntries(
        lengthFallbackClone,
        keyFallbackClone
      );
    }

    return keyFallbackClone;
  }

  if (hasNonUndefinedLengthFallbackEntry && lengthFallbackClone !== null) {
    return lengthFallbackClone;
  }

  return lengthFallbackClone;
};

const cloneIndexedArraySafelyWithMetadata = (value) => {
  if (!isArrayValue(value)) {
    return null;
  }

  try {
    const iteratorEntries = Array.from(value).map((entryValue, entryIndex) => {
      return toIndexedArrayEntry(entryIndex, entryValue);
    });
    if (iteratorEntries.length === 0) {
      const fallbackEntries = cloneIndexedArrayFromIndexedAccess(value);
      if (fallbackEntries === null) {
        return {
          entries: iteratorEntries,
          fromIndexedFallback: true,
        };
      }
      if (fallbackEntries.length > 0) {
        return {
          entries: fallbackEntries,
          fromIndexedFallback: true,
        };
      }
    }

    return {
      entries: iteratorEntries,
      fromIndexedFallback: false,
    };
  } catch {
    const fallbackEntries = cloneIndexedArrayFromIndexedAccess(value);
    if (fallbackEntries === null) {
      return null;
    }

    return {
      entries: fallbackEntries,
      fromIndexedFallback: true,
    };
  }
};

const toNonNegativeIntegerOrNull = (value) => {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

const toNonNegativeFiniteNumberOrNull = (value) => {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
};

const toTrimmedStringOrNull = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
};

const toSanitizedOutputLineOrNull = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const nonEmptyLines = sanitizeOutputForJsonParsing(value)
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

const KNOWN_WASM_PACK_STATUSES = new Set([
  "ok",
  "missing",
  "unavailable",
  "skipped",
]);

const toKnownWasmPackStatus = (value) => {
  const normalizedValue = toTrimmedStringOrNull(value);
  if (normalizedValue === null) {
    return null;
  }

  const canonicalStatus = normalizedValue.toLowerCase();
  return KNOWN_WASM_PACK_STATUSES.has(canonicalStatus)
    ? canonicalStatus
    : null;
};

const KNOWN_TS_CORE_EXAMPLE_STATUSES = new Set(["ok", "failed", "skipped"]);

const toKnownTsCoreExampleStatus = (value) => {
  const normalizedValue = toTrimmedStringOrNull(value);
  if (normalizedValue === null) {
    return null;
  }

  const canonicalStatus = normalizedValue.toLowerCase();
  return KNOWN_TS_CORE_EXAMPLE_STATUSES.has(canonicalStatus)
    ? canonicalStatus
    : null;
};

export const deriveFailureMessageFromReport = (report) => {
  if (!isObjectRecord(report)) {
    return null;
  }

  const reportMessage = toSanitizedOutputLineOrNull(
    safeReadProperty(report, "message")
  );
  if (reportMessage !== null) {
    return reportMessage;
  }

  const requiredFailures = safeReadProperty(report, "requiredFailures");
  const normalizedRequiredFailures = toNonNegativeIntegerOrNull(requiredFailures);
  if (normalizedRequiredFailures !== null && normalizedRequiredFailures > 0) {
    return `${normalizedRequiredFailures} required check(s) failed.`;
  }

  const stepsValue = safeReadProperty(report, "steps");
  const clonedStepEntries = cloneIndexedArraySafelyWithMetadata(stepsValue);
  if (clonedStepEntries !== null) {
    const stepRecordEntries = toObjectRecordEntriesOrEmpty(
      stepsValue,
      clonedStepEntries.entries,
      clonedStepEntries.fromIndexedFallback
    );
    for (const step of stepRecordEntries) {
      const passedValue = safeReadProperty(step, "passed");
      if (passedValue !== false) {
        continue;
      }

      if (safeReadProperty(step, "skipped") === true) {
        continue;
      }

      const stepName = toTrimmedStringOrNull(safeReadProperty(step, "name"));
      if (stepName === null) {
        continue;
      }

      const stepReportMessage = toSanitizedOutputLineOrNull(
        safeReadProperty(safeReadProperty(step, "report"), "message")
      );
      if (stepReportMessage !== null) {
        return `${stepName}: ${stepReportMessage}`;
      }

      const stepReason = toSanitizedOutputLineOrNull(
        safeReadProperty(step, "reason")
      );
      if (stepReason !== null) {
        return `${stepName}: ${stepReason}`;
      }

      return `${stepName} failed.`;
    }
  }

  return null;
};

const toStringArrayOrNull = (value) => {
  const clonedIndexedEntries = cloneIndexedArraySafelyWithMetadata(value);
  if (clonedIndexedEntries === null) {
    return null;
  }

  return toStringArrayFromClonedIndexedEntries(value, clonedIndexedEntries);
};

const toStringArrayFromClonedIndexedEntries = (sourceValue, clonedIndexedEntries) => {
  const indexedEntries = clonedIndexedEntries.entries;

  const normalizedStringEntries = indexedEntries.filter((entry) => {
    return typeof entry.value === "string";
  });
  if (normalizedStringEntries.length === indexedEntries.length) {
    return toValuesFromIndexedArrayEntries(normalizedStringEntries);
  }

  const keyFallbackStringEntries = cloneStringEntriesFromIndexedKeys(sourceValue);
  if (keyFallbackStringEntries !== null && keyFallbackStringEntries.length > 0) {
    const capMergedStringEntries = clonedIndexedEntries.fromIndexedFallback;
    return mergeIndexedEntriesByFirstSeen(
      normalizedStringEntries,
      keyFallbackStringEntries,
      capMergedStringEntries
    );
  }

  return toValuesFromIndexedArrayEntries(normalizedStringEntries);
};

const toObjectRecordEntriesOrEmpty = (
  sourceValue,
  indexedEntries,
  capMergedRecordEntries = false
) => {
  const normalizedRecordEntries = indexedEntries.filter((entry) => {
    return isObjectRecord(entry.value);
  });
  if (normalizedRecordEntries.length === indexedEntries.length) {
    return toValuesFromIndexedArrayEntries(normalizedRecordEntries);
  }

  const keyFallbackRecordEntries = cloneObjectEntriesFromIndexedKeys(sourceValue);
  if (keyFallbackRecordEntries !== null && keyFallbackRecordEntries.length > 0) {
    return mergeIndexedEntriesByFirstSeen(
      normalizedRecordEntries,
      keyFallbackRecordEntries,
      capMergedRecordEntries
    );
  }

  return toValuesFromIndexedArrayEntries(normalizedRecordEntries);
};

const toStringArrayOrEmpty = (value) => {
  return toStringArrayOrNull(value) ?? [];
};

const toTrustedOptionArgsOverrideOrNull = (optionArgsOverride) => {
  if (!isArrayValue(optionArgsOverride)) {
    return null;
  }

  const clonedOptionArgs = cloneIndexedArraySafelyWithMetadata(optionArgsOverride);
  if (
    clonedOptionArgs === null ||
    clonedOptionArgs.fromIndexedFallback ||
    clonedOptionArgs.entries.some((entry) => {
      return typeof entry.value !== "string";
    })
  ) {
    return null;
  }

  return clonedOptionArgs.entries.map((entry) => {
    return entry.value;
  });
};

const resolveSupportedCliOptionsForValidation = (
  catalogSupportedCliOptions,
  precomputedSupportedCliOptions
) => {
  if (precomputedSupportedCliOptions === null) {
    return catalogSupportedCliOptions;
  }

  const normalizedPrecomputedSupportedCliOptionMetadata =
    normalizeCliOptionTokenListWithAvailability(precomputedSupportedCliOptions);
  const normalizedPrecomputedSupportedCliOptions =
    normalizedPrecomputedSupportedCliOptionMetadata.tokens;
  if (catalogSupportedCliOptions.length === 0) {
    return normalizedPrecomputedSupportedCliOptions;
  }

  const catalogSupportedCliOptionSet = new Set(catalogSupportedCliOptions);
  const filteredPrecomputedSupportedCliOptions =
    normalizedPrecomputedSupportedCliOptions.filter((optionToken) => {
      return catalogSupportedCliOptionSet.has(optionToken);
    });
  const precomputedSupportedCliOptionsContainUnknownTokens =
    filteredPrecomputedSupportedCliOptions.length <
    normalizedPrecomputedSupportedCliOptions.length;
  const precomputedSupportedCliOptionsHadArrayEntries =
    normalizedPrecomputedSupportedCliOptionMetadata.hadArrayEntries === true;
  const shouldFallbackToCatalogSupportedCliOptions =
    normalizedPrecomputedSupportedCliOptionMetadata.unavailable ||
    precomputedSupportedCliOptionsContainUnknownTokens ||
    (filteredPrecomputedSupportedCliOptions.length === 0 &&
      (normalizedPrecomputedSupportedCliOptions.length > 0 ||
        precomputedSupportedCliOptionsHadArrayEntries));

  return shouldFallbackToCatalogSupportedCliOptions
    ? catalogSupportedCliOptions
    : filteredPrecomputedSupportedCliOptions;
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
  const wasmPackCheckStatus = toKnownWasmPackStatus(wasmPackCheckStatusValue);
  const wasmPackCheckCommandValue = safeReadProperty(report, "wasmPackCheckCommand");
  const wasmPackCheckCommand = toTrimmedStringOrNull(wasmPackCheckCommandValue);
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
  const wasmPackCheckOutputLine = toSanitizedOutputLineOrNull(
    wasmPackCheckOutputLineValue
  );

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
  const keyPrefix = toTrimmedStringOrNull(prefix) ?? "";
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
  const clonedPayloadIssues = toStringArrayOrNull(payloadIssues);
  if (clonedPayloadIssues === null) {
    return null;
  }

  const seenPayloadIssues = new Set();
  const normalizedPayloadIssues = [];
  for (const payloadIssue of clonedPayloadIssues) {
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
  const exampleCommand = toTrimmedStringOrNull(exampleCommandValue);
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
    toNonNegativeFiniteNumberOrNull(exampleDurationMsValue);
  const exampleOutputLineValue = safeReadProperty(report, "exampleOutputLine");
  const exampleOutputLine = toSanitizedOutputLineOrNull(exampleOutputLineValue);
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
  const normalizedExampleStatus = toKnownTsCoreExampleStatus(exampleStatusValue);
  const exampleStatus =
    normalizedExampleStatus ??
    (exampleAttempted === null
      ? null
      : exampleAttempted
        ? exampleExitCode === 0 &&
          exampleRuleMatched === true &&
          examplePayloadValid === true
          ? "ok"
          : "failed"
        : "skipped");

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
  const keyPrefix = toTrimmedStringOrNull(prefix) ?? "";
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
  return toSanitizedOutputLineOrNull(output);
};
const isNumberVec3 = (value) => {
  return (
    isArrayValue(value) &&
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
  if (isArrayValue(parsedOutput)) {
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
    !isArrayValue(voxelValue);
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
      !isArrayValue(voxelRotationValue);
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
    !isArrayValue(lightValue);
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
    !isArrayValue(rotatedAabbValue);
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
  const normalizedDirectStatus = toKnownWasmPackStatus(directStatus);
  if (normalizedDirectStatus !== null) {
    return normalizedDirectStatus;
  }

  const checkStatusMap = safeReadProperty(report, "checkStatusMap");
  if (!isObjectRecord(checkStatusMap)) {
    return null;
  }

  const wasmPackStatus = safeReadProperty(checkStatusMap, "wasm-pack");
  const normalizedWasmPackStatus = toKnownWasmPackStatus(wasmPackStatus);
  if (normalizedWasmPackStatus !== null) {
    return normalizedWasmPackStatus;
  }

  for (const checkName of safeObjectKeys(checkStatusMap)) {
    if (checkName.trim().toLowerCase() !== "wasm-pack") {
      continue;
    }

    const mappedStatus = toKnownWasmPackStatus(
      safeReadProperty(checkStatusMap, checkName)
    );
    if (mappedStatus !== null) {
      return mappedStatus;
    }
  }

  return null;
};

export const deriveWasmPackCheckStatus = (wasmPackCheckMetadata = null) => {
  const wasmPackCheckExitCode = safeReadProperty(
    wasmPackCheckMetadata,
    "wasmPackCheckExitCode"
  );
  const wasmPackCheckReport = safeReadProperty(
    wasmPackCheckMetadata,
    "wasmPackCheckReport"
  );
  const reportStatus = extractWasmPackStatusFromReport(wasmPackCheckReport);
  if (reportStatus !== null) {
    return reportStatus;
  }

  const normalizedExitCode =
    toNonNegativeIntegerOrNull(wasmPackCheckExitCode);
  if (normalizedExitCode === null) {
    return "skipped";
  }

  if (normalizedExitCode === 0) {
    return "ok";
  }

  return "unavailable";
};

export const summarizeStepFailureResults = (steps) => {
  const clonedStepEntries = cloneIndexedArraySafelyWithMetadata(steps);
  const stepEntries = clonedStepEntries?.entries ?? [];
  const stepRecordEntries = toObjectRecordEntriesOrEmpty(
    steps,
    stepEntries,
    clonedStepEntries?.fromIndexedFallback === true
  );
  const failureSummaries = [];

  for (const step of stepRecordEntries) {
    const passed = safeReadProperty(step, "passed");
    if (passed !== false) {
      continue;
    }

    const skipped = safeReadProperty(step, "skipped");
    if (skipped !== false) {
      continue;
    }

    const name = toTrimmedStringOrNull(safeReadProperty(step, "name"));
    if (name === null) {
      continue;
    }

    const reportMessage = deriveFailureMessageFromReport(
      safeReadProperty(step, "report")
    );
    const outputMessage = toSanitizedOutputLineOrNull(
      safeReadProperty(step, "output")
    );
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
    const scriptNameValue = toTrimmedStringOrNull(
      safeReadProperty(step, "scriptName")
    );
    const stepIndexValue = safeReadProperty(step, "stepIndex");
    const checkCommandValue = toTrimmedStringOrNull(
      safeReadProperty(step, "checkCommand")
    );

    failureSummaries.push({
      name,
      scriptName: scriptNameValue ?? "",
      supportsNoBuild: safeReadProperty(step, "supportsNoBuild") === true,
      stepIndex: toNonNegativeIntegerOrNull(stepIndexValue),
      checkCommand: checkCommandValue ?? "",
      checkArgs,
      checkArgCount,
      exitCode: normalizedExitCode ?? 1,
      message: reportMessage ?? outputMessage ?? defaultMessage,
    });
  }

  return failureSummaries;
};

export const summarizeCheckFailureResults = (checks) => {
  const clonedCheckEntries = cloneIndexedArraySafelyWithMetadata(checks);
  const checkEntries = clonedCheckEntries?.entries ?? [];
  const checkRecordEntries = toObjectRecordEntriesOrEmpty(
    checks,
    checkEntries,
    clonedCheckEntries?.fromIndexedFallback === true
  );
  const failureSummaries = [];

  for (const check of checkRecordEntries) {
    const passed = safeReadProperty(check, "passed");
    if (passed !== false) {
      continue;
    }

    const name = toTrimmedStringOrNull(safeReadProperty(check, "name"));
    if (name === null) {
      continue;
    }

    const reportMessage = deriveFailureMessageFromReport(
      safeReadProperty(check, "report")
    );
    const outputMessage = toSanitizedOutputLineOrNull(
      safeReadProperty(check, "output")
    );
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
    const scriptNameValue = toTrimmedStringOrNull(
      safeReadProperty(check, "scriptName")
    );
    const checkCommandValue = toTrimmedStringOrNull(
      safeReadProperty(check, "checkCommand")
    );

    failureSummaries.push({
      name,
      scriptName: scriptNameValue ?? "",
      supportsNoBuild: safeReadProperty(check, "supportsNoBuild") === true,
      checkIndex,
      checkCommand: checkCommandValue ?? "",
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
    const normalizedToken = token.trim();
    if (normalizedToken.length === 0 || seenTokens.has(normalizedToken)) {
      continue;
    }

    seenTokens.add(normalizedToken);
    uniqueTokens.push(normalizedToken);
  }

  return uniqueTokens;
};

const normalizeCliOptionTokenList = (tokens) => {
  return dedupeStringList(toStringArrayOrEmpty(tokens));
};

const normalizeCliOptionTokenListWithAvailability = (tokens) => {
  if (!isArrayValue(tokens)) {
    const normalizedTokens = normalizeCliOptionTokenList(tokens);
    return {
      tokens: normalizedTokens,
      unavailable: tokens !== null && tokens !== undefined,
      hadArrayEntries: false,
    };
  }

  const clonedIndexedTokens = cloneIndexedArraySafelyWithMetadata(tokens);
  if (clonedIndexedTokens === null) {
    return {
      tokens: [],
      unavailable: true,
      hadArrayEntries: false,
    };
  }

  return {
    tokens: dedupeStringList(
      toStringArrayFromClonedIndexedEntries(tokens, clonedIndexedTokens)
    ),
    unavailable:
      clonedIndexedTokens.fromIndexedFallback ||
      clonedIndexedTokens.entries.some((entry) => {
        return typeof entry.value !== "string";
      }),
    hadArrayEntries: clonedIndexedTokens.entries.length > 0,
  };
};

const normalizeCliOptionAliases = (optionAliases) => {
  if (!isObjectRecord(optionAliases)) {
    return {};
  }

  const normalizedAliasMap = new Map();

  for (const canonicalOption of safeObjectKeys(optionAliases)) {
    const normalizedCanonicalOption = canonicalOption.trim();
    if (normalizedCanonicalOption.length === 0) {
      continue;
    }

    const aliases = safeReadProperty(optionAliases, canonicalOption);
    if (aliases === undefined) {
      continue;
    }

    const normalizedAliases = normalizeCliOptionTokenList(aliases);
    const existingAliases =
      normalizedAliasMap.get(normalizedCanonicalOption) ?? [];
    normalizedAliasMap.set(
      normalizedCanonicalOption,
      dedupeStringList([
        ...existingAliases,
        ...normalizedAliases,
      ])
    );
  }

  return Object.fromEntries(normalizedAliasMap.entries());
};

const createCanonicalOptionMapFromNormalizedMetadata = (
  normalizedCanonicalOptions,
  normalizedOptionAliases
) => {
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

const createSupportedCliOptionsFromNormalizedMetadata = (
  normalizedCanonicalOptions,
  normalizedOptionAliases
) => {
  return dedupeStringList([
    ...normalizedCanonicalOptions,
    ...Object.keys(normalizedOptionAliases),
    ...Object.values(normalizedOptionAliases).flat(),
  ]);
};

const readCliOptionConfigValue = (
  config,
  key,
  fallbackValue
) => {
  const configValue = safeReadProperty(config, key);
  return configValue === undefined ? fallbackValue : configValue;
};

export const createCliOptionCatalog = (optionMetadata = null) => {
  const canonicalOptions = readCliOptionConfigValue(
    optionMetadata,
    "canonicalOptions",
    []
  );
  const optionAliases = readCliOptionConfigValue(
    optionMetadata,
    "optionAliases",
    {}
  );
  const normalizedCanonicalOptions = normalizeCliOptionTokenList(canonicalOptions);
  const normalizedOptionAliases = normalizeCliOptionAliases(optionAliases);
  const supportedCliOptions = createSupportedCliOptionsFromNormalizedMetadata(
    normalizedCanonicalOptions,
    normalizedOptionAliases
  );
  const canonicalOptionMap = createCanonicalOptionMapFromNormalizedMetadata(
    normalizedCanonicalOptions,
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

const createCanonicalOptionSnapshotFromCatalog = (optionCatalog) => {
  const availableCliOptionCanonicalMap = safeReadProperty(
    optionCatalog,
    "availableCliOptionCanonicalMap"
  );
  if (!isObjectRecord(availableCliOptionCanonicalMap)) {
    return [];
  }

  const canonicalOptionTokens = Object.values(availableCliOptionCanonicalMap).filter(
    (optionToken) => typeof optionToken === "string"
  );
  return dedupeStringList(canonicalOptionTokens);
};

const normalizeCliOptionCanonicalMapEntries = (
  availableCliOptionCanonicalMap
) => {
  if (!isObjectRecord(availableCliOptionCanonicalMap)) {
    return [];
  }

  const normalizedEntries = [];
  for (const optionToken of safeObjectKeys(availableCliOptionCanonicalMap)) {
    const normalizedOptionToken = optionToken.trim();
    if (normalizedOptionToken.length === 0) {
      continue;
    }

    const canonicalOption = toTrimmedStringOrNull(
      safeReadProperty(availableCliOptionCanonicalMap, optionToken)
    );
    if (canonicalOption === null) {
      continue;
    }

    normalizedEntries.push([normalizedOptionToken, canonicalOption]);
  }

  return normalizedEntries;
};

const mergeNormalizedCliOptionAliases = (
  normalizedOptionAliases,
  fallbackOptionAliases
) => {
  const mergedOptionAliases = new Map();
  const mergeAliasEntries = (optionAliases) => {
    for (const [canonicalOption, aliases] of Object.entries(optionAliases)) {
      const existingAliases = mergedOptionAliases.get(canonicalOption) ?? [];
      mergedOptionAliases.set(
        canonicalOption,
        dedupeStringList([
          ...existingAliases,
          ...aliases,
        ])
      );
    }
  };

  mergeAliasEntries(normalizedOptionAliases);
  mergeAliasEntries(fallbackOptionAliases);

  return Object.fromEntries(mergedOptionAliases.entries());
};

const createNormalizedCliOptionAliasesFromCanonicalMapEntries = (
  normalizedCanonicalMapEntries
) => {
  return Object.fromEntries(
    Array.from(
      normalizedCanonicalMapEntries
        .filter((entry) => entry[0] !== entry[1])
        .reduce((aliasEntries, entry) => {
          const [optionToken, canonicalOption] = entry;
          const existingAliases = aliasEntries.get(canonicalOption) ?? [];
          aliasEntries.set(
            canonicalOption,
            dedupeStringList([
              ...existingAliases,
              optionToken,
            ])
          );
          return aliasEntries;
        }, new Map())
        .entries()
    ).sort((entryA, entryB) => {
      return entryA[0].localeCompare(entryB[0]);
    })
  );
};

const toNormalizedCliOptionCatalogOrNull = (optionCatalog) => {
  if (!isObjectRecord(optionCatalog)) {
    return null;
  }

  const supportedCliOptions = normalizeCliOptionTokenList(
    safeReadProperty(optionCatalog, "supportedCliOptions")
  );
  const normalizedOptionAliases = normalizeCliOptionAliases(
    safeReadProperty(optionCatalog, "availableCliOptionAliases")
  );
  const normalizedCanonicalMapEntries = normalizeCliOptionCanonicalMapEntries(
    safeReadProperty(optionCatalog, "availableCliOptionCanonicalMap")
  );
  const catalogCanonicalOptions = dedupeStringList(
    normalizedCanonicalMapEntries.map((entry) => entry[1])
  );
  const fallbackOptionAliases = createNormalizedCliOptionAliasesFromCanonicalMapEntries(
    normalizedCanonicalMapEntries
  );
  const availableCliOptionAliases = mergeNormalizedCliOptionAliases(
    normalizedOptionAliases,
    fallbackOptionAliases
  );
  const hasCanonicalCatalogData =
    catalogCanonicalOptions.length > 0 ||
    Object.keys(availableCliOptionAliases).length > 0;
  if (!hasCanonicalCatalogData) {
    return null;
  }

  const derivedSupportedCliOptions = createSupportedCliOptionsFromNormalizedMetadata(
    catalogCanonicalOptions,
    availableCliOptionAliases
  );
  const derivedSupportedCliOptionSet = new Set(derivedSupportedCliOptions);
  const sanitizedSupportedCliOptions = supportedCliOptions.filter((optionToken) => {
    return derivedSupportedCliOptionSet.has(optionToken);
  });
  const resolvedSupportedCliOptions =
    supportedCliOptions.length > 0
      ? dedupeStringList([
          ...sanitizedSupportedCliOptions,
          ...derivedSupportedCliOptions,
        ])
      : derivedSupportedCliOptions;
  const hasCatalogData = resolvedSupportedCliOptions.length > 0;
  if (!hasCatalogData) {
    return null;
  }

  return {
    supportedCliOptions: resolvedSupportedCliOptions,
    availableCliOptionAliases,
    catalogCanonicalOptions,
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

const isLikelyShortOptionToken = (optionToken) => {
  return /^-[A-Za-z](?:=.*)?$/.test(optionToken);
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

  if (isKnownOptionTokenLike(nextArg, canonicalOptionMap)) {
    return false;
  }

  return !isLikelyShortOptionToken(nextArg);
};

const resolveCanonicalOptionTokens = (optionTokens, canonicalOptionMap) => {
  return optionTokens
    .map((optionToken) => {
      return canonicalOptionMap.get(optionToken);
    })
    .filter((canonicalOption) => {
      return canonicalOption !== undefined;
    });
};

const toNormalizedCliOptionTokenMetadata = (
  normalizedTokenMetadata,
  fallbackTokens
) => {
  if (isObjectRecord(normalizedTokenMetadata)) {
    const metadataTokens = safeReadProperty(normalizedTokenMetadata, "tokens");
    const metadataUnavailable = safeReadProperty(
      normalizedTokenMetadata,
      "unavailable"
    );
    if (isArrayValue(metadataTokens) && typeof metadataUnavailable === "boolean") {
      const normalizedMetadataTokensWithAvailability =
        normalizeCliOptionTokenListWithAvailability(metadataTokens);
      const metadataOverrideIsInconsistent =
        metadataUnavailable === false &&
        (
          normalizedMetadataTokensWithAvailability.unavailable ||
          (
            normalizedMetadataTokensWithAvailability.hadArrayEntries === true &&
            normalizedMetadataTokensWithAvailability.tokens.length === 0
          )
        );
      if (metadataOverrideIsInconsistent) {
        return normalizeCliOptionTokenListWithAvailability(fallbackTokens);
      }

      return {
        tokens: normalizedMetadataTokensWithAvailability.tokens,
        unavailable:
          metadataUnavailable || normalizedMetadataTokensWithAvailability.unavailable,
      };
    }
  }

  return normalizeCliOptionTokenListWithAvailability(fallbackTokens);
};

const createValueOptionMetadataFromNormalizedTokenMetadata = (
  valueOptionTokenMetadata,
  strictValueOptionTokenMetadata,
  canonicalOptionMap
) => {
  const {
    tokens: normalizedOptionsWithValues,
    unavailable: valueOptionsUnavailable,
  } = valueOptionTokenMetadata;
  const {
    tokens: normalizedOptionsWithStrictValues,
    unavailable: strictValueOptionsUnavailable,
  } = strictValueOptionTokenMetadata;
  let canonicalValueOptions = new Set(
    resolveCanonicalOptionTokens(normalizedOptionsWithValues, canonicalOptionMap)
  );
  const valueOptionMetadataUnresolved =
    normalizedOptionsWithValues.length > 0 && canonicalValueOptions.size === 0;
  if (
    (valueOptionsUnavailable || valueOptionMetadataUnresolved) &&
    normalizedOptionsWithStrictValues.length > 0
  ) {
    const fallbackStrictValueOptions = new Set(
      resolveCanonicalOptionTokens(
        normalizedOptionsWithStrictValues,
        canonicalOptionMap
      )
    );
    canonicalValueOptions = new Set([
      ...canonicalValueOptions,
      ...fallbackStrictValueOptions,
    ]);
  }
  const resolvedCanonicalStrictValueOptions = resolveCanonicalOptionTokens(
    normalizedOptionsWithStrictValues,
    canonicalOptionMap
  );
  const hasRecoverableStrictValueOptions =
    resolvedCanonicalStrictValueOptions.length > 0;
  if (
    canonicalValueOptions.size === 0 &&
    hasRecoverableStrictValueOptions
  ) {
    canonicalValueOptions = new Set(resolvedCanonicalStrictValueOptions);
  }
  let canonicalStrictValueOptions = new Set(
    resolvedCanonicalStrictValueOptions.filter((strictValueOption) => {
      return canonicalValueOptions.has(strictValueOption);
    })
  );
  const strictValueMetadataUnresolved =
    normalizedOptionsWithStrictValues.length > 0 &&
    !hasRecoverableStrictValueOptions;
  const strictMetadataUnavailableWithoutRecoverableTokens =
    strictValueOptionsUnavailable && !hasRecoverableStrictValueOptions;
  const strictFallbackRequiresAllValueOptions =
    (strictMetadataUnavailableWithoutRecoverableTokens ||
      strictValueMetadataUnresolved) &&
    canonicalValueOptions.size > 0;
  const unavailableValueMetadataRequiresStrictFallback =
    canonicalStrictValueOptions.size === 0 &&
    valueOptionsUnavailable &&
    canonicalValueOptions.size > 0;
  if (
    strictFallbackRequiresAllValueOptions ||
    unavailableValueMetadataRequiresStrictFallback
  ) {
    canonicalStrictValueOptions = new Set(canonicalValueOptions);
  }
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
  optionMetadata = null
) => {
  const canonicalOptions = readCliOptionConfigValue(
    optionMetadata,
    "canonicalOptions",
    []
  );
  const optionAliases = readCliOptionConfigValue(
    optionMetadata,
    "optionAliases",
    {}
  );
  const optionsWithValues = readCliOptionConfigValue(
    optionMetadata,
    "optionsWithValues",
    []
  );
  const optionsWithStrictValues = readCliOptionConfigValue(
    optionMetadata,
    "optionsWithStrictValues",
    []
  );
  const valueOptionTokenMetadata = readCliOptionConfigValue(
    optionMetadata,
    "valueOptionTokenMetadata",
    null
  );
  const strictValueOptionTokenMetadata = readCliOptionConfigValue(
    optionMetadata,
    "strictValueOptionTokenMetadata",
    null
  );
  const normalizedOptionArgs = readCliOptionConfigValue(
    optionMetadata,
    "optionArgs",
    null
  );
  const optionArgsFromOverride =
    toTrustedOptionArgsOverrideOrNull(normalizedOptionArgs);
  const optionArgs =
    optionArgsFromOverride === null
      ? splitCliArgs(args).optionArgs
      : optionArgsFromOverride;
  const normalizedCanonicalOptions = normalizeCliOptionTokenList(canonicalOptions);
  const normalizedOptionAliases = normalizeCliOptionAliases(optionAliases);
  const canonicalOptionMap = createCanonicalOptionMapFromNormalizedMetadata(
    normalizedCanonicalOptions,
    normalizedOptionAliases
  );
  const normalizedValueOptionTokenMetadata = toNormalizedCliOptionTokenMetadata(
    valueOptionTokenMetadata,
    optionsWithValues
  );
  const normalizedStrictValueOptionTokenMetadata =
    toNormalizedCliOptionTokenMetadata(
      strictValueOptionTokenMetadata,
      optionsWithStrictValues
    );
  const {
    canonicalValueOptions,
    canonicalStrictValueOptions,
    inlineValueTokenCanonicalMap,
  } = createValueOptionMetadataFromNormalizedTokenMetadata(
    normalizedValueOptionTokenMetadata,
    normalizedStrictValueOptionTokenMetadata,
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
  optionMetadata = null
) => {
  const canonicalOptions = readCliOptionConfigValue(
    optionMetadata,
    "canonicalOptions",
    []
  );
  const optionAliases = readCliOptionConfigValue(
    optionMetadata,
    "optionAliases",
    {}
  );
  const optionsWithValues = readCliOptionConfigValue(
    optionMetadata,
    "optionsWithValues",
    []
  );
  const optionsWithStrictValues = readCliOptionConfigValue(
    optionMetadata,
    "optionsWithStrictValues",
    []
  );
  const valueOptionTokenMetadata = readCliOptionConfigValue(
    optionMetadata,
    "valueOptionTokenMetadata",
    null
  );
  const strictValueOptionTokenMetadata = readCliOptionConfigValue(
    optionMetadata,
    "strictValueOptionTokenMetadata",
    null
  );
  const optionArgs = readCliOptionConfigValue(
    optionMetadata,
    "optionArgs",
    null
  );
  const outputPathError = readCliOptionConfigValue(
    optionMetadata,
    "outputPathError",
    null
  );
  const precomputedSupportedCliOptions = readCliOptionConfigValue(
    optionMetadata,
    "supportedCliOptions",
    null
  );
  const optionCatalog = readCliOptionConfigValue(
    optionMetadata,
    "optionCatalog",
    null
  );
  const normalizedOptionCatalogOverride =
    toNormalizedCliOptionCatalogOrNull(optionCatalog);
  const resolvedOptionCatalog =
    normalizedOptionCatalogOverride ??
    createCliOptionCatalog({
      canonicalOptions,
      optionAliases,
    });
  const catalogCanonicalOptions =
    normalizedOptionCatalogOverride === null
      ? createCanonicalOptionSnapshotFromCatalog(resolvedOptionCatalog)
      : normalizedOptionCatalogOverride.catalogCanonicalOptions;
  const catalogOptionAliases =
    normalizedOptionCatalogOverride === null
      ? resolvedOptionCatalog.availableCliOptionAliases
      : normalizedOptionCatalogOverride.availableCliOptionAliases;
  const catalogSupportedCliOptions =
    normalizedOptionCatalogOverride === null
      ? resolvedOptionCatalog.supportedCliOptions
      : normalizedOptionCatalogOverride.supportedCliOptions;
  const supportedCliOptions = resolveSupportedCliOptionsForValidation(
    catalogSupportedCliOptions,
    precomputedSupportedCliOptions
  );
  const unknownOptions = parseUnknownCliOptions(args, {
    canonicalOptions: catalogCanonicalOptions,
    optionAliases: catalogOptionAliases,
    optionsWithValues,
    optionsWithStrictValues,
    valueOptionTokenMetadata,
    strictValueOptionTokenMetadata,
    optionArgs,
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

export const deriveCliValidationFailureMessage = (
  failureMetadata = null
) => {
  const outputPathError = readCliOptionConfigValue(
    failureMetadata,
    "outputPathError",
    null
  );
  const unsupportedOptionsError = readCliOptionConfigValue(
    failureMetadata,
    "unsupportedOptionsError",
    null
  );
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
  optionMetadata = null
) => {
  const canonicalOptions = readCliOptionConfigValue(
    optionMetadata,
    "canonicalOptions",
    []
  );
  const optionAliases = readCliOptionConfigValue(
    optionMetadata,
    "optionAliases",
    {}
  );
  const optionsWithValues = readCliOptionConfigValue(
    optionMetadata,
    "optionsWithValues",
    []
  );
  const optionsWithStrictValues = readCliOptionConfigValue(
    optionMetadata,
    "optionsWithStrictValues",
    []
  );
  const valueOptionTokenMetadata = readCliOptionConfigValue(
    optionMetadata,
    "valueOptionTokenMetadata",
    null
  );
  const strictValueOptionTokenMetadata = readCliOptionConfigValue(
    optionMetadata,
    "strictValueOptionTokenMetadata",
    null
  );
  const normalizedOptionArgs = readCliOptionConfigValue(
    optionMetadata,
    "optionArgs",
    null
  );
  const optionArgsFromOverride =
    toTrustedOptionArgsOverrideOrNull(normalizedOptionArgs);
  const optionArgs =
    optionArgsFromOverride === null
      ? splitCliArgs(args).optionArgs
      : optionArgsFromOverride;
  const normalizedCanonicalOptions = normalizeCliOptionTokenList(canonicalOptions);
  const normalizedOptionAliases = normalizeCliOptionAliases(optionAliases);
  const canonicalOptionMap = createCanonicalOptionMapFromNormalizedMetadata(
    normalizedCanonicalOptions,
    normalizedOptionAliases
  );
  const normalizedValueOptionTokenMetadata = toNormalizedCliOptionTokenMetadata(
    valueOptionTokenMetadata,
    optionsWithValues
  );
  const normalizedStrictValueOptionTokenMetadata =
    toNormalizedCliOptionTokenMetadata(
      strictValueOptionTokenMetadata,
      optionsWithStrictValues
    );
  const {
    canonicalValueOptions,
    canonicalStrictValueOptions,
    inlineValueTokenCanonicalMap,
  } = createValueOptionMetadataFromNormalizedTokenMetadata(
    normalizedValueOptionTokenMetadata,
    normalizedStrictValueOptionTokenMetadata,
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

  const canonicalOptionCandidates = createSupportedCliOptionsFromNormalizedMetadata(
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
  optionMetadata = null
) => {
  const canonicalOptions = readCliOptionConfigValue(
    optionMetadata,
    "canonicalOptions",
    []
  );
  const optionAliases = readCliOptionConfigValue(
    optionMetadata,
    "optionAliases",
    {}
  );
  const optionsWithValues = readCliOptionConfigValue(
    optionMetadata,
    "optionsWithValues",
    []
  );
  const optionsWithStrictValues = readCliOptionConfigValue(
    optionMetadata,
    "optionsWithStrictValues",
    []
  );
  const outputPathError = readCliOptionConfigValue(
    optionMetadata,
    "outputPathError",
    null
  );
  const { optionArgs } = splitCliArgs(args);
  const optionCatalog = createCliOptionCatalog({
    canonicalOptions,
    optionAliases,
  });
  const catalogCanonicalOptions =
    createCanonicalOptionSnapshotFromCatalog(optionCatalog);
  const catalogOptionAliases = optionCatalog.availableCliOptionAliases;
  const valueOptionTokenMetadata = normalizeCliOptionTokenListWithAvailability(
    optionsWithValues
  );
  const strictValueOptionTokenMetadata =
    normalizeCliOptionTokenListWithAvailability(optionsWithStrictValues);
  const optionValidation = createCliOptionValidation(args, {
    optionCatalog,
    canonicalOptions: catalogCanonicalOptions,
    optionAliases: catalogOptionAliases,
    optionsWithValues,
    optionsWithStrictValues,
    valueOptionTokenMetadata,
    strictValueOptionTokenMetadata,
    optionArgs,
    outputPathError,
  });
  const activeOptionMetadata = parseActiveCliOptionMetadata(args, {
    canonicalOptions: catalogCanonicalOptions,
    optionAliases: catalogOptionAliases,
    optionsWithValues,
    optionsWithStrictValues,
    valueOptionTokenMetadata,
    strictValueOptionTokenMetadata,
    optionArgs,
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
  const normalizedOptionName = toTrimmedStringOrNull(optionName);
  if (normalizedOptionName === null) {
    return {
      hasOption: false,
      value: null,
      error: null,
    };
  }

  const { optionArgs } = splitCliArgs(args);
  const normalizedRecognizedOptionTokenMetadata =
    normalizeCliOptionTokenListWithAvailability(recognizedOptionTokens);
  const normalizedRecognizedOptionTokens =
    normalizedRecognizedOptionTokenMetadata.tokens;
  const recognizedOptionTokensUnavailable =
    normalizedRecognizedOptionTokenMetadata.unavailable ||
    (normalizedRecognizedOptionTokenMetadata.hadArrayEntries === true &&
      normalizedRecognizedOptionTokens.length === 0);
  const recognizedOptionTokenSet = new Set(
    normalizedRecognizedOptionTokens
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
  const inlineOptionPrefix = `${normalizedOptionName}=`;
  let hasOption = false;
  let resolvedValue = null;
  let missingValue = false;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const token = optionArgs[index];

    if (token === normalizedOptionName) {
      hasOption = true;
      const nextArg = optionArgs[index + 1] ?? null;
      if (
        nextArg === null ||
        nextArg.startsWith("--") ||
        (recognizedOptionTokensUnavailable && isLikelyShortOptionToken(nextArg)) ||
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
    error:
      hasOption && missingValue
        ? `Missing value for ${normalizedOptionName} option.`
        : null,
  };
};

export const resolveOutputPath = (
  args,
  cwd = null,
  recognizedOptionTokens = []
) => {
  const resolveFallbackCwd = () => {
    try {
      const processCwd = process.cwd();
      if (typeof processCwd === "string" && processCwd.length > 0) {
        return processCwd;
      }
    } catch {
      // fall through to root fallback
    }

    try {
      const executableRoot = path.parse(process.execPath).root;
      if (typeof executableRoot === "string" && executableRoot.length > 0) {
        return executableRoot;
      }
    } catch {
      // fall through to static root fallback
    }

    return "/";
  };

  const resolvedCwd =
    typeof cwd === "string" && cwd.length > 0 ? cwd : resolveFallbackCwd();
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

  let resolvedOutputPath = null;
  try {
    resolvedOutputPath = path.resolve(resolvedCwd, outputPathValue.value);
  } catch {
    resolvedOutputPath = path.resolve(resolveFallbackCwd(), outputPathValue.value);
  }

  return {
    outputPath: resolvedOutputPath,
    error: null,
  };
};

const FALLBACK_UNPRINTABLE_OUTPUT_PATH = "(unprintable output path)";

const toOutputPathMessageValue = (outputPath) => {
  if (typeof outputPath === "string") {
    return outputPath.length > 0
      ? outputPath
      : FALLBACK_UNPRINTABLE_OUTPUT_PATH;
  }

  if (
    typeof outputPath === "number" ||
    typeof outputPath === "boolean" ||
    typeof outputPath === "bigint" ||
    typeof outputPath === "symbol"
  ) {
    try {
      const normalizedOutputPath = String(outputPath);
      return normalizedOutputPath.length > 0
        ? normalizedOutputPath
        : FALLBACK_UNPRINTABLE_OUTPUT_PATH;
    } catch {
      return FALLBACK_UNPRINTABLE_OUTPUT_PATH;
    }
  }

  const wrappedPrimitiveOutputPath = toPrimitiveWrapperStringOrNull(outputPath);
  if (wrappedPrimitiveOutputPath !== null) {
    return wrappedPrimitiveOutputPath;
  }

  return FALLBACK_UNPRINTABLE_OUTPUT_PATH;
};

const toErrorMessageDetail = (error) => {
  let isErrorValue = false;
  try {
    isErrorValue = error instanceof Error;
  } catch {
    isErrorValue = false;
  }

  if (!isErrorValue) {
    return "";
  }

  let messageValue = "";
  try {
    messageValue = error.message;
  } catch {
    return "";
  }

  return typeof messageValue === "string" && messageValue.length > 0
    ? ` ${messageValue}`
    : "";
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
    const detail = toErrorMessageDetail(error);
    return `Failed to write report to ${toOutputPathMessageValue(outputPath)}.${detail}`;
  }
};

const createWriteFailureReportSnapshot = (report, outputPath, writeError) => {
  return {
    ...toReportSnapshotOrEmpty(report),
    passed: false,
    exitCode: 1,
    outputPath: toOutputPathMessageValue(outputPath),
    writeError,
    message: writeError,
  };
};

const toTimedWriteFailureReportSnapshot = (writeFailureReport, buildTimedReport) => {
  if (typeof buildTimedReport !== "function") {
    return writeFailureReport;
  }

  try {
    const timedReportSnapshot = toReportSnapshotOrEmpty(
      buildTimedReport(writeFailureReport)
    );
    if (Object.keys(timedReportSnapshot).length === 0) {
      return writeFailureReport;
    }

    return {
      ...writeFailureReport,
      ...timedReportSnapshot,
    };
  } catch {
    return writeFailureReport;
  }
};

const readReportSerializationConfigValue = (
  serializationOptions,
  key,
  fallbackValue
) => {
  const configValue = safeReadProperty(serializationOptions, key);
  return configValue === undefined ? fallbackValue : configValue;
};

export const serializeReportWithOptionalWrite = (
  report,
  serializationOptions = null
) => {
  const jsonFormat = readReportSerializationConfigValue(
    serializationOptions,
    "jsonFormat",
    undefined
  );
  const outputPath = readReportSerializationConfigValue(
    serializationOptions,
    "outputPath",
    null
  );
  const buildTimedReport = readReportSerializationConfigValue(
    serializationOptions,
    "buildTimedReport",
    null
  );
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

  const writeFailureReport = createWriteFailureReportSnapshot(
    report,
    outputPath,
    writeError
  );
  const timedWriteFailureReport = toTimedWriteFailureReportSnapshot(
    writeFailureReport,
    buildTimedReport
  );

  return {
    reportJson: toReportJson(timedWriteFailureReport, jsonFormat),
    writeError,
  };
};
