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

type DevEnvJsonCheck = {
  label: string;
  required: boolean;
  status: string;
  message: string;
  hint: string;
  detectedVersion: string | null;
  minimumVersion: string | null;
};

type DevEnvJsonReport = {
  passed: boolean;
  requiredFailures: number;
  checks: DevEnvJsonCheck[];
};

type ClientJsonStep = {
  name: string;
  passed: boolean;
  exitCode: number;
  output: string;
};

type ClientJsonReport = {
  passed: boolean;
  exitCode: number;
  steps: ClientJsonStep[];
};

type OnboardingJsonStep = {
  name: string;
  passed: boolean;
  exitCode: number;
  report: DevEnvJsonReport | ClientJsonReport | null;
  output: string | null;
};

type OnboardingJsonReport = {
  passed: boolean;
  exitCode: number;
  steps: OnboardingJsonStep[];
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

  it("check-wasm-pack quiet mode suppresses messages", () => {
    const result = runScript("check-wasm-pack.mjs", ["--quiet"]);

    expect(result.output).toBe("");
  });

  it("check-dev-env returns pass or fail summary", () => {
    const result = runScript("check-dev-env.mjs");
    expect(result.output).toContain("node:");
    expect(result.output).toContain("cargo watch:");

    if (result.status === 0) {
      expect(result.output).toContain("Environment check passed.");
      return;
    }

    expect(result.output).toContain("Environment check failed:");
  });

  it("check-dev-env quiet mode suppresses success lines", () => {
    const result = runScript("check-dev-env.mjs", ["--quiet"]);

    expect(result.output).not.toContain("✓ ");
  });

  it("check-dev-env json mode emits machine-readable report", () => {
    const result = runScript("check-dev-env.mjs", ["--json"]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.requiredFailures).toBeGreaterThanOrEqual(0);
    expect(typeof report.passed).toBe("boolean");
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.map((check) => check.label)).toContain("node");
    expect(report.checks.map((check) => check.label)).toContain("pnpm");
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Environment check failed:");
  });

  it("check-client returns pass or fail summary", () => {
    const result = runScript("check-client.mjs");
    expect(result.output).toContain(
      "Running client check step: WASM artifact preflight"
    );

    if (result.status === 0) {
      expect(result.output).toContain("Client checks passed.");
      return;
    }

    expect(result.output).toContain("Client check failed:");
  });

  it("check-client quiet mode suppresses step logs", () => {
    const result = runScript("check-client.mjs", ["--quiet"]);

    expect(result.output).not.toContain("Running client check step:");
  });

  it("check-client json mode emits machine-readable report", () => {
    const result = runScript("check-client.mjs", ["--json"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(typeof report.passed).toBe("boolean");
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.steps)).toBe(true);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps[0].name).toBe("WASM artifact preflight");
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Running client check step:");
    expect(result.output).not.toContain("Client check failed:");
  });

  it("check-onboarding returns pass or fail summary", () => {
    const result = runScript("check-onboarding.mjs");
    expect(result.output).toContain(
      "Running onboarding step: Developer environment preflight"
    );

    if (result.status === 0) {
      expect(result.output).toContain("Onboarding checks passed.");
      return;
    }

    expect(result.output).toContain("Onboarding check failed:");
  });

  it("check-onboarding quiet mode suppresses step logs", () => {
    const result = runScript("check-onboarding.mjs", ["--quiet"]);

    expect(result.output).not.toContain("Running onboarding step:");
    expect(result.output).not.toContain("✓ node:");
  });

  it("check-onboarding json mode emits machine-readable report", () => {
    const result = runScript("check-onboarding.mjs", ["--json"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(typeof report.passed).toBe("boolean");
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.steps)).toBe(true);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps[0].name).toBe("Developer environment preflight");
    expect(report.steps[0].report).not.toBeNull();
    if (report.steps[0].report !== null) {
      expect(typeof report.steps[0].report.passed).toBe("boolean");
    }
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Running onboarding step:");
    expect(result.output).not.toContain("Onboarding check failed:");
  });
});
