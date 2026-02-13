import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type PreflightCheckResult = {
  name: string;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  report: object | null;
  output: string | null;
};

type PreflightFailureSummary = {
  name: string;
  exitCode: number;
  message: string;
};

type PreflightReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  noBuild: boolean;
  platform: string;
  nodeVersion: string;
  startedAt: string;
  durationMs: number;
  passedChecks: string[];
  failedChecks: string[];
  failureSummaries: PreflightFailureSummary[];
  checks: PreflightCheckResult[];
  outputPath: string | null;
  message?: string;
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");
const preflightScript = path.resolve(rootDir, "check-preflight.mjs");

describe("preflight aggregate report", () => {
  it("emits machine-readable aggregate JSON", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--no-build"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(typeof report.passed).toBe("boolean");
    expect(report.noBuild).toBe(true);
    expect(report.platform).toBe(process.platform);
    expect(report.nodeVersion).toBe(process.version);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(typeof report.startedAt).toBe("string");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.passedChecks)).toBe(true);
    expect(Array.isArray(report.failedChecks)).toBe(true);
    expect(Array.isArray(report.failureSummaries)).toBe(true);
    expect(report.passedChecks.length + report.failedChecks.length).toBe(3);
    expect(report.failureSummaries.length).toBe(report.failedChecks.length);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual(
      ["client", "devEnvironment", "wasmPack"]
    );
    expect(report.failureSummaries.map((entry) => entry.name).sort()).toEqual(
      report.failedChecks.slice().sort()
    );
    for (const entry of report.failureSummaries) {
      expect(entry.exitCode).toBeGreaterThanOrEqual(1);
      expect(entry.message.length).toBeGreaterThan(0);
    }
    expect(report.outputPath).toBeNull();
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBe(3);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    for (const check of report.checks) {
      expect(check.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("writes aggregate report to output path when requested", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-report-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(fileReport.schemaVersion).toBe(1);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("creates output directory when writing aggregate report", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-output-dir-")
    );
    const outputPath = path.resolve(
      tempDirectory,
      "nested",
      "preflight",
      "report.json"
    );

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(fileReport.schemaVersion).toBe(1);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("fails with structured output when output value is missing", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--output"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.platform).toBe(process.platform);
    expect(report.nodeVersion).toBe(process.version);
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });
});
