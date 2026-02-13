import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");

type ScriptResult = {
  status: number;
  output: string;
};

const runScript = (scriptName: string, args: string[] = []): ScriptResult => {
  const scriptPath = path.resolve(rootDir, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  };
};

describe("root preflight scripts", () => {
  it("check-wasm-pack returns clear status output", () => {
    const result = runScript("check-wasm-pack.mjs");

    if (result.status === 0) {
      expect(result.output).toBe("");
      return;
    }

    expect(result.output).toContain("wasm-pack is required for wasm build commands");
    expect(result.output).toContain(
      "https://rustwasm.github.io/wasm-pack/installer/"
    );
  });

  it("check-dev-env returns pass or fail summary", () => {
    const result = runScript("check-dev-env.mjs");

    if (result.status === 0) {
      expect(result.output).toContain("Environment check passed.");
      return;
    }

    expect(result.output).toContain("Environment check failed:");
  });

  it("check-client returns pass or fail summary", () => {
    const result = runScript("check-client.mjs");

    if (result.status === 0) {
      expect(result.output).toContain("Client checks passed.");
      return;
    }

    expect(result.output).toContain("Client check failed:");
  });

  it("check-onboarding returns pass or fail summary", () => {
    const result = runScript("check-onboarding.mjs");

    if (result.status === 0) {
      expect(result.output).toContain("Onboarding checks passed.");
      return;
    }

    expect(result.output).toContain("Onboarding check failed:");
  });
});
