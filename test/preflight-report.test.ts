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
  endedAt: string;
  durationMs: number;
  selectionMode: "default" | "only";
  selectedChecks: string[];
  requestedChecks: string[];
  skippedChecks: string[];
  totalChecks: number;
  passedCheckCount: number;
  failedCheckCount: number;
  firstFailedCheck: string | null;
  availableChecks: string[];
  availableCheckAliases: {
    devEnvironment: string[];
    wasmPack: string[];
    client: string[];
  };
  availableSpecialCheckAliases: {
    all: string[];
  };
  passedChecks: string[];
  failedChecks: string[];
  failureSummaries: PreflightFailureSummary[];
  checks: PreflightCheckResult[];
  outputPath: string | null;
  invalidChecks: string[];
  writeError?: string;
  message?: string;
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");
const preflightScript = path.resolve(rootDir, "check-preflight.mjs");
const expectedAvailableCheckAliases = {
  devEnvironment: [
    "devEnvironment",
    "dev",
    "dev-env",
    "dev_env",
    "devenv",
    "devenvironment",
  ],
  wasmPack: ["wasmPack", "wasm", "wasm-pack", "wasm_pack", "wasmpack"],
  client: ["client"],
};
const expectedAvailableSpecialCheckAliases = {
  all: ["all", "all-checks", "all_checks", "allchecks"],
};

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
    expect(typeof report.endedAt).toBe("string");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.availableChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
    expect(report.selectionMode).toBe("default");
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.requestedChecks).toEqual([]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.totalChecks).toBe(report.checks.length);
    expect(report.passedCheckCount).toBe(report.passedChecks.length);
    expect(report.failedCheckCount).toBe(report.failedChecks.length);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(
      report.totalChecks
    );
    if (report.failedChecks.length > 0) {
      expect(report.firstFailedCheck).toBe(report.failedChecks[0]);
    } else {
      expect(report.firstFailedCheck).toBeNull();
    }
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
    const devEnvironmentFailure = report.failureSummaries.find(
      (entry) => entry.name === "devEnvironment"
    );
    if (devEnvironmentFailure !== undefined) {
      expect(devEnvironmentFailure.message).toContain("required check(s) failed");
    }
    const clientFailure = report.failureSummaries.find(
      (entry) => entry.name === "client"
    );
    if (clientFailure !== undefined) {
      expect(clientFailure.message).toContain("WASM artifact preflight");
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

  it("supports selecting a subset of checks via --only", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "devEnvironment,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectionMode).toBe("only");
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.skippedChecks).toEqual(["wasmPack"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.totalChecks).toBe(2);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("normalizes duplicated and spaced check names in --only", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment, client , devEnvironment"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedChecks).toEqual([
      "devEnvironment",
      "client",
      "devEnvironment",
    ]);
    expect(report.skippedChecks).toEqual(["wasmPack"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("normalizes selected checks to available check order", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "client,devEnvironment"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedChecks).toEqual(["client", "devEnvironment"]);
    expect(report.skippedChecks).toEqual(["wasmPack"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports canonical aliases and case-insensitive check names", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "DEV_ENV,wasm_pack,CLIENT"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.requestedChecks).toEqual(["DEV_ENV", "wasm_pack", "CLIENT"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator-free alias forms", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "wasmpack,devenvironment"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "wasmPack"]);
    expect(report.requestedChecks).toEqual(["wasmpack", "devenvironment"]);
    expect(report.skippedChecks).toEqual(["client"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports short alias forms", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "dev,wasm"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "wasmPack"]);
    expect(report.requestedChecks).toEqual(["dev", "wasm"]);
    expect(report.skippedChecks).toEqual(["client"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports selecting all checks with the all alias", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "all"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.requestedChecks).toEqual(["all"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports case-insensitive all alias selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "ALL"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.requestedChecks).toEqual(["ALL"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator variants for all alias selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "all_checks"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.requestedChecks).toEqual(["all_checks"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports mixing the all alias with specific checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "all,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.requestedChecks).toEqual(["all", "client"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("preserves duplicate requested checks while normalizing selected checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "client,client,DEV_ENV,dev_env"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedChecks).toEqual([
      "client",
      "client",
      "DEV_ENV",
      "dev_env",
    ]);
    expect(report.skippedChecks).toEqual(["wasmPack"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("deduplicates mixed alias forms to canonical selected checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "devEnvironment,DEV_ENV,dev"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment"]);
    expect(report.requestedChecks).toEqual([
      "devEnvironment",
      "DEV_ENV",
      "dev",
    ]);
    expect(report.skippedChecks).toEqual(["wasmPack", "client"]);
    expect(report.checks.map((check) => check.name)).toEqual(["devEnvironment"]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("uses the last only flag when multiple are provided", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--no-build",
        "--only",
        "devEnvironment",
        "--only",
        "client",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["client"]);
    expect(report.requestedChecks).toEqual(["client"]);
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual(["client"]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("fails when the last only flag is missing a value", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment", "--only"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.selectionMode).toBe("only");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.selectedChecks).toEqual([]);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(1);
  });

  it("fails when the last only flag contains invalid checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment", "--only", "invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all."
    );
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.selectedChecks).toEqual([]);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(1);
  });

  it("supports compact json output formatting", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--compact"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`.trim();
    const report = JSON.parse(output) as PreflightReport;

    expect(output).not.toContain("\n  \"");
    expect(report.schemaVersion).toBe(1);
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

  it("uses the last output flag when multiple are provided", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--no-build",
        "--output",
        firstOutputPath,
        "--output",
        secondOutputPath,
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
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
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(typeof report.endedAt).toBe("string");
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.selectionMode).toBe("default");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(result.status).toBe(1);
  });

  it("fails when the last output flag value is missing", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "./first.json", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.selectionMode).toBe("default");
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(result.status).toBe(1);
  });

  it("prioritizes output validation errors over only-selection errors", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "--only", "invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual(["invalidCheck"]);
    expect(report.selectionMode).toBe("only");
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(result.status).toBe(1);
  });

  it("keeps parsed requested checks when output value is missing", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "--only", "client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual(["client"]);
    expect(report.selectionMode).toBe("only");
    expect(result.status).toBe(1);
  });

  it("fails with structured output when only value is missing", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--only"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(typeof report.endedAt).toBe("string");
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.selectionMode).toBe("only");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.requestedChecks).toEqual([]);
    expect(report.availableChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
    expect(result.status).toBe(1);
  });

  it("fails with structured output when only value is blank", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", " ,  , "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(result.status).toBe(1);
  });

  it("fails with structured output for invalid check names", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment,invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(typeof report.endedAt).toBe("string");
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all."
    );
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.requestedChecks).toEqual(["devEnvironment", "invalidCheck"]);
    expect(report.availableChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(result.status).toBe(1);
  });

  it("deduplicates repeated invalid check names in error output", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--only",
        "devEnvironment,invalidCheck,INVALID_CHECK,invalid-check,otherInvalid",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.message).toBe(
      "Invalid check name(s): invalidCheck, otherInvalid. Available checks: devEnvironment, wasmPack, client. Special selectors: all."
    );
    expect(report.invalidChecks).toEqual(["invalidCheck", "otherInvalid"]);
    expect(report.requestedChecks).toEqual([
      "devEnvironment",
      "invalidCheck",
      "INVALID_CHECK",
      "invalid-check",
      "otherInvalid",
    ]);
    expect(result.status).toBe(1);
  });

  it("writes structured validation errors to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-invalid-only-output-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "invalidCheck", "--output", outputPath],
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
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all."
    );
    expect(stdoutReport.invalidChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.requestedChecks).toEqual(["invalidCheck"]);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.message).toBe(stdoutReport.message);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes missing only-value errors to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-missing-only-output-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "--output", outputPath],
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
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.message).toBe("Missing value for --only option.");
    expect(stdoutReport.invalidChecks).toEqual([]);
    expect(stdoutReport.requestedChecks).toEqual([]);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.message).toBe(stdoutReport.message);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns structured write failures for validation-error output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-invalid-output-path-")
    );

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "invalidCheck", "--output", tempDirectory],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.writeError).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(report.message).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.requestedChecks).toEqual(["invalidCheck"]);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
});
