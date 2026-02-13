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
const isQuiet = cliArgs.includes("--quiet");
const isJson = cliArgs.includes("--json");
const isNoBuild = cliArgs.includes("--no-build");
const isCompact = cliArgs.includes("--compact");
const jsonFormat = { compact: isCompact };
const { outputPath, error: outputPathError } = resolveOutputPath(cliArgs);
const startedAt = new Date().toISOString();
const startedAtMs = Date.now();
const stepResults = [];
let exitCode = 0;

const buildTimedReport = (report) => {
  return {
    ...report,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
  };
};

if (isJson && outputPathError !== null) {
  console.log(
    toReportJson(
      buildTimedReport({
        passed: false,
        exitCode: 1,
        noBuild: isNoBuild,
        outputPath: null,
        steps: [],
        totalSteps: 0,
        passedStepCount: 0,
        failedStepCount: 0,
        skippedStepCount: 0,
        firstFailedStep: null,
        message: outputPathError,
      }),
      jsonFormat
    )
  );
  process.exit(1);
}

const addSkippedStep = (name, reason) => {
  if (!isJson) {
    return;
  }

  stepResults.push({
    name,
    passed: false,
    exitCode: null,
    skipped: true,
    reason,
    report: null,
    output: null,
  });
};

const runStep = (name, scriptPath, extraArgs = []) => {
  if (!isQuiet && !isJson) {
    console.log(`Running onboarding step: ${name}`);
  }

  const scriptArgs = isJson
    ? [scriptPath, "--json", ...extraArgs]
    : isQuiet
      ? [scriptPath, "--quiet", ...extraArgs]
      : [scriptPath, ...extraArgs];
  const result = isJson
    ? spawnSync(process.execPath, scriptArgs, {
        encoding: "utf8",
        shell: false,
        cwd: __dirname,
      })
    : spawnSync(process.execPath, scriptArgs, {
        stdio: "inherit",
        shell: false,
        cwd: __dirname,
      });

  const resolvedStatus = result.status ?? 1;
  if (isJson) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const parsedReport = parseJsonOutput(output);
    stepResults.push({
      name,
      passed: resolvedStatus === 0,
      exitCode: resolvedStatus,
      skipped: false,
      reason: null,
      report: parsedReport,
      output: parsedReport === null ? output : null,
    });
  }

  if (resolvedStatus === 0) {
    return true;
  }

  exitCode = resolvedStatus;
  if (isJson) {
    return false;
  }

  console.error(`Onboarding check failed: ${name}`);
  process.exit(exitCode);
};

const devEnvPassed = runStep(
  "Developer environment preflight",
  path.resolve(__dirname, "check-dev-env.mjs")
);

if (devEnvPassed) {
  runStep("Client checks", path.resolve(__dirname, "check-client.mjs"), [
    ...(isNoBuild ? ["--no-build"] : []),
  ]);
} else {
  addSkippedStep("Client checks", "Developer environment preflight failed");
}

if (isJson) {
  const passedStepCount = stepResults.filter(
    (step) => step.passed && step.skipped === false
  ).length;
  const failedStepCount = stepResults.filter(
    (step) => !step.passed && step.skipped === false
  ).length;
  const skippedStepCount = stepResults.filter((step) => step.skipped).length;
  const firstFailedStep =
    stepResults.find((step) => !step.passed && step.skipped === false)?.name ??
    null;
  const report = buildTimedReport({
    passed: exitCode === 0,
    exitCode,
    noBuild: isNoBuild,
    outputPath,
    steps: stepResults,
    totalSteps: stepResults.length,
    passedStepCount,
    failedStepCount,
    skippedStepCount,
    firstFailedStep,
  });
  const reportJson = toReportJson(report, jsonFormat);

  if (outputPath !== null) {
    const writeError = writeReportToPath(reportJson, outputPath);
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
  process.exit(exitCode);
}

if (!isQuiet) {
  console.log("Onboarding checks passed.");
}
