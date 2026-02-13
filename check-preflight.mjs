import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isNoBuild = process.argv.includes("--no-build");

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
    report,
    output: report === null ? output : null,
  };
};

const checks = [
  runCheck("devEnvironment", "check-dev-env.mjs"),
  runCheck("wasmPack", "check-wasm-pack.mjs"),
  runCheck("client", "check-client.mjs", isNoBuild ? ["--no-build"] : []),
];

const passed = checks.every((check) => check.passed);
const exitCode = passed ? 0 : 1;

console.log(
  JSON.stringify(
    {
      passed,
      exitCode,
      noBuild: isNoBuild,
      checks,
    },
    null,
    2
  )
);

process.exit(exitCode);
