import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";
import { parseJsonOutput, toReportJson } from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pnpmCommand = resolvePnpmCommand();
const isQuiet = process.argv.includes("--quiet");
const isJson = process.argv.includes("--json");
const isNoBuild = process.argv.includes("--no-build");
const stepResults = [];
let exitCode = 0;

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

const runStep = (name, command, args) => {
  if (!isQuiet && !isJson) {
    console.log(`Running client check step: ${name}`);
  }

  const result = isJson
    ? spawnSync(command, args, {
        encoding: "utf8",
        shell: false,
        cwd: __dirname,
      })
    : spawnSync(command, args, {
        stdio: "inherit",
        shell: false,
        cwd: __dirname,
      });

  const resolvedStatus = result.status ?? 1;
  if (isJson) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const report = parseJsonOutput(output);
    stepResults.push({
      name,
      passed: resolvedStatus === 0,
      exitCode: resolvedStatus,
      skipped: false,
      reason: null,
      report,
      output: report === null ? output : null,
    });
  }

  if (resolvedStatus === 0) {
    return true;
  }

  exitCode = resolvedStatus;
  if (isJson) {
    return false;
  }

  console.error(`Client check failed: ${name}`);
  process.exit(exitCode);
};

const wasmPreflightPassed = runStep(
  "WASM artifact preflight",
  process.execPath,
  [
    path.resolve(__dirname, "./examples/client/scripts/check-wasm-mesher.mjs"),
    ...(isJson ? ["--json"] : []),
    ...(isNoBuild ? ["--no-build"] : []),
  ]
);

if (wasmPreflightPassed) {
  runStep("TypeScript typecheck", pnpmCommand, [
    "--dir",
    "./examples/client",
    "run",
    "typecheck",
  ]);
} else {
  addSkippedStep("TypeScript typecheck", "WASM artifact preflight failed");
}

if (isJson) {
  console.log(
    toReportJson({
      passed: exitCode === 0,
      exitCode,
      noBuild: isNoBuild,
      steps: stepResults,
    })
  );
  process.exit(exitCode);
}

if (!isQuiet) {
  console.log("Client checks passed.");
}
