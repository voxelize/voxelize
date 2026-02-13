import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseJsonOutput,
  resolveOutputPath,
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
const onlyArgIndex = cliArgs.indexOf("--only");

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

  return {
    selectedChecks: parsedChecks,
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

const startedAt = new Date().toISOString();
const aggregateStartMs = Date.now();
const platform = process.platform;
const nodeVersion = process.version;

if (outputPathError !== null || selectedChecksError !== null) {
  const endedAt = new Date().toISOString();
  console.log(
    toReportJson({
      passed: false,
      exitCode: 1,
      noBuild: isNoBuild,
      platform,
      nodeVersion,
      startedAt,
      endedAt,
      durationMs: 0,
      selectedChecks: [],
      skippedChecks: availableCheckNames,
      totalChecks: 0,
      passedCheckCount: 0,
      failedCheckCount: 0,
      firstFailedCheck: null,
      checks: [],
      outputPath: null,
      message: outputPathError ?? selectedChecksError,
      availableChecks: availableCheckNames,
    }, jsonFormat)
  );
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
const passedChecks = checks.filter((check) => check.passed).map((check) => check.name);
const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);
const totalChecks = checks.length;
const passedCheckCount = passedChecks.length;
const failedCheckCount = failedChecks.length;
const firstFailedCheck = failedChecks[0] ?? null;
const deriveFailureMessage = (report) => {
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
const failureSummaries = checks
  .filter((check) => !check.passed)
  .map((check) => {
    const reportMessage = deriveFailureMessage(check.report);

    return {
      name: check.name,
      exitCode: check.exitCode,
      message:
        reportMessage ??
        check.output ??
        `Preflight check failed with exit code ${check.exitCode}.`,
    };
  });
const report = {
  passed,
  exitCode,
  noBuild: isNoBuild,
  platform,
  nodeVersion,
  startedAt,
  endedAt: new Date().toISOString(),
  durationMs: Date.now() - aggregateStartMs,
  selectedChecks,
  skippedChecks,
  totalChecks,
  passedCheckCount,
  failedCheckCount,
  firstFailedCheck,
  passedChecks,
  failedChecks,
  failureSummaries,
  checks,
  outputPath: resolvedOutputPath,
  availableChecks: availableCheckNames,
};
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
