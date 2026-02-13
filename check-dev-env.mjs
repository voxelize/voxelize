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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

  const printFailure = (reason) => {
    if (check.required) {
      requiredFailures += 1;
    }

    const status = check.required ? "✗" : "!";
    const requirement = check.required ? "required" : "optional";
    console.error(`${status} ${check.label}: ${reason} (${requirement})`);
    console.error(`  ${check.hint}`);
  };

  if (commandFailed) {
    if (result.error !== undefined) {
      printFailure("missing");
      continue;
    }

    const failureDetail =
      firstLine === "ok" ? "command returned non-zero status" : firstLine;
    printFailure(`unavailable (${failureDetail})`);
    continue;
  }

  if (check.minVersion !== undefined) {
    const parsedVersion = parseSemver(firstLine);
    if (parsedVersion === null) {
      printFailure(`unable to parse version from "${firstLine}"`);
      continue;
    }

    if (!isSemverAtLeast(parsedVersion, check.minVersion)) {
      printFailure(
        `version ${formatSemver(parsedVersion)} is below ${formatSemver(
          check.minVersion
        )}`
      );
      continue;
    }
  }

  console.log(`✓ ${check.label}: ${firstLine}`);
}

if (requiredFailures > 0) {
  console.error(
    `Environment check failed: ${requiredFailures} required check(s) failed.`
  );
  process.exit(1);
}

console.log("Environment check passed.");
