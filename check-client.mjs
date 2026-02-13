import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pnpmCommand = resolvePnpmCommand();
const isQuiet = process.argv.includes("--quiet");

const runStep = (name, command, args) => {
  if (!isQuiet) {
    console.log(`Running client check step: ${name}`);
  }

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    cwd: __dirname,
  });

  if (result.status === 0) {
    return;
  }

  console.error(`Client check failed: ${name}`);
  process.exit(result.status ?? 1);
};

runStep(
  "WASM artifact preflight",
  process.execPath,
  [path.resolve(__dirname, "./examples/client/scripts/check-wasm-mesher.mjs")]
);

runStep("TypeScript typecheck", pnpmCommand, [
  "--dir",
  "./examples/client",
  "run",
  "typecheck",
]);

if (!isQuiet) {
  console.log("Client checks passed.");
}
