import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type WasmPackJsonReport = {
  passed: boolean;
  exitCode: number;
  command: string;
  version: string | null;
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
  outputPath: string | null;
  message: string;
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");
const wasmMesherScript = path.resolve(
  rootDir,
  "examples/client/scripts/check-wasm-mesher.mjs"
);

describe("client wasm preflight script", () => {
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
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);

    if (report.wasmPackCheckReport !== null) {
      expect(report.wasmPackCheckReport.command).toContain("wasm-pack");
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
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
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
    expect(report.message).toBe("Missing value for --output option.");
    expect(result.status).toBe(1);
  });
});
