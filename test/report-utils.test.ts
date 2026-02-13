import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPORT_SCHEMA_VERSION,
  parseJsonOutput,
  resolveOutputPath,
  toReport,
  toReportJson,
  writeReportToPath,
} from "../scripts/report-utils.mjs";

describe("report-utils", () => {
  it("parses valid json output", () => {
    expect(parseJsonOutput("{\"ok\":true}")).toEqual({ ok: true });
  });

  it("returns null for invalid or empty json output", () => {
    expect(parseJsonOutput("")).toBeNull();
    expect(parseJsonOutput("not-json")).toBeNull();
  });

  it("injects schema version in report payloads", () => {
    const report = toReport({ passed: true, schemaVersion: 999 });

    expect(report.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(report.passed).toBe(true);
  });

  it("serializes report payloads with schema version", () => {
    const serialized = toReportJson({ passed: false, exitCode: 1 });
    const parsed = JSON.parse(serialized) as {
      schemaVersion: number;
      passed: boolean;
      exitCode: number;
    };

    expect(parsed.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(parsed.passed).toBe(false);
    expect(parsed.exitCode).toBe(1);
  });

  it("resolves output paths and validates missing values", () => {
    const resolved = resolveOutputPath(
      ["--json", "--output", "./report.json"],
      "/workspace"
    );
    expect(resolved.error).toBeNull();
    expect(resolved.outputPath).toBe("/workspace/report.json");

    const missingValue = resolveOutputPath(["--json", "--output"], "/workspace");
    expect(missingValue.error).toBe("Missing value for --output option.");
    expect(missingValue.outputPath).toBeNull();

    const invalidValue = resolveOutputPath(
      ["--json", "--output", "--quiet"],
      "/workspace"
    );
    expect(invalidValue.error).toBe("Missing value for --output option.");
    expect(invalidValue.outputPath).toBeNull();
  });

  it("writes report json payloads to output paths", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "report-utils-"));
    const outputPath = path.resolve(tempDirectory, "nested", "report.json");
    const reportJson = toReportJson({ passed: true, exitCode: 0 });

    expect(writeReportToPath(reportJson, outputPath)).toBeNull();
    expect(fs.readFileSync(outputPath, "utf8")).toBe(reportJson);
    expect(writeReportToPath(reportJson, null)).toBeNull();

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
});
