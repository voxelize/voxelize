import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pnpmCommand = resolvePnpmCommand();
const isQuiet = process.argv.includes("--quiet");
const isJson = process.argv.includes("--json");
const stepResults = [];
let exitCode = 0;

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
    stepResults.push({
      name,
      passed: resolvedStatus === 0,
      exitCode: resolvedStatus,
      output,
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
  [path.resolve(__dirname, "./examples/client/scripts/check-wasm-mesher.mjs")]
);

if (wasmPreflightPassed) {
  runStep("TypeScript typecheck", pnpmCommand, [
    "--dir",
    "./examples/client",
    "run",
    "typecheck",
  ]);
}

if (isJson) {
  console.log(
    JSON.stringify(
      {
        passed: exitCode === 0,
        exitCode,
        steps: stepResults,
      },
      null,
      2
    )
  );
  process.exit(exitCode);
}

if (!isQuiet) {
  console.log("Client checks passed.");
}
