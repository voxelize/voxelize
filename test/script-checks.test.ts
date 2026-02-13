import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");

type ScriptResult = {
  status: number;
  output: string;
};

type WasmPackJsonReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  command: string;
  version: string | null;
  outputPath: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message?: string;
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
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  requiredFailures: number;
  checks: DevEnvJsonCheck[];
  outputPath: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message?: string;
};

type WasmMesherJsonReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  artifactPath: string;
  artifactFound: boolean;
  attemptedBuild: boolean;
  buildSkipped: boolean;
  wasmPackAvailable: boolean | null;
  wasmPackCheckReport: WasmPackJsonReport | null;
  buildOutput: string | null;
  message: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

type ClientJsonStep = {
  name: string;
  passed: boolean;
  exitCode: number | null;
  skipped: boolean;
  reason: string | null;
  report: WasmMesherJsonReport | null;
  output: string | null;
};

type ClientJsonReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  noBuild: boolean;
  outputPath: string | null;
  steps: ClientJsonStep[];
  totalSteps: number;
  passedStepCount: number;
  failedStepCount: number;
  skippedStepCount: number;
  firstFailedStep: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message?: string;
};

type OnboardingJsonStep = {
  name: string;
  passed: boolean;
  exitCode: number | null;
  skipped: boolean;
  reason: string | null;
  report: DevEnvJsonReport | ClientJsonReport | null;
  output: string | null;
};

type OnboardingJsonReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  noBuild: boolean;
  outputPath: string | null;
  steps: OnboardingJsonStep[];
  totalSteps: number;
  passedStepCount: number;
  failedStepCount: number;
  skippedStepCount: number;
  firstFailedStep: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message?: string;
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

const expectCompactJsonOutput = (output: string) => {
  expect(output).not.toContain("\n  \"");
};

