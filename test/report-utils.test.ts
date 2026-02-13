import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPORT_SCHEMA_VERSION,
  createTimedReportBuilder,
  deriveFailureMessageFromReport,
  parseJsonOutput,
  resolveOutputPath,
  summarizeCheckResults,
  summarizeStepResults,
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

  it("parses compact json lines when logs are present", () => {
    expect(
      parseJsonOutput(`warning: preflight noise\n{"ok":true,"exitCode":0}`)
    ).toEqual({ ok: true, exitCode: 0 });
    expect(
      parseJsonOutput(`{"ok":true,"exitCode":0}\nwarning: trailing message`)
    ).toEqual({ ok: true, exitCode: 0 });
    expect(
      parseJsonOutput(
        `warning: before\n{"ok":true,"exitCode":0}\nwarning: after`
      )
    ).toEqual({ ok: true, exitCode: 0 });
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

  it("supports compact json serialization option", () => {
    const compactSerialized = toReportJson(
      { passed: true, exitCode: 0 },
      { compact: true }
    );

    expect(compactSerialized).toBe(
      `{"passed":true,"exitCode":0,"schemaVersion":${REPORT_SCHEMA_VERSION}}`
    );
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

    const lastOutputWins = resolveOutputPath(
      ["--json", "--output", "./first.json", "--output", "./second.json"],
      "/workspace"
    );
    expect(lastOutputWins.error).toBeNull();
    expect(lastOutputWins.outputPath).toBe("/workspace/second.json");

    const trailingMissingValue = resolveOutputPath(
      ["--json", "--output", "./first.json", "--output"],
      "/workspace"
    );
    expect(trailingMissingValue.error).toBe("Missing value for --output option.");
    expect(trailingMissingValue.outputPath).toBeNull();
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

  it("includes failure details when report write fails", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "report-utils-write-failure-")
    );
    const reportJson = toReportJson({ passed: false, exitCode: 1 });
    const failureMessage = writeReportToPath(reportJson, tempDirectory);

    expect(failureMessage).toContain(`Failed to write report to ${tempDirectory}.`);
    if (failureMessage !== null) {
      expect(failureMessage.length).toBeGreaterThan(
        `Failed to write report to ${tempDirectory}.`.length
      );
    }

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("builds timed reports with stable startedAt and duration", () => {
    let tick = 0;
    const now = () => {
      tick += 1;
      return tick * 1000;
    };
    const toIsoString = (value) => `iso-${value}`;
    const withTiming = createTimedReportBuilder(now, toIsoString);
    const initialReport = withTiming({ passed: true, exitCode: 0 });
    const followUpReport = withTiming({ passed: false, exitCode: 1 });

    expect(initialReport.startedAt).toBe("iso-1000");
    expect(initialReport.endedAt).toBe("iso-2000");
    expect(initialReport.durationMs).toBe(1000);
    expect(followUpReport.startedAt).toBe("iso-1000");
    expect(followUpReport.endedAt).toBe("iso-3000");
    expect(followUpReport.durationMs).toBe(2000);
  });

  it("summarizes step outcomes for json preflight reports", () => {
    const summary = summarizeStepResults([
      { name: "step-a", passed: true, skipped: false },
      { name: "step-b", passed: false, skipped: false },
      { name: "step-c", passed: false, skipped: true },
    ]);

    expect(summary).toEqual({
      totalSteps: 3,
      passedStepCount: 1,
      failedStepCount: 1,
      skippedStepCount: 1,
      firstFailedStep: "step-b",
    });
  });

  it("summarizes check outcomes for aggregate preflight reports", () => {
    const summary = summarizeCheckResults([
      { name: "devEnvironment", passed: false },
      { name: "wasmPack", passed: true },
      { name: "client", passed: false },
    ]);

    expect(summary).toEqual({
      totalChecks: 3,
      passedCheckCount: 1,
      failedCheckCount: 2,
      firstFailedCheck: "devEnvironment",
      passedChecks: ["wasmPack"],
      failedChecks: ["devEnvironment", "client"],
    });
  });

  it("derives failure messages from nested report structures", () => {
    expect(deriveFailureMessageFromReport(null)).toBeNull();
    expect(deriveFailureMessageFromReport({})).toBeNull();
    expect(
      deriveFailureMessageFromReport({ message: "top-level failure message" })
    ).toBe("top-level failure message");
    expect(
      deriveFailureMessageFromReport({ requiredFailures: 2 })
    ).toBe("2 required check(s) failed.");
    expect(
      deriveFailureMessageFromReport({
        steps: [
          { name: "Skipped", passed: false, skipped: true },
          {
            name: "WASM artifact preflight",
            passed: false,
            skipped: false,
            report: { message: "artifact missing" },
          },
        ],
      })
    ).toBe("WASM artifact preflight: artifact missing");
    expect(
      deriveFailureMessageFromReport({
        steps: [
          {
            name: "TypeScript typecheck",
            passed: false,
            skipped: false,
            reason: "previous step failed",
          },
        ],
      })
    ).toBe("TypeScript typecheck: previous step failed");
    expect(
      deriveFailureMessageFromReport({
        steps: [{ name: "Client checks", passed: false, skipped: false }],
      })
    ).toBe("Client checks failed.");
  });
});
