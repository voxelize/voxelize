import { describe, expect, it } from "vitest";

import {
  REPORT_SCHEMA_VERSION,
  parseJsonOutput,
  toReport,
  toReportJson,
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
});