const expectTimingMetadata = (report: {
  startedAt: string;
  endedAt: string;
  durationMs: number;
}) => {
  expect(typeof report.startedAt).toBe("string");
  expect(typeof report.endedAt).toBe("string");
  expect(report.durationMs).toBeGreaterThanOrEqual(0);
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

  it("check-wasm-pack json mode emits machine-readable report", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json"]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(typeof report.passed).toBe("boolean");
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.command).toContain("wasm-pack");
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);

    if (report.passed) {
      expect(report.version).not.toBeNull();
      return;
    }

    expect(report.message).toContain("wasm-pack is required for wasm build commands");
  });

  it("check-wasm-pack supports compact json mode", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--compact"]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expectCompactJsonOutput(result.output.trim());
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("check-wasm-pack json mode writes report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-json-")
    );
    const outputPath = path.resolve(tempDirectory, "wasm-pack-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as WasmPackJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json mode uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-json-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as WasmPackJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json mode validates missing output value", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--output"]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });

  it("check-wasm-pack json mode reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-output-write-failure-")
    );

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
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

    expect(report.schemaVersion).toBe(1);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.requiredFailures).toBeGreaterThanOrEqual(0);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(typeof report.passed).toBe("boolean");
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.map((check) => check.label)).toContain("node");
    expect(report.checks.map((check) => check.label)).toContain("pnpm");
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Environment check failed:");
  });

  it("check-dev-env supports compact json mode", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--compact"]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expectCompactJsonOutput(result.output.trim());
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("check-dev-env json mode writes report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-json-")
    );
    const outputPath = path.resolve(tempDirectory, "dev-env-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as DevEnvJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-json-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as DevEnvJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode validates missing output value", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--output"]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });

  it("check-dev-env json mode reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-output-write-failure-")
    );

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
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

    expect(report.schemaVersion).toBe(1);
    expect(typeof report.passed).toBe("boolean");
    expect(report.noBuild).toBe(false);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(Array.isArray(report.steps)).toBe(true);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps[0].name).toBe("WASM artifact preflight");
    expect(typeof report.steps[0].skipped).toBe("boolean");
    expect(report.steps.some((step) => step.name === "TypeScript typecheck")).toBe(
      true
    );
    expect(report.steps[0].report).not.toBeNull();
    if (report.steps[0].report !== null) {
      expect(report.steps[0].report.schemaVersion).toBe(1);
      expect(report.steps[0].report.artifactPath).toBe(
        "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js"
      );
      expect(typeof report.steps[0].report.passed).toBe("boolean");
      expect(report.steps[0].report.buildSkipped).toBe(false);
      expectTimingMetadata(report.steps[0].report);
    }
    if (report.failedStepCount > 0) {
      expect(report.firstFailedStep).toBe(
        report.steps.find((step) => !step.passed && step.skipped === false)?.name
      );
    } else {
      expect(report.firstFailedStep).toBeNull();
    }
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Running client check step:");
    expect(result.output).not.toContain("Client check failed:");
  });

  it("check-client supports compact json mode", () => {
    const result = runScript("check-client.mjs", ["--json", "--compact"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expectCompactJsonOutput(result.output.trim());
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("check-client json mode writes report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-json-")
    );
    const outputPath = path.resolve(tempDirectory, "client-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-json-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--no-build",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode validates missing output value", () => {
    const result = runScript("check-client.mjs", ["--json", "--output"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });

  it("check-client json mode reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-output-write-failure-")
    );

    const result = runScript("check-client.mjs", [
      "--json",
      "--no-build",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json no-build mode reports skipped build intent", () => {
    const result = runScript("check-client.mjs", ["--json", "--no-build"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps[0].name).toBe("WASM artifact preflight");
    const typecheckStep = report.steps.find(
      (step) => step.name === "TypeScript typecheck"
    );
    expect(typecheckStep).toBeDefined();
    if (report.steps[0].report !== null) {
      expect(report.steps[0].report.buildSkipped).toBe(true);
      expect(report.steps[0].report.attemptedBuild).toBe(false);
      expectTimingMetadata(report.steps[0].report);
    }
    if (typecheckStep !== undefined && report.steps[0].passed === false) {
      expect(typecheckStep.skipped).toBe(true);
      expect(typecheckStep.exitCode).toBeNull();
      expect(typecheckStep.reason).toBe("WASM artifact preflight failed");
    }
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

    expect(report.schemaVersion).toBe(1);
    expect(typeof report.passed).toBe("boolean");
    expect(report.noBuild).toBe(false);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(Array.isArray(report.steps)).toBe(true);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps[0].name).toBe("Developer environment preflight");
    expect(
      report.steps.some((step) => step.name === "Client checks")
    ).toBe(true);
    expect(report.steps[0].report).not.toBeNull();
    if (report.steps[0].report !== null) {
      expect(report.steps[0].report.schemaVersion).toBe(1);
      expect(typeof report.steps[0].report.passed).toBe("boolean");
      expectTimingMetadata(report.steps[0].report);
    }
    if (report.failedStepCount > 0) {
      expect(report.firstFailedStep).toBe(
        report.steps.find((step) => !step.passed && step.skipped === false)?.name
      );
    } else {
      expect(report.firstFailedStep).toBeNull();
    }
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Running onboarding step:");
    expect(result.output).not.toContain("Onboarding check failed:");
  });

  it("check-onboarding supports compact json mode", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--compact"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expectCompactJsonOutput(result.output.trim());
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("check-onboarding json mode writes report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-json-")
    );
    const outputPath = path.resolve(tempDirectory, "onboarding-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-json-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--no-build",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode validates missing output value", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--output"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });

  it("check-onboarding json mode reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-output-write-failure-")
    );

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--no-build",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json no-build mode propagates option", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--no-build"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps[0].name).toBe("Developer environment preflight");
    const clientStep = report.steps.find((step) => step.name === "Client checks");
    expect(clientStep).toBeDefined();
    if (clientStep !== undefined && report.steps[0].passed === false) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe(
        "Developer environment preflight failed"
      );
    }
  });
});
