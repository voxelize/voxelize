import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTimedReportBuilder,
  deriveFailureMessageFromReport,
  parseJsonOutput,
  resolveOutputPath,
  summarizeCheckResults,
  toReportJson,
  writeReportToPath,
} from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliArgs = process.argv.slice(2);
const isNoBuild = cliArgs.includes("--no-build");
const isCompact = cliArgs.includes("--compact");
const jsonFormat = { compact: isCompact };
const { outputPath: resolvedOutputPath, error: outputPathError } =
  resolveOutputPath(cliArgs);
const onlyArgIndex = cliArgs.lastIndexOf("--only");
const buildTimedReport = createTimedReportBuilder();

const availableChecks = [
  {
    name: "devEnvironment",
    scriptName: "check-dev-env.mjs",
    extraArgs: [],
  },
  {
    name: "wasmPack",
    scriptName: "check-wasm-pack.mjs",
    extraArgs: [],
  },
  {
    name: "client",
    scriptName: "check-client.mjs",
    extraArgs: isNoBuild ? ["--no-build"] : [],
  },
];
const availableCheckNames = availableChecks.map((check) => check.name);

const parseSelectedChecks = () => {
  if (onlyArgIndex === -1) {
    return {
      selectedChecks: availableCheckNames,
      error: null,
    };
  }

  const onlyValue = cliArgs[onlyArgIndex + 1] ?? null;
  if (onlyValue === null || onlyValue.startsWith("--")) {
    return {
      selectedChecks: [],
      error: "Missing value for --only option.",
    };
  }

  const parsedChecks = Array.from(
    new Set(
      onlyValue
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );

  if (parsedChecks.length === 0) {
    return {
      selectedChecks: [],
      error: "Missing value for --only option.",
    };
  }

  const unknownChecks = parsedChecks.filter((value) => {
    return !availableCheckNames.includes(value);
  });

  if (unknownChecks.length > 0) {
    return {
      selectedChecks: [],
      error: `Invalid check name(s): ${unknownChecks.join(", ")}.`,
    };
  }

  const parsedCheckSet = new Set(parsedChecks);
  const normalizedChecks = availableCheckNames.filter((value) => {
    return parsedCheckSet.has(value);
  });

  return {
    selectedChecks: normalizedChecks,
    error: null,
  };
};
const { selectedChecks, error: selectedChecksError } = parseSelectedChecks();

const runCheck = (name, scriptName, extraArgs = []) => {
  const checkStartMs = Date.now();
  const scriptPath = path.resolve(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, "--json", ...extraArgs], {
    cwd: __dirname,
    encoding: "utf8",
    shell: false,
  });

  const exitCode = result.status ?? 1;
  const output = `${result.stdout}${result.stderr}`.trim();
  const report = parseJsonOutput(output);

  return {
    name,
    passed: exitCode === 0,
    exitCode,
    durationMs: Date.now() - checkStartMs,
    report,
    output: report === null ? output : null,
  };
};

const platform = process.platform;
const nodeVersion = process.version;

if (outputPathError !== null || selectedChecksError !== null) {
  const report = buildTimedReport({
    passed: false,
    exitCode: 1,
    noBuild: isNoBuild,
    platform,
    nodeVersion,
    selectedChecks: [],
    skippedChecks: availableCheckNames,
    totalChecks: 0,
    passedCheckCount: 0,
    failedCheckCount: 0,
    firstFailedCheck: null,
    checks: [],
    outputPath: outputPathError === null ? resolvedOutputPath : null,
    message: outputPathError ?? selectedChecksError,
    availableChecks: availableCheckNames,
  });
  const reportJson = toReportJson(report, jsonFormat);

  if (outputPathError === null && resolvedOutputPath !== null) {
    const writeError = writeReportToPath(reportJson, resolvedOutputPath);
    if (writeError !== null) {
      console.log(
        toReportJson(
          buildTimedReport({
            ...report,
            passed: false,
            exitCode: 1,
            message: writeError,
          }),
          jsonFormat
        )
      );
      process.exit(1);
    }
  }

  console.log(reportJson);
  process.exit(1);
}

const selectedCheckSet = new Set(selectedChecks);
const skippedChecks = availableCheckNames.filter((checkName) => {
  return !selectedCheckSet.has(checkName);
});
const checks = availableChecks
  .filter((check) => selectedCheckSet.has(check.name))
  .map((check) => {
    return runCheck(check.name, check.scriptName, check.extraArgs);
  });

const passed = checks.every((check) => check.passed);
const exitCode = passed ? 0 : 1;
const checkSummary = summarizeCheckResults(checks);
const failureSummaries = checks
  .filter((check) => !check.passed)
  .map((check) => {
    const reportMessage = deriveFailureMessageFromReport(check.report);

    return {
      name: check.name,
      exitCode: check.exitCode,
      message:
        reportMessage ??
        check.output ??
        `Preflight check failed with exit code ${check.exitCode}.`,
    };
  });
const report = buildTimedReport({
  passed,
  exitCode,
  noBuild: isNoBuild,
  platform,
  nodeVersion,
  selectedChecks,
  skippedChecks,
  ...checkSummary,
  failureSummaries,
  checks,
  outputPath: resolvedOutputPath,
  availableChecks: availableCheckNames,
});
const reportJson = toReportJson(report, jsonFormat);

if (resolvedOutputPath !== null) {
  const writeError = writeReportToPath(reportJson, resolvedOutputPath);
  if (writeError !== null) {
    console.log(
      toReportJson({
        ...report,
        passed: false,
        exitCode: 1,
        message: writeError,
      }, jsonFormat)
    );
    process.exit(1);
  }
}

console.log(reportJson);

process.exit(exitCode);
