import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";

const runStep = (name, command, args) => {
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

console.log("Client checks passed.");
