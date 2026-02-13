import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

if (outputArgIndex !== -1 && requestedOutputPath === null) {
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        passed: false,
        exitCode: 1,
        noBuild: isNoBuild,
        startedAt,
        durationMs: 0,
        checks: [],
        outputPath: null,
        message: "Missing value for --output option.",
      },
      null,
      2
    )
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
const report = {
  schemaVersion: 1,
  passed,
  exitCode,
  noBuild: isNoBuild,
  startedAt,
  durationMs: Date.now() - aggregateStartMs,
  passedChecks,
  failedChecks,
  checks,
  outputPath: resolvedOutputPath,
};
const reportJson = JSON.stringify(report, null, 2);

if (resolvedOutputPath !== null) {
  try {
    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    fs.writeFileSync(resolvedOutputPath, reportJson);
  } catch {
    console.log(
      JSON.stringify(
        {
          ...report,
          passed: false,
          exitCode: 1,
          message: `Failed to write preflight report to ${resolvedOutputPath}.`,
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

console.log(reportJson);

process.exit(exitCode);
