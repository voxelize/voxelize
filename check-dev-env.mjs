import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCommand } from "./scripts/command-utils.mjs";
import {
  formatSemver,
  isSemverAtLeast,
  loadWorkspaceMinimumVersions,
  parseSemver,
} from "./scripts/dev-env-utils.mjs";
import {
  resolveOutputPath,
  toReportJson,
  writeReportToPath,
} from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliArgs = process.argv.slice(2);
const isQuiet = cliArgs.includes("--quiet");
const isJson = cliArgs.includes("--json");
const isCompact = cliArgs.includes("--compact");
const jsonFormat = { compact: isCompact };
const { outputPath, error: outputPathError } = resolveOutputPath(cliArgs);
const minimumVersions = loadWorkspaceMinimumVersions(__dirname);

const checks = [
  {
    label: "node",
    command: process.execPath,
    args: ["--version"],
    required: true,
    minVersion: minimumVersions.node,
    hint: "Install Node.js: https://nodejs.org/en/download/",
  },
  {
    label: "pnpm",
    command: resolveCommand("pnpm"),
    args: ["--version"],
    required: true,
    minVersion: minimumVersions.pnpm,
    hint: "Install pnpm: https://pnpm.io/installation",
  },
  {
    label: "cargo",
    command: resolveCommand("cargo"),
    args: ["--version"],
    required: true,
    hint: "Install Rust toolchain: https://www.rust-lang.org/tools/install",
  },
  {
    label: "wasm-pack",
    command: resolveCommand("wasm-pack"),
    args: ["--version"],
    required: true,
    hint: "Install wasm-pack: https://rustwasm.github.io/wasm-pack/installer/",
  },
  {
    label: "protoc",
    command: resolveCommand("protoc"),
    args: ["--version"],
    required: true,
    hint: "Install protoc: https://grpc.io/docs/protoc-installation/",
  },
  {
    label: "cargo watch",
    command: resolveCommand("cargo"),
    args: ["watch", "--version"],
    required: false,
    hint: "Install cargo-watch: https://crates.io/crates/cargo-watch",
  },
];

let requiredFailures = 0;
const checkResults = [];

if (isJson && outputPathError !== null) {
  console.log(
    toReportJson({
      passed: false,
      exitCode: 1,
      requiredFailures: 0,
      checks: [],
      outputPath: null,
      message: outputPathError,
    }, jsonFormat)
  );
  process.exit(1);
}

for (const check of checks) {
  const result = spawnSync(check.command, check.args, {
    encoding: "utf8",
    shell: false,
  });

  const commandFailed = result.status !== 0 || result.error !== undefined;
  const output = `${result.stdout}${result.stderr}`;
  const firstLine =
    output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "ok";

  let status = "ok";
  let message = firstLine;
  let detectedVersion = null;
  let minimumVersion = null;

  if (commandFailed) {
    if (result.error !== undefined) {
      status = "missing";
      message = "missing";
    } else {
      const failureDetail =
        firstLine === "ok" ? "command returned non-zero status" : firstLine;
      status = "unavailable";
      message = `unavailable (${failureDetail})`;
    }
  } else if (check.minVersion !== undefined) {
    const parsedVersion = parseSemver(firstLine);
    minimumVersion = formatSemver(check.minVersion);
    if (parsedVersion === null) {
      status = "unparseable_version";
      message = `unable to parse version from "${firstLine}"`;
    } else {
      detectedVersion = formatSemver(parsedVersion);
      if (!isSemverAtLeast(parsedVersion, check.minVersion)) {
        status = "version_below_minimum";
        message = `version ${detectedVersion} is below ${minimumVersion}`;
      }
    }
  }

  if (status !== "ok" && check.required) {
    requiredFailures += 1;
  }

  checkResults.push({
    label: check.label,
    required: check.required,
    status,
    message,
    hint: check.hint,
    detectedVersion,
    minimumVersion,
  });

  if (isJson) {
    continue;
  }

  if (status === "ok") {
    if (!isQuiet) {
      console.log(`✓ ${check.label}: ${firstLine}`);
    }
    continue;
  }

  const statusSymbol = check.required ? "✗" : "!";
  const requirement = check.required ? "required" : "optional";
  console.error(`${statusSymbol} ${check.label}: ${message} (${requirement})`);
  console.error(`  ${check.hint}`);
}

if (isJson) {
  const report = {
    passed: requiredFailures === 0,
    exitCode: requiredFailures > 0 ? 1 : 0,
    requiredFailures,
    checks: checkResults,
    outputPath,
  };
  const reportJson = toReportJson(report, jsonFormat);

  if (outputPath !== null) {
    const writeError = writeReportToPath(reportJson, outputPath);
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
}

if (requiredFailures > 0) {
  if (!isJson) {
    console.error(
      `Environment check failed: ${requiredFailures} required check(s) failed.`
    );
  }
  process.exit(1);
}

if (!isQuiet && !isJson) {
  console.log("Environment check passed.");
}
