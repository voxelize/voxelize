import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type OptionTerminatorMetadata = {
  optionTerminatorUsed: boolean;
  positionalArgs: string[];
  positionalArgCount: number;
};

type WasmPackJsonReport = OptionTerminatorMetadata & {
  passed: boolean;
  exitCode: number;
  command: string;
  version: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  writeError?: string;
  message?: string;
};

type WasmMesherJsonReport = OptionTerminatorMetadata & {
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
  outputPath: string | null;
  writeError?: string;
  message: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");
const wasmMesherScript = path.resolve(
  rootDir,
  "examples/client/scripts/check-wasm-mesher.mjs"
);

describe("client wasm preflight script", () => {
  const expectTimingMetadata = (report: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
  }) => {
    expect(typeof report.startedAt).toBe("string");
    expect(typeof report.endedAt).toBe("string");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  };

  const expectOptionTerminatorMetadata = (
    report: OptionTerminatorMetadata,
    expectedOptionTerminatorUsed = false,
    expectedPositionalArgs: string[] = []
  ) => {
    expect(report.optionTerminatorUsed).toBe(expectedOptionTerminatorUsed);
    expect(report.positionalArgs).toEqual(expectedPositionalArgs);
    expect(report.positionalArgCount).toBe(report.positionalArgs.length);
  };

  it("emits machine-readable JSON report", () => {
    const result = spawnSync(process.execPath, [wasmMesherScript, "--json"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as WasmMesherJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(typeof report.passed).toBe("boolean");
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.artifactPath).toBe(
      "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js"
    );
    expect(typeof report.artifactFound).toBe("boolean");
    expect(typeof report.attemptedBuild).toBe("boolean");
    expect(typeof report.buildSkipped).toBe("boolean");
    expect(report.outputPath).toBeNull();
    expect(typeof report.message).toBe("string");
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);

    if (report.wasmPackCheckReport !== null) {
      expect(report.wasmPackCheckReport.command).toContain("wasm-pack");
      expectTimingMetadata(report.wasmPackCheckReport);
      expectOptionTerminatorMetadata(report.wasmPackCheckReport);
    }
  });

  it("respects no-build mode in machine-readable output", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--no-build"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as WasmMesherJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.buildSkipped).toBe(true);
    expect(report.attemptedBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports compact json mode", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--no-build", "--compact"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`.trim();
    const report = JSON.parse(output) as WasmMesherJsonReport;

    expect(output).not.toContain("\n  \"");
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("writes machine-readable JSON report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-preflight-")
    );
    const outputPath = path.resolve(tempDirectory, "wasm-preflight-report.json");

    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--no-build", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const stdoutReport = JSON.parse(
      `${result.stdout}${result.stderr}`
    ) as WasmMesherJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as WasmMesherJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("supports inline output values in machine-readable mode", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-preflight-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "wasm-inline-report.json");

    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--no-build", `--output=${outputPath}`],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const stdoutReport = JSON.parse(
      `${result.stdout}${result.stderr}`
    ) as WasmMesherJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as WasmMesherJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag when multiple are provided", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-preflight-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--json",
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
    const stdoutReport = JSON.parse(
      `${result.stdout}${result.stderr}`
    ) as WasmMesherJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as WasmMesherJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("fails with structured output when output value is missing", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });

  it("fails with structured output when inline output value is empty", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output="],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });

  it("ignores option-like tokens after option terminator", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--no-build", "--", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--output"]);
    expect(report.message).not.toBe("Missing value for --output option.");
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("fails when last output flag value is missing", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output", "./first.json", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });

  it("reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-preflight-output-write-failure-")
    );

    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--no-build", "--output", tempDirectory],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expectTimingMetadata(report);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
});
