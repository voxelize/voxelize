import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type PreflightCheckResult = {
  name: string;
  passed: boolean;
  exitCode: number;
  report: object | null;
  output: string | null;
};

type PreflightReport = {
  passed: boolean;
  exitCode: number;
  noBuild: boolean;
  checks: PreflightCheckResult[];
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

    expect(typeof report.passed).toBe("boolean");
    expect(report.noBuild).toBe(true);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBe(3);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });
});
