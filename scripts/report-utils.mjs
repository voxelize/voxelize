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

export const resolveOutputPath = (args, cwd = process.cwd()) => {
  const outputArgIndex = args.indexOf("--output");
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
  } catch {
    return `Failed to write report to ${outputPath}.`;
  }
};
