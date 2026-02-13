import { spawnSync } from "node:child_process";
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
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });
});
