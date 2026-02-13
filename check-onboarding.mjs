import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTimedReportBuilder,
  parseJsonOutput,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  summarizeStepResults,
  toReportJson,
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
const buildTimedReport = createTimedReportBuilder();
const stepResults = [];
let exitCode = 0;

if (isJson && outputPathError !== null) {
  console.log(
    toReportJson(
      buildTimedReport({
        passed: false,
        exitCode: 1,
        noBuild: isNoBuild,
        outputPath: null,
        steps: [],
        ...summarizeStepResults([]),
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
    ? [scriptPath, "--json", "--compact", ...extraArgs]
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
  const stepSummary = summarizeStepResults(stepResults);
  const report = buildTimedReport({
    passed: exitCode === 0,
    exitCode,
    noBuild: isNoBuild,
    outputPath,
    steps: stepResults,
    ...stepSummary,
  });
  const { reportJson, writeError } = serializeReportWithOptionalWrite(report, {
    jsonFormat,
    outputPath,
    buildTimedReport,
  });

  console.log(reportJson);
  process.exit(writeError === null ? exitCode : 1);
}

if (!isQuiet) {
  console.log("Onboarding checks passed.");
}
