import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

const resolveCommand = (command) => {
  if (!isWindows) {
    return command;
  }

  if (command === "pnpm") {
    return "pnpm.cmd";
  }

  return `${command}.exe`;
};

const checks = [
  {
    label: "pnpm",
    command: resolveCommand("pnpm"),
    args: ["--version"],
    required: true,
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

let missingRequired = 0;

for (const check of checks) {
  const result = spawnSync(check.command, check.args, {
    encoding: "utf8",
    shell: false,
  });

  const commandFailed = result.status !== 0 || result.error !== undefined;
  if (!commandFailed) {
    const output = `${result.stdout}${result.stderr}`;
    const firstLine =
      output
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "ok";
    console.log(`✓ ${check.label}: ${firstLine}`);
    continue;
  }

  if (check.required) {
    missingRequired += 1;
  }

  const status = check.required ? "✗" : "!";
  const requirement = check.required ? "required" : "optional";
  console.error(`${status} ${check.label}: missing (${requirement})`);
  console.error(`  ${check.hint}`);
}

if (missingRequired > 0) {
  console.error(
    `Environment check failed: ${missingRequired} required tool(s) missing.`
  );
  process.exit(1);
}

console.log("Environment check passed.");
