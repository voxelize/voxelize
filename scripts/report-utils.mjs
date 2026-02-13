import fs from "node:fs";
import path from "node:path";

export const REPORT_SCHEMA_VERSION = 1;

export const parseJsonOutput = (value) => {
  if (value.length === 0) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
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

export const resolveOutputPath = (args, cwd = process.cwd()) => {
  const outputArgIndex = args.lastIndexOf("--output");
  if (outputArgIndex === -1) {
    return {
      outputPath: null,
      error: null,
    };
  }

  const outputArgValue = args[outputArgIndex + 1] ?? null;
  if (outputArgValue === null || outputArgValue.startsWith("--")) {
    return {
      outputPath: null,
      error: "Missing value for --output option.",
    };
  }

  return {
    outputPath: path.resolve(cwd, outputArgValue),
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
