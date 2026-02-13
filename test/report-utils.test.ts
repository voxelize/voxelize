import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPORT_SCHEMA_VERSION,
  createTimedReportBuilder,
  deriveFailureMessageFromReport,
  parseJsonOutput,
  resolveLastOptionValue,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
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

  it("ignores primitive json values in output parsing", () => {
    expect(parseJsonOutput("true")).toBeNull();
    expect(parseJsonOutput("123")).toBeNull();
    expect(parseJsonOutput("\"text\"")).toBeNull();
  });

  it("returns null for whitespace-only output", () => {
    expect(parseJsonOutput("   \n\t  \n")).toBeNull();
  });

  it("returns null for ansi-only output", () => {
    expect(parseJsonOutput("\u001b[31m\u001b[0m\u001b[2K")).toBeNull();
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

  it("parses pretty-printed json blocks when logs are present", () => {
    expect(
      parseJsonOutput(
        `warning: before\n{\n  "ok": true,\n  "exitCode": 0\n}\nwarning: after`
      )
    ).toEqual({ ok: true, exitCode: 0 });
    expect(
      parseJsonOutput(
        `warning: before\n[\n  {\n    "name": "devEnvironment"\n  },\n  {\n    "name": "client"\n  }\n]\nwarning: after`
      )
    ).toEqual([{ name: "devEnvironment" }, { name: "client" }]);
    expect(
      parseJsonOutput(`warning: before\n42\n{"ok":true}`)
    ).toEqual({ ok: true });
  });

  it("prefers the latest complete json block in mixed output", () => {
    expect(
      parseJsonOutput(
        `{"check":"first","passed":true}\nwarning: separator\n{\n  "check": "second",\n  "passed": false\n}`
      )
    ).toEqual({ check: "second", passed: false });
  });

  it("parses json output containing ansi color sequences", () => {
    expect(
      parseJsonOutput(
        `\u001b[31mwarning:\u001b[0m before\n\u001b[32m{\u001b[0m\n  "ok": true,\n  "exitCode": 0\n}`
      )
    ).toEqual({ ok: true, exitCode: 0 });
    expect(
      parseJsonOutput(`\u001b[33m{"ok":true,"exitCode":0}\u001b[0m`)
    ).toEqual({ ok: true, exitCode: 0 });
    expect(
      parseJsonOutput(
        `\u001b[2K{\n  "ok": true,\n  "exitCode": 0\n}\u001b[2K`
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

    const outputAfterTerminator = resolveOutputPath(
      ["--json", "--", "--output", "./report.json"],
      "/workspace"
    );
    expect(outputAfterTerminator.error).toBeNull();
    expect(outputAfterTerminator.outputPath).toBeNull();

    const outputBeforeTerminator = resolveOutputPath(
      ["--json", "--output", "./report.json", "--", "--output"],
      "/workspace"
    );
    expect(outputBeforeTerminator.error).toBeNull();
    expect(outputBeforeTerminator.outputPath).toBe("/workspace/report.json");

    const inlineValue = resolveOutputPath(
      ["--json", "--output=./inline-report.json"],
      "/workspace"
    );
    expect(inlineValue.error).toBeNull();
    expect(inlineValue.outputPath).toBe("/workspace/inline-report.json");

    const inlineMissingValue = resolveOutputPath(
      ["--json", "--output="],
      "/workspace"
    );
    expect(inlineMissingValue.error).toBe("Missing value for --output option.");
    expect(inlineMissingValue.outputPath).toBeNull();

    const inlineBeforeMissingTrailing = resolveOutputPath(
      ["--json", "--output=./first-inline.json", "--output="],
      "/workspace"
    );
    expect(inlineBeforeMissingTrailing.error).toBe(
      "Missing value for --output option."
    );
    expect(inlineBeforeMissingTrailing.outputPath).toBeNull();
  });

  it("resolves last option values for both split and inline forms", () => {
    const noOption = resolveLastOptionValue(["--json"], "--output");
    expect(noOption.hasOption).toBe(false);
    expect(noOption.value).toBeNull();
    expect(noOption.error).toBeNull();

    const splitValue = resolveLastOptionValue(
      ["--json", "--output", "./report.json"],
      "--output"
    );
    expect(splitValue.hasOption).toBe(true);
    expect(splitValue.value).toBe("./report.json");
    expect(splitValue.error).toBeNull();

    const inlineValue = resolveLastOptionValue(
      ["--json", "--output=./report.json"],
      "--output"
    );
    expect(inlineValue.hasOption).toBe(true);
    expect(inlineValue.value).toBe("./report.json");
    expect(inlineValue.error).toBeNull();

    const missingSplitValue = resolveLastOptionValue(
      ["--json", "--output"],
      "--output"
    );
    expect(missingSplitValue.hasOption).toBe(true);
    expect(missingSplitValue.value).toBeNull();
    expect(missingSplitValue.error).toBe("Missing value for --output option.");

    const missingInlineValue = resolveLastOptionValue(
      ["--json", "--output="],
      "--output"
    );
    expect(missingInlineValue.hasOption).toBe(true);
    expect(missingInlineValue.value).toBeNull();
    expect(missingInlineValue.error).toBe("Missing value for --output option.");

    const inlineAfterMissingSplit = resolveLastOptionValue(
      ["--json", "--output", "--quiet", "--output=./final.json"],
      "--output"
    );
    expect(inlineAfterMissingSplit.hasOption).toBe(true);
    expect(inlineAfterMissingSplit.value).toBe("./final.json");
    expect(inlineAfterMissingSplit.error).toBeNull();

    const ignoresAfterTerminator = resolveLastOptionValue(
      ["--json", "--", "--output=./ignored.json"],
      "--output"
    );
    expect(ignoresAfterTerminator.hasOption).toBe(false);
    expect(ignoresAfterTerminator.value).toBeNull();
    expect(ignoresAfterTerminator.error).toBeNull();
  });

  it("splits option and positional args using option terminator", () => {
    const withoutTerminator = splitCliArgs(["--json", "--output", "report.json"]);
    expect(withoutTerminator.optionArgs).toEqual([
      "--json",
      "--output",
      "report.json",
    ]);
    expect(withoutTerminator.positionalArgs).toEqual([]);
    expect(withoutTerminator.optionTerminatorUsed).toBe(false);

    const withTerminator = splitCliArgs([
      "--json",
      "--output",
      "report.json",
      "--",
      "--output",
      "positional",
    ]);
    expect(withTerminator.optionArgs).toEqual([
      "--json",
      "--output",
      "report.json",
    ]);
    expect(withTerminator.positionalArgs).toEqual(["--output", "positional"]);
    expect(withTerminator.optionTerminatorUsed).toBe(true);
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

  it("serializes reports with optional output writes", () => {
    const report = {
      passed: true,
      exitCode: 0,
      outputPath: null,
    };
    const noWriteResult = serializeReportWithOptionalWrite(report, {
      jsonFormat: { compact: true },
      outputPath: null,
      buildTimedReport: createTimedReportBuilder(),
    });
    const parsedNoWriteResult = JSON.parse(noWriteResult.reportJson) as {
      schemaVersion: number;
      passed: boolean;
      exitCode: number;
      outputPath: string | null;
    };

    expect(noWriteResult.writeError).toBeNull();
    expect(parsedNoWriteResult.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(parsedNoWriteResult.passed).toBe(true);
    expect(parsedNoWriteResult.exitCode).toBe(0);
    expect(parsedNoWriteResult.outputPath).toBeNull();

    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "report-utils-serialize-write-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");
    const withWriteResult = serializeReportWithOptionalWrite(
      {
        ...report,
        outputPath,
      },
      {
        jsonFormat: { compact: false },
        outputPath,
        buildTimedReport: createTimedReportBuilder(),
      }
    );
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
      schemaVersion: number;
      outputPath: string;
      passed: boolean;
    };

    expect(withWriteResult.writeError).toBeNull();
    expect(fileReport.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.passed).toBe(true);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns a structured fallback report when output write fails", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "report-utils-serialize-failure-")
    );
    const timedReportBuilder = createTimedReportBuilder(
      (() => {
        let tick = 0;
        return () => {
          tick += 1;
          return tick * 1000;
        };
      })(),
      (value) => `iso-${value}`
    );
    const writeFailureResult = serializeReportWithOptionalWrite(
      {
        passed: true,
        exitCode: 0,
        outputPath: tempDirectory,
      },
      {
        jsonFormat: { compact: true },
        outputPath: tempDirectory,
        buildTimedReport: timedReportBuilder,
      }
    );
    const parsedWriteFailureResult = JSON.parse(
      writeFailureResult.reportJson
    ) as {
      schemaVersion: number;
      passed: boolean;
      exitCode: number;
      outputPath: string;
      writeError: string;
      message: string;
      startedAt: string;
      endedAt: string;
      durationMs: number;
    };

    expect(writeFailureResult.writeError).toContain(
      `Failed to write report to ${tempDirectory}.`
    );
    expect(parsedWriteFailureResult.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(parsedWriteFailureResult.passed).toBe(false);
    expect(parsedWriteFailureResult.exitCode).toBe(1);
    expect(parsedWriteFailureResult.outputPath).toBe(tempDirectory);
    expect(parsedWriteFailureResult.writeError).toContain(
      `Failed to write report to ${tempDirectory}.`
    );
    expect(parsedWriteFailureResult.message).toContain(
      `Failed to write report to ${tempDirectory}.`
    );
    expect(parsedWriteFailureResult.startedAt).toBe("iso-1000");
    expect(parsedWriteFailureResult.endedAt).toBe("iso-2000");
    expect(parsedWriteFailureResult.durationMs).toBe(1000);

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
