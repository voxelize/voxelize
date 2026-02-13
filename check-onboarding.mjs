import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runStep = (name, scriptPath) => {
  console.log(`Running onboarding step: ${name}`);

  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: "inherit",
    shell: false,
    cwd: __dirname,
  });

  if (result.status === 0) {
    return;
  }

  console.error(`Onboarding check failed: ${name}`);
  process.exit(result.status ?? 1);
};

runStep("Developer environment preflight", path.resolve(__dirname, "check-dev-env.mjs"));
runStep("Client checks", path.resolve(__dirname, "check-client.mjs"));

console.log("Onboarding checks passed.");
