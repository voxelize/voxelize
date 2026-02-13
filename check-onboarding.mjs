import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isQuiet = process.argv.includes("--quiet");
const isJson = process.argv.includes("--json");
const stepResults = [];
let exitCode = 0;

const parseJsonOutput = (value) => {
  if (value.length === 0) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const runStep = (name, scriptPath) => {
  if (!isQuiet && !isJson) {
    console.log(`Running onboarding step: ${name}`);
  }

  const scriptArgs = isJson
    ? [scriptPath, "--json"]
    : isQuiet
      ? [scriptPath, "--quiet"]
      : [scriptPath];
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
  runStep("Client checks", path.resolve(__dirname, "check-client.mjs"));
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
  console.log("Onboarding checks passed.");
}
