import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseJsonOutput, toReportJson } from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliArgs = process.argv.slice(2);
const isNoBuild = cliArgs.includes("--no-build");
const outputArgIndex = cliArgs.indexOf("--output");
const requestedOutputPath =
  outputArgIndex === -1 ? null : cliArgs[outputArgIndex + 1] ?? null;
const resolvedOutputPath =
  requestedOutputPath === null
    ? null
    : path.resolve(process.cwd(), requestedOutputPath);

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

if (outputArgIndex !== -1 && requestedOutputPath === null) {
  console.log(
    toReportJson({
      passed: false,
      exitCode: 1,
      noBuild: isNoBuild,
      platform,
      nodeVersion,
      startedAt,
      durationMs: 0,
      checks: [],
      outputPath: null,
      message: "Missing value for --output option.",
    })
  );
  process.exit(1);
}

const checks = [
  runCheck("devEnvironment", "check-dev-env.mjs"),
  runCheck("wasmPack", "check-wasm-pack.mjs"),
  runCheck("client", "check-client.mjs", isNoBuild ? ["--no-build"] : []),
];

const passed = checks.every((check) => check.passed);
const exitCode = passed ? 0 : 1;
const passedChecks = checks.filter((check) => check.passed).map((check) => check.name);
const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);
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
  durationMs: Date.now() - aggregateStartMs,
  passedChecks,
  failedChecks,
  failureSummaries,
  checks,
  outputPath: resolvedOutputPath,
};
const reportJson = toReportJson(report);

if (resolvedOutputPath !== null) {
  try {
    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    fs.writeFileSync(resolvedOutputPath, reportJson);
  } catch {
    console.log(
      toReportJson({
        ...report,
        passed: false,
        exitCode: 1,
        message: `Failed to write preflight report to ${resolvedOutputPath}.`,
      })
    );
    process.exit(1);
  }
}

console.log(reportJson);

process.exit(exitCode);
