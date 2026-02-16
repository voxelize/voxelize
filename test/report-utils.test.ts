import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPORT_SCHEMA_VERSION,
  countRecordEntries,
  createCliOptionCatalog,
  createCliDiagnostics,
  createPrefixedTsCoreExampleSummary,
  createPrefixedWasmPackCheckSummary,
  createTimedReportBuilder,
  createCliOptionValidation,
  deriveWasmPackCheckStatus,
  deriveCliValidationFailureMessage,
  deriveFailureMessageFromReport,
  extractTsCoreExampleSummaryFromReport,
  extractWasmPackCheckSummaryFromReport,
  extractWasmPackStatusFromReport,
  hasCliOption,
  parseActiveCliOptionMetadata,
  parseJsonOutput,
  parseUnknownCliOptions,
  normalizeTsCorePayloadIssues,
  resolveLastOptionValue,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
  summarizeTsCoreExampleOutput,
  summarizeCheckFailureResults,
  summarizeCheckResults,
  summarizeStepFailureResults,
  summarizeStepResults,
  toReport,
  toReportJson,
  writeReportToPath,
} from "../scripts/report-utils.mjs";

const createPartiallyRecoveredStringArray = (
  values: readonly string[],
  trappedIndex = 1
): string[] => {
  const clonedValues = [...values];
  return new Proxy(clonedValues, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        throw new Error("iterator trap");
      }
      if (property === "length") {
        return clonedValues.length;
      }
      if (property === String(trappedIndex)) {
        throw new Error("read trap");
      }
      return Reflect.get(target, property, receiver);
    },
  });
};

const createLengthTrappedPartiallyRecoveredStringArray = (
  values: readonly string[],
  trappedIndex = 1
): string[] => {
  const clonedValues = [...values];
  return new Proxy(clonedValues, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        throw new Error("iterator trap");
      }
      if (property === "length") {
        throw new Error("length trap");
      }
      if (property === String(trappedIndex)) {
        throw new Error("read trap");
      }
      return Reflect.get(target, property, receiver);
    },
  });
};

const createFullyTrappedStringArray = (values: readonly string[]): string[] => {
  const clonedValues = [...values];
  return new Proxy(clonedValues, {
    ownKeys() {
      throw new Error("ownKeys trap");
    },
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        throw new Error("iterator trap");
      }
      if (property === "length") {
        throw new Error("length trap");
      }
      return Reflect.get(target, property, receiver);
    },
  });
};

describe("report-utils", () => {
  it("parses valid json output", () => {
    expect(parseJsonOutput("{\"ok\":true}")).toEqual({ ok: true });
  });

  it("returns null for invalid or empty json output", () => {
    expect(parseJsonOutput("")).toBeNull();
    expect(parseJsonOutput("not-json")).toBeNull();
    expect(parseJsonOutput(null)).toBeNull();
    expect(parseJsonOutput(42)).toBeNull();
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

  it("prefers the latest inline json object in single-line mixed output", () => {
    expect(
      parseJsonOutput(
        `progress={"step":"first","ok":true} progress={"step":"second","ok":false}`
      )
    ).toEqual({ step: "second", ok: false });
  });

  it("prefers the latest inline json array in single-line mixed output", () => {
    expect(
      parseJsonOutput(
        `checks=[{"name":"first","ok":true}] checks=[{"name":"second","ok":false}]`
      )
    ).toEqual([{ name: "second", ok: false }]);
  });

  it("prefers the last inline json payload across object/array shapes", () => {
    expect(
      parseJsonOutput(
        `status={"phase":"first","ok":true} checks=[{"phase":"second","ok":false}]`
      )
    ).toEqual([{ phase: "second", ok: false }]);
  });

  it("parses the latest object from concatenated json payloads", () => {
    expect(parseJsonOutput(`{"step":"first"}{"step":"second"}`)).toEqual({
      step: "second",
    });
  });

  it("parses the latest payload from concatenated mixed json shapes", () => {
    expect(parseJsonOutput(`[{"step":"first"}]{"step":"second"}`)).toEqual({
      step: "second",
    });
    expect(parseJsonOutput(`{"step":"first"}[{"step":"second"}]`)).toEqual([
      { step: "second" },
    ]);
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

  it("parses json output containing ansi osc hyperlink sequences", () => {
    expect(
      parseJsonOutput(
        `\u001b]8;;https://example.com\u0007{"ok":true,"exitCode":0}\u001b]8;;\u0007`
      )
    ).toEqual({ ok: true, exitCode: 0 });
    expect(
      parseJsonOutput(
        `\u001b]8;;https://example.com\u001b\\{\n  "ok": true,\n  "exitCode": 0\n}\u001b]8;;\u001b\\`
      )
    ).toEqual({ ok: true, exitCode: 0 });
  });

  it("parses json output containing c1 ansi escape sequences", () => {
    expect(
      parseJsonOutput(`\u009b31m{"ok":true,"exitCode":0}\u009b0m`)
    ).toEqual({ ok: true, exitCode: 0 });
    expect(
      parseJsonOutput(
        `\u009d8;;https://example.com\u0007{"ok":true,"exitCode":0}\u009d8;;\u0007`
      )
    ).toEqual({ ok: true, exitCode: 0 });
    expect(
      parseJsonOutput(
        `\u009d8;;https://example.com\u009c{\n  "ok": true,\n  "exitCode": 0\n}\u009d8;;\u009c`
      )
    ).toEqual({ ok: true, exitCode: 0 });
  });

  it("parses json output containing UTF-8 BOM prefixes", () => {
    expect(parseJsonOutput(`\uFEFF{"ok":true,"exitCode":0}`)).toEqual({
      ok: true,
      exitCode: 0,
    });
    expect(
      parseJsonOutput(
        `warning: before\n\uFEFF{"ok":false,"exitCode":2}\nwarning: after`
      )
    ).toEqual({
      ok: false,
      exitCode: 2,
    });
    expect(parseJsonOutput(`progress\r\uFEFF{"ok":true}`)).toEqual({
      ok: true,
    });
    expect(
      parseJsonOutput(`\u001b[33m\uFEFF{"ok":true,"exitCode":0}\u001b[39m`)
    ).toEqual({
      ok: true,
      exitCode: 0,
    });
  });

  it("parses json output containing carriage-return progress updates", () => {
    expect(parseJsonOutput(`progress: checking\r{"ok":true}`)).toEqual({
      ok: true,
    });
    expect(
      parseJsonOutput(
        `progress: checking\r\u001b]8;;https://example.com\u0007{"ok":true}\u001b]8;;\u0007`
      )
    ).toEqual({ ok: true });
  });

  it("parses json output containing raw control characters", () => {
    expect(parseJsonOutput(`progress:\u0008\u0008\u0008{"ok":true}`)).toEqual({
      ok: true,
    });
    expect(
      parseJsonOutput(`progress:\u007f\u0000\u001f{"ok":true,"exitCode":0}`)
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

    const emptySplitValue = resolveOutputPath(
      ["--json", "--output", ""],
      "/workspace"
    );
    expect(emptySplitValue.error).toBe("Missing value for --output option.");
    expect(emptySplitValue.outputPath).toBeNull();

    const whitespaceSplitValue = resolveOutputPath(
      ["--json", "--output", "   "],
      "/workspace"
    );
    expect(whitespaceSplitValue.error).toBe("Missing value for --output option.");
    expect(whitespaceSplitValue.outputPath).toBeNull();

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

    const inlineWhitespaceValue = resolveOutputPath(
      ["--json", "--output=   "],
      "/workspace"
    );
    expect(inlineWhitespaceValue.error).toBe("Missing value for --output option.");
    expect(inlineWhitespaceValue.outputPath).toBeNull();

    const inlineBeforeMissingTrailing = resolveOutputPath(
      ["--json", "--output=./first-inline.json", "--output="],
      "/workspace"
    );
    expect(inlineBeforeMissingTrailing.error).toBe(
      "Missing value for --output option."
    );
    expect(inlineBeforeMissingTrailing.outputPath).toBeNull();

    const recognizedAliasTokenAfterOutput = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      ["--output", "--list-checks", "-l"]
    );
    expect(recognizedAliasTokenAfterOutput.error).toBe(
      "Missing value for --output option."
    );
    expect(recognizedAliasTokenAfterOutput.outputPath).toBeNull();

    const unknownDashPrefixedValueAfterOutput = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      ["--output", "--list-checks", "-l"]
    );
    expect(unknownDashPrefixedValueAfterOutput.error).toBeNull();
    expect(unknownDashPrefixedValueAfterOutput.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );

    const recognizedInlineAliasMisuseAfterOutput = resolveOutputPath(
      ["--output", "-l=1"],
      "/workspace",
      ["--output", "--list-checks", "-l"]
    );
    expect(recognizedInlineAliasMisuseAfterOutput.error).toBe(
      "Missing value for --output option."
    );
    expect(recognizedInlineAliasMisuseAfterOutput.outputPath).toBeNull();

    const recognizedLongAliasAfterOutput = resolveOutputPath(
      ["--output", "--verify"],
      "/workspace",
      ["--output", "--no-build", "--verify"]
    );
    expect(recognizedLongAliasAfterOutput.error).toBe(
      "Missing value for --output option."
    );
    expect(recognizedLongAliasAfterOutput.outputPath).toBeNull();

    const recognizedCanonicalNoBuildAfterOutput = resolveOutputPath(
      ["--output", "--no-build"],
      "/workspace",
      ["--output", "--no-build", "--verify"]
    );
    expect(recognizedCanonicalNoBuildAfterOutput.error).toBe(
      "Missing value for --output option."
    );
    expect(recognizedCanonicalNoBuildAfterOutput.outputPath).toBeNull();

    const recognizedAliasBeforeValidTrailingOutput = resolveOutputPath(
      ["--output", "-l", "--output=./final-report.json"],
      "/workspace",
      ["--output", "--list-checks", "-l"]
    );
    expect(recognizedAliasBeforeValidTrailingOutput.error).toBeNull();
    expect(recognizedAliasBeforeValidTrailingOutput.outputPath).toBe(
      "/workspace/final-report.json"
    );

    const recognizedNoBuildAliasBeforeValidTrailingOutput = resolveOutputPath(
      ["--output", "--verify", "--output=./final-report.json"],
      "/workspace",
      ["--output", "--no-build", "--verify"]
    );
    expect(recognizedNoBuildAliasBeforeValidTrailingOutput.error).toBeNull();
    expect(recognizedNoBuildAliasBeforeValidTrailingOutput.outputPath).toBe(
      "/workspace/final-report.json"
    );

    const inlineNoBuildMisuseBeforeValidTrailingOutput = resolveOutputPath(
      ["--output", "--verify=1", "--output=./final-report.json"],
      "/workspace",
      ["--output", "--no-build", "--verify"]
    );
    expect(inlineNoBuildMisuseBeforeValidTrailingOutput.error).toBeNull();
    expect(inlineNoBuildMisuseBeforeValidTrailingOutput.outputPath).toBe(
      "/workspace/final-report.json"
    );

    const recognizedOnlyInlineTokenBeforeTrailingOutput = resolveOutputPath(
      ["--output", "--only=client", "--output=./final-report.json"],
      "/workspace",
      ["--output", "--only"]
    );
    expect(recognizedOnlyInlineTokenBeforeTrailingOutput.error).toBeNull();
    expect(recognizedOnlyInlineTokenBeforeTrailingOutput.outputPath).toBe(
      "/workspace/final-report.json"
    );
    const nonArrayRecognizedOutputTokens = new Set(["-l"]);
    const nonArrayRecognizedOutputTokenResult = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      nonArrayRecognizedOutputTokens as never
    );
    expect(nonArrayRecognizedOutputTokenResult.error).toBe(
      "Missing value for --output option."
    );
    expect(nonArrayRecognizedOutputTokenResult.outputPath).toBeNull();
    const nonArrayRecognizedOutputDashValueResult = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      nonArrayRecognizedOutputTokens as never
    );
    expect(nonArrayRecognizedOutputDashValueResult.error).toBeNull();
    expect(nonArrayRecognizedOutputDashValueResult.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );
    const mapRecognizedOutputTokens = new Map<string, boolean>([
      ["-l", true],
    ]);
    const mapRecognizedOutputTokenResult = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      mapRecognizedOutputTokens as never
    );
    expect(mapRecognizedOutputTokenResult.error).toBe(
      "Missing value for --output option."
    );
    expect(mapRecognizedOutputTokenResult.outputPath).toBeNull();
    const mapRecognizedOutputDashValueResult = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      mapRecognizedOutputTokens as never
    );
    expect(mapRecognizedOutputDashValueResult.error).toBeNull();
    expect(mapRecognizedOutputDashValueResult.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );
    const malformedPrimitiveRecognizedOutputTokens = "--list-checks";
    const malformedPrimitiveRecognizedOutputTokenResult = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      malformedPrimitiveRecognizedOutputTokens as never
    );
    expect(malformedPrimitiveRecognizedOutputTokenResult.error).toBe(
      "Missing value for --output option."
    );
    expect(malformedPrimitiveRecognizedOutputTokenResult.outputPath).toBeNull();
    const malformedPrimitiveRecognizedOutputDashValueResult = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      malformedPrimitiveRecognizedOutputTokens as never
    );
    expect(malformedPrimitiveRecognizedOutputDashValueResult.error).toBeNull();
    expect(malformedPrimitiveRecognizedOutputDashValueResult.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );
    const malformedArrayRecognizedOutputTokens = ["--list-checks", 1];
    const malformedArrayRecognizedOutputTokenResult = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      malformedArrayRecognizedOutputTokens as never
    );
    expect(malformedArrayRecognizedOutputTokenResult.error).toBe(
      "Missing value for --output option."
    );
    expect(malformedArrayRecognizedOutputTokenResult.outputPath).toBeNull();
    const malformedArrayRecognizedOutputDashValueResult = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      malformedArrayRecognizedOutputTokens as never
    );
    expect(malformedArrayRecognizedOutputDashValueResult.error).toBeNull();
    expect(malformedArrayRecognizedOutputDashValueResult.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );

    const malformedRecognizedOutputTokens = new Proxy(
      ["--list-checks", "-l"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const malformedRecognizedOutputTokenResult = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      malformedRecognizedOutputTokens as never
    );
    expect(malformedRecognizedOutputTokenResult.error).toBe(
      "Missing value for --output option."
    );
    expect(malformedRecognizedOutputTokenResult.outputPath).toBeNull();
    const malformedRecognizedDashValueResult = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      malformedRecognizedOutputTokens as never
    );
    expect(malformedRecognizedDashValueResult.error).toBeNull();
    expect(malformedRecognizedDashValueResult.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );
    const malformedRecognizedInlineAliasMisuseResult = resolveOutputPath(
      ["--output", "-l=1"],
      "/workspace",
      malformedRecognizedOutputTokens as never
    );
    expect(malformedRecognizedInlineAliasMisuseResult.error).toBe(
      "Missing value for --output option."
    );
    expect(malformedRecognizedInlineAliasMisuseResult.outputPath).toBeNull();
    const malformedRecognizedSingleDashValueResult = resolveOutputPath(
      ["--output", "-"],
      "/workspace",
      malformedRecognizedOutputTokens as never
    );
    expect(malformedRecognizedSingleDashValueResult.error).toBeNull();
    expect(malformedRecognizedSingleDashValueResult.outputPath).toBe(
      "/workspace/-"
    );
    const malformedRecognizedDashEqualsValueResult = resolveOutputPath(
      ["--output", "-=token"],
      "/workspace",
      malformedRecognizedOutputTokens as never
    );
    expect(malformedRecognizedDashEqualsValueResult.error).toBeNull();
    expect(malformedRecognizedDashEqualsValueResult.outputPath).toBe(
      "/workspace/-=token"
    );
    const malformedRecognizedNumericDashValueResult = resolveOutputPath(
      ["--output", "-9"],
      "/workspace",
      malformedRecognizedOutputTokens as never
    );
    expect(malformedRecognizedNumericDashValueResult.error).toBeNull();
    expect(malformedRecognizedNumericDashValueResult.outputPath).toBe(
      "/workspace/-9"
    );
    let largeLengthRecognizedOutputTokenReadCount = 0;
    const largeLengthRecognizedOutputTokens = new Proxy(["-l"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (property === "0") {
          largeLengthRecognizedOutputTokenReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const largeLengthRecognizedOutputTokenResult = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      largeLengthRecognizedOutputTokens as never
    );
    expect(largeLengthRecognizedOutputTokenResult.error).toBe(
      "Missing value for --output option."
    );
    expect(largeLengthRecognizedOutputTokenResult.outputPath).toBeNull();
    const largeLengthRecognizedOutputDashValueResult = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      largeLengthRecognizedOutputTokens as never
    );
    expect(largeLengthRecognizedOutputDashValueResult.error).toBeNull();
    expect(largeLengthRecognizedOutputDashValueResult.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );
    expect(largeLengthRecognizedOutputTokenReadCount).toBe(4);
    const partiallyRecoveredRecognizedOutputTokens =
      createPartiallyRecoveredStringArray(["--list-checks", "-l"]);
    const partiallyRecoveredRecognizedOutputTokenResult = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      partiallyRecoveredRecognizedOutputTokens as never
    );
    expect(partiallyRecoveredRecognizedOutputTokenResult.error).toBe(
      "Missing value for --output option."
    );
    expect(partiallyRecoveredRecognizedOutputTokenResult.outputPath).toBeNull();
    const partiallyRecoveredRecognizedDashValueResult = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      partiallyRecoveredRecognizedOutputTokens as never
    );
    expect(partiallyRecoveredRecognizedDashValueResult.error).toBeNull();
    expect(partiallyRecoveredRecognizedDashValueResult.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );
    const partiallyRecoveredRecognizedOutputTokensAtIndexZero =
      createPartiallyRecoveredStringArray(["--list-checks", "-l"], 0);
    const partiallyRecoveredRecognizedOutputTokenResultAtIndexZero =
      resolveOutputPath(
        ["--output", "-l"],
        "/workspace",
        partiallyRecoveredRecognizedOutputTokensAtIndexZero as never
      );
    expect(partiallyRecoveredRecognizedOutputTokenResultAtIndexZero.error).toBe(
      "Missing value for --output option."
    );
    expect(
      partiallyRecoveredRecognizedOutputTokenResultAtIndexZero.outputPath
    ).toBeNull();
    const partiallyRecoveredRecognizedDashValueResultAtIndexZero =
      resolveOutputPath(
        ["--output", "-artifact-report.json"],
        "/workspace",
        partiallyRecoveredRecognizedOutputTokensAtIndexZero as never
      );
    expect(partiallyRecoveredRecognizedDashValueResultAtIndexZero.error).toBeNull();
    expect(partiallyRecoveredRecognizedDashValueResultAtIndexZero.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );
    let statefulRecognizedOutputTokenReadCount = 0;
    const statefulRecognizedOutputTokens = new Proxy(["-l"], {
      get(target, property, receiver) {
        if (property === "0") {
          statefulRecognizedOutputTokenReadCount += 1;
          if (statefulRecognizedOutputTokenReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulRecognizedOutputTokenResult = resolveOutputPath(
      ["--output", "-l"],
      "/workspace",
      statefulRecognizedOutputTokens as never
    );
    expect(statefulRecognizedOutputTokenResult.error).toBe(
      "Missing value for --output option."
    );
    expect(statefulRecognizedOutputTokenResult.outputPath).toBeNull();
    const statefulRecognizedOutputDashValueResult = resolveOutputPath(
      ["--output", "-artifact-report.json"],
      "/workspace",
      statefulRecognizedOutputTokens as never
    );
    expect(statefulRecognizedOutputDashValueResult.error).toBeNull();
    expect(statefulRecognizedOutputDashValueResult.outputPath).toBe(
      "/workspace/-artifact-report.json"
    );

    const lengthAndOwnKeysTrapOutputArgs = new Proxy(
      ["--output", "./report.json"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const lengthAndOwnKeysTrapOutput = resolveOutputPath(
      lengthAndOwnKeysTrapOutputArgs as never,
      "/workspace"
    );
    expect(lengthAndOwnKeysTrapOutput.error).toBeNull();
    expect(lengthAndOwnKeysTrapOutput.outputPath).toBeNull();
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

    const emptySplitValue = resolveLastOptionValue(
      ["--json", "--output", ""],
      "--output"
    );
    expect(emptySplitValue.hasOption).toBe(true);
    expect(emptySplitValue.value).toBeNull();
    expect(emptySplitValue.error).toBe("Missing value for --output option.");

    const whitespaceSplitValue = resolveLastOptionValue(
      ["--json", "--output", "   "],
      "--output"
    );
    expect(whitespaceSplitValue.hasOption).toBe(true);
    expect(whitespaceSplitValue.value).toBeNull();
    expect(whitespaceSplitValue.error).toBe("Missing value for --output option.");

    const emptyOnlySplitValue = resolveLastOptionValue(
      ["--json", "--only", ""],
      "--only"
    );
    expect(emptyOnlySplitValue.hasOption).toBe(true);
    expect(emptyOnlySplitValue.value).toBeNull();
    expect(emptyOnlySplitValue.error).toBe("Missing value for --only option.");

    const whitespaceOnlySplitValue = resolveLastOptionValue(
      ["--json", "--only", "   "],
      "--only"
    );
    expect(whitespaceOnlySplitValue.hasOption).toBe(true);
    expect(whitespaceOnlySplitValue.value).toBeNull();
    expect(whitespaceOnlySplitValue.error).toBe(
      "Missing value for --only option."
    );

    const missingInlineValue = resolveLastOptionValue(
      ["--json", "--output="],
      "--output"
    );
    expect(missingInlineValue.hasOption).toBe(true);
    expect(missingInlineValue.value).toBeNull();
    expect(missingInlineValue.error).toBe("Missing value for --output option.");

    const whitespaceInlineValue = resolveLastOptionValue(
      ["--json", "--output=   "],
      "--output"
    );
    expect(whitespaceInlineValue.hasOption).toBe(true);
    expect(whitespaceInlineValue.value).toBeNull();
    expect(whitespaceInlineValue.error).toBe("Missing value for --output option.");

    const whitespaceInlineOnlyValue = resolveLastOptionValue(
      ["--json", "--only=   "],
      "--only"
    );
    expect(whitespaceInlineOnlyValue.hasOption).toBe(true);
    expect(whitespaceInlineOnlyValue.value).toBeNull();
    expect(whitespaceInlineOnlyValue.error).toBe(
      "Missing value for --only option."
    );

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

    const recognizedOptionTokenAsSplitValue = resolveLastOptionValue(
      ["--output", "-l"],
      "--output",
      ["--list-checks", "-l"]
    );
    expect(recognizedOptionTokenAsSplitValue.hasOption).toBe(true);
    expect(recognizedOptionTokenAsSplitValue.value).toBeNull();
    expect(recognizedOptionTokenAsSplitValue.error).toBe(
      "Missing value for --output option."
    );

    const unknownDashValueRemainsValid = resolveLastOptionValue(
      ["--output", "-artifact-report.json"],
      "--output",
      ["--list-checks", "-l"]
    );
    expect(unknownDashValueRemainsValid.hasOption).toBe(true);
    expect(unknownDashValueRemainsValid.value).toBe("-artifact-report.json");
    expect(unknownDashValueRemainsValid.error).toBeNull();

    const recognizedOnlyAliasAsSplitValue = resolveLastOptionValue(
      ["--only", "-l"],
      "--only",
      ["--list-checks", "-l"]
    );
    expect(recognizedOnlyAliasAsSplitValue.hasOption).toBe(true);
    expect(recognizedOnlyAliasAsSplitValue.value).toBeNull();
    expect(recognizedOnlyAliasAsSplitValue.error).toBe(
      "Missing value for --only option."
    );

    const recognizedOnlyAliasInlineMisuseAsSplitValue = resolveLastOptionValue(
      ["--only", "-l=1"],
      "--only",
      ["--list-checks", "-l"]
    );
    expect(recognizedOnlyAliasInlineMisuseAsSplitValue.hasOption).toBe(true);
    expect(recognizedOnlyAliasInlineMisuseAsSplitValue.value).toBeNull();
    expect(recognizedOnlyAliasInlineMisuseAsSplitValue.error).toBe(
      "Missing value for --only option."
    );

    const recognizedOnlyNoBuildAliasAsSplitValue = resolveLastOptionValue(
      ["--only", "--verify"],
      "--only",
      ["--only", "--no-build", "--verify"]
    );
    expect(recognizedOnlyNoBuildAliasAsSplitValue.hasOption).toBe(true);
    expect(recognizedOnlyNoBuildAliasAsSplitValue.value).toBeNull();
    expect(recognizedOnlyNoBuildAliasAsSplitValue.error).toBe(
      "Missing value for --only option."
    );

    const recognizedOnlyNoBuildAliasInlineMisuseAsSplitValue =
      resolveLastOptionValue(
        ["--only", "--verify=1"],
        "--only",
        ["--only", "--no-build", "--verify"]
      );
    expect(recognizedOnlyNoBuildAliasInlineMisuseAsSplitValue.hasOption).toBe(
      true
    );
    expect(recognizedOnlyNoBuildAliasInlineMisuseAsSplitValue.value).toBeNull();
    expect(recognizedOnlyNoBuildAliasInlineMisuseAsSplitValue.error).toBe(
      "Missing value for --only option."
    );

    const missingTrailingOnlyAfterNoBuildAlias = resolveLastOptionValue(
      ["--only", "devEnvironment", "--verify", "--only"],
      "--only",
      ["--only", "--no-build", "--verify"]
    );
    expect(missingTrailingOnlyAfterNoBuildAlias.hasOption).toBe(true);
    expect(missingTrailingOnlyAfterNoBuildAlias.value).toBeNull();
    expect(missingTrailingOnlyAfterNoBuildAlias.error).toBe(
      "Missing value for --only option."
    );

    const missingTrailingOnlyAfterNoBuildInlineMisuse = resolveLastOptionValue(
      ["--only", "devEnvironment", "--verify=1", "--only"],
      "--only",
      ["--only", "--no-build", "--verify"]
    );
    expect(missingTrailingOnlyAfterNoBuildInlineMisuse.hasOption).toBe(true);
    expect(missingTrailingOnlyAfterNoBuildInlineMisuse.value).toBeNull();
    expect(missingTrailingOnlyAfterNoBuildInlineMisuse.error).toBe(
      "Missing value for --only option."
    );

    const recognizedOutputLongAliasAsSplitValue = resolveLastOptionValue(
      ["--output", "--verify"],
      "--output",
      ["--no-build", "--verify"]
    );
    expect(recognizedOutputLongAliasAsSplitValue.hasOption).toBe(true);
    expect(recognizedOutputLongAliasAsSplitValue.value).toBeNull();
    expect(recognizedOutputLongAliasAsSplitValue.error).toBe(
      "Missing value for --output option."
    );

    const recognizedOutputCanonicalAsSplitValue = resolveLastOptionValue(
      ["--output", "--no-build"],
      "--output",
      ["--no-build", "--verify"]
    );
    expect(recognizedOutputCanonicalAsSplitValue.hasOption).toBe(true);
    expect(recognizedOutputCanonicalAsSplitValue.value).toBeNull();
    expect(recognizedOutputCanonicalAsSplitValue.error).toBe(
      "Missing value for --output option."
    );

    const recognizedAliasBeforeTrailingOutputValue = resolveLastOptionValue(
      ["--output", "-l", "--output=./final-report.json"],
      "--output",
      ["--output", "--list-checks", "-l"]
    );
    expect(recognizedAliasBeforeTrailingOutputValue.hasOption).toBe(true);
    expect(recognizedAliasBeforeTrailingOutputValue.value).toBe(
      "./final-report.json"
    );
    expect(recognizedAliasBeforeTrailingOutputValue.error).toBeNull();

    const recognizedAliasBeforeTrailingOnlyValue = resolveLastOptionValue(
      ["--only", "-l", "--only=client"],
      "--only",
      ["--only", "--list-checks", "-l"]
    );
    expect(recognizedAliasBeforeTrailingOnlyValue.hasOption).toBe(true);
    expect(recognizedAliasBeforeTrailingOnlyValue.value).toBe("client");
    expect(recognizedAliasBeforeTrailingOnlyValue.error).toBeNull();

    const recognizedNoBuildAliasBeforeTrailingOutputValue = resolveLastOptionValue(
      ["--output", "--verify", "--output=./final-report.json"],
      "--output",
      ["--output", "--no-build", "--verify"]
    );
    expect(recognizedNoBuildAliasBeforeTrailingOutputValue.hasOption).toBe(true);
    expect(recognizedNoBuildAliasBeforeTrailingOutputValue.value).toBe(
      "./final-report.json"
    );
    expect(recognizedNoBuildAliasBeforeTrailingOutputValue.error).toBeNull();

    const inlineNoBuildMisuseBeforeTrailingOutputValue = resolveLastOptionValue(
      ["--output", "--verify=1", "--output=./final-report.json"],
      "--output",
      ["--output", "--no-build", "--verify"]
    );
    expect(inlineNoBuildMisuseBeforeTrailingOutputValue.hasOption).toBe(true);
    expect(inlineNoBuildMisuseBeforeTrailingOutputValue.value).toBe(
      "./final-report.json"
    );
    expect(inlineNoBuildMisuseBeforeTrailingOutputValue.error).toBeNull();

    const recognizedNoBuildAliasBeforeTrailingOnlyValue = resolveLastOptionValue(
      ["--only", "--verify", "--only=client"],
      "--only",
      ["--only", "--no-build", "--verify"]
    );
    expect(recognizedNoBuildAliasBeforeTrailingOnlyValue.hasOption).toBe(true);
    expect(recognizedNoBuildAliasBeforeTrailingOnlyValue.value).toBe("client");
    expect(recognizedNoBuildAliasBeforeTrailingOnlyValue.error).toBeNull();

    const recognizedOutputInlineTokenBeforeTrailingOnlyValue =
      resolveLastOptionValue(
        ["--only", "--output=./report.json", "--only=client"],
        "--only",
        ["--only", "--output"]
      );
    expect(recognizedOutputInlineTokenBeforeTrailingOnlyValue.hasOption).toBe(
      true
    );
    expect(recognizedOutputInlineTokenBeforeTrailingOnlyValue.value).toBe(
      "client"
    );
    expect(recognizedOutputInlineTokenBeforeTrailingOnlyValue.error).toBeNull();
    const nonArrayRecognizedOptionTokens = new Set(["-l"]);
    const resolvedFromNonArrayRecognizedOptionTokens = resolveLastOptionValue(
      ["--output", "-l"],
      "--output",
      nonArrayRecognizedOptionTokens as never
    );
    expect(resolvedFromNonArrayRecognizedOptionTokens.hasOption).toBe(true);
    expect(resolvedFromNonArrayRecognizedOptionTokens.value).toBeNull();
    expect(resolvedFromNonArrayRecognizedOptionTokens.error).toBe(
      "Missing value for --output option."
    );
    const resolvedUnknownDashValueFromNonArrayRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        nonArrayRecognizedOptionTokens as never
      );
    expect(resolvedUnknownDashValueFromNonArrayRecognizedOptionTokens.hasOption).toBe(
      true
    );
    expect(resolvedUnknownDashValueFromNonArrayRecognizedOptionTokens.value).toBe(
      "-artifact-report.json"
    );
    expect(resolvedUnknownDashValueFromNonArrayRecognizedOptionTokens.error).toBeNull();
    const mapRecognizedOptionTokens = new Map<string, boolean>([["-l", true]]);
    const resolvedFromMapRecognizedOptionTokens = resolveLastOptionValue(
      ["--output", "-l"],
      "--output",
      mapRecognizedOptionTokens as never
    );
    expect(resolvedFromMapRecognizedOptionTokens.hasOption).toBe(true);
    expect(resolvedFromMapRecognizedOptionTokens.value).toBeNull();
    expect(resolvedFromMapRecognizedOptionTokens.error).toBe(
      "Missing value for --output option."
    );
    const resolvedUnknownDashValueFromMapRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        mapRecognizedOptionTokens as never
      );
    expect(resolvedUnknownDashValueFromMapRecognizedOptionTokens.hasOption).toBe(
      true
    );
    expect(resolvedUnknownDashValueFromMapRecognizedOptionTokens.value).toBe(
      "-artifact-report.json"
    );
    expect(resolvedUnknownDashValueFromMapRecognizedOptionTokens.error).toBeNull();
    const malformedPrimitiveRecognizedOptionTokens = "--list-checks";
    const resolvedFromMalformedPrimitiveRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-l"],
        "--output",
        malformedPrimitiveRecognizedOptionTokens as never
      );
    expect(resolvedFromMalformedPrimitiveRecognizedOptionTokens.hasOption).toBe(
      true
    );
    expect(resolvedFromMalformedPrimitiveRecognizedOptionTokens.value).toBeNull();
    expect(resolvedFromMalformedPrimitiveRecognizedOptionTokens.error).toBe(
      "Missing value for --output option."
    );
    const resolvedUnknownDashValueFromMalformedPrimitiveRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        malformedPrimitiveRecognizedOptionTokens as never
      );
    expect(
      resolvedUnknownDashValueFromMalformedPrimitiveRecognizedOptionTokens.hasOption
    ).toBe(true);
    expect(
      resolvedUnknownDashValueFromMalformedPrimitiveRecognizedOptionTokens.value
    ).toBe("-artifact-report.json");
    expect(
      resolvedUnknownDashValueFromMalformedPrimitiveRecognizedOptionTokens.error
    ).toBeNull();
    const malformedArrayRecognizedOptionTokens = ["--list-checks", 1];
    const resolvedFromMalformedArrayRecognizedOptionTokens = resolveLastOptionValue(
      ["--output", "-l"],
      "--output",
      malformedArrayRecognizedOptionTokens as never
    );
    expect(resolvedFromMalformedArrayRecognizedOptionTokens.hasOption).toBe(true);
    expect(resolvedFromMalformedArrayRecognizedOptionTokens.value).toBeNull();
    expect(resolvedFromMalformedArrayRecognizedOptionTokens.error).toBe(
      "Missing value for --output option."
    );
    const resolvedUnknownDashValueFromMalformedArrayRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        malformedArrayRecognizedOptionTokens as never
      );
    expect(
      resolvedUnknownDashValueFromMalformedArrayRecognizedOptionTokens.hasOption
    ).toBe(true);
    expect(
      resolvedUnknownDashValueFromMalformedArrayRecognizedOptionTokens.value
    ).toBe("-artifact-report.json");
    expect(
      resolvedUnknownDashValueFromMalformedArrayRecognizedOptionTokens.error
    ).toBeNull();

    const lengthAndOwnKeysTrapOptionArgs = new Proxy(
      ["--output", "./report.json"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const lengthAndOwnKeysTrapOptionResolution = resolveLastOptionValue(
      lengthAndOwnKeysTrapOptionArgs as never,
      "--output"
    );
    expect(lengthAndOwnKeysTrapOptionResolution.hasOption).toBe(false);
    expect(lengthAndOwnKeysTrapOptionResolution.value).toBeNull();
    expect(lengthAndOwnKeysTrapOptionResolution.error).toBeNull();
  });

  it("sanitizes malformed recognized option token lists in resolveLastOptionValue", () => {
    const recognizedOptionTokens = ["--list-checks", "-l"];
    Object.defineProperty(recognizedOptionTokens, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    const resolved = resolveLastOptionValue(
      ["--output", "-l"],
      "--output",
      recognizedOptionTokens as never
    );

    expect(resolved.hasOption).toBe(true);
    expect(resolved.value).toBeNull();
    expect(resolved.error).toBe("Missing value for --output option.");

    const lengthAndOwnKeysTrapRecognizedOptionTokens = new Proxy(
      ["--list-checks", "-l"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const resolvedFromCombinedRecognizedOptionTraps = resolveLastOptionValue(
      ["--output", "-l"],
      "--output",
      lengthAndOwnKeysTrapRecognizedOptionTokens as never
    );
    expect(resolvedFromCombinedRecognizedOptionTraps.hasOption).toBe(true);
    expect(resolvedFromCombinedRecognizedOptionTraps.value).toBeNull();
    expect(resolvedFromCombinedRecognizedOptionTraps.error).toBe(
      "Missing value for --output option."
    );
    const resolvedUnknownDashValueFromCombinedRecognizedOptionTraps =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        lengthAndOwnKeysTrapRecognizedOptionTokens as never
      );
    expect(resolvedUnknownDashValueFromCombinedRecognizedOptionTraps.hasOption).toBe(
      true
    );
    expect(
      resolvedUnknownDashValueFromCombinedRecognizedOptionTraps.value
    ).toBe("-artifact-report.json");
    expect(
      resolvedUnknownDashValueFromCombinedRecognizedOptionTraps.error
    ).toBeNull();
    const resolvedInlineAliasMisuseFromCombinedRecognizedOptionTraps =
      resolveLastOptionValue(
        ["--output", "-l=1"],
        "--output",
        lengthAndOwnKeysTrapRecognizedOptionTokens as never
      );
    expect(resolvedInlineAliasMisuseFromCombinedRecognizedOptionTraps.hasOption).toBe(
      true
    );
    expect(resolvedInlineAliasMisuseFromCombinedRecognizedOptionTraps.value).toBeNull();
    expect(resolvedInlineAliasMisuseFromCombinedRecognizedOptionTraps.error).toBe(
      "Missing value for --output option."
    );
    const resolvedSingleDashValueFromCombinedRecognizedOptionTraps =
      resolveLastOptionValue(
        ["--output", "-"],
        "--output",
        lengthAndOwnKeysTrapRecognizedOptionTokens as never
      );
    expect(resolvedSingleDashValueFromCombinedRecognizedOptionTraps.hasOption).toBe(
      true
    );
    expect(resolvedSingleDashValueFromCombinedRecognizedOptionTraps.value).toBe("-");
    expect(resolvedSingleDashValueFromCombinedRecognizedOptionTraps.error).toBeNull();
    const resolvedDashEqualsValueFromCombinedRecognizedOptionTraps =
      resolveLastOptionValue(
        ["--output", "-=token"],
        "--output",
        lengthAndOwnKeysTrapRecognizedOptionTokens as never
      );
    expect(resolvedDashEqualsValueFromCombinedRecognizedOptionTraps.hasOption).toBe(
      true
    );
    expect(resolvedDashEqualsValueFromCombinedRecognizedOptionTraps.value).toBe(
      "-=token"
    );
    expect(resolvedDashEqualsValueFromCombinedRecognizedOptionTraps.error).toBeNull();
    const resolvedNumericDashValueFromCombinedRecognizedOptionTraps =
      resolveLastOptionValue(
        ["--output", "-9"],
        "--output",
        lengthAndOwnKeysTrapRecognizedOptionTokens as never
      );
    expect(resolvedNumericDashValueFromCombinedRecognizedOptionTraps.hasOption).toBe(
      true
    );
    expect(resolvedNumericDashValueFromCombinedRecognizedOptionTraps.value).toBe(
      "-9"
    );
    expect(resolvedNumericDashValueFromCombinedRecognizedOptionTraps.error).toBeNull();
    const lengthTrappedRecognizedOptionTokens =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--list-checks",
        "-list",
      ], 2);
    const resolvedFromLengthTrappedRecognizedOptionTokens = resolveLastOptionValue(
      ["--output", "-list"],
      "--output",
      lengthTrappedRecognizedOptionTokens as never
    );
    expect(resolvedFromLengthTrappedRecognizedOptionTokens.hasOption).toBe(true);
    expect(resolvedFromLengthTrappedRecognizedOptionTokens.value).toBeNull();
    expect(resolvedFromLengthTrappedRecognizedOptionTokens.error).toBe(
      "Missing value for --output option."
    );
    const resolvedInlineAliasMisuseFromLengthTrappedRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-list=1"],
        "--output",
        lengthTrappedRecognizedOptionTokens as never
      );
    expect(
      resolvedInlineAliasMisuseFromLengthTrappedRecognizedOptionTokens.hasOption
    ).toBe(true);
    expect(
      resolvedInlineAliasMisuseFromLengthTrappedRecognizedOptionTokens.value
    ).toBeNull();
    expect(
      resolvedInlineAliasMisuseFromLengthTrappedRecognizedOptionTokens.error
    ).toBe("Missing value for --output option.");
    const resolvedDashValueFromLengthTrappedRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        lengthTrappedRecognizedOptionTokens as never
      );
    expect(resolvedDashValueFromLengthTrappedRecognizedOptionTokens.hasOption).toBe(
      true
    );
    expect(resolvedDashValueFromLengthTrappedRecognizedOptionTokens.value).toBe(
      "-artifact-report.json"
    );
    expect(resolvedDashValueFromLengthTrappedRecognizedOptionTokens.error).toBeNull();
    let largeLengthRecognizedTokenReadCount = 0;
    const largeLengthRecognizedOptionTokens = new Proxy(["-l"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (property === "0") {
          largeLengthRecognizedTokenReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const resolvedFromLargeLengthRecognizedOptionTokens = resolveLastOptionValue(
      ["--output", "-l"],
      "--output",
      largeLengthRecognizedOptionTokens as never
    );
    expect(resolvedFromLargeLengthRecognizedOptionTokens.hasOption).toBe(true);
    expect(resolvedFromLargeLengthRecognizedOptionTokens.value).toBeNull();
    expect(resolvedFromLargeLengthRecognizedOptionTokens.error).toBe(
      "Missing value for --output option."
    );
    const resolvedDashValueFromLargeLengthRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        largeLengthRecognizedOptionTokens as never
      );
    expect(resolvedDashValueFromLargeLengthRecognizedOptionTokens.hasOption).toBe(
      true
    );
    expect(resolvedDashValueFromLargeLengthRecognizedOptionTokens.value).toBe(
      "-artifact-report.json"
    );
    expect(resolvedDashValueFromLargeLengthRecognizedOptionTokens.error).toBeNull();
    expect(largeLengthRecognizedTokenReadCount).toBe(4);
    const partiallyRecoveredRecognizedOptionTokens =
      createPartiallyRecoveredStringArray(["--list-checks", "-l"]);
    const resolvedFromPartiallyRecoveredRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-l"],
        "--output",
        partiallyRecoveredRecognizedOptionTokens as never
      );
    expect(resolvedFromPartiallyRecoveredRecognizedOptionTokens.hasOption).toBe(
      true
    );
    expect(resolvedFromPartiallyRecoveredRecognizedOptionTokens.value).toBeNull();
    expect(resolvedFromPartiallyRecoveredRecognizedOptionTokens.error).toBe(
      "Missing value for --output option."
    );
    const resolvedUnknownDashValueFromPartiallyRecoveredRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        partiallyRecoveredRecognizedOptionTokens as never
      );
    expect(
      resolvedUnknownDashValueFromPartiallyRecoveredRecognizedOptionTokens.hasOption
    ).toBe(true);
    expect(
      resolvedUnknownDashValueFromPartiallyRecoveredRecognizedOptionTokens.value
    ).toBe("-artifact-report.json");
    expect(
      resolvedUnknownDashValueFromPartiallyRecoveredRecognizedOptionTokens.error
    ).toBeNull();
    const partiallyRecoveredRecognizedOptionTokensAtIndexZero =
      createPartiallyRecoveredStringArray(["--list-checks", "-l"], 0);
    const resolvedFromPartiallyRecoveredRecognizedOptionTokensAtIndexZero =
      resolveLastOptionValue(
        ["--output", "-l"],
        "--output",
        partiallyRecoveredRecognizedOptionTokensAtIndexZero as never
      );
    expect(
      resolvedFromPartiallyRecoveredRecognizedOptionTokensAtIndexZero.hasOption
    ).toBe(true);
    expect(
      resolvedFromPartiallyRecoveredRecognizedOptionTokensAtIndexZero.value
    ).toBeNull();
    expect(
      resolvedFromPartiallyRecoveredRecognizedOptionTokensAtIndexZero.error
    ).toBe("Missing value for --output option.");
    const resolvedUnknownDashValueFromPartiallyRecoveredRecognizedOptionTokensAtIndexZero =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        partiallyRecoveredRecognizedOptionTokensAtIndexZero as never
      );
    expect(
      resolvedUnknownDashValueFromPartiallyRecoveredRecognizedOptionTokensAtIndexZero.hasOption
    ).toBe(true);
    expect(
      resolvedUnknownDashValueFromPartiallyRecoveredRecognizedOptionTokensAtIndexZero.value
    ).toBe("-artifact-report.json");
    expect(
      resolvedUnknownDashValueFromPartiallyRecoveredRecognizedOptionTokensAtIndexZero.error
    ).toBeNull();
    let statefulRecognizedOptionTokenReadCount = 0;
    const statefulRecognizedOptionTokens = new Proxy(["-l"], {
      get(target, property, receiver) {
        if (property === "0") {
          statefulRecognizedOptionTokenReadCount += 1;
          if (statefulRecognizedOptionTokenReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const resolvedFromStatefulRecognizedOptionTokens = resolveLastOptionValue(
      ["--output", "-l"],
      "--output",
      statefulRecognizedOptionTokens as never
    );
    expect(resolvedFromStatefulRecognizedOptionTokens.hasOption).toBe(true);
    expect(resolvedFromStatefulRecognizedOptionTokens.value).toBeNull();
    expect(resolvedFromStatefulRecognizedOptionTokens.error).toBe(
      "Missing value for --output option."
    );
    const resolvedUnknownDashValueFromStatefulRecognizedOptionTokens =
      resolveLastOptionValue(
        ["--output", "-artifact-report.json"],
        "--output",
        statefulRecognizedOptionTokens as never
      );
    expect(resolvedUnknownDashValueFromStatefulRecognizedOptionTokens.hasOption).toBe(
      true
    );
    expect(resolvedUnknownDashValueFromStatefulRecognizedOptionTokens.value).toBe(
      "-artifact-report.json"
    );
    expect(resolvedUnknownDashValueFromStatefulRecognizedOptionTokens.error).toBeNull();
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

    const mixedTypeArgs = splitCliArgs([
      "--json",
      1 as never,
      "--",
      null as never,
      "--no-build",
    ]);
    expect(mixedTypeArgs.optionArgs).toEqual(["--json"]);
    expect(mixedTypeArgs.positionalArgs).toEqual(["--no-build"]);
    expect(mixedTypeArgs.optionTerminatorUsed).toBe(true);

    const iteratorTrapArgs = ["--json", "--output", "report.json"];
    Object.defineProperty(iteratorTrapArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const malformedArgs = splitCliArgs(iteratorTrapArgs as never);
    expect(malformedArgs.optionArgs).toEqual([
      "--json",
      "--output",
      "report.json",
    ]);
    expect(malformedArgs.positionalArgs).toEqual([]);
    expect(malformedArgs.optionTerminatorUsed).toBe(false);

    const largeLengthTrapArgs = new Proxy(["--json", "--mystery"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const largeLengthTrapResult = splitCliArgs(largeLengthTrapArgs as never);
    expect(largeLengthTrapResult.optionArgs).toEqual(["--json", "--mystery"]);
    expect(largeLengthTrapResult.positionalArgs).toEqual([]);
    expect(largeLengthTrapResult.optionTerminatorUsed).toBe(false);

    const ownKeysTrapArgs = new Proxy(["--json", "--output", "report.json"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const ownKeysTrapResult = splitCliArgs(ownKeysTrapArgs as never);
    expect(ownKeysTrapResult.optionArgs).toEqual([
      "--json",
      "--output",
      "report.json",
    ]);
    expect(ownKeysTrapResult.positionalArgs).toEqual([]);
    expect(ownKeysTrapResult.optionTerminatorUsed).toBe(false);

    const lengthAndOwnKeysTrapArgs = new Proxy(["--json"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const lengthAndOwnKeysTrapResult = splitCliArgs(lengthAndOwnKeysTrapArgs as never);
    expect(lengthAndOwnKeysTrapResult.optionArgs).toEqual([]);
    expect(lengthAndOwnKeysTrapResult.positionalArgs).toEqual([]);
    expect(lengthAndOwnKeysTrapResult.optionTerminatorUsed).toBe(false);

    const lengthTrapArgs = new Proxy(["--json", "--output", "report.json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const lengthTrapResult = splitCliArgs(lengthTrapArgs as never);
    expect(lengthTrapResult.optionArgs).toEqual([
      "--json",
      "--output",
      "report.json",
    ]);
    expect(lengthTrapResult.positionalArgs).toEqual([]);
    expect(lengthTrapResult.optionTerminatorUsed).toBe(false);

    let oversizedOwnKeysIndexProbeCount = 0;
    let oversizedOwnKeysIndexReadCount = 0;
    const oversizedOwnKeysTrapArgs = new Proxy(["--json", "--mystery"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      has(target, property) {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          oversizedOwnKeysIndexProbeCount += 1;
        }
        return Reflect.has(target, property);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          oversizedOwnKeysIndexReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const oversizedOwnKeysTrapResult = splitCliArgs(
      oversizedOwnKeysTrapArgs as never
    );
    expect(oversizedOwnKeysTrapResult.optionArgs).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(oversizedOwnKeysTrapResult.positionalArgs).toEqual([]);
    expect(oversizedOwnKeysTrapResult.optionTerminatorUsed).toBe(false);
    expect(oversizedOwnKeysIndexProbeCount).toBe(0);
    expect(oversizedOwnKeysIndexReadCount).toBe(2);

    let hasTrapFallbackReadCount = 0;
    const hasTrapFallbackArgs = new Proxy(["--json", "--mystery"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      has(target, property) {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          throw new Error("has trap");
        }
        return Reflect.has(target, property);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          hasTrapFallbackReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const hasTrapFallbackResult = splitCliArgs(hasTrapFallbackArgs as never);
    expect(hasTrapFallbackResult.optionArgs).toEqual(["--json", "--mystery"]);
    expect(hasTrapFallbackResult.positionalArgs).toEqual([]);
    expect(hasTrapFallbackResult.optionTerminatorUsed).toBe(false);
    expect(hasTrapFallbackReadCount).toBe(2);

    let descriptorTrapProbeCount = 0;
    let descriptorTrapReadCount = 0;
    const descriptorTrapFallbackArgs = new Proxy(["--json", "--mystery"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          descriptorTrapProbeCount += 1;
          throw new Error("descriptor trap");
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          descriptorTrapReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const descriptorTrapFallbackResult = splitCliArgs(
      descriptorTrapFallbackArgs as never
    );
    expect(descriptorTrapFallbackResult.optionArgs).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(descriptorTrapFallbackResult.positionalArgs).toEqual([]);
    expect(descriptorTrapFallbackResult.optionTerminatorUsed).toBe(false);
    expect(descriptorTrapProbeCount).toBe(1);
    expect(descriptorTrapReadCount).toBe(1_024);

    const sparseHighIndexArgs: string[] = [];
    sparseHighIndexArgs[5_000] = "--json";
    Object.defineProperty(sparseHighIndexArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const sparseHighIndexResult = splitCliArgs(sparseHighIndexArgs as never);
    expect(sparseHighIndexResult.optionArgs).toEqual(["--json"]);
    expect(sparseHighIndexResult.positionalArgs).toEqual([]);
    expect(sparseHighIndexResult.optionTerminatorUsed).toBe(false);

    const sparseMixedPrefixAndHighIndexArgs: string[] = [];
    sparseMixedPrefixAndHighIndexArgs[0] = "--json";
    sparseMixedPrefixAndHighIndexArgs[5_000] = "--mystery";
    Object.defineProperty(sparseMixedPrefixAndHighIndexArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const sparseMixedPrefixAndHighIndexResult = splitCliArgs(
      sparseMixedPrefixAndHighIndexArgs as never
    );
    expect(sparseMixedPrefixAndHighIndexResult.optionArgs).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(sparseMixedPrefixAndHighIndexResult.positionalArgs).toEqual([]);
    expect(sparseMixedPrefixAndHighIndexResult.optionTerminatorUsed).toBe(false);

    let statefulSparsePrefixReadCount = 0;
    const statefulSparseArgsTarget: string[] = [];
    statefulSparseArgsTarget[0] = "--json";
    statefulSparseArgsTarget[5_000] = "--mystery";
    const statefulSparseArgs = new Proxy(statefulSparseArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          statefulSparsePrefixReadCount += 1;
          if (statefulSparsePrefixReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulSparseResult = splitCliArgs(statefulSparseArgs as never);
    expect(statefulSparseResult.optionArgs).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(statefulSparseResult.positionalArgs).toEqual([]);
    expect(statefulSparseResult.optionTerminatorUsed).toBe(false);

    let statefulUndefinedPrefixReadCount = 0;
    const statefulUndefinedPrefixArgsTarget: string[] = [];
    statefulUndefinedPrefixArgsTarget[0] = "--json";
    statefulUndefinedPrefixArgsTarget[1] = "--mystery";
    const statefulUndefinedPrefixArgs = new Proxy(
      statefulUndefinedPrefixArgsTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulUndefinedPrefixReadCount += 1;
            if (statefulUndefinedPrefixReadCount === 1) {
              return undefined;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const statefulUndefinedPrefixResult = splitCliArgs(
      statefulUndefinedPrefixArgs as never
    );
    expect(statefulUndefinedPrefixResult.optionArgs).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(statefulUndefinedPrefixResult.positionalArgs).toEqual([]);
    expect(statefulUndefinedPrefixResult.optionTerminatorUsed).toBe(false);

    let statefulNullPrefixReadCount = 0;
    const statefulNullPrefixArgsTarget: string[] = [];
    statefulNullPrefixArgsTarget[0] = "--json";
    statefulNullPrefixArgsTarget[1] = "--mystery";
    const statefulNullPrefixArgs = new Proxy(statefulNullPrefixArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 2;
        }
        if (propertyKey === "0") {
          statefulNullPrefixReadCount += 1;
          if (statefulNullPrefixReadCount === 1) {
            return null;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulNullPrefixResult = splitCliArgs(statefulNullPrefixArgs as never);
    expect(statefulNullPrefixResult.optionArgs).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(statefulNullPrefixResult.positionalArgs).toEqual([]);
    expect(statefulNullPrefixResult.optionTerminatorUsed).toBe(false);

    let statefulNumericPrefixReadCount = 0;
    const statefulNumericPrefixArgsTarget: string[] = [];
    statefulNumericPrefixArgsTarget[0] = "--json";
    statefulNumericPrefixArgsTarget[1] = "--mystery";
    const statefulNumericPrefixArgs = new Proxy(statefulNumericPrefixArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 2;
        }
        if (propertyKey === "0") {
          statefulNumericPrefixReadCount += 1;
          if (statefulNumericPrefixReadCount === 1) {
            return 1;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulNumericPrefixResult = splitCliArgs(
      statefulNumericPrefixArgs as never
    );
    expect(statefulNumericPrefixResult.optionArgs).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(statefulNumericPrefixResult.positionalArgs).toEqual([]);
    expect(statefulNumericPrefixResult.optionTerminatorUsed).toBe(false);

    let equalLengthArgIndexZeroReadCount = 0;
    let equalLengthArgIndexOneReadCount = 0;
    const equalLengthReplacementArgsTarget: string[] = [];
    equalLengthReplacementArgsTarget[0] = "--json";
    equalLengthReplacementArgsTarget[1] = "--mystery";
    const equalLengthReplacementArgs = new Proxy(equalLengthReplacementArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 2;
        }
        if (propertyKey === "0") {
          equalLengthArgIndexZeroReadCount += 1;
          if (equalLengthArgIndexZeroReadCount === 1) {
            return 1;
          }
        }
        if (propertyKey === "1") {
          equalLengthArgIndexOneReadCount += 1;
          if (equalLengthArgIndexOneReadCount > 1) {
            return 1;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const equalLengthReplacementResult = splitCliArgs(
      equalLengthReplacementArgs as never
    );
    expect(equalLengthReplacementResult.optionArgs).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(equalLengthReplacementResult.positionalArgs).toEqual([]);
    expect(equalLengthReplacementResult.optionTerminatorUsed).toBe(false);
    let statefulStringToObjectReadCount = 0;
    const statefulStringToObjectArgsTarget: string[] = [];
    statefulStringToObjectArgsTarget[0] = "--json";
    const statefulStringToObjectArgs = new Proxy(statefulStringToObjectArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          statefulStringToObjectReadCount += 1;
          if (statefulStringToObjectReadCount > 1) {
            return { malformed: true };
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulStringToObjectResult = splitCliArgs(
      statefulStringToObjectArgs as never
    );
    expect(statefulStringToObjectResult.optionArgs).toEqual(["--json"]);
    expect(statefulStringToObjectResult.positionalArgs).toEqual([]);
    expect(statefulStringToObjectResult.optionTerminatorUsed).toBe(false);
    let statefulStringReplacementReadCount = 0;
    const statefulStringReplacementArgs = new Proxy(["--json"], {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          statefulStringReplacementReadCount += 1;
          if (statefulStringReplacementReadCount > 1) {
            return "--replaced";
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulStringReplacementResult = splitCliArgs(
      statefulStringReplacementArgs as never
    );
    expect(statefulStringReplacementResult.optionArgs).toEqual(["--json"]);
    expect(statefulStringReplacementResult.positionalArgs).toEqual([]);
    expect(statefulStringReplacementResult.optionTerminatorUsed).toBe(false);

    const cappedMergedFallbackArgsTarget: string[] = [];
    cappedMergedFallbackArgsTarget[0] = "--json";
    for (let index = 0; index < 1_024; index += 1) {
      cappedMergedFallbackArgsTarget[5_000 + index] = `--k${index}`;
    }
    const cappedFallbackKeyList = Array.from({ length: 1_024 }, (_, index) => {
      return String(5_000 + index);
    });
    const cappedMergedFallbackArgs = new Proxy(cappedMergedFallbackArgsTarget, {
      ownKeys() {
        return [...cappedFallbackKeyList, "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const cappedMergedFallbackResult = splitCliArgs(
      cappedMergedFallbackArgs as never
    );
    expect(cappedMergedFallbackResult.optionArgs).toHaveLength(1_024);
    expect(cappedMergedFallbackResult.optionArgs[0]).toBe("--json");
    expect(cappedMergedFallbackResult.optionArgs.includes("--k1022")).toBe(true);
    expect(cappedMergedFallbackResult.optionArgs.includes("--k1023")).toBe(false);
    expect(cappedMergedFallbackResult.positionalArgs).toEqual([]);
    expect(cappedMergedFallbackResult.optionTerminatorUsed).toBe(false);

    const cappedSupplementedFallbackArgsTarget: Array<string | number> = [];
    cappedSupplementedFallbackArgsTarget[0] = "--json";
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedFallbackArgsTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedFallbackArgsTarget[5_000 + index] = `--k${index}`;
    }
    const cappedSupplementedFallbackKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedFallbackArgs = new Proxy(
      cappedSupplementedFallbackArgsTarget,
      {
        ownKeys() {
          return [...cappedSupplementedFallbackKeyList, "length"];
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const cappedSupplementedFallbackResult = splitCliArgs(
      cappedSupplementedFallbackArgs as never
    );
    expect(cappedSupplementedFallbackResult.optionArgs).toHaveLength(1_024);
    expect(cappedSupplementedFallbackResult.optionArgs[0]).toBe("--json");
    expect(cappedSupplementedFallbackResult.optionArgs.includes("--k1022")).toBe(
      true
    );
    expect(cappedSupplementedFallbackResult.optionArgs.includes("--k1023")).toBe(
      false
    );
    expect(cappedSupplementedFallbackResult.positionalArgs).toEqual([]);
    expect(cappedSupplementedFallbackResult.optionTerminatorUsed).toBe(false);

    const uncappedSupplementedArgsTarget: string[] = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedSupplementedArgsTarget[5_000 + index] = `--high${index}`;
    }
    Object.defineProperty(uncappedSupplementedArgsTarget, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: function* () {
        for (let index = 0; index < 450; index += 1) {
          yield index;
        }
        for (let index = 0; index < 450; index += 1) {
          yield uncappedSupplementedArgsTarget[5_000 + index];
        }
      },
    });
    const uncappedSupplementedArgsResult = splitCliArgs(
      uncappedSupplementedArgsTarget as never
    );
    expect(uncappedSupplementedArgsResult.optionArgs).toHaveLength(1_350);
    expect(uncappedSupplementedArgsResult.optionArgs[0]).toBe("--high0");
    expect(uncappedSupplementedArgsResult.optionArgs.includes("--high449")).toBe(
      true
    );
    expect(uncappedSupplementedArgsResult.positionalArgs).toEqual([]);
    expect(uncappedSupplementedArgsResult.optionTerminatorUsed).toBe(false);

    const sparseHighIndexWithUndefinedPrefixArgs: Array<string | undefined> = [];
    sparseHighIndexWithUndefinedPrefixArgs[0] = undefined;
    sparseHighIndexWithUndefinedPrefixArgs[5_000] = "--json";
    Object.defineProperty(
      sparseHighIndexWithUndefinedPrefixArgs,
      Symbol.iterator,
      {
        configurable: true,
        enumerable: false,
        get: () => {
          throw new Error("iterator trap");
        },
      }
    );
    const sparseHighIndexWithUndefinedPrefixResult = splitCliArgs(
      sparseHighIndexWithUndefinedPrefixArgs as never
    );
    expect(sparseHighIndexWithUndefinedPrefixResult.optionArgs).toEqual([
      "--json",
    ]);
    expect(sparseHighIndexWithUndefinedPrefixResult.positionalArgs).toEqual([]);
    expect(sparseHighIndexWithUndefinedPrefixResult.optionTerminatorUsed).toBe(
      false
    );

    const sparseHighIndexWithNumericPrefixArgs: Array<string | number> = [];
    sparseHighIndexWithNumericPrefixArgs[0] = 1;
    sparseHighIndexWithNumericPrefixArgs[5_000] = "--json";
    Object.defineProperty(
      sparseHighIndexWithNumericPrefixArgs,
      Symbol.iterator,
      {
        configurable: true,
        enumerable: false,
        get: () => {
          throw new Error("iterator trap");
        },
      }
    );
    const sparseHighIndexWithNumericPrefixResult = splitCliArgs(
      sparseHighIndexWithNumericPrefixArgs as never
    );
    expect(sparseHighIndexWithNumericPrefixResult.optionArgs).toEqual([
      "--json",
    ]);
    expect(sparseHighIndexWithNumericPrefixResult.positionalArgs).toEqual([]);
    expect(sparseHighIndexWithNumericPrefixResult.optionTerminatorUsed).toBe(
      false
    );

    const denseNonStringPrefixHighIndexArgs: Array<number | string> = [];
    for (let index = 0; index < 1_024; index += 1) {
      denseNonStringPrefixHighIndexArgs[index] = index;
    }
    denseNonStringPrefixHighIndexArgs[5_000] = "--json";
    Object.defineProperty(denseNonStringPrefixHighIndexArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const denseNonStringPrefixHighIndexResult = splitCliArgs(
      denseNonStringPrefixHighIndexArgs as never
    );
    expect(denseNonStringPrefixHighIndexResult.optionArgs).toEqual(["--json"]);
    expect(denseNonStringPrefixHighIndexResult.positionalArgs).toEqual([]);
    expect(denseNonStringPrefixHighIndexResult.optionTerminatorUsed).toBe(false);

    const unorderedOwnKeysArgsTarget: string[] = [];
    unorderedOwnKeysArgsTarget[1] = "--one";
    unorderedOwnKeysArgsTarget[3] = "--three";
    unorderedOwnKeysArgsTarget[5] = "--five";
    const unorderedOwnKeysArgs = new Proxy(unorderedOwnKeysArgsTarget, {
      ownKeys() {
        return ["5", "1", "3", "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const unorderedOwnKeysResult = splitCliArgs(unorderedOwnKeysArgs as never);
    expect(unorderedOwnKeysResult.optionArgs).toEqual([
      "--one",
      "--three",
      "--five",
    ]);
    expect(unorderedOwnKeysResult.positionalArgs).toEqual([]);
    expect(unorderedOwnKeysResult.optionTerminatorUsed).toBe(false);

    const keyScanCapArgsTarget: string[] = [];
    for (let index = 0; index < 1_100; index += 1) {
      keyScanCapArgsTarget[index] = `--k${index}`;
    }
    const keyScanCapArgs = new Proxy(keyScanCapArgsTarget, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const keyScanCapResult = splitCliArgs(keyScanCapArgs as never);
    expect(keyScanCapResult.optionArgs).toHaveLength(1_024);
    expect(keyScanCapResult.optionArgs[0]).toBe("--k0");
    expect(keyScanCapResult.optionArgs[1_023]).toBe("--k1023");
    expect(keyScanCapResult.positionalArgs).toEqual([]);
    expect(keyScanCapResult.optionTerminatorUsed).toBe(false);

    const inheritedIndexArgs: string[] = [];
    inheritedIndexArgs.length = 1;
    const inheritedIndexPrototype = Object.create(Array.prototype) as {
      readonly 0: string;
    };
    Object.defineProperty(inheritedIndexPrototype, 0, {
      configurable: true,
      enumerable: true,
      value: "--proto",
    });
    Object.setPrototypeOf(inheritedIndexArgs, inheritedIndexPrototype);
    Object.defineProperty(inheritedIndexArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const inheritedIndexResult = splitCliArgs(inheritedIndexArgs as never);
    expect(inheritedIndexResult.optionArgs).toEqual([]);
    expect(inheritedIndexResult.positionalArgs).toEqual([]);
    expect(inheritedIndexResult.optionTerminatorUsed).toBe(false);
    Object.setPrototypeOf(inheritedIndexArgs, Array.prototype);

    let densePrefixOwnKeysCallCount = 0;
    const densePrefixArgsTarget: string[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      densePrefixArgsTarget[index] = `--dense${index}`;
    }
    const densePrefixArgs = new Proxy(densePrefixArgsTarget, {
      ownKeys(target) {
        densePrefixOwnKeysCallCount += 1;
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const densePrefixResult = splitCliArgs(densePrefixArgs as never);
    expect(densePrefixResult.optionArgs).toHaveLength(1_024);
    expect(densePrefixResult.optionArgs[0]).toBe("--dense0");
    expect(densePrefixResult.optionArgs[1_023]).toBe("--dense1023");
    expect(densePrefixResult.positionalArgs).toEqual([]);
    expect(densePrefixResult.optionTerminatorUsed).toBe(false);
    expect(densePrefixOwnKeysCallCount).toBe(0);

    const partiallyTrappedArgs = ["--json", "--output", "report.json"];
    Object.defineProperty(partiallyTrappedArgs, 1, {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("index trap");
      },
    });
    Object.defineProperty(partiallyTrappedArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const partiallyTrappedResult = splitCliArgs(partiallyTrappedArgs as never);
    expect(partiallyTrappedResult.optionArgs).toEqual(["--json", "report.json"]);
    expect(partiallyTrappedResult.positionalArgs).toEqual([]);
    expect(partiallyTrappedResult.optionTerminatorUsed).toBe(false);
  });

  it("detects canonical options with optional aliases", () => {
    expect(hasCliOption(["--json", "--no-build"], "--no-build")).toBe(true);
    expect(hasCliOption(["--json", "--verify"], "--no-build", ["--verify"])).toBe(
      true
    );
    expect(hasCliOption(["--json", "--verify"], "--no-build")).toBe(false);
    expect(
      hasCliOption(["--json", "--", "--verify"], "--no-build", ["--verify"])
    ).toBe(false);
    expect(hasCliOption(["--json"], "--no-build", ["--verify"])).toBe(false);
    expect(hasCliOption(["--json", "--no-build=1"], "--no-build")).toBe(false);
    expect(
      hasCliOption(["--json", "--verify=1"], "--no-build", ["--verify"])
    ).toBe(false);
    expect(
      hasCliOption(
        ["--json", "--verify", "--", "--verify=1"],
        "--no-build",
        ["--verify"]
      )
    ).toBe(true);
    const iteratorTrapArgs = ["--json", "--verify"];
    Object.defineProperty(iteratorTrapArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    expect(hasCliOption(iteratorTrapArgs as never, "--no-build", ["--verify"])).toBe(
      true
    );
  });

  it("parses unknown cli options with alias and value support", () => {
    const unknownFromMixedArgs = parseUnknownCliOptions(
      [
        "--json",
        "--output",
        "./report.json",
        "--verify",
        "--output=./inline-report.json",
        "--mystery",
        "--mystery",
        "-x",
      ],
      {
        canonicalOptions: ["--json", "--output", "--no-build"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownFromMixedArgs).toEqual(["--mystery", "-x"]);

    const unknownWithTerminator = parseUnknownCliOptions(
      ["--json", "--", "--mystery"],
      {
        canonicalOptions: ["--json"],
      }
    );
    expect(unknownWithTerminator).toEqual([]);
    const unknownWithMalformedOptionArgsOverride = parseUnknownCliOptions(
      ["--mystery"],
      {
        canonicalOptions: ["--json"],
        optionArgs: "--json" as never,
      }
    );
    expect(unknownWithMalformedOptionArgsOverride).toEqual(["--mystery"]);
    const unknownWithMalformedArrayOptionArgsOverride = parseUnknownCliOptions(
      ["--mystery"],
      {
        canonicalOptions: ["--json"],
        optionArgs: createFullyTrappedStringArray(["--json"]) as never,
      }
    );
    expect(unknownWithMalformedArrayOptionArgsOverride).toEqual(["--mystery"]);
    const unknownWithMixedArrayOptionArgsOverride = parseUnknownCliOptions(
      ["--mystery"],
      {
        canonicalOptions: ["--json"],
        optionArgs: ["--json", 1] as never,
      }
    );
    expect(unknownWithMixedArrayOptionArgsOverride).toEqual(["--mystery"]);
    const unknownWithMalformedValueMetadataOverride = parseUnknownCliOptions(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        valueOptionTokenMetadata: {
          tokens: createFullyTrappedStringArray(["--output"]) as never,
          unavailable: false,
        } as never,
      }
    );
    expect(unknownWithMalformedValueMetadataOverride).toEqual([]);
    const unknownWithUnavailableValueMetadataOverride = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        valueOptionTokenMetadata: {
          tokens: ["--output"],
          unavailable: true,
        } as never,
      }
    );
    expect(unknownWithUnavailableValueMetadataOverride).toEqual(["-l"]);
    const unknownWithUnavailableStrictMetadataOverride = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        strictValueOptionTokenMetadata: {
          tokens: [],
          unavailable: true,
        } as never,
      }
    );
    expect(unknownWithUnavailableStrictMetadataOverride).toEqual(["-l"]);
    const unknownWithUnavailableStrictMetadataOverrideForAlias =
      parseUnknownCliOptions(["--output", "-j"], {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        strictValueOptionTokenMetadata: {
          tokens: [],
          unavailable: true,
        } as never,
      });
    expect(unknownWithUnavailableStrictMetadataOverrideForAlias).toEqual([]);
    const unknownWithMalformedStrictMetadataOverride = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        strictValueOptionTokenMetadata: {
          tokens: createFullyTrappedStringArray(["--output"]) as never,
          unavailable: false,
        } as never,
      }
    );
    expect(unknownWithMalformedStrictMetadataOverride).toEqual(["-l"]);

    const unknownWithInlineMisuseAfterTerminator = parseUnknownCliOptions(
      ["--json", "--", "--json=1", "--verify=2", "--=secret", "--mystery=alpha"],
      {
        canonicalOptions: ["--json", "--no-build"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );
    expect(unknownWithInlineMisuseAfterTerminator).toEqual([]);

    const unknownWithRecognizedAliasAndTerminatedInlineMisuse = parseUnknownCliOptions(
      ["--verify", "--", "--verify=1", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );
    expect(unknownWithRecognizedAliasAndTerminatedInlineMisuse).toEqual([]);

    const unknownWithMissingValueFollowedByUnknown = parseUnknownCliOptions(
      ["--output", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownWithMissingValueFollowedByUnknown).toEqual(["--mystery"]);

    const unknownWithAliasCanonicalOnly = parseUnknownCliOptions(
      ["--no-build", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );
    expect(unknownWithAliasCanonicalOnly).toEqual(["--mystery"]);

    const unknownWithAliasCanonicalValueOption = parseUnknownCliOptions(
      ["--output", "./report.json", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownWithAliasCanonicalValueOption).toEqual(["--mystery"]);

    const unknownWithAliasValueTokenSplit = parseUnknownCliOptions(
      ["--report-path", "./report.json", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownWithAliasValueTokenSplit).toEqual(["--mystery"]);

    const unknownWithAliasValueTokenInline = parseUnknownCliOptions(
      ["--report-path=./report.json", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownWithAliasValueTokenInline).toEqual(["--mystery"]);

    const unknownWithAliasDefinedValueOptionToken = parseUnknownCliOptions(
      ["--report-path=./report.json", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--report-path"],
      }
    );
    expect(unknownWithAliasDefinedValueOptionToken).toEqual(["--mystery"]);

    const unknownWithAliasValueThatMatchesAnotherAlias = parseUnknownCliOptions(
      ["--report-path", "-j"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownWithAliasValueThatMatchesAnotherAlias).toEqual([]);
    const unknownWithAliasStrictSubsetForOutputOption = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
        },
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["-o"],
      }
    );
    expect(unknownWithAliasStrictSubsetForOutputOption).toEqual([]);
    const unknownWithAliasStrictSubsetForOnlyOption = parseUnknownCliOptions(
      ["--only", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
        },
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["-o"],
      }
    );
    expect(unknownWithAliasStrictSubsetForOnlyOption).toEqual(["-l"]);
    const unknownDashPathWithAliasStrictSubsetForOnlyOption =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
        },
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["-o"],
      });
    expect(unknownDashPathWithAliasStrictSubsetForOnlyOption).toEqual([]);
    const unknownWithAliasStrictSubsetForOnlyAliasToken = parseUnknownCliOptions(
      ["-o", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
        },
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["-o"],
      }
    );
    expect(unknownWithAliasStrictSubsetForOnlyAliasToken).toEqual(["-l"]);
    const strictAliasSubsetFromLengthTraps =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--output"]);
    const unknownWithLengthTrappedAliasStrictSubsetForOutput =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
        },
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: strictAliasSubsetFromLengthTraps as never,
      });
    expect(unknownWithLengthTrappedAliasStrictSubsetForOutput).toEqual([]);
    const unknownWithLengthTrappedAliasStrictSubsetForOnly = parseUnknownCliOptions(
      ["--only", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
        },
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: strictAliasSubsetFromLengthTraps as never,
      }
    );
    expect(unknownWithLengthTrappedAliasStrictSubsetForOnly).toEqual(["-l"]);
    const setValueMetadataForAliasStrictSubset = new Set(["--output"]);
    const unknownWithLengthTrappedAliasStrictSubsetAndSetValueMetadataForOutput =
      parseUnknownCliOptions(["--report-path", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadataForAliasStrictSubset as never,
        optionsWithStrictValues: strictAliasSubsetFromLengthTraps as never,
      });
    expect(
      unknownWithLengthTrappedAliasStrictSubsetAndSetValueMetadataForOutput
    ).toEqual(["-artifact-report.json"]);
    const unknownWithLengthTrappedAliasStrictSubsetAndSetValueMetadataForOnly =
      parseUnknownCliOptions(["-o", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadataForAliasStrictSubset as never,
        optionsWithStrictValues: strictAliasSubsetFromLengthTraps as never,
      });
    expect(
      unknownWithLengthTrappedAliasStrictSubsetAndSetValueMetadataForOnly
    ).toEqual([]);
    const unknownWithStrictUnknownShortValue = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownWithStrictUnknownShortValue).toEqual(["-l"]);
    const unknownWithStrictUnknownInlineShortValue = parseUnknownCliOptions(
      ["--output", "-l=1"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownWithStrictUnknownInlineShortValue).toEqual(["-l"]);
    const partiallyRecoveredStrictValueOptions = createPartiallyRecoveredStringArray(
      ["--output", "--only"]
    );
    const unknownWithPartiallyRecoveredStrictMetadataForStrictOption =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: partiallyRecoveredStrictValueOptions as never,
      });
    expect(unknownWithPartiallyRecoveredStrictMetadataForStrictOption).toEqual([
      "-l",
    ]);
    const unknownWithPartiallyRecoveredStrictMetadataForNonStrictOption =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: partiallyRecoveredStrictValueOptions as never,
      });
    expect(unknownWithPartiallyRecoveredStrictMetadataForNonStrictOption).toEqual(
      []
    );
    const unknownWithStrictDashPrefixedPathValue = parseUnknownCliOptions(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownWithStrictDashPrefixedPathValue).toEqual([]);
    const unknownWithMixedStrictMetadataForNonStrictOption = parseUnknownCliOptions(
      ["--only", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["--output", 1] as never,
      }
    );
    expect(unknownWithMixedStrictMetadataForNonStrictOption).toEqual([]);
    const unknownWithMixedStrictMetadataForStrictOption = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["--output", 1] as never,
      }
    );
    expect(unknownWithMixedStrictMetadataForStrictOption).toEqual(["-l"]);
    const unknownWithPrimitiveStrictValueMetadata = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: "--output" as never,
      }
    );
    expect(unknownWithPrimitiveStrictValueMetadata).toEqual(["-l"]);
    const unknownWithPrimitiveStrictValueMetadataAcrossMultipleValueOptions =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: "--output" as never,
      });
    expect(
      unknownWithPrimitiveStrictValueMetadataAcrossMultipleValueOptions
    ).toEqual(["-l"]);
    const unknownDashPathWithPrimitiveStrictValueMetadataAcrossMultipleValueOptions =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: "--output" as never,
      });
    expect(
      unknownDashPathWithPrimitiveStrictValueMetadataAcrossMultipleValueOptions
    ).toEqual([]);
    const setStrictValueMetadata = new Set(["--output"]);
    const unknownWithSetStrictValueMetadataAcrossMultipleValueOptions =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: setStrictValueMetadata as never,
      });
    expect(
      unknownWithSetStrictValueMetadataAcrossMultipleValueOptions
    ).toEqual(["-l"]);
    const unknownDashPathWithSetStrictValueMetadataAcrossMultipleValueOptions =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: setStrictValueMetadata as never,
      });
    expect(
      unknownDashPathWithSetStrictValueMetadataAcrossMultipleValueOptions
    ).toEqual([]);
    const unknownDashPathWithPrimitiveStrictValueMetadata = parseUnknownCliOptions(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: "--output" as never,
      }
    );
    expect(unknownDashPathWithPrimitiveStrictValueMetadata).toEqual([]);
    const unknownWithUnsupportedStrictValueMetadata = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--mystery"],
      }
    );
    expect(unknownWithUnsupportedStrictValueMetadata).toEqual(["-l"]);
    const unknownDashPathWithUnsupportedStrictValueMetadata =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--mystery"],
      });
    expect(unknownDashPathWithUnsupportedStrictValueMetadata).toEqual([]);
    const unknownWithMixedValueMetadataAndUnsupportedStrictMetadata =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      });
    expect(unknownWithMixedValueMetadataAndUnsupportedStrictMetadata).toEqual([
      "-l",
    ]);
    const unknownDashPathWithMixedValueMetadataAndUnsupportedStrictMetadata =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      });
    expect(
      unknownDashPathWithMixedValueMetadataAndUnsupportedStrictMetadata
    ).toEqual([]);
    const unknownWithMixedValueMetadataWithoutStrictMetadata =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
      });
    expect(unknownWithMixedValueMetadataWithoutStrictMetadata).toEqual(["-l"]);
    const unknownDashPathWithMixedValueMetadataWithoutStrictMetadata =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
      });
    expect(unknownDashPathWithMixedValueMetadataWithoutStrictMetadata).toEqual(
      []
    );
    const unknownWithUnavailableValueMetadataWithoutStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
      });
    expect(unknownWithUnavailableValueMetadataWithoutStrictSubsetForOnly).toEqual([
      "-l",
    ]);
    const unknownDashPathWithUnavailableValueMetadataWithoutStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
      });
    expect(
      unknownDashPathWithUnavailableValueMetadataWithoutStrictSubsetForOnly
    ).toEqual([]);
    const unknownWithUnavailableValueMetadataAndRecoverableStrictSubsetForOutput =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      unknownWithUnavailableValueMetadataAndRecoverableStrictSubsetForOutput
    ).toEqual([]);
    const unknownWithUnavailableValueMetadataAndRecoverableStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      unknownWithUnavailableValueMetadataAndRecoverableStrictSubsetForOnly
    ).toEqual(["-l"]);
    const unknownDashPathWithUnavailableValueMetadataAndRecoverableStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      unknownDashPathWithUnavailableValueMetadataAndRecoverableStrictSubsetForOnly
    ).toEqual([]);
    const unknownWithUnavailableValueMetadataAndUnsupportedStrictMetadataForOnly =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      });
    expect(
      unknownWithUnavailableValueMetadataAndUnsupportedStrictMetadataForOnly
    ).toEqual(["-l"]);
    const unknownDashPathWithUnavailableValueMetadataAndUnsupportedStrictMetadataForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      });
    expect(
      unknownDashPathWithUnavailableValueMetadataAndUnsupportedStrictMetadataForOnly
    ).toEqual([]);
    const partiallyRecoveredValueOptions = createPartiallyRecoveredStringArray([
      "--output",
      "--only",
    ]);
    const unknownWithPartiallyRecoveredValueMetadataForOutput =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
      });
    expect(unknownWithPartiallyRecoveredValueMetadataForOutput).toEqual(["-l"]);
    const unknownWithPartiallyRecoveredValueMetadataForOnly =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
      });
    expect(unknownWithPartiallyRecoveredValueMetadataForOnly).toEqual(["-l"]);
    const unknownDashPathWithPartiallyRecoveredValueMetadataForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
      });
    expect(unknownDashPathWithPartiallyRecoveredValueMetadataForOnly).toEqual([
      "-artifact-report.json",
    ]);
    const partiallyRecoveredStrictSubsetOptions = createPartiallyRecoveredStringArray(
      ["--only", "--output"]
    );
    const unknownWithPartiallyRecoveredValueAndStrictSubsetForOutput =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      });
    expect(unknownWithPartiallyRecoveredValueAndStrictSubsetForOutput).toEqual([]);
    const unknownWithPartiallyRecoveredValueAndStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      });
    expect(unknownWithPartiallyRecoveredValueAndStrictSubsetForOnly).toEqual([
      "-l",
    ]);
    const unknownDashPathWithPartiallyRecoveredValueAndStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      });
    expect(
      unknownDashPathWithPartiallyRecoveredValueAndStrictSubsetForOnly
    ).toEqual([]);
    const lengthTrappedPartiallyRecoveredStrictSubsetOptions =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--output",
        "--only",
      ]);
    const unknownWithLengthTrappedStrictSubsetForOnly = parseUnknownCliOptions(
      ["--only", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictSubsetOptions as never,
      }
    );
    expect(unknownWithLengthTrappedStrictSubsetForOnly).toEqual([]);
    const unknownWithLengthTrappedStrictSubsetForOutput = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictSubsetOptions as never,
      }
    );
    expect(unknownWithLengthTrappedStrictSubsetForOutput).toEqual(["-l"]);
    const unknownInlineShortWithLengthTrappedStrictSubsetForOutput =
      parseUnknownCliOptions(["--output", "-l=1"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictSubsetOptions as never,
      });
    expect(unknownInlineShortWithLengthTrappedStrictSubsetForOutput).toEqual([
      "-l",
    ]);
    const lengthTrappedPartiallyRecoveredValueOptions =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--output",
        "--only",
      ]);
    const unknownWithLengthTrappedValueSubsetForOnly = parseUnknownCliOptions(
      ["--only", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownWithLengthTrappedValueSubsetForOnly).toEqual(["-l"]);
    const unknownDashPathWithLengthTrappedValueSubsetForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(unknownDashPathWithLengthTrappedValueSubsetForOnly).toEqual([
      "-artifact-report.json",
    ]);
    const unknownInlineShortWithLengthTrappedValueSubsetForOnly =
      parseUnknownCliOptions(["--only", "-l=1"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(unknownInlineShortWithLengthTrappedValueSubsetForOnly).toEqual([
      "-l",
    ]);
    const unknownWithUnresolvedValueMetadataAndSupportedStrictMetadata =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--mystery"],
        optionsWithStrictValues: ["--output"],
      });
    expect(unknownWithUnresolvedValueMetadataAndSupportedStrictMetadata).toEqual([
      "-l",
    ]);
    const unknownDashPathWithUnresolvedValueMetadataAndSupportedStrictMetadata =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--mystery"],
        optionsWithStrictValues: ["--output"],
      });
    expect(
      unknownDashPathWithUnresolvedValueMetadataAndSupportedStrictMetadata
    ).toEqual([]);
    const setValueMetadata = new Set(["--output"]);
    const unknownWithSetValueMetadataAndSupportedStrictMetadata =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(unknownWithSetValueMetadataAndSupportedStrictMetadata).toEqual([
      "-l",
    ]);
    const unknownDashPathWithSetValueMetadataAndSupportedStrictMetadata =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(
      unknownDashPathWithSetValueMetadataAndSupportedStrictMetadata
    ).toEqual([]);
    const unknownWithSetValueMetadataAndOnlyStrictSubsetForOutput =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(unknownWithSetValueMetadataAndOnlyStrictSubsetForOutput).toEqual([
      "-l",
    ]);
    const unknownDashPathWithSetValueMetadataAndOnlyStrictSubsetForOutput =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      unknownDashPathWithSetValueMetadataAndOnlyStrictSubsetForOutput
    ).toEqual(["-artifact-report.json"]);
    const unknownWithSetValueMetadataAndOnlyStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(unknownWithSetValueMetadataAndOnlyStrictSubsetForOnly).toEqual([
      "-l",
    ]);
    const unknownDashPathWithSetValueMetadataAndOnlyStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      unknownDashPathWithSetValueMetadataAndOnlyStrictSubsetForOnly
    ).toEqual([]);
    const mapValueMetadataForSiblingStrictSubset = new Map<string, boolean>([
      ["--output", true],
    ]);
    const unknownWithMapValueMetadataAndOnlyStrictSubsetForOutput =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: mapValueMetadataForSiblingStrictSubset as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(unknownWithMapValueMetadataAndOnlyStrictSubsetForOutput).toEqual([
      "-artifact-report.json",
    ]);
    const unknownWithMapValueMetadataAndOnlyStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: mapValueMetadataForSiblingStrictSubset as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(unknownWithMapValueMetadataAndOnlyStrictSubsetForOnly).toEqual([]);
    const unknownWithSetValueMetadataAndAliasStrictSubsetForOutput =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      });
    expect(unknownWithSetValueMetadataAndAliasStrictSubsetForOutput).toEqual([
      "-artifact-report.json",
    ]);
    const unknownWithSetValueMetadataAndAliasStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      });
    expect(unknownWithSetValueMetadataAndAliasStrictSubsetForOnly).toEqual([]);
    const unknownShortWithSetValueMetadataAndAliasStrictSubsetForOnly =
      parseUnknownCliOptions(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      });
    expect(unknownShortWithSetValueMetadataAndAliasStrictSubsetForOnly).toEqual([
      "-l",
    ]);
    const unknownShortWithSetValueMetadataAndAliasStrictSubsetForOutput =
      parseUnknownCliOptions(["--report-path", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      });
    expect(unknownShortWithSetValueMetadataAndAliasStrictSubsetForOutput).toEqual([
      "-l",
    ]);
    const unknownDashPathWithSetValueMetadataAndNoStrictMetadata =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: setValueMetadata as never,
      });
    expect(unknownDashPathWithSetValueMetadataAndNoStrictMetadata).toEqual([
      "-artifact-report.json",
    ]);
    const mapValueMetadata = new Map<string, boolean>([["--output", true]]);
    const unknownWithMapValueMetadataAndSupportedStrictMetadata =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: mapValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(unknownWithMapValueMetadataAndSupportedStrictMetadata).toEqual([
      "-l",
    ]);
    const unknownDashPathWithMapValueMetadataAndSupportedStrictMetadata =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: mapValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(
      unknownDashPathWithMapValueMetadataAndSupportedStrictMetadata
    ).toEqual([]);
    const mapStrictValueMetadata = new Map<string, boolean>([
      ["--output", true],
    ]);
    const unknownWithMapStrictValueMetadata = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: mapStrictValueMetadata as never,
      }
    );
    expect(unknownWithMapStrictValueMetadata).toEqual(["-l"]);
    const unknownDashPathWithMapStrictValueMetadata = parseUnknownCliOptions(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: mapStrictValueMetadata as never,
      }
    );
    expect(unknownDashPathWithMapStrictValueMetadata).toEqual([]);
    const unknownWithStrictMetadataOnly = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownWithStrictMetadataOnly).toEqual(["-l"]);
    const unknownDashPathWithStrictMetadataOnly = parseUnknownCliOptions(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownDashPathWithStrictMetadataOnly).toEqual([]);

    const unknownWithInlineValues = parseUnknownCliOptions(
      ["--json", "--mystery=alpha", "--mystery=beta", "-x=1", "-x=2"],
      {
        canonicalOptions: ["--json"],
      }
    );
    expect(unknownWithInlineValues).toEqual(["--mystery", "-x"]);
    const unknownWithUnsupportedValueOptionMetadata = parseUnknownCliOptions(
      ["--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
        optionsWithValues: ["--mystery"],
      }
    );
    expect(unknownWithUnsupportedValueOptionMetadata).toEqual(["--mystery"]);

    const unknownWithInlineValueOnKnownFlag = parseUnknownCliOptions(
      ["--json=1", "--json=2", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
      }
    );
    expect(unknownWithInlineValueOnKnownFlag).toEqual([
      "--json=<value>",
      "--mystery",
    ]);

    const unknownWithMixedInlineAndBareTokens = parseUnknownCliOptions(
      ["--mystery=alpha", "--mystery"],
      {
        canonicalOptions: [],
      }
    );
    expect(unknownWithMixedInlineAndBareTokens).toEqual(["--mystery"]);

    const unknownWithInlineAliasMisuse = parseUnknownCliOptions(
      ["--verify=1", "--verify=2", "-j=1", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
          "--json": ["-j"],
        },
      }
    );
    expect(unknownWithInlineAliasMisuse).toEqual([
      "--no-build=<value>",
      "--json=<value>",
      "--mystery",
    ]);

    const unknownWithLiteralAliasPlaceholders = parseUnknownCliOptions(
      [
        "--verify=<value>",
        "--verify=1",
        "--no-build=2",
        "-j=<value>",
        "-j=1",
        "--json=2",
        "--mystery=alpha",
      ],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
          "--json": ["-j"],
        },
      }
    );
    expect(unknownWithLiteralAliasPlaceholders).toEqual([
      "--no-build=<value>",
      "--json=<value>",
      "--mystery",
    ]);

    const unknownWithInlineAliasAndCanonicalMisuse = parseUnknownCliOptions(
      ["--verify=1", "--no-build=2", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );
    expect(unknownWithInlineAliasAndCanonicalMisuse).toEqual([
      "--no-build=<value>",
      "--mystery",
    ]);

    const unknownWithMalformedInlineOptionNames = parseUnknownCliOptions(
      ["--=secret", "--=token", "--=", "-=secret", "-=token", "-="],
      {
        canonicalOptions: ["--json"],
      }
    );
    expect(unknownWithMalformedInlineOptionNames).toEqual([
      "--=<value>",
      "-=<value>",
    ]);

    const unknownWithLiteralRedactionPlaceholderAndKnownMisuse = parseUnknownCliOptions(
      ["--json=<value>", "--json=secret", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
      }
    );
    expect(unknownWithLiteralRedactionPlaceholderAndKnownMisuse).toEqual([
      "--json=<value>",
      "--mystery",
    ]);

    const unknownWithLiteralMalformedPlaceholderAndMalformedMisuse =
      parseUnknownCliOptions(
        ["--=<value>", "--=secret", "-=<value>", "-=secret"],
        {
          canonicalOptions: ["--json"],
        }
      );
    expect(unknownWithLiteralMalformedPlaceholderAndMalformedMisuse).toEqual([
      "--=<value>",
      "-=<value>",
    ]);

    const iteratorTrapArgs = ["--json", "--mystery", "--output", "./report.json"];
    Object.defineProperty(iteratorTrapArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const unknownFromIteratorTrapArgs = parseUnknownCliOptions(
      iteratorTrapArgs as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownFromIteratorTrapArgs).toEqual(["--mystery"]);

    const largeLengthTrapArgs = new Proxy(["--json", "--mystery"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const unknownFromLargeLengthTrapArgs = parseUnknownCliOptions(
      largeLengthTrapArgs as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownFromLargeLengthTrapArgs).toEqual(["--mystery"]);
    const lengthAndOwnKeysTrapArgs = new Proxy(["--json", "--mystery"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const unknownFromLengthAndOwnKeysTrapArgs = parseUnknownCliOptions(
      lengthAndOwnKeysTrapArgs as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownFromLengthAndOwnKeysTrapArgs).toEqual([]);

    const unknownFromWhitespacePaddedMetadata = parseUnknownCliOptions(
      ["--json", "--verify", "--mystery"],
      {
        canonicalOptions: [" --json "],
        optionAliases: {
          " --no-build ": [" --verify "],
        },
      }
    );
    expect(unknownFromWhitespacePaddedMetadata).toEqual(["--mystery"]);
  });

  it("sanitizes malformed metadata inputs in unknown option parsing", () => {
    const canonicalOptions = ["--json", "--output"];
    Object.defineProperty(canonicalOptions, 2, {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("index trap");
      },
    });
    Object.defineProperty(canonicalOptions, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const optionAliases = Object.create(null) as {
      readonly "--no-build": string[];
    };
    Object.defineProperty(optionAliases, "--no-build", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("alias trap");
      },
    });
    const optionsWithValues = ["--output"];
    Object.defineProperty(optionsWithValues, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    const unknownOptions = parseUnknownCliOptions(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: canonicalOptions as never,
        optionAliases: optionAliases as never,
        optionsWithValues: optionsWithValues as never,
      }
    );

    expect(unknownOptions).toEqual(["--mystery"]);
    let canonicalUnknownReadCount = 0;
    const canonicalOptionsForUnknownReadCount = new Proxy(["--json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (property === "0") {
          canonicalUnknownReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const unknownFromCanonicalReadCountMetadata = parseUnknownCliOptions(
      ["--json"],
      {
        canonicalOptions: canonicalOptionsForUnknownReadCount as never,
      }
    );
    expect(unknownFromCanonicalReadCountMetadata).toEqual([]);
    expect(canonicalUnknownReadCount).toBe(2);
    let aliasUnknownReadCount = 0;
    const unknownFromAliasReadCountMetadata = parseUnknownCliOptions(
      ["--verify"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": new Proxy(["--verify"], {
            get(target, property, receiver) {
              if (property === Symbol.iterator) {
                throw new Error("iterator trap");
              }
              if (property === "length") {
                return 1;
              }
              if (property === "0") {
                aliasUnknownReadCount += 1;
              }
              return Reflect.get(target, property, receiver);
            },
          }) as never,
        },
      }
    );
    expect(unknownFromAliasReadCountMetadata).toEqual([]);
    expect(aliasUnknownReadCount).toBe(2);
    let optionArgsUnknownReadCount = 0;
    const unknownFromOptionArgsReadCountMetadata = parseUnknownCliOptions(
      new Proxy(["--json"], {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionArgsUnknownReadCount += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      }) as never,
      {
        canonicalOptions: ["--json"],
      }
    );
    expect(unknownFromOptionArgsReadCountMetadata).toEqual([]);
    expect(optionArgsUnknownReadCount).toBe(2);
    let valueMetadataUnknownReadCount = 0;
    const unknownFromValueMetadataReadCount = parseUnknownCliOptions(
      ["--output", "-j"],
      {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: new Proxy(["--output"], {
          get(target, property, receiver) {
            if (property === "0") {
              valueMetadataUnknownReadCount += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      }
    );
    expect(unknownFromValueMetadataReadCount).toEqual([]);
    expect(valueMetadataUnknownReadCount).toBe(1);
    let strictMetadataUnknownReadCount = 0;
    const unknownFromStrictMetadataReadCount = parseUnknownCliOptions(
      ["--output", "-j"],
      {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: new Proxy(["--output"], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) {
              throw new Error("iterator trap");
            }
            if (property === "length") {
              return 1;
            }
            if (property === "0") {
              strictMetadataUnknownReadCount += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      }
    );
    expect(unknownFromStrictMetadataReadCount).toEqual([]);
    expect(strictMetadataUnknownReadCount).toBe(2);
    const fullyTrappedCanonicalOptions = createFullyTrappedStringArray([
      "--json",
      "--output",
    ]);
    const unknownFromFullyTrappedCanonicalOptions = parseUnknownCliOptions(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: fullyTrappedCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownFromFullyTrappedCanonicalOptions).toEqual([
      "--json",
      "--mystery",
      "--output",
    ]);
    const unknownFromFullyTrappedCanonicalOptionsWithAliasFallback =
      parseUnknownCliOptions(["--verify", "--mystery"], {
        canonicalOptions: fullyTrappedCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(unknownFromFullyTrappedCanonicalOptionsWithAliasFallback).toEqual([
      "--mystery",
    ]);
    const nonArrayCanonicalOptions = new Set(["--json", "--output"]);
    const unknownFromNonArrayCanonicalOptions = parseUnknownCliOptions(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: nonArrayCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownFromNonArrayCanonicalOptions).toEqual([
      "--json",
      "--mystery",
      "--output",
    ]);
    const unknownFromNonArrayCanonicalOptionsWithAliasFallback =
      parseUnknownCliOptions(["--verify", "--json", "--mystery"], {
        canonicalOptions: nonArrayCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(unknownFromNonArrayCanonicalOptionsWithAliasFallback).toEqual([
      "--json",
      "--mystery",
    ]);
    const primitiveCanonicalOptions = "--json";
    const unknownFromPrimitiveCanonicalOptions = parseUnknownCliOptions(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: primitiveCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );
    expect(unknownFromPrimitiveCanonicalOptions).toEqual([
      "--json",
      "--mystery",
      "--output",
    ]);
    const unknownFromPrimitiveCanonicalOptionsWithAliasFallback =
      parseUnknownCliOptions(["--verify", "--json", "--mystery"], {
        canonicalOptions: primitiveCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(unknownFromPrimitiveCanonicalOptionsWithAliasFallback).toEqual([
      "--json",
      "--mystery",
    ]);
    const nonArrayAliasMetadata = {
      "--no-build": new Set(["--verify"]),
    };
    const unknownFromNonArrayAliasMetadataUsingAliasValue = parseUnknownCliOptions(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: nonArrayAliasMetadata as never,
      }
    );
    expect(unknownFromNonArrayAliasMetadataUsingAliasValue).toEqual([
      "--verify",
      "--mystery",
    ]);
    const unknownFromNonArrayAliasMetadataUsingCanonicalAliasKey =
      parseUnknownCliOptions(["--no-build", "--mystery"], {
        canonicalOptions: ["--json"],
        optionAliases: nonArrayAliasMetadata as never,
      });
    expect(unknownFromNonArrayAliasMetadataUsingCanonicalAliasKey).toEqual([
      "--mystery",
    ]);
    const primitiveAliasMetadata = {
      "--no-build": "--verify",
    };
    const unknownFromPrimitiveAliasMetadataUsingAliasValue =
      parseUnknownCliOptions(["--verify", "--mystery"], {
        canonicalOptions: ["--json"],
        optionAliases: primitiveAliasMetadata as never,
      });
    expect(unknownFromPrimitiveAliasMetadataUsingAliasValue).toEqual([
      "--verify",
      "--mystery",
    ]);
    const unknownFromPrimitiveAliasMetadataUsingCanonicalAliasKey =
      parseUnknownCliOptions(["--no-build", "--mystery"], {
        canonicalOptions: ["--json"],
        optionAliases: primitiveAliasMetadata as never,
      });
    expect(unknownFromPrimitiveAliasMetadataUsingCanonicalAliasKey).toEqual([
      "--mystery",
    ]);
    const mapAliasMetadata = new Map<string, string[]>([
      ["--no-build", ["--verify"]],
    ]);
    const unknownFromMapAliasMetadata = parseUnknownCliOptions(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: mapAliasMetadata as never,
      }
    );
    expect(unknownFromMapAliasMetadata).toEqual(["--verify", "--mystery"]);
    const mixedAliasMetadata = {
      "--no-build": ["--verify", 1] as never,
    };
    const unknownFromMixedAliasMetadataUsingAliasValue = parseUnknownCliOptions(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: mixedAliasMetadata as never,
      }
    );
    expect(unknownFromMixedAliasMetadataUsingAliasValue).toEqual(["--mystery"]);
    const unknownFromMixedAliasMetadataUsingCanonicalAliasKey =
      parseUnknownCliOptions(["--no-build", "--mystery"], {
        canonicalOptions: ["--json"],
        optionAliases: mixedAliasMetadata as never,
      });
    expect(unknownFromMixedAliasMetadataUsingCanonicalAliasKey).toEqual([
      "--mystery",
    ]);

    const trappedStrictValueOptions = new Proxy(["--output"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const unknownFromTrappedStrictValueOptions = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: trappedStrictValueOptions as never,
      }
    );
    expect(unknownFromTrappedStrictValueOptions).toEqual(["-l"]);
    const unknownDashPathFromTrappedStrictValueOptions = parseUnknownCliOptions(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: trappedStrictValueOptions as never,
      }
    );
    expect(unknownDashPathFromTrappedStrictValueOptions).toEqual([]);

    const trappedValueOptions = new Proxy(["--output"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const unknownFromTrappedValueOptionsWithStrictFallback = parseUnknownCliOptions(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: trappedValueOptions as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownFromTrappedValueOptionsWithStrictFallback).toEqual(["-l"]);
    const unknownDashPathFromTrappedValueOptionsWithStrictFallback =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: trappedValueOptions as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(unknownDashPathFromTrappedValueOptionsWithStrictFallback).toEqual([]);
    const unknownFromPrimitiveValueOptionsWithStrictFallback =
      parseUnknownCliOptions(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: "--output" as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(unknownFromPrimitiveValueOptionsWithStrictFallback).toEqual(["-l"]);
    const unknownDashPathFromPrimitiveValueOptionsWithStrictFallback =
      parseUnknownCliOptions(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: "--output" as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(unknownDashPathFromPrimitiveValueOptionsWithStrictFallback).toEqual([]);
  });

  it("salvages length-trapped alias token lists in unknown option parsing", () => {
    const fullyRecoverableAliasTokens =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--only-long"], 2);
    const unknownFromRecoverableLengthTrappedAliasTokens = parseUnknownCliOptions(
      ["--only-long", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": fullyRecoverableAliasTokens as never,
        },
      }
    );
    expect(unknownFromRecoverableLengthTrappedAliasTokens).toEqual(["--mystery"]);

    const partiallyRecoverableAliasTokens =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--only-long"]);
    const unknownFromPartiallyRecoverableLengthTrappedAliasTokens =
      parseUnknownCliOptions(["--only-long", "--mystery"], {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": partiallyRecoverableAliasTokens as never,
        },
      });
    expect(unknownFromPartiallyRecoverableLengthTrappedAliasTokens).toEqual([
      "--only-long",
      "--mystery",
    ]);
    const unknownFromPartiallyRecoverableShortAliasToken = parseUnknownCliOptions(
      ["-o", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": partiallyRecoverableAliasTokens as never,
        },
      }
    );
    expect(unknownFromPartiallyRecoverableShortAliasToken).toEqual(["--mystery"]);
    const fullyTrappedAliasTokens = createFullyTrappedStringArray([
      "-o",
      "--only-long",
    ]);
    const unknownFromFullyTrappedAliasTokens = parseUnknownCliOptions(
      ["--only", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": fullyTrappedAliasTokens as never,
        },
      }
    );
    expect(unknownFromFullyTrappedAliasTokens).toEqual(["--mystery"]);
    const unknownFromFullyTrappedAliasTokensByAliasValue = parseUnknownCliOptions(
      ["-o", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": fullyTrappedAliasTokens as never,
        },
      }
    );
    expect(unknownFromFullyTrappedAliasTokensByAliasValue).toEqual([
      "-o",
      "--mystery",
    ]);
  });

  it("salvages length-trapped canonical option metadata in unknown option parsing", () => {
    const fullyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(
        ["--json", "--output"],
        2
      );
    const unknownFromFullyRecoverableLengthTrappedCanonicalOptions =
      parseUnknownCliOptions(
        ["--json", "--mystery", "--output", "./report.json"],
        {
          canonicalOptions:
            fullyRecoverableLengthTrappedCanonicalOptions as never,
          optionsWithValues: ["--output"],
        }
      );
    expect(unknownFromFullyRecoverableLengthTrappedCanonicalOptions).toEqual([
      "--mystery",
    ]);
    const partiallyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(["--json", "--output"]);
    const unknownFromPartiallyRecoverableLengthTrappedCanonicalOptions =
      parseUnknownCliOptions(
        ["--json", "--mystery", "--output", "./report.json"],
        {
          canonicalOptions:
            partiallyRecoverableLengthTrappedCanonicalOptions as never,
          optionsWithValues: ["--output"],
        }
      );
    expect(unknownFromPartiallyRecoverableLengthTrappedCanonicalOptions).toEqual(
      ["--mystery", "--output"]
    );
    const unknownFromPartiallyRecoverableLengthTrappedCanonicalOptionsWithAliases =
      parseUnknownCliOptions(["--verify", "--mystery"], {
        canonicalOptions:
          partiallyRecoverableLengthTrappedCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(
      unknownFromPartiallyRecoverableLengthTrappedCanonicalOptionsWithAliases
    ).toEqual(["--mystery"]);
    const unknownFromPartiallyRecoverableLengthTrappedCanonicalOptionsWithAliasesAndDashValue =
      parseUnknownCliOptions(
        ["--verify", "--output", "-artifact-report.json"],
        {
          canonicalOptions:
            partiallyRecoverableLengthTrappedCanonicalOptions as never,
          optionAliases: {
            "--no-build": ["--verify"],
          },
          optionsWithValues: ["--output"],
          optionsWithStrictValues: ["--output"],
        }
      );
    expect(
      unknownFromPartiallyRecoverableLengthTrappedCanonicalOptionsWithAliasesAndDashValue
    ).toEqual(["--output", "-artifact-report.json"]);
  });

  it("applies set value metadata strict-subset fallback across sibling options in unknown parsing", () => {
    const setValueMetadata = new Set(["--output"]);
    const unknownOnlyShortOption = parseUnknownCliOptions(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: setValueMetadata as never,
      optionsWithStrictValues: ["--output"],
    });
    expect(unknownOnlyShortOption).toEqual(["-l"]);
    const unknownOnlyDashPrefixedValue = parseUnknownCliOptions(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownOnlyDashPrefixedValue).toEqual(["-artifact-report.json"]);
    const unknownOutputShortOption = parseUnknownCliOptions(["--output", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: setValueMetadata as never,
      optionsWithStrictValues: ["--output"],
    });
    expect(unknownOutputShortOption).toEqual(["-l"]);
    const unknownOutputDashPrefixedValue = parseUnknownCliOptions(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(unknownOutputDashPrefixedValue).toEqual([]);
  });

  it("creates structured cli option validation metadata", () => {
    const noValidationErrors = createCliOptionValidation(
      ["--json", "--verify", "--output=./report.json"],
      {
        canonicalOptions: ["--json", "--no-build", "--output"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--output"],
        outputPathError: null,
      }
    );
    expect(noValidationErrors.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--output",
      "--verify",
    ]);
    expect(noValidationErrors.supportedCliOptionCount).toBe(4);
    expect(noValidationErrors.unknownOptions).toEqual([]);
    expect(noValidationErrors.unknownOptionCount).toBe(0);
    expect(noValidationErrors.unsupportedOptionsError).toBeNull();
    expect(noValidationErrors.validationErrorCode).toBeNull();

    const unsupportedOnly = createCliOptionValidation(["--json", "--mystery"], {
      canonicalOptions: ["--json", "--output"],
      optionsWithValues: ["--output"],
    });
    expect(unsupportedOnly.unknownOptions).toEqual(["--mystery"]);
    expect(unsupportedOnly.unknownOptionCount).toBe(1);
    expect(unsupportedOnly.supportedCliOptionCount).toBe(2);
    expect(unsupportedOnly.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(unsupportedOnly.validationErrorCode).toBe("unsupported_options");
    let optionArgsValidationReadCount = 0;
    const optionArgsValidation = createCliOptionValidation(
      new Proxy(["--json"], {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionArgsValidationReadCount += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      }) as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(optionArgsValidation.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(optionArgsValidation.supportedCliOptionCount).toBe(2);
    expect(optionArgsValidation.unknownOptions).toEqual([]);
    expect(optionArgsValidation.unknownOptionCount).toBe(0);
    expect(optionArgsValidation.unsupportedOptionsError).toBeNull();
    expect(optionArgsValidation.validationErrorCode).toBeNull();
    expect(optionArgsValidationReadCount).toBe(2);
    const malformedOptionArgsValidation = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        optionArgs: "--json" as never,
      }
    );
    expect(malformedOptionArgsValidation.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(malformedOptionArgsValidation.supportedCliOptionCount).toBe(2);
    expect(malformedOptionArgsValidation.unknownOptions).toEqual(["--mystery"]);
    expect(malformedOptionArgsValidation.unknownOptionCount).toBe(1);
    expect(malformedOptionArgsValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(malformedOptionArgsValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const malformedArrayOptionArgsValidation = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        optionArgs: createFullyTrappedStringArray(["--json"]) as never,
      }
    );
    expect(malformedArrayOptionArgsValidation.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(malformedArrayOptionArgsValidation.supportedCliOptionCount).toBe(2);
    expect(malformedArrayOptionArgsValidation.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(malformedArrayOptionArgsValidation.unknownOptionCount).toBe(1);
    expect(malformedArrayOptionArgsValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(malformedArrayOptionArgsValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const mixedArrayOptionArgsValidation = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        optionArgs: ["--json", 1] as never,
      }
    );
    expect(mixedArrayOptionArgsValidation.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(mixedArrayOptionArgsValidation.supportedCliOptionCount).toBe(2);
    expect(mixedArrayOptionArgsValidation.unknownOptions).toEqual(["--mystery"]);
    expect(mixedArrayOptionArgsValidation.unknownOptionCount).toBe(1);
    expect(mixedArrayOptionArgsValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(mixedArrayOptionArgsValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const malformedValueMetadataOverrideValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        valueOptionTokenMetadata: {
          tokens: createFullyTrappedStringArray(["--output"]) as never,
          unavailable: false,
        } as never,
      }
    );
    expect(malformedValueMetadataOverrideValidation.supportedCliOptions).toEqual([
      "--output",
    ]);
    expect(malformedValueMetadataOverrideValidation.supportedCliOptionCount).toBe(1);
    expect(malformedValueMetadataOverrideValidation.unknownOptions).toEqual([]);
    expect(malformedValueMetadataOverrideValidation.unknownOptionCount).toBe(0);
    expect(
      malformedValueMetadataOverrideValidation.unsupportedOptionsError
    ).toBeNull();
    expect(malformedValueMetadataOverrideValidation.validationErrorCode).toBeNull();
    const unavailableValueMetadataOverrideValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        valueOptionTokenMetadata: {
          tokens: ["--output"],
          unavailable: true,
        } as never,
      }
    );
    expect(unavailableValueMetadataOverrideValidation.supportedCliOptions).toEqual([
      "--output",
    ]);
    expect(unavailableValueMetadataOverrideValidation.supportedCliOptionCount).toBe(
      1
    );
    expect(unavailableValueMetadataOverrideValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(unavailableValueMetadataOverrideValidation.unknownOptionCount).toBe(1);
    expect(
      unavailableValueMetadataOverrideValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output.");
    expect(unavailableValueMetadataOverrideValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const unavailableStrictMetadataOverrideValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        strictValueOptionTokenMetadata: {
          tokens: [],
          unavailable: true,
        } as never,
      }
    );
    expect(unavailableStrictMetadataOverrideValidation.supportedCliOptions).toEqual([
      "--output",
    ]);
    expect(unavailableStrictMetadataOverrideValidation.supportedCliOptionCount).toBe(
      1
    );
    expect(unavailableStrictMetadataOverrideValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(unavailableStrictMetadataOverrideValidation.unknownOptionCount).toBe(1);
    expect(
      unavailableStrictMetadataOverrideValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output.");
    expect(unavailableStrictMetadataOverrideValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const unavailableStrictMetadataOverrideAliasValidation =
      createCliOptionValidation(["--output", "-j"], {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        strictValueOptionTokenMetadata: {
          tokens: [],
          unavailable: true,
        } as never,
      });
    expect(
      unavailableStrictMetadataOverrideAliasValidation.supportedCliOptions
    ).toEqual(["--output", "--json", "-j"]);
    expect(
      unavailableStrictMetadataOverrideAliasValidation.supportedCliOptionCount
    ).toBe(3);
    expect(unavailableStrictMetadataOverrideAliasValidation.unknownOptions).toEqual(
      []
    );
    expect(
      unavailableStrictMetadataOverrideAliasValidation.unknownOptionCount
    ).toBe(0);
    expect(
      unavailableStrictMetadataOverrideAliasValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      unavailableStrictMetadataOverrideAliasValidation.validationErrorCode
    ).toBeNull();
    const malformedStrictMetadataOverrideValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        strictValueOptionTokenMetadata: {
          tokens: createFullyTrappedStringArray(["--output"]) as never,
          unavailable: false,
        } as never,
      }
    );
    expect(malformedStrictMetadataOverrideValidation.supportedCliOptions).toEqual([
      "--output",
    ]);
    expect(malformedStrictMetadataOverrideValidation.supportedCliOptionCount).toBe(
      1
    );
    expect(malformedStrictMetadataOverrideValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(malformedStrictMetadataOverrideValidation.unknownOptionCount).toBe(1);
    expect(
      malformedStrictMetadataOverrideValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output.");
    expect(malformedStrictMetadataOverrideValidation.validationErrorCode).toBe(
      "unsupported_options"
    );

    const unsupportedInlineUnknownOption = createCliOptionValidation(
      ["--json", "--mystery=alpha", "--mystery=beta"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(unsupportedInlineUnknownOption.unknownOptions).toEqual(["--mystery"]);
    expect(unsupportedInlineUnknownOption.unknownOptionCount).toBe(1);
    expect(unsupportedInlineUnknownOption.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(unsupportedInlineUnknownOption.validationErrorCode).toBe(
      "unsupported_options"
    );
    const unsupportedWithUnknownValueOptionMetadata = createCliOptionValidation(
      ["--mystery=alpha"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--mystery"],
      }
    );
    expect(unsupportedWithUnknownValueOptionMetadata.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(unsupportedWithUnknownValueOptionMetadata.unknownOptionCount).toBe(1);
    expect(unsupportedWithUnknownValueOptionMetadata.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(unsupportedWithUnknownValueOptionMetadata.validationErrorCode).toBe(
      "unsupported_options"
    );

    const unsupportedInlineKnownFlagValue = createCliOptionValidation(
      ["--json=1", "--json=2", "--mystery=alpha"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(unsupportedInlineKnownFlagValue.unknownOptions).toEqual([
      "--json=<value>",
      "--mystery",
    ]);
    expect(unsupportedInlineKnownFlagValue.unknownOptionCount).toBe(2);
    expect(unsupportedInlineKnownFlagValue.unsupportedOptionsError).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --json, --output."
    );
    expect(unsupportedInlineKnownFlagValue.validationErrorCode).toBe(
      "unsupported_options"
    );

    const unsupportedMalformedInlineOptionNames = createCliOptionValidation(
      ["--=secret", "--=token", "--=", "-=secret", "-=token", "-="],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(unsupportedMalformedInlineOptionNames.unknownOptions).toEqual([
      "--=<value>",
      "-=<value>",
    ]);
    expect(unsupportedMalformedInlineOptionNames.unknownOptionCount).toBe(2);
    expect(unsupportedMalformedInlineOptionNames.unsupportedOptionsError).toBe(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --json, --output."
    );
    expect(unsupportedMalformedInlineOptionNames.validationErrorCode).toBe(
      "unsupported_options"
    );

    const unsupportedWithLiteralPlaceholderAndKnownMisuse =
      createCliOptionValidation(["--json=<value>", "--json=secret", "--mystery=alpha"], {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      });
    expect(unsupportedWithLiteralPlaceholderAndKnownMisuse.unknownOptions).toEqual([
      "--json=<value>",
      "--mystery",
    ]);
    expect(unsupportedWithLiteralPlaceholderAndKnownMisuse.unknownOptionCount).toBe(2);
    expect(unsupportedWithLiteralPlaceholderAndKnownMisuse.unsupportedOptionsError).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --json, --output."
    );
    expect(unsupportedWithLiteralPlaceholderAndKnownMisuse.validationErrorCode).toBe(
      "unsupported_options"
    );

    const precomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: ["--output", "--json"],
      }
    );
    expect(precomputedSupportedTokens.supportedCliOptions).toEqual([
      "--output",
      "--json",
    ]);
    expect(precomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --output, --json."
    );
    const precomputedSupportedTokensWithoutCatalog = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: "--json" as never,
        supportedCliOptions: ["--json", "--json"],
      }
    );
    expect(precomputedSupportedTokensWithoutCatalog.supportedCliOptions).toEqual([
      "--json",
    ]);
    expect(precomputedSupportedTokensWithoutCatalog.supportedCliOptionCount).toBe(1);
    expect(precomputedSupportedTokensWithoutCatalog.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(precomputedSupportedTokensWithoutCatalog.unknownOptionCount).toBe(1);
    expect(precomputedSupportedTokensWithoutCatalog.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json."
    );
    expect(precomputedSupportedTokensWithoutCatalog.validationErrorCode).toBe(
      "unsupported_options"
    );
    const partiallyRecoverablePrecomputedSupportedTokensWithoutCatalog =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: "--json" as never,
        supportedCliOptions:
          createLengthTrappedPartiallyRecoveredStringArray([
            "--json",
            "--output",
          ]) as never,
      });
    expect(
      partiallyRecoverablePrecomputedSupportedTokensWithoutCatalog.supportedCliOptions
    ).toEqual(["--json"]);
    expect(
      partiallyRecoverablePrecomputedSupportedTokensWithoutCatalog.supportedCliOptionCount
    ).toBe(1);
    expect(
      partiallyRecoverablePrecomputedSupportedTokensWithoutCatalog.unknownOptions
    ).toEqual(["--mystery"]);
    expect(
      partiallyRecoverablePrecomputedSupportedTokensWithoutCatalog.unknownOptionCount
    ).toBe(1);
    expect(
      partiallyRecoverablePrecomputedSupportedTokensWithoutCatalog.unsupportedOptionsError
    ).toBe("Unsupported option(s): --mystery. Supported options: --json.");
    expect(
      partiallyRecoverablePrecomputedSupportedTokensWithoutCatalog.validationErrorCode
    ).toBe("unsupported_options");
    const emptyPrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: [],
      }
    );
    expect(emptyPrecomputedSupportedTokens.supportedCliOptions).toEqual([]);
    expect(emptyPrecomputedSupportedTokens.supportedCliOptionCount).toBe(0);
    expect(emptyPrecomputedSupportedTokens.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(emptyPrecomputedSupportedTokens.unknownOptionCount).toBe(1);
    expect(emptyPrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: (none)."
    );
    expect(emptyPrecomputedSupportedTokens.validationErrorCode).toBe(
      "unsupported_options"
    );
    const whitespacePrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: ["   "],
      }
    );
    expect(whitespacePrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(whitespacePrecomputedSupportedTokens.supportedCliOptionCount).toBe(2);
    expect(whitespacePrecomputedSupportedTokens.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(whitespacePrecomputedSupportedTokens.unknownOptionCount).toBe(1);
    expect(whitespacePrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(whitespacePrecomputedSupportedTokens.validationErrorCode).toBe(
      "unsupported_options"
    );
    const mixedWhitespacePrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: ["--json", "   "],
      }
    );
    expect(mixedWhitespacePrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
    ]);
    expect(mixedWhitespacePrecomputedSupportedTokens.supportedCliOptionCount).toBe(
      1
    );
    expect(mixedWhitespacePrecomputedSupportedTokens.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(mixedWhitespacePrecomputedSupportedTokens.unknownOptionCount).toBe(1);
    expect(mixedWhitespacePrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json."
    );
    expect(mixedWhitespacePrecomputedSupportedTokens.validationErrorCode).toBe(
      "unsupported_options"
    );
    const iteratorOnlyWhitespacePrecomputedSupportedTokens = new Proxy(
      ["   "],
      {
        get(target, property, receiver) {
          if (property === "length") {
            throw new Error("length trap");
          }
          if (property === Symbol.iterator) {
            return function* () {
              yield "   ";
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const iteratorOnlyWhitespacePrecomputedValidation = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions:
          iteratorOnlyWhitespacePrecomputedSupportedTokens as never,
      }
    );
    expect(iteratorOnlyWhitespacePrecomputedValidation.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(
      iteratorOnlyWhitespacePrecomputedValidation.supportedCliOptionCount
    ).toBe(2);
    expect(iteratorOnlyWhitespacePrecomputedValidation.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(iteratorOnlyWhitespacePrecomputedValidation.unknownOptionCount).toBe(1);
    expect(
      iteratorOnlyWhitespacePrecomputedValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(iteratorOnlyWhitespacePrecomputedValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const staleUnknownPrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: ["--output", "--mystery", "--json"],
      }
    );
    expect(staleUnknownPrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(staleUnknownPrecomputedSupportedTokens.supportedCliOptionCount).toBe(2);
    expect(staleUnknownPrecomputedSupportedTokens.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(staleUnknownPrecomputedSupportedTokens.unknownOptionCount).toBe(1);
    expect(staleUnknownPrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(staleUnknownPrecomputedSupportedTokens.validationErrorCode).toBe(
      "unsupported_options"
    );
    const staleUnknownAliasPrecomputedSupportedTokens =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        supportedCliOptions: ["--verify", "--mystery"],
      });
    expect(staleUnknownAliasPrecomputedSupportedTokens.supportedCliOptions).toEqual(
      ["--json", "--no-build", "--verify"]
    );
    expect(staleUnknownAliasPrecomputedSupportedTokens.supportedCliOptionCount).toBe(
      3
    );
    expect(staleUnknownAliasPrecomputedSupportedTokens.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(staleUnknownAliasPrecomputedSupportedTokens.unknownOptionCount).toBe(1);
    expect(staleUnknownAliasPrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build, --verify."
    );
    expect(staleUnknownAliasPrecomputedSupportedTokens.validationErrorCode).toBe(
      "unsupported_options"
    );
    const staleUnknownOnlyPrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: ["--mystery"],
      }
    );
    expect(staleUnknownOnlyPrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(staleUnknownOnlyPrecomputedSupportedTokens.supportedCliOptionCount).toBe(2);
    expect(staleUnknownOnlyPrecomputedSupportedTokens.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(staleUnknownOnlyPrecomputedSupportedTokens.unknownOptionCount).toBe(1);
    expect(staleUnknownOnlyPrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(staleUnknownOnlyPrecomputedSupportedTokens.validationErrorCode).toBe(
      "unsupported_options"
    );
    const staleUnknownOnlyAliasPrecomputedSupportedTokens =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        supportedCliOptions: ["--mystery"],
      });
    expect(staleUnknownOnlyAliasPrecomputedSupportedTokens.supportedCliOptions).toEqual(
      ["--json", "--no-build", "--verify"]
    );
    expect(staleUnknownOnlyAliasPrecomputedSupportedTokens.supportedCliOptionCount).toBe(
      3
    );
    expect(staleUnknownOnlyAliasPrecomputedSupportedTokens.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(staleUnknownOnlyAliasPrecomputedSupportedTokens.unknownOptionCount).toBe(
      1
    );
    expect(
      staleUnknownOnlyAliasPrecomputedSupportedTokens.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build, --verify."
    );
    expect(staleUnknownOnlyAliasPrecomputedSupportedTokens.validationErrorCode).toBe(
      "unsupported_options"
    );
    let statefulCanonicalWithPrecomputedReadCount = 0;
    const statefulCanonicalWithPrecomputed = new Proxy(["--json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (property === "0") {
          statefulCanonicalWithPrecomputedReadCount += 1;
          if (statefulCanonicalWithPrecomputedReadCount > 1) {
            return undefined;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulCanonicalWithPrecomputedValidation =
      createCliOptionValidation(["--json"], {
        canonicalOptions: statefulCanonicalWithPrecomputed as never,
        supportedCliOptions: ["--json"],
      });
    expect(statefulCanonicalWithPrecomputedValidation.supportedCliOptions).toEqual([
      "--json",
    ]);
    expect(statefulCanonicalWithPrecomputedValidation.supportedCliOptionCount).toBe(
      1
    );
    expect(statefulCanonicalWithPrecomputedValidation.unknownOptions).toEqual([]);
    expect(statefulCanonicalWithPrecomputedValidation.unknownOptionCount).toBe(0);
    expect(
      statefulCanonicalWithPrecomputedValidation.unsupportedOptionsError
    ).toBeNull();
    expect(statefulCanonicalWithPrecomputedValidation.validationErrorCode).toBeNull();
    expect(statefulCanonicalWithPrecomputedReadCount).toBe(2);
    let optionCatalogOverrideCanonicalReadCount = 0;
    const optionCatalogOverrideCanonicalOptions = new Proxy(["--json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (property === "0") {
          optionCatalogOverrideCanonicalReadCount += 1;
          return "--json";
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const optionCatalogOverrideValidation = createCliOptionValidation(
      ["--json"],
      {
        canonicalOptions: optionCatalogOverrideCanonicalOptions as never,
        optionCatalog: {
          supportedCliOptions: ["--json"],
          availableCliOptionAliases: {},
          availableCliOptionCanonicalMap: {
            "--json": "--json",
          },
        } as never,
      }
    );
    expect(optionCatalogOverrideValidation.supportedCliOptions).toEqual([
      "--json",
    ]);
    expect(optionCatalogOverrideValidation.supportedCliOptionCount).toBe(1);
    expect(optionCatalogOverrideValidation.unknownOptions).toEqual([]);
    expect(optionCatalogOverrideValidation.unknownOptionCount).toBe(0);
    expect(optionCatalogOverrideValidation.unsupportedOptionsError).toBeNull();
    expect(optionCatalogOverrideValidation.validationErrorCode).toBeNull();
    expect(optionCatalogOverrideCanonicalReadCount).toBe(0);
    let optionCatalogOverrideWithMalformedPrecomputedCanonicalReadCount = 0;
    const optionCatalogOverrideWithMalformedPrecomputedCanonicalOptions =
      new Proxy(["--json"], {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionCatalogOverrideWithMalformedPrecomputedCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const optionCatalogOverrideWithMalformedPrecomputedValidation =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions:
          optionCatalogOverrideWithMalformedPrecomputedCanonicalOptions as never,
        supportedCliOptions: "--json" as never,
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--json": "--json",
            "--output": "--output",
          },
        } as never,
      });
    expect(
      optionCatalogOverrideWithMalformedPrecomputedValidation.supportedCliOptions
    ).toEqual(["--json", "--output"]);
    expect(
      optionCatalogOverrideWithMalformedPrecomputedValidation.supportedCliOptionCount
    ).toBe(2);
    expect(
      optionCatalogOverrideWithMalformedPrecomputedValidation.unknownOptions
    ).toEqual(["--mystery"]);
    expect(
      optionCatalogOverrideWithMalformedPrecomputedValidation.unknownOptionCount
    ).toBe(1);
    expect(
      optionCatalogOverrideWithMalformedPrecomputedValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(
      optionCatalogOverrideWithMalformedPrecomputedValidation.validationErrorCode
    ).toBe("unsupported_options");
    expect(optionCatalogOverrideWithMalformedPrecomputedCanonicalReadCount).toBe(0);
    let optionCatalogOverrideWithEmptyPrecomputedCanonicalReadCount = 0;
    const optionCatalogOverrideWithEmptyPrecomputedCanonicalOptions = new Proxy(
      ["--json"],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionCatalogOverrideWithEmptyPrecomputedCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const optionCatalogOverrideWithEmptyPrecomputedValidation =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions:
          optionCatalogOverrideWithEmptyPrecomputedCanonicalOptions as never,
        supportedCliOptions: [],
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--json": "--json",
            "--output": "--output",
          },
        } as never,
      });
    expect(optionCatalogOverrideWithEmptyPrecomputedValidation.supportedCliOptions).toEqual(
      []
    );
    expect(
      optionCatalogOverrideWithEmptyPrecomputedValidation.supportedCliOptionCount
    ).toBe(0);
    expect(optionCatalogOverrideWithEmptyPrecomputedValidation.unknownOptions).toEqual(
      ["--mystery"]
    );
    expect(
      optionCatalogOverrideWithEmptyPrecomputedValidation.unknownOptionCount
    ).toBe(1);
    expect(
      optionCatalogOverrideWithEmptyPrecomputedValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): --mystery. Supported options: (none).");
    expect(
      optionCatalogOverrideWithEmptyPrecomputedValidation.validationErrorCode
    ).toBe("unsupported_options");
    expect(optionCatalogOverrideWithEmptyPrecomputedCanonicalReadCount).toBe(0);
    let optionCatalogOverrideWithStalePrecomputedCanonicalReadCount = 0;
    const optionCatalogOverrideWithStalePrecomputedCanonicalOptions = new Proxy(
      ["--json"],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionCatalogOverrideWithStalePrecomputedCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const optionCatalogOverrideWithStalePrecomputedValidation =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions:
          optionCatalogOverrideWithStalePrecomputedCanonicalOptions as never,
        supportedCliOptions: ["--json", "--mystery"],
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--json": "--json",
            "--output": "--output",
          },
        } as never,
      });
    expect(optionCatalogOverrideWithStalePrecomputedValidation.supportedCliOptions).toEqual(
      ["--json", "--output"]
    );
    expect(
      optionCatalogOverrideWithStalePrecomputedValidation.supportedCliOptionCount
    ).toBe(2);
    expect(optionCatalogOverrideWithStalePrecomputedValidation.unknownOptions).toEqual(
      ["--mystery"]
    );
    expect(
      optionCatalogOverrideWithStalePrecomputedValidation.unknownOptionCount
    ).toBe(1);
    expect(
      optionCatalogOverrideWithStalePrecomputedValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(
      optionCatalogOverrideWithStalePrecomputedValidation.validationErrorCode
    ).toBe("unsupported_options");
    expect(optionCatalogOverrideWithStalePrecomputedCanonicalReadCount).toBe(0);
    let optionCatalogOverrideWithKnownSubsetCanonicalReadCount = 0;
    const optionCatalogOverrideWithKnownSubsetCanonicalOptions = new Proxy(
      ["--json"],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionCatalogOverrideWithKnownSubsetCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const optionCatalogOverrideWithKnownSubsetValidation =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions:
          optionCatalogOverrideWithKnownSubsetCanonicalOptions as never,
        supportedCliOptions: ["--json"],
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--json": "--json",
            "--output": "--output",
          },
        } as never,
      });
    expect(optionCatalogOverrideWithKnownSubsetValidation.supportedCliOptions).toEqual(
      ["--json"]
    );
    expect(
      optionCatalogOverrideWithKnownSubsetValidation.supportedCliOptionCount
    ).toBe(1);
    expect(optionCatalogOverrideWithKnownSubsetValidation.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(optionCatalogOverrideWithKnownSubsetValidation.unknownOptionCount).toBe(
      1
    );
    expect(
      optionCatalogOverrideWithKnownSubsetValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): --mystery. Supported options: --json.");
    expect(optionCatalogOverrideWithKnownSubsetValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(optionCatalogOverrideWithKnownSubsetCanonicalReadCount).toBe(0);
    let optionCatalogOverrideWithUnavailablePrecomputedCanonicalReadCount = 0;
    const optionCatalogOverrideWithUnavailablePrecomputedCanonicalOptions =
      new Proxy(["--json"], {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionCatalogOverrideWithUnavailablePrecomputedCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const unavailablePrecomputedSupportedTokensForOptionCatalog =
      createLengthTrappedPartiallyRecoveredStringArray(["--json", "--output"]);
    const optionCatalogOverrideWithUnavailablePrecomputedValidation =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions:
          optionCatalogOverrideWithUnavailablePrecomputedCanonicalOptions as never,
        supportedCliOptions:
          unavailablePrecomputedSupportedTokensForOptionCatalog as never,
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--json": "--json",
            "--output": "--output",
          },
        } as never,
      });
    expect(
      optionCatalogOverrideWithUnavailablePrecomputedValidation.supportedCliOptions
    ).toEqual(["--json", "--output"]);
    expect(
      optionCatalogOverrideWithUnavailablePrecomputedValidation.supportedCliOptionCount
    ).toBe(2);
    expect(
      optionCatalogOverrideWithUnavailablePrecomputedValidation.unknownOptions
    ).toEqual(["--mystery"]);
    expect(
      optionCatalogOverrideWithUnavailablePrecomputedValidation.unknownOptionCount
    ).toBe(1);
    expect(
      optionCatalogOverrideWithUnavailablePrecomputedValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(
      optionCatalogOverrideWithUnavailablePrecomputedValidation.validationErrorCode
    ).toBe("unsupported_options");
    expect(optionCatalogOverrideWithUnavailablePrecomputedCanonicalReadCount).toBe(
      0
    );
    let staleSupportedOptionCatalogOverrideCanonicalReadCount = 0;
    const staleSupportedOptionCatalogOverrideCanonicalOptions = new Proxy(
      ["--json"],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            staleSupportedOptionCatalogOverrideCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const staleSupportedOptionCatalogOverrideValidation =
      createCliOptionValidation(["--output", "-j"], {
        canonicalOptions:
          staleSupportedOptionCatalogOverrideCanonicalOptions as never,
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        optionCatalog: {
          supportedCliOptions: ["--output"],
          availableCliOptionCanonicalMap: {
            "--output": "--output",
            "--json": "--json",
            "-j": "--json",
          },
        } as never,
      });
    expect(staleSupportedOptionCatalogOverrideValidation.supportedCliOptions).toEqual(
      ["--output", "--json", "-j"]
    );
    expect(
      staleSupportedOptionCatalogOverrideValidation.supportedCliOptionCount
    ).toBe(3);
    expect(staleSupportedOptionCatalogOverrideValidation.unknownOptions).toEqual(
      []
    );
    expect(staleSupportedOptionCatalogOverrideValidation.unknownOptionCount).toBe(
      0
    );
    expect(
      staleSupportedOptionCatalogOverrideValidation.unsupportedOptionsError
    ).toBeNull();
    expect(staleSupportedOptionCatalogOverrideValidation.validationErrorCode).toBeNull();
    expect(staleSupportedOptionCatalogOverrideCanonicalReadCount).toBe(0);
    const staleSupportedWithUnknownTokenCatalogOverrideValidation =
      createCliOptionValidation(["--output", "-j"], {
        canonicalOptions: ["--json"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        optionCatalog: {
          supportedCliOptions: ["--output", "--mystery"],
          availableCliOptionCanonicalMap: {
            "--output": "--output",
            "--json": "--json",
            "-j": "--json",
          },
        } as never,
      });
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideValidation.supportedCliOptions
    ).toEqual(["--output", "--json", "-j"]);
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideValidation.supportedCliOptionCount
    ).toBe(3);
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideValidation.unknownOptions
    ).toEqual([]);
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideValidation.unknownOptionCount
    ).toBe(0);
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideValidation.validationErrorCode
    ).toBeNull();
    const staleSupportedWithUnknownTokenCatalogOverrideUnknownValidation =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: ["--json"],
        optionCatalog: {
          supportedCliOptions: ["--output", "--mystery"],
          availableCliOptionCanonicalMap: {
            "--output": "--output",
            "--json": "--json",
            "-j": "--json",
          },
        } as never,
      });
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideUnknownValidation.supportedCliOptions
    ).toEqual(["--output", "--json", "-j"]);
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideUnknownValidation.supportedCliOptionCount
    ).toBe(3);
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideUnknownValidation.unknownOptions
    ).toEqual(["--mystery"]);
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideUnknownValidation.unknownOptionCount
    ).toBe(1);
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideUnknownValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --output, --json, -j."
    );
    expect(
      staleSupportedWithUnknownTokenCatalogOverrideUnknownValidation.validationErrorCode
    ).toBe("unsupported_options");
    let staleAliasOnlyOptionCatalogOverrideCanonicalReadCount = 0;
    const staleAliasOnlyOptionCatalogOverrideCanonicalOptions = new Proxy(
      ["--json"],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            staleAliasOnlyOptionCatalogOverrideCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const staleAliasOnlyOptionCatalogOverrideValidation =
      createCliOptionValidation(["--verify"], {
        canonicalOptions:
          staleAliasOnlyOptionCatalogOverrideCanonicalOptions as never,
        optionCatalog: {
          supportedCliOptions: ["--no-build"],
          availableCliOptionAliases: {
            "--no-build": ["--verify"],
          },
        } as never,
      });
    expect(staleAliasOnlyOptionCatalogOverrideValidation.supportedCliOptions).toEqual(
      ["--no-build", "--verify"]
    );
    expect(
      staleAliasOnlyOptionCatalogOverrideValidation.supportedCliOptionCount
    ).toBe(2);
    expect(staleAliasOnlyOptionCatalogOverrideValidation.unknownOptions).toEqual(
      []
    );
    expect(staleAliasOnlyOptionCatalogOverrideValidation.unknownOptionCount).toBe(
      0
    );
    expect(
      staleAliasOnlyOptionCatalogOverrideValidation.unsupportedOptionsError
    ).toBeNull();
    expect(staleAliasOnlyOptionCatalogOverrideValidation.validationErrorCode).toBeNull();
    expect(staleAliasOnlyOptionCatalogOverrideCanonicalReadCount).toBe(0);
    const staleAliasOnlyWithUnknownTokenCatalogOverrideValidation =
      createCliOptionValidation(["--verify"], {
        canonicalOptions: ["--json"],
        optionCatalog: {
          supportedCliOptions: ["--no-build", "--mystery"],
          availableCliOptionAliases: {
            "--no-build": ["--verify"],
          },
        } as never,
      });
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideValidation.supportedCliOptions
    ).toEqual(["--no-build", "--verify"]);
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideValidation.supportedCliOptionCount
    ).toBe(2);
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideValidation.unknownOptions
    ).toEqual([]);
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideValidation.unknownOptionCount
    ).toBe(0);
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideValidation.validationErrorCode
    ).toBeNull();
    const staleAliasOnlyWithUnknownTokenCatalogOverrideUnknownValidation =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: ["--json"],
        optionCatalog: {
          supportedCliOptions: ["--no-build", "--mystery"],
          availableCliOptionAliases: {
            "--no-build": ["--verify"],
          },
        } as never,
      });
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideUnknownValidation.supportedCliOptions
    ).toEqual(["--no-build", "--verify"]);
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideUnknownValidation.supportedCliOptionCount
    ).toBe(2);
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideUnknownValidation.unknownOptions
    ).toEqual(["--mystery"]);
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideUnknownValidation.unknownOptionCount
    ).toBe(1);
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideUnknownValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --no-build, --verify."
    );
    expect(
      staleAliasOnlyWithUnknownTokenCatalogOverrideUnknownValidation.validationErrorCode
    ).toBe("unsupported_options");
    let optionCatalogOverrideWithoutSupportedCanonicalReadCount = 0;
    const optionCatalogOverrideWithoutSupportedCanonicalOptions = new Proxy(
      ["--json"],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionCatalogOverrideWithoutSupportedCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const optionCatalogOverrideWithoutSupportedValidation =
      createCliOptionValidation(["--json"], {
        canonicalOptions:
          optionCatalogOverrideWithoutSupportedCanonicalOptions as never,
        optionCatalog: {
          availableCliOptionAliases: {},
          availableCliOptionCanonicalMap: {
            "--json": "--json",
          },
        } as never,
      });
    expect(optionCatalogOverrideWithoutSupportedValidation.supportedCliOptions).toEqual(
      ["--json"]
    );
    expect(optionCatalogOverrideWithoutSupportedValidation.supportedCliOptionCount).toBe(
      1
    );
    expect(optionCatalogOverrideWithoutSupportedValidation.unknownOptions).toEqual(
      []
    );
    expect(optionCatalogOverrideWithoutSupportedValidation.unknownOptionCount).toBe(
      0
    );
    expect(
      optionCatalogOverrideWithoutSupportedValidation.unsupportedOptionsError
    ).toBeNull();
    expect(optionCatalogOverrideWithoutSupportedValidation.validationErrorCode).toBeNull();
    expect(optionCatalogOverrideWithoutSupportedCanonicalReadCount).toBe(0);
    let aliasOnlyOptionCatalogOverrideCanonicalReadCount = 0;
    const aliasOnlyOptionCatalogOverrideCanonicalOptions = new Proxy(
      ["--json"],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            aliasOnlyOptionCatalogOverrideCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const aliasOnlyOptionCatalogOverrideValidation = createCliOptionValidation(
      ["--verify"],
      {
        canonicalOptions:
          aliasOnlyOptionCatalogOverrideCanonicalOptions as never,
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--verify": "--no-build",
          },
        } as never,
      }
    );
    expect(aliasOnlyOptionCatalogOverrideValidation.supportedCliOptions).toEqual([
      "--no-build",
      "--verify",
    ]);
    expect(aliasOnlyOptionCatalogOverrideValidation.supportedCliOptionCount).toBe(2);
    expect(aliasOnlyOptionCatalogOverrideValidation.unknownOptions).toEqual([]);
    expect(aliasOnlyOptionCatalogOverrideValidation.unknownOptionCount).toBe(0);
    expect(aliasOnlyOptionCatalogOverrideValidation.unsupportedOptionsError).toBeNull();
    expect(aliasOnlyOptionCatalogOverrideValidation.validationErrorCode).toBeNull();
    expect(aliasOnlyOptionCatalogOverrideCanonicalReadCount).toBe(0);
    const whitespaceCanonicalMapOptionCatalogOverrideValidation =
      createCliOptionValidation(["--verify", "--skip-build"], {
        canonicalOptions: ["--json"],
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            " --verify ": " --no-build ",
            " --no-build ": " --no-build ",
          },
          availableCliOptionAliases: {
            " --no-build ": [" --skip-build "],
          },
        } as never,
      });
    expect(
      whitespaceCanonicalMapOptionCatalogOverrideValidation.supportedCliOptions
    ).toEqual(["--no-build", "--skip-build", "--verify"]);
    expect(
      whitespaceCanonicalMapOptionCatalogOverrideValidation.supportedCliOptionCount
    ).toBe(3);
    expect(
      whitespaceCanonicalMapOptionCatalogOverrideValidation.unknownOptions
    ).toEqual([]);
    expect(
      whitespaceCanonicalMapOptionCatalogOverrideValidation.unknownOptionCount
    ).toBe(0);
    expect(
      whitespaceCanonicalMapOptionCatalogOverrideValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      whitespaceCanonicalMapOptionCatalogOverrideValidation.validationErrorCode
    ).toBeNull();
    const mixedCanonicalMapEntryOptionCatalogOverrideValidation =
      createCliOptionValidation(["--verify"], {
        canonicalOptions: ["--json"],
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--verify": "--no-build",
            "--json": 1 as never,
            "--no-build": "--no-build",
          },
        } as never,
      });
    expect(
      mixedCanonicalMapEntryOptionCatalogOverrideValidation.supportedCliOptions
    ).toEqual(["--no-build", "--verify"]);
    expect(
      mixedCanonicalMapEntryOptionCatalogOverrideValidation.supportedCliOptionCount
    ).toBe(2);
    expect(mixedCanonicalMapEntryOptionCatalogOverrideValidation.unknownOptions).toEqual(
      []
    );
    expect(
      mixedCanonicalMapEntryOptionCatalogOverrideValidation.unknownOptionCount
    ).toBe(0);
    expect(
      mixedCanonicalMapEntryOptionCatalogOverrideValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      mixedCanonicalMapEntryOptionCatalogOverrideValidation.validationErrorCode
    ).toBeNull();
    const dedupedAliasCatalogOverrideValidation = createCliOptionValidation(
      ["--verify", "--skip-build"],
      {
        canonicalOptions: ["--json"],
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--verify": "--no-build",
          },
          availableCliOptionAliases: {
            "--no-build": ["--verify", "--skip-build"],
          },
        } as never,
      }
    );
    expect(dedupedAliasCatalogOverrideValidation.supportedCliOptions).toEqual([
      "--no-build",
      "--verify",
      "--skip-build",
    ]);
    expect(dedupedAliasCatalogOverrideValidation.supportedCliOptionCount).toBe(3);
    expect(dedupedAliasCatalogOverrideValidation.unknownOptions).toEqual([]);
    expect(dedupedAliasCatalogOverrideValidation.unknownOptionCount).toBe(0);
    expect(dedupedAliasCatalogOverrideValidation.unsupportedOptionsError).toBeNull();
    expect(dedupedAliasCatalogOverrideValidation.validationErrorCode).toBeNull();
    const strictOptionCatalogOverrideValidation = createCliOptionValidation(
      ["--output", "-j"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--output": "--output",
            "--json": "--json",
            "-j": "--json",
          },
        } as never,
      }
    );
    expect(strictOptionCatalogOverrideValidation.supportedCliOptions).toEqual([
      "--output",
      "--json",
      "-j",
    ]);
    expect(strictOptionCatalogOverrideValidation.supportedCliOptionCount).toBe(3);
    expect(strictOptionCatalogOverrideValidation.unknownOptions).toEqual([]);
    expect(strictOptionCatalogOverrideValidation.unknownOptionCount).toBe(0);
    expect(strictOptionCatalogOverrideValidation.unsupportedOptionsError).toBeNull();
    expect(strictOptionCatalogOverrideValidation.validationErrorCode).toBeNull();
    const strictOptionCatalogOverrideUnknownValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        optionCatalog: {
          availableCliOptionCanonicalMap: {
            "--output": "--output",
            "--json": "--json",
            "-j": "--json",
          },
        } as never,
      });
    expect(strictOptionCatalogOverrideUnknownValidation.supportedCliOptions).toEqual(
      ["--output", "--json", "-j"]
    );
    expect(strictOptionCatalogOverrideUnknownValidation.supportedCliOptionCount).toBe(
      3
    );
    expect(strictOptionCatalogOverrideUnknownValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(strictOptionCatalogOverrideUnknownValidation.unknownOptionCount).toBe(1);
    expect(strictOptionCatalogOverrideUnknownValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --json, -j."
    );
    expect(strictOptionCatalogOverrideUnknownValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    let malformedOptionCatalogOverrideCanonicalReadCount = 0;
    const malformedOptionCatalogOverrideCanonicalOptions = new Proxy(
      ["--json"],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            malformedOptionCatalogOverrideCanonicalReadCount += 1;
            return "--json";
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const malformedOptionCatalogOverrideValidation = createCliOptionValidation(
      ["--json"],
      {
        canonicalOptions: malformedOptionCatalogOverrideCanonicalOptions as never,
        optionCatalog: {
          supportedCliOptions: "--json" as never,
        } as never,
      }
    );
    expect(malformedOptionCatalogOverrideValidation.supportedCliOptions).toEqual([
      "--json",
    ]);
    expect(malformedOptionCatalogOverrideValidation.supportedCliOptionCount).toBe(
      1
    );
    expect(malformedOptionCatalogOverrideValidation.unknownOptions).toEqual([]);
    expect(malformedOptionCatalogOverrideValidation.unknownOptionCount).toBe(0);
    expect(malformedOptionCatalogOverrideValidation.unsupportedOptionsError).toBeNull();
    expect(malformedOptionCatalogOverrideValidation.validationErrorCode).toBeNull();
    expect(malformedOptionCatalogOverrideCanonicalReadCount).toBe(2);

    const malformedPrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: ["--json", "--json", 1],
      }
    );
    expect(malformedPrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(malformedPrecomputedSupportedTokens.supportedCliOptionCount).toBe(2);
    expect(malformedPrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    const setPrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: new Set(["--json", "--output"]) as never,
      }
    );
    expect(setPrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(setPrecomputedSupportedTokens.supportedCliOptionCount).toBe(2);
    expect(setPrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    const mapPrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: new Map<string, boolean>([
          ["--json", true],
          ["--output", true],
        ]) as never,
      }
    );
    expect(mapPrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(mapPrecomputedSupportedTokens.supportedCliOptionCount).toBe(2);
    expect(mapPrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    const primitivePrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: "--json" as never,
      }
    );
    expect(primitivePrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(primitivePrecomputedSupportedTokens.supportedCliOptionCount).toBe(2);
    expect(primitivePrecomputedSupportedTokens.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    let canonicalValidationReadCount = 0;
    const canonicalOptionsForValidationReadCount = new Proxy(["--json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (property === "0") {
          canonicalValidationReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const canonicalValidationReadCountResult = createCliOptionValidation(
      ["--json"],
      {
        canonicalOptions: canonicalOptionsForValidationReadCount as never,
      }
    );
    expect(canonicalValidationReadCountResult.supportedCliOptions).toEqual([
      "--json",
    ]);
    expect(canonicalValidationReadCountResult.supportedCliOptionCount).toBe(1);
    expect(canonicalValidationReadCountResult.unknownOptions).toEqual([]);
    expect(canonicalValidationReadCountResult.unknownOptionCount).toBe(0);
    expect(canonicalValidationReadCountResult.unsupportedOptionsError).toBeNull();
    expect(canonicalValidationReadCountResult.validationErrorCode).toBeNull();
    expect(canonicalValidationReadCount).toBe(2);
    let statefulCanonicalOptionReadCount = 0;
    const statefulCanonicalOptions = new Proxy(["--json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (property === "0") {
          statefulCanonicalOptionReadCount += 1;
          if (statefulCanonicalOptionReadCount > 1) {
            return undefined;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulCanonicalValidation = createCliOptionValidation(["--json"], {
      canonicalOptions: statefulCanonicalOptions as never,
    });
    expect(statefulCanonicalValidation.supportedCliOptions).toEqual(["--json"]);
    expect(statefulCanonicalValidation.supportedCliOptionCount).toBe(1);
    expect(statefulCanonicalValidation.unknownOptions).toEqual([]);
    expect(statefulCanonicalValidation.unknownOptionCount).toBe(0);
    expect(statefulCanonicalValidation.unsupportedOptionsError).toBeNull();
    expect(statefulCanonicalValidation.validationErrorCode).toBeNull();
    let statefulAliasTokenReadCount = 0;
    const statefulAliasValidation = createCliOptionValidation(["--verify"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": new Proxy(["--verify"], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) {
              throw new Error("iterator trap");
            }
            if (property === "length") {
              return 1;
            }
            if (property === "0") {
              statefulAliasTokenReadCount += 1;
              if (statefulAliasTokenReadCount > 1) {
                return undefined;
              }
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      },
    });
    expect(statefulAliasValidation.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(statefulAliasValidation.supportedCliOptionCount).toBe(3);
    expect(statefulAliasValidation.unknownOptions).toEqual([]);
    expect(statefulAliasValidation.unknownOptionCount).toBe(0);
    expect(statefulAliasValidation.unsupportedOptionsError).toBeNull();
    expect(statefulAliasValidation.validationErrorCode).toBeNull();
    expect(statefulAliasTokenReadCount).toBe(2);
    let statefulValueMetadataReadCount = 0;
    const statefulValueMetadataValidation = createCliOptionValidation(
      ["--output", "-j"],
      {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: new Proxy(["--output"], {
          get(target, property, receiver) {
            if (property === "0") {
              statefulValueMetadataReadCount += 1;
              if (statefulValueMetadataReadCount > 1) {
                return undefined;
              }
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      }
    );
    expect(statefulValueMetadataValidation.supportedCliOptions).toEqual([
      "--output",
      "--json",
      "-j",
    ]);
    expect(statefulValueMetadataValidation.supportedCliOptionCount).toBe(3);
    expect(statefulValueMetadataValidation.unknownOptions).toEqual([]);
    expect(statefulValueMetadataValidation.unknownOptionCount).toBe(0);
    expect(statefulValueMetadataValidation.unsupportedOptionsError).toBeNull();
    expect(statefulValueMetadataValidation.validationErrorCode).toBeNull();
    expect(statefulValueMetadataReadCount).toBe(1);
    let statefulStrictMetadataReadCount = 0;
    const statefulStrictMetadataValidation = createCliOptionValidation(
      ["--output", "-j"],
      {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: new Proxy(["--output"], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) {
              throw new Error("iterator trap");
            }
            if (property === "length") {
              return 1;
            }
            if (property === "0") {
              statefulStrictMetadataReadCount += 1;
              if (statefulStrictMetadataReadCount > 1) {
                return undefined;
              }
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      }
    );
    expect(statefulStrictMetadataValidation.supportedCliOptions).toEqual([
      "--output",
      "--json",
      "-j",
    ]);
    expect(statefulStrictMetadataValidation.supportedCliOptionCount).toBe(3);
    expect(statefulStrictMetadataValidation.unknownOptions).toEqual([]);
    expect(statefulStrictMetadataValidation.unknownOptionCount).toBe(0);
    expect(statefulStrictMetadataValidation.unsupportedOptionsError).toBeNull();
    expect(statefulStrictMetadataValidation.validationErrorCode).toBeNull();
    expect(statefulStrictMetadataReadCount).toBe(2);

    const iteratorTrapSupportedTokens = ["--json", "--output"];
    Object.defineProperty(iteratorTrapSupportedTokens, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const iteratorTrapPrecomputedSupportedTokens = createCliOptionValidation(
      ["--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: iteratorTrapSupportedTokens as never,
      }
    );
    expect(iteratorTrapPrecomputedSupportedTokens.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(
      iteratorTrapPrecomputedSupportedTokens.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    const lengthAndOwnKeysTrapSupportedTokens = new Proxy(
      ["--json", "--output"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const lengthAndOwnKeysTrapPrecomputedSupportedTokens =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions: lengthAndOwnKeysTrapSupportedTokens as never,
      });
    expect(lengthAndOwnKeysTrapPrecomputedSupportedTokens.supportedCliOptions).toEqual(
      ["--json", "--output"]
    );
    expect(
      lengthAndOwnKeysTrapPrecomputedSupportedTokens.supportedCliOptionCount
    ).toBe(2);
    expect(
      lengthAndOwnKeysTrapPrecomputedSupportedTokens.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    const fullyRecoverableLengthTrappedSupportedTokens =
      createLengthTrappedPartiallyRecoveredStringArray(
        ["--json", "--output"],
        2
      );
    const fullyRecoverableLengthTrappedPrecomputedSupportedTokens =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions:
          fullyRecoverableLengthTrappedSupportedTokens as never,
      });
    expect(
      fullyRecoverableLengthTrappedPrecomputedSupportedTokens.supportedCliOptions
    ).toEqual(["--json", "--output"]);
    expect(
      fullyRecoverableLengthTrappedPrecomputedSupportedTokens.supportedCliOptionCount
    ).toBe(2);
    expect(
      fullyRecoverableLengthTrappedPrecomputedSupportedTokens.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    const partiallyRecoverableLengthTrappedSupportedTokens =
      createLengthTrappedPartiallyRecoveredStringArray(["--json", "--output"]);
    const partiallyRecoverableLengthTrappedPrecomputedSupportedTokens =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        supportedCliOptions:
          partiallyRecoverableLengthTrappedSupportedTokens as never,
      });
    expect(
      partiallyRecoverableLengthTrappedPrecomputedSupportedTokens.supportedCliOptions
    ).toEqual(["--json", "--output"]);
    expect(
      partiallyRecoverableLengthTrappedPrecomputedSupportedTokens.supportedCliOptionCount
    ).toBe(2);
    expect(
      partiallyRecoverableLengthTrappedPrecomputedSupportedTokens.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    const partiallyRecoverableLengthTrappedAliasPrecomputedSupportedTokens =
      createLengthTrappedPartiallyRecoveredStringArray(["--verify", "--json"]);
    const partiallyRecoverableLengthTrappedAliasPrecomputedValidation =
      createCliOptionValidation(["--mystery"], {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        supportedCliOptions:
          partiallyRecoverableLengthTrappedAliasPrecomputedSupportedTokens as never,
      });
    expect(
      partiallyRecoverableLengthTrappedAliasPrecomputedValidation.supportedCliOptions
    ).toEqual(["--json", "--no-build", "--verify"]);
    expect(
      partiallyRecoverableLengthTrappedAliasPrecomputedValidation.supportedCliOptionCount
    ).toBe(3);
    expect(
      partiallyRecoverableLengthTrappedAliasPrecomputedValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build, --verify."
    );
    const fullyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(
        ["--json", "--output"],
        2
      );
    const fullyRecoverableLengthTrappedCanonicalValidation =
      createCliOptionValidation(
        ["--json", "--mystery", "--output", "./report.json"],
        {
          canonicalOptions:
            fullyRecoverableLengthTrappedCanonicalOptions as never,
          optionsWithValues: ["--output"],
        }
      );
    expect(
      fullyRecoverableLengthTrappedCanonicalValidation.supportedCliOptions
    ).toEqual(["--json", "--output"]);
    expect(
      fullyRecoverableLengthTrappedCanonicalValidation.supportedCliOptionCount
    ).toBe(2);
    expect(fullyRecoverableLengthTrappedCanonicalValidation.unknownOptions).toEqual(
      ["--mystery"]
    );
    expect(
      fullyRecoverableLengthTrappedCanonicalValidation.unknownOptionCount
    ).toBe(1);
    expect(
      fullyRecoverableLengthTrappedCanonicalValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(
      fullyRecoverableLengthTrappedCanonicalValidation.validationErrorCode
    ).toBe("unsupported_options");
    const partiallyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(["--json", "--output"]);
    const partiallyRecoverableLengthTrappedCanonicalValidation =
      createCliOptionValidation(
        ["--json", "--mystery", "--output", "./report.json"],
        {
          canonicalOptions:
            partiallyRecoverableLengthTrappedCanonicalOptions as never,
          optionsWithValues: ["--output"],
        }
      );
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidation.supportedCliOptions
    ).toEqual(["--json"]);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidation.supportedCliOptionCount
    ).toBe(1);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidation.unknownOptions
    ).toEqual(["--mystery", "--output"]);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidation.unknownOptionCount
    ).toBe(2);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery, --output. Supported options: --json."
    );
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidation.validationErrorCode
    ).toBe("unsupported_options");
    const partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallback =
      createCliOptionValidation(
        ["--verify", "--mystery", "--output", "./report.json"],
        {
          canonicalOptions:
            partiallyRecoverableLengthTrappedCanonicalOptions as never,
          optionAliases: {
            "--no-build": ["--verify"],
          },
          optionsWithValues: ["--output"],
        }
      );
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallback.supportedCliOptions
    ).toEqual(["--json", "--no-build", "--verify"]);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallback.supportedCliOptionCount
    ).toBe(3);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallback.unknownOptions
    ).toEqual(["--mystery", "--output"]);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallback.unknownOptionCount
    ).toBe(2);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallback.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery, --output. Supported options: --json, --no-build, --verify."
    );
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallback.validationErrorCode
    ).toBe("unsupported_options");
    const partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallbackAndDashValue =
      createCliOptionValidation(
        ["--verify", "--output", "-artifact-report.json"],
        {
          canonicalOptions:
            partiallyRecoverableLengthTrappedCanonicalOptions as never,
          optionAliases: {
            "--no-build": ["--verify"],
          },
          optionsWithValues: ["--output"],
          optionsWithStrictValues: ["--output"],
        }
      );
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallbackAndDashValue.supportedCliOptions
    ).toEqual(["--json", "--no-build", "--verify"]);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallbackAndDashValue.supportedCliOptionCount
    ).toBe(3);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallbackAndDashValue.unknownOptions
    ).toEqual(["--output", "-artifact-report.json"]);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallbackAndDashValue.unknownOptionCount
    ).toBe(2);
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallbackAndDashValue.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --output, -artifact-report.json. Supported options: --json, --no-build, --verify."
    );
    expect(
      partiallyRecoverableLengthTrappedCanonicalValidationWithAliasFallbackAndDashValue.validationErrorCode
    ).toBe("unsupported_options");

    const outputErrorPriority = createCliOptionValidation(
      ["--json", "--mystery"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        outputPathError: "Missing value for --output option.",
      }
    );
    expect(outputErrorPriority.validationErrorCode).toBe(
      "output_option_missing_value"
    );
    const strictUnknownShortValueValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(strictUnknownShortValueValidation.unknownOptions).toEqual(["-l"]);
    expect(strictUnknownShortValueValidation.unknownOptionCount).toBe(1);
    expect(strictUnknownShortValueValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(strictUnknownShortValueValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const strictUnknownInlineShortValueValidation = createCliOptionValidation(
      ["--output", "-l=1"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(strictUnknownInlineShortValueValidation.unknownOptions).toEqual(["-l"]);
    expect(strictUnknownInlineShortValueValidation.unknownOptionCount).toBe(1);
    expect(strictUnknownInlineShortValueValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(strictUnknownInlineShortValueValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const mixedStrictMetadataStrictOptionValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["--output", 1] as never,
      }
    );
    expect(mixedStrictMetadataStrictOptionValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(mixedStrictMetadataStrictOptionValidation.unknownOptionCount).toBe(1);
    expect(mixedStrictMetadataStrictOptionValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(mixedStrictMetadataStrictOptionValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const mixedStrictMetadataNonStrictOptionValidation =
      createCliOptionValidation(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["--output", 1] as never,
      });
    expect(mixedStrictMetadataNonStrictOptionValidation.unknownOptions).toEqual([]);
    expect(mixedStrictMetadataNonStrictOptionValidation.unknownOptionCount).toBe(
      0
    );
    expect(
      mixedStrictMetadataNonStrictOptionValidation.unsupportedOptionsError
    ).toBeNull();
    expect(mixedStrictMetadataNonStrictOptionValidation.validationErrorCode).toBeNull();
    const primitiveStrictValueMetadataValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: "--output" as never,
      }
    );
    expect(primitiveStrictValueMetadataValidation.unknownOptions).toEqual(["-l"]);
    expect(primitiveStrictValueMetadataValidation.unknownOptionCount).toBe(1);
    expect(primitiveStrictValueMetadataValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(primitiveStrictValueMetadataValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const primitiveStrictMetadataAcrossMultipleValueOptionsValidation =
      createCliOptionValidation(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: "--output" as never,
      });
    expect(
      primitiveStrictMetadataAcrossMultipleValueOptionsValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      primitiveStrictMetadataAcrossMultipleValueOptionsValidation.unknownOptionCount
    ).toBe(1);
    expect(
      primitiveStrictMetadataAcrossMultipleValueOptionsValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      primitiveStrictMetadataAcrossMultipleValueOptionsValidation.validationErrorCode
    ).toBe("unsupported_options");
    const primitiveStrictMetadataAcrossMultipleValueOptionsDashPathValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: "--output" as never,
      });
    expect(
      primitiveStrictMetadataAcrossMultipleValueOptionsDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      primitiveStrictMetadataAcrossMultipleValueOptionsDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      primitiveStrictMetadataAcrossMultipleValueOptionsDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      primitiveStrictMetadataAcrossMultipleValueOptionsDashPathValidation.validationErrorCode
    ).toBeNull();
    const setStrictValueMetadata = new Set(["--output"]);
    const setStrictMetadataAcrossMultipleValueOptionsValidation =
      createCliOptionValidation(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: setStrictValueMetadata as never,
      });
    expect(
      setStrictMetadataAcrossMultipleValueOptionsValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      setStrictMetadataAcrossMultipleValueOptionsValidation.unknownOptionCount
    ).toBe(1);
    expect(
      setStrictMetadataAcrossMultipleValueOptionsValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      setStrictMetadataAcrossMultipleValueOptionsValidation.validationErrorCode
    ).toBe("unsupported_options");
    const setStrictMetadataAcrossMultipleValueOptionsDashPathValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: setStrictValueMetadata as never,
      });
    expect(
      setStrictMetadataAcrossMultipleValueOptionsDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      setStrictMetadataAcrossMultipleValueOptionsDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      setStrictMetadataAcrossMultipleValueOptionsDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      setStrictMetadataAcrossMultipleValueOptionsDashPathValidation.validationErrorCode
    ).toBeNull();
    const primitiveStrictDashPathValueValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: "--output" as never,
      }
    );
    expect(primitiveStrictDashPathValueValidation.unknownOptions).toEqual([]);
    expect(primitiveStrictDashPathValueValidation.unknownOptionCount).toBe(0);
    expect(primitiveStrictDashPathValueValidation.unsupportedOptionsError).toBeNull();
    expect(primitiveStrictDashPathValueValidation.validationErrorCode).toBeNull();
    const unsupportedStrictShortValueValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--mystery"],
      }
    );
    expect(unsupportedStrictShortValueValidation.unknownOptions).toEqual(["-l"]);
    expect(unsupportedStrictShortValueValidation.unknownOptionCount).toBe(1);
    expect(unsupportedStrictShortValueValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(unsupportedStrictShortValueValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const unsupportedStrictDashPathValueValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--mystery"],
      }
    );
    expect(unsupportedStrictDashPathValueValidation.unknownOptions).toEqual([]);
    expect(unsupportedStrictDashPathValueValidation.unknownOptionCount).toBe(0);
    expect(unsupportedStrictDashPathValueValidation.unsupportedOptionsError).toBeNull();
    expect(unsupportedStrictDashPathValueValidation.validationErrorCode).toBeNull();
    const mixedValueMetadataAndUnsupportedStrictShortValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      });
    expect(
      mixedValueMetadataAndUnsupportedStrictShortValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      mixedValueMetadataAndUnsupportedStrictShortValidation.unknownOptionCount
    ).toBe(1);
    expect(
      mixedValueMetadataAndUnsupportedStrictShortValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output.");
    expect(
      mixedValueMetadataAndUnsupportedStrictShortValidation.validationErrorCode
    ).toBe("unsupported_options");
    const mixedValueMetadataAndUnsupportedStrictDashPathValidation =
      createCliOptionValidation(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      });
    expect(
      mixedValueMetadataAndUnsupportedStrictDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      mixedValueMetadataAndUnsupportedStrictDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      mixedValueMetadataAndUnsupportedStrictDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      mixedValueMetadataAndUnsupportedStrictDashPathValidation.validationErrorCode
    ).toBeNull();
    const mixedValueMetadataWithoutStrictShortValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
      });
    expect(mixedValueMetadataWithoutStrictShortValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(mixedValueMetadataWithoutStrictShortValidation.unknownOptionCount).toBe(
      1
    );
    expect(
      mixedValueMetadataWithoutStrictShortValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output.");
    expect(
      mixedValueMetadataWithoutStrictShortValidation.validationErrorCode
    ).toBe("unsupported_options");
    const mixedValueMetadataWithoutStrictDashPathValidation =
      createCliOptionValidation(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
      });
    expect(mixedValueMetadataWithoutStrictDashPathValidation.unknownOptions).toEqual(
      []
    );
    expect(
      mixedValueMetadataWithoutStrictDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      mixedValueMetadataWithoutStrictDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      mixedValueMetadataWithoutStrictDashPathValidation.validationErrorCode
    ).toBeNull();
    const mixedValueMetadataWithoutStrictSubsetOnlyValidation =
      createCliOptionValidation(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
      });
    expect(mixedValueMetadataWithoutStrictSubsetOnlyValidation.unknownOptions).toEqual(
      ["-l"]
    );
    expect(
      mixedValueMetadataWithoutStrictSubsetOnlyValidation.unknownOptionCount
    ).toBe(1);
    expect(
      mixedValueMetadataWithoutStrictSubsetOnlyValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      mixedValueMetadataWithoutStrictSubsetOnlyValidation.validationErrorCode
    ).toBe("unsupported_options");
    const mixedValueMetadataWithoutStrictSubsetOnlyDashPathValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
      });
    expect(
      mixedValueMetadataWithoutStrictSubsetOnlyDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      mixedValueMetadataWithoutStrictSubsetOnlyDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      mixedValueMetadataWithoutStrictSubsetOnlyDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      mixedValueMetadataWithoutStrictSubsetOnlyDashPathValidation.validationErrorCode
    ).toBeNull();
    const partiallyRecoveredValueOptions = createPartiallyRecoveredStringArray([
      "--output",
      "--only",
    ]);
    const partiallyRecoveredValueMetadataOutputValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
      });
    expect(partiallyRecoveredValueMetadataOutputValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(partiallyRecoveredValueMetadataOutputValidation.unknownOptionCount).toBe(
      1
    );
    expect(
      partiallyRecoveredValueMetadataOutputValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(partiallyRecoveredValueMetadataOutputValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const partiallyRecoveredValueMetadataOnlyValidation =
      createCliOptionValidation(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
      });
    expect(partiallyRecoveredValueMetadataOnlyValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(partiallyRecoveredValueMetadataOnlyValidation.unknownOptionCount).toBe(
      1
    );
    expect(
      partiallyRecoveredValueMetadataOnlyValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(partiallyRecoveredValueMetadataOnlyValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const partiallyRecoveredValueMetadataOnlyDashPathValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
      });
    expect(
      partiallyRecoveredValueMetadataOnlyDashPathValidation.unknownOptions
    ).toEqual(["-artifact-report.json"]);
    expect(
      partiallyRecoveredValueMetadataOnlyDashPathValidation.unknownOptionCount
    ).toBe(1);
    expect(
      partiallyRecoveredValueMetadataOnlyDashPathValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(
      partiallyRecoveredValueMetadataOnlyDashPathValidation.validationErrorCode
    ).toBe("unsupported_options");
    const partiallyRecoveredStrictSubsetOptions = createPartiallyRecoveredStringArray(
      ["--only", "--output"]
    );
    const partiallyRecoveredValueAndStrictSubsetOutputValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      });
    expect(
      partiallyRecoveredValueAndStrictSubsetOutputValidation.unknownOptions
    ).toEqual([]);
    expect(
      partiallyRecoveredValueAndStrictSubsetOutputValidation.unknownOptionCount
    ).toBe(0);
    expect(
      partiallyRecoveredValueAndStrictSubsetOutputValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      partiallyRecoveredValueAndStrictSubsetOutputValidation.validationErrorCode
    ).toBeNull();
    const partiallyRecoveredValueAndStrictSubsetOnlyValidation =
      createCliOptionValidation(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      });
    expect(
      partiallyRecoveredValueAndStrictSubsetOnlyValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      partiallyRecoveredValueAndStrictSubsetOnlyValidation.unknownOptionCount
    ).toBe(1);
    expect(
      partiallyRecoveredValueAndStrictSubsetOnlyValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      partiallyRecoveredValueAndStrictSubsetOnlyValidation.validationErrorCode
    ).toBe("unsupported_options");
    const partiallyRecoveredValueAndStrictSubsetOnlyDashPathValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      });
    expect(
      partiallyRecoveredValueAndStrictSubsetOnlyDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      partiallyRecoveredValueAndStrictSubsetOnlyDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      partiallyRecoveredValueAndStrictSubsetOnlyDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      partiallyRecoveredValueAndStrictSubsetOnlyDashPathValidation.validationErrorCode
    ).toBeNull();
    const lengthTrappedPartiallyRecoveredStrictSubsetOptions =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--output",
        "--only",
      ]);
    const lengthTrappedStrictSubsetOnlyShortValidation = createCliOptionValidation(
      ["--only", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictSubsetOptions as never,
      }
    );
    expect(lengthTrappedStrictSubsetOnlyShortValidation.unknownOptions).toEqual(
      []
    );
    expect(lengthTrappedStrictSubsetOnlyShortValidation.unknownOptionCount).toBe(0);
    expect(
      lengthTrappedStrictSubsetOnlyShortValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      lengthTrappedStrictSubsetOnlyShortValidation.validationErrorCode
    ).toBeNull();
    const lengthTrappedStrictSubsetOutputShortValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictSubsetOptions as never,
      });
    expect(lengthTrappedStrictSubsetOutputShortValidation.unknownOptions).toEqual([
      "-l",
    ]);
    expect(lengthTrappedStrictSubsetOutputShortValidation.unknownOptionCount).toBe(
      1
    );
    expect(
      lengthTrappedStrictSubsetOutputShortValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      lengthTrappedStrictSubsetOutputShortValidation.validationErrorCode
    ).toBe("unsupported_options");
    const lengthTrappedStrictSubsetOutputInlineShortValidation =
      createCliOptionValidation(["--output", "-l=1"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictSubsetOptions as never,
      });
    expect(
      lengthTrappedStrictSubsetOutputInlineShortValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      lengthTrappedStrictSubsetOutputInlineShortValidation.unknownOptionCount
    ).toBe(1);
    expect(
      lengthTrappedStrictSubsetOutputInlineShortValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      lengthTrappedStrictSubsetOutputInlineShortValidation.validationErrorCode
    ).toBe("unsupported_options");
    const lengthTrappedPartiallyRecoveredValueOptions =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--output",
        "--only",
      ]);
    const lengthTrappedValueSubsetOnlyDashPathValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(lengthTrappedValueSubsetOnlyDashPathValidation.unknownOptions).toEqual(
      ["-artifact-report.json"]
    );
    expect(
      lengthTrappedValueSubsetOnlyDashPathValidation.unknownOptionCount
    ).toBe(1);
    expect(
      lengthTrappedValueSubsetOnlyDashPathValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(
      lengthTrappedValueSubsetOnlyDashPathValidation.validationErrorCode
    ).toBe("unsupported_options");
    const lengthTrappedValueSubsetOnlyInlineShortValidation =
      createCliOptionValidation(["--only", "-l=1"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(lengthTrappedValueSubsetOnlyInlineShortValidation.unknownOptions).toEqual(
      ["-l"]
    );
    expect(
      lengthTrappedValueSubsetOnlyInlineShortValidation.unknownOptionCount
    ).toBe(1);
    expect(
      lengthTrappedValueSubsetOnlyInlineShortValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      lengthTrappedValueSubsetOnlyInlineShortValidation.validationErrorCode
    ).toBe("unsupported_options");
    const unavailableValueMetadataAndRecoverableStrictSubsetOutputValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOutputValidation.unknownOptions
    ).toEqual([]);
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOutputValidation.unknownOptionCount
    ).toBe(0);
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOutputValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOutputValidation.validationErrorCode
    ).toBeNull();
    const unavailableValueMetadataAndRecoverableStrictSubsetOnlyValidation =
      createCliOptionValidation(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOnlyValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOnlyValidation.unknownOptionCount
    ).toBe(1);
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOnlyValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOnlyValidation.validationErrorCode
    ).toBe("unsupported_options");
    const unavailableValueMetadataAndRecoverableStrictSubsetOnlyDashPathValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOnlyDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOnlyDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOnlyDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      unavailableValueMetadataAndRecoverableStrictSubsetOnlyDashPathValidation.validationErrorCode
    ).toBeNull();
    const unavailableValueMetadataAndUnsupportedStrictSubsetOnlyValidation =
      createCliOptionValidation(["--only", "-l"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      });
    expect(
      unavailableValueMetadataAndUnsupportedStrictSubsetOnlyValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      unavailableValueMetadataAndUnsupportedStrictSubsetOnlyValidation.unknownOptionCount
    ).toBe(1);
    expect(
      unavailableValueMetadataAndUnsupportedStrictSubsetOnlyValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output, --only.");
    expect(
      unavailableValueMetadataAndUnsupportedStrictSubsetOnlyValidation.validationErrorCode
    ).toBe("unsupported_options");
    const unavailableValueMetadataAndUnsupportedStrictSubsetOnlyDashPathValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      });
    expect(
      unavailableValueMetadataAndUnsupportedStrictSubsetOnlyDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      unavailableValueMetadataAndUnsupportedStrictSubsetOnlyDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      unavailableValueMetadataAndUnsupportedStrictSubsetOnlyDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      unavailableValueMetadataAndUnsupportedStrictSubsetOnlyDashPathValidation.validationErrorCode
    ).toBeNull();
    const unresolvedValueMetadataAndSupportedStrictShortValueValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--mystery"],
        optionsWithStrictValues: ["--output"],
      });
    expect(
      unresolvedValueMetadataAndSupportedStrictShortValueValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      unresolvedValueMetadataAndSupportedStrictShortValueValidation.unknownOptionCount
    ).toBe(1);
    expect(
      unresolvedValueMetadataAndSupportedStrictShortValueValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output.");
    expect(
      unresolvedValueMetadataAndSupportedStrictShortValueValidation.validationErrorCode
    ).toBe("unsupported_options");
    const unresolvedValueMetadataAndSupportedStrictDashPathValidation =
      createCliOptionValidation(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--mystery"],
        optionsWithStrictValues: ["--output"],
      });
    expect(
      unresolvedValueMetadataAndSupportedStrictDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      unresolvedValueMetadataAndSupportedStrictDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      unresolvedValueMetadataAndSupportedStrictDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      unresolvedValueMetadataAndSupportedStrictDashPathValidation.validationErrorCode
    ).toBeNull();
    const setValueMetadata = new Set(["--output"]);
    const setValueMetadataAndSupportedStrictShortValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(setValueMetadataAndSupportedStrictShortValidation.unknownOptions).toEqual(
      ["-l"]
    );
    expect(
      setValueMetadataAndSupportedStrictShortValidation.unknownOptionCount
    ).toBe(1);
    expect(
      setValueMetadataAndSupportedStrictShortValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output.");
    expect(
      setValueMetadataAndSupportedStrictShortValidation.validationErrorCode
    ).toBe("unsupported_options");
    const setValueMetadataAndSupportedStrictDashPathValidation =
      createCliOptionValidation(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(
      setValueMetadataAndSupportedStrictDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      setValueMetadataAndSupportedStrictDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      setValueMetadataAndSupportedStrictDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      setValueMetadataAndSupportedStrictDashPathValidation.validationErrorCode
    ).toBeNull();
    const setValueMetadataAndOnlyStrictSubsetOutputValidation =
      createCliOptionValidation(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      setValueMetadataAndOnlyStrictSubsetOutputValidation.unknownOptions
    ).toEqual(["-artifact-report.json"]);
    expect(
      setValueMetadataAndOnlyStrictSubsetOutputValidation.unknownOptionCount
    ).toBe(1);
    expect(
      setValueMetadataAndOnlyStrictSubsetOutputValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(
      setValueMetadataAndOnlyStrictSubsetOutputValidation.validationErrorCode
    ).toBe("unsupported_options");
    const setValueMetadataAndOnlyStrictSubsetOnlyValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      setValueMetadataAndOnlyStrictSubsetOnlyValidation.unknownOptions
    ).toEqual([]);
    expect(
      setValueMetadataAndOnlyStrictSubsetOnlyValidation.unknownOptionCount
    ).toBe(0);
    expect(
      setValueMetadataAndOnlyStrictSubsetOnlyValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      setValueMetadataAndOnlyStrictSubsetOnlyValidation.validationErrorCode
    ).toBeNull();
    const mapValueMetadataForSiblingStrictSubset = new Map<string, boolean>([
      ["--output", true],
    ]);
    const mapValueMetadataAndOnlyStrictSubsetOutputValidation =
      createCliOptionValidation(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: mapValueMetadataForSiblingStrictSubset as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      mapValueMetadataAndOnlyStrictSubsetOutputValidation.unknownOptions
    ).toEqual(["-artifact-report.json"]);
    expect(
      mapValueMetadataAndOnlyStrictSubsetOutputValidation.unknownOptionCount
    ).toBe(1);
    expect(
      mapValueMetadataAndOnlyStrictSubsetOutputValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(
      mapValueMetadataAndOnlyStrictSubsetOutputValidation.validationErrorCode
    ).toBe("unsupported_options");
    const mapValueMetadataAndOnlyStrictSubsetOnlyValidation =
      createCliOptionValidation(["--only", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: mapValueMetadataForSiblingStrictSubset as never,
        optionsWithStrictValues: ["--only"],
      });
    expect(
      mapValueMetadataAndOnlyStrictSubsetOnlyValidation.unknownOptions
    ).toEqual([]);
    expect(
      mapValueMetadataAndOnlyStrictSubsetOnlyValidation.unknownOptionCount
    ).toBe(0);
    expect(
      mapValueMetadataAndOnlyStrictSubsetOnlyValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      mapValueMetadataAndOnlyStrictSubsetOnlyValidation.validationErrorCode
    ).toBeNull();
    const setValueMetadataAndAliasStrictSubsetOutputValidation =
      createCliOptionValidation(["--report-path", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      });
    expect(
      setValueMetadataAndAliasStrictSubsetOutputValidation.unknownOptions
    ).toEqual(["-artifact-report.json"]);
    expect(
      setValueMetadataAndAliasStrictSubsetOutputValidation.unknownOptionCount
    ).toBe(1);
    expect(
      setValueMetadataAndAliasStrictSubsetOutputValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only, -o, --report-path."
    );
    expect(
      setValueMetadataAndAliasStrictSubsetOutputValidation.validationErrorCode
    ).toBe("unsupported_options");
    const setValueMetadataAndAliasStrictSubsetOnlyValidation =
      createCliOptionValidation(["-o", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      });
    expect(
      setValueMetadataAndAliasStrictSubsetOnlyValidation.unknownOptions
    ).toEqual([]);
    expect(
      setValueMetadataAndAliasStrictSubsetOnlyValidation.unknownOptionCount
    ).toBe(0);
    expect(
      setValueMetadataAndAliasStrictSubsetOnlyValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      setValueMetadataAndAliasStrictSubsetOnlyValidation.validationErrorCode
    ).toBeNull();
    const setValueMetadataAndNoStrictDashPathValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: setValueMetadata as never,
      }
    );
    expect(setValueMetadataAndNoStrictDashPathValidation.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(setValueMetadataAndNoStrictDashPathValidation.unknownOptionCount).toBe(1);
    expect(
      setValueMetadataAndNoStrictDashPathValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output."
    );
    expect(
      setValueMetadataAndNoStrictDashPathValidation.validationErrorCode
    ).toBe("unsupported_options");
    const mapValueMetadata = new Map<string, boolean>([["--output", true]]);
    const mapValueMetadataAndSupportedStrictShortValidation =
      createCliOptionValidation(["--output", "-l"], {
        canonicalOptions: ["--output"],
        optionsWithValues: mapValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(
      mapValueMetadataAndSupportedStrictShortValidation.unknownOptions
    ).toEqual(["-l"]);
    expect(
      mapValueMetadataAndSupportedStrictShortValidation.unknownOptionCount
    ).toBe(1);
    expect(
      mapValueMetadataAndSupportedStrictShortValidation.unsupportedOptionsError
    ).toBe("Unsupported option(s): -l. Supported options: --output.");
    expect(
      mapValueMetadataAndSupportedStrictShortValidation.validationErrorCode
    ).toBe("unsupported_options");
    const mapValueMetadataAndSupportedStrictDashPathValidation =
      createCliOptionValidation(["--output", "-artifact-report.json"], {
        canonicalOptions: ["--output"],
        optionsWithValues: mapValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      });
    expect(
      mapValueMetadataAndSupportedStrictDashPathValidation.unknownOptions
    ).toEqual([]);
    expect(
      mapValueMetadataAndSupportedStrictDashPathValidation.unknownOptionCount
    ).toBe(0);
    expect(
      mapValueMetadataAndSupportedStrictDashPathValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      mapValueMetadataAndSupportedStrictDashPathValidation.validationErrorCode
    ).toBeNull();
    const mapStrictValueMetadata = new Map<string, boolean>([
      ["--output", true],
    ]);
    const mapStrictMetadataOnlyShortValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: mapStrictValueMetadata as never,
      }
    );
    expect(mapStrictMetadataOnlyShortValidation.unknownOptions).toEqual(["-l"]);
    expect(mapStrictMetadataOnlyShortValidation.unknownOptionCount).toBe(1);
    expect(mapStrictMetadataOnlyShortValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(mapStrictMetadataOnlyShortValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const mapStrictMetadataOnlyDashPathValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: mapStrictValueMetadata as never,
      }
    );
    expect(mapStrictMetadataOnlyDashPathValidation.unknownOptions).toEqual([]);
    expect(mapStrictMetadataOnlyDashPathValidation.unknownOptionCount).toBe(0);
    expect(mapStrictMetadataOnlyDashPathValidation.unsupportedOptionsError).toBeNull();
    expect(mapStrictMetadataOnlyDashPathValidation.validationErrorCode).toBeNull();
    const strictMetadataOnlyShortValueValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(strictMetadataOnlyShortValueValidation.unknownOptions).toEqual(["-l"]);
    expect(strictMetadataOnlyShortValueValidation.unknownOptionCount).toBe(1);
    expect(strictMetadataOnlyShortValueValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(strictMetadataOnlyShortValueValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const strictMetadataOnlyDashPathValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(strictMetadataOnlyDashPathValidation.unknownOptions).toEqual([]);
    expect(strictMetadataOnlyDashPathValidation.unknownOptionCount).toBe(0);
    expect(strictMetadataOnlyDashPathValidation.unsupportedOptionsError).toBeNull();
    expect(strictMetadataOnlyDashPathValidation.validationErrorCode).toBeNull();
    const trappedStrictValueOptions = new Proxy(["--output"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const trappedStrictShortValueValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: trappedStrictValueOptions as never,
      }
    );
    expect(trappedStrictShortValueValidation.unknownOptions).toEqual(["-l"]);
    expect(trappedStrictShortValueValidation.unknownOptionCount).toBe(1);
    expect(trappedStrictShortValueValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(trappedStrictShortValueValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const trappedStrictDashPathValueValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: trappedStrictValueOptions as never,
      }
    );
    expect(trappedStrictDashPathValueValidation.unknownOptions).toEqual([]);
    expect(trappedStrictDashPathValueValidation.unknownOptionCount).toBe(0);
    expect(trappedStrictDashPathValueValidation.unsupportedOptionsError).toBeNull();
    expect(trappedStrictDashPathValueValidation.validationErrorCode).toBeNull();
    const trappedValueOptions = new Proxy(["--output"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const trappedValueOptionsShortValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: trappedValueOptions as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(trappedValueOptionsShortValidation.unknownOptions).toEqual(["-l"]);
    expect(trappedValueOptionsShortValidation.unknownOptionCount).toBe(1);
    expect(trappedValueOptionsShortValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(trappedValueOptionsShortValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const trappedValueOptionsDashPathValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: trappedValueOptions as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(trappedValueOptionsDashPathValidation.unknownOptions).toEqual([]);
    expect(trappedValueOptionsDashPathValidation.unknownOptionCount).toBe(0);
    expect(trappedValueOptionsDashPathValidation.unsupportedOptionsError).toBeNull();
    expect(trappedValueOptionsDashPathValidation.validationErrorCode).toBeNull();
    const primitiveValueOptionsShortValidation = createCliOptionValidation(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: "--output" as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(primitiveValueOptionsShortValidation.unknownOptions).toEqual(["-l"]);
    expect(primitiveValueOptionsShortValidation.unknownOptionCount).toBe(1);
    expect(primitiveValueOptionsShortValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(primitiveValueOptionsShortValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const primitiveValueOptionsDashPathValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: "--output" as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(primitiveValueOptionsDashPathValidation.unknownOptions).toEqual([]);
    expect(primitiveValueOptionsDashPathValidation.unknownOptionCount).toBe(0);
    expect(primitiveValueOptionsDashPathValidation.unsupportedOptionsError).toBeNull();
    expect(primitiveValueOptionsDashPathValidation.validationErrorCode).toBeNull();
    const strictDashPrefixedPathValueValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(strictDashPrefixedPathValueValidation.unknownOptions).toEqual([]);
    expect(strictDashPrefixedPathValueValidation.unknownOptionCount).toBe(0);
    expect(strictDashPrefixedPathValueValidation.unsupportedOptionsError).toBeNull();
    expect(strictDashPrefixedPathValueValidation.validationErrorCode).toBeNull();

    const aliasCanonicalTokenValidation = createCliOptionValidation(
      ["--no-build"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );
    expect(aliasCanonicalTokenValidation.unknownOptions).toEqual([]);
    expect(aliasCanonicalTokenValidation.unsupportedOptionsError).toBeNull();

    const lengthAndOwnKeysTrapValidationArgs = new Proxy(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const lengthAndOwnKeysTrapValidation = createCliOptionValidation(
      lengthAndOwnKeysTrapValidationArgs as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(lengthAndOwnKeysTrapValidation.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(lengthAndOwnKeysTrapValidation.supportedCliOptionCount).toBe(2);
    expect(lengthAndOwnKeysTrapValidation.unknownOptions).toEqual([]);
    expect(lengthAndOwnKeysTrapValidation.unknownOptionCount).toBe(0);
    expect(lengthAndOwnKeysTrapValidation.unsupportedOptionsError).toBeNull();
    expect(lengthAndOwnKeysTrapValidation.validationErrorCode).toBeNull();
    const nonArrayCanonicalOptions = new Set(["--json", "--output"]);
    const nonArrayCanonicalValidation = createCliOptionValidation(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: nonArrayCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );
    expect(nonArrayCanonicalValidation.supportedCliOptions).toEqual([]);
    expect(nonArrayCanonicalValidation.supportedCliOptionCount).toBe(0);
    expect(nonArrayCanonicalValidation.unknownOptions).toEqual([
      "--json",
      "--mystery",
      "--output",
    ]);
    expect(nonArrayCanonicalValidation.unknownOptionCount).toBe(3);
    expect(nonArrayCanonicalValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --json, --mystery, --output. Supported options: (none)."
    );
    expect(nonArrayCanonicalValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const nonArrayCanonicalValidationWithAliasFallback = createCliOptionValidation(
      ["--verify", "--json", "--mystery"],
      {
        canonicalOptions: nonArrayCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );
    expect(nonArrayCanonicalValidationWithAliasFallback.supportedCliOptions).toEqual(
      ["--no-build", "--verify"]
    );
    expect(
      nonArrayCanonicalValidationWithAliasFallback.supportedCliOptionCount
    ).toBe(2);
    expect(nonArrayCanonicalValidationWithAliasFallback.unknownOptions).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(nonArrayCanonicalValidationWithAliasFallback.unknownOptionCount).toBe(2);
    expect(
      nonArrayCanonicalValidationWithAliasFallback.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --json, --mystery. Supported options: --no-build, --verify."
    );
    expect(
      nonArrayCanonicalValidationWithAliasFallback.validationErrorCode
    ).toBe("unsupported_options");
    const primitiveCanonicalValidation = createCliOptionValidation(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: "--json" as never,
        optionsWithValues: ["--output"],
      }
    );
    expect(primitiveCanonicalValidation.supportedCliOptions).toEqual([]);
    expect(primitiveCanonicalValidation.supportedCliOptionCount).toBe(0);
    expect(primitiveCanonicalValidation.unknownOptions).toEqual([
      "--json",
      "--mystery",
      "--output",
    ]);
    expect(primitiveCanonicalValidation.unknownOptionCount).toBe(3);
    expect(primitiveCanonicalValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --json, --mystery, --output. Supported options: (none)."
    );
    expect(primitiveCanonicalValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const primitiveCanonicalValidationWithAliasFallback =
      createCliOptionValidation(["--verify", "--json", "--mystery"], {
        canonicalOptions: "--json" as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(primitiveCanonicalValidationWithAliasFallback.supportedCliOptions).toEqual(
      ["--no-build", "--verify"]
    );
    expect(
      primitiveCanonicalValidationWithAliasFallback.supportedCliOptionCount
    ).toBe(2);
    expect(primitiveCanonicalValidationWithAliasFallback.unknownOptions).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(primitiveCanonicalValidationWithAliasFallback.unknownOptionCount).toBe(
      2
    );
    expect(
      primitiveCanonicalValidationWithAliasFallback.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --json, --mystery. Supported options: --no-build, --verify."
    );
    expect(
      primitiveCanonicalValidationWithAliasFallback.validationErrorCode
    ).toBe("unsupported_options");
    const nonArrayAliasMetadataValidation = createCliOptionValidation(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": new Set(["--verify"]) as never,
        },
      }
    );
    expect(nonArrayAliasMetadataValidation.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
    ]);
    expect(nonArrayAliasMetadataValidation.supportedCliOptionCount).toBe(2);
    expect(nonArrayAliasMetadataValidation.unknownOptions).toEqual([
      "--verify",
      "--mystery",
    ]);
    expect(nonArrayAliasMetadataValidation.unknownOptionCount).toBe(2);
    expect(nonArrayAliasMetadataValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --verify, --mystery. Supported options: --json, --no-build."
    );
    expect(nonArrayAliasMetadataValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const nonArrayAliasMetadataCanonicalKeyValidation = createCliOptionValidation(
      ["--no-build", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": new Set(["--verify"]) as never,
        },
      }
    );
    expect(nonArrayAliasMetadataCanonicalKeyValidation.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
    ]);
    expect(
      nonArrayAliasMetadataCanonicalKeyValidation.supportedCliOptionCount
    ).toBe(2);
    expect(nonArrayAliasMetadataCanonicalKeyValidation.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(nonArrayAliasMetadataCanonicalKeyValidation.unknownOptionCount).toBe(1);
    expect(
      nonArrayAliasMetadataCanonicalKeyValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build."
    );
    expect(nonArrayAliasMetadataCanonicalKeyValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const primitiveAliasMetadataValidation = createCliOptionValidation(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": "--verify" as never,
        },
      }
    );
    expect(primitiveAliasMetadataValidation.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
    ]);
    expect(primitiveAliasMetadataValidation.supportedCliOptionCount).toBe(2);
    expect(primitiveAliasMetadataValidation.unknownOptions).toEqual([
      "--verify",
      "--mystery",
    ]);
    expect(primitiveAliasMetadataValidation.unknownOptionCount).toBe(2);
    expect(primitiveAliasMetadataValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --verify, --mystery. Supported options: --json, --no-build."
    );
    expect(primitiveAliasMetadataValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const primitiveAliasMetadataCanonicalKeyValidation = createCliOptionValidation(
      ["--no-build", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": "--verify" as never,
        },
      }
    );
    expect(primitiveAliasMetadataCanonicalKeyValidation.supportedCliOptions).toEqual(
      ["--json", "--no-build"]
    );
    expect(
      primitiveAliasMetadataCanonicalKeyValidation.supportedCliOptionCount
    ).toBe(2);
    expect(primitiveAliasMetadataCanonicalKeyValidation.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(
      primitiveAliasMetadataCanonicalKeyValidation.unknownOptionCount
    ).toBe(1);
    expect(
      primitiveAliasMetadataCanonicalKeyValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build."
    );
    expect(
      primitiveAliasMetadataCanonicalKeyValidation.validationErrorCode
    ).toBe("unsupported_options");
    const mapAliasMetadataValidation = createCliOptionValidation(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: new Map<string, string[]>([
          ["--no-build", ["--verify"]],
        ]) as never,
      }
    );
    expect(mapAliasMetadataValidation.supportedCliOptions).toEqual(["--json"]);
    expect(mapAliasMetadataValidation.supportedCliOptionCount).toBe(1);
    expect(mapAliasMetadataValidation.unknownOptions).toEqual([
      "--verify",
      "--mystery",
    ]);
    expect(mapAliasMetadataValidation.unknownOptionCount).toBe(2);
    expect(mapAliasMetadataValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --verify, --mystery. Supported options: --json."
    );
    expect(mapAliasMetadataValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const mixedAliasMetadataValidation = createCliOptionValidation(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify", 1] as never,
        },
      }
    );
    expect(mixedAliasMetadataValidation.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(mixedAliasMetadataValidation.supportedCliOptionCount).toBe(3);
    expect(mixedAliasMetadataValidation.unknownOptions).toEqual(["--mystery"]);
    expect(mixedAliasMetadataValidation.unknownOptionCount).toBe(1);
    expect(mixedAliasMetadataValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build, --verify."
    );
    expect(mixedAliasMetadataValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const mixedAliasMetadataCanonicalKeyValidation = createCliOptionValidation(
      ["--no-build", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify", 1] as never,
        },
      }
    );
    expect(mixedAliasMetadataCanonicalKeyValidation.supportedCliOptions).toEqual(
      ["--json", "--no-build", "--verify"]
    );
    expect(mixedAliasMetadataCanonicalKeyValidation.supportedCliOptionCount).toBe(
      3
    );
    expect(mixedAliasMetadataCanonicalKeyValidation.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(mixedAliasMetadataCanonicalKeyValidation.unknownOptionCount).toBe(1);
    expect(mixedAliasMetadataCanonicalKeyValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build, --verify."
    );
    expect(mixedAliasMetadataCanonicalKeyValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
  });

  it("handles fully trapped alias token lists in cli option validation", () => {
    const fullyTrappedAliasTokens = createFullyTrappedStringArray([
      "-o",
      "--only-long",
    ]);
    const validation = createCliOptionValidation(["--only", "--mystery"], {
      canonicalOptions: ["--output"],
      optionAliases: {
        "--only": fullyTrappedAliasTokens as never,
      },
    });

    expect(validation.supportedCliOptions).toEqual(["--output", "--only"]);
    expect(validation.supportedCliOptionCount).toBe(2);
    expect(validation.unknownOptions).toEqual(["--mystery"]);
    expect(validation.unknownOptionCount).toBe(1);
    expect(validation.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --output, --only."
    );
    expect(validation.validationErrorCode).toBe("unsupported_options");
    const aliasValueValidation = createCliOptionValidation(["-o", "--mystery"], {
      canonicalOptions: ["--output"],
      optionAliases: {
        "--only": fullyTrappedAliasTokens as never,
      },
    });
    expect(aliasValueValidation.supportedCliOptions).toEqual([
      "--output",
      "--only",
    ]);
    expect(aliasValueValidation.supportedCliOptionCount).toBe(2);
    expect(aliasValueValidation.unknownOptions).toEqual(["-o", "--mystery"]);
    expect(aliasValueValidation.unknownOptionCount).toBe(2);
    expect(aliasValueValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -o, --mystery. Supported options: --output, --only."
    );
    expect(aliasValueValidation.validationErrorCode).toBe("unsupported_options");
  });

  it("validates set value metadata strict-subset fallback across sibling options", () => {
    const setValueMetadata = new Set(["--output"]);
    const onlyShortValidation = createCliOptionValidation(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: setValueMetadata as never,
      optionsWithStrictValues: ["--output"],
    });
    expect(onlyShortValidation.unknownOptions).toEqual(["-l"]);
    expect(onlyShortValidation.unknownOptionCount).toBe(1);
    expect(onlyShortValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(onlyShortValidation.validationErrorCode).toBe("unsupported_options");
    const onlyDashPrefixedValueValidation = createCliOptionValidation(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(onlyDashPrefixedValueValidation.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(onlyDashPrefixedValueValidation.unknownOptionCount).toBe(1);
    expect(onlyDashPrefixedValueValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(onlyDashPrefixedValueValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const outputDashPrefixedValueValidation = createCliOptionValidation(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(outputDashPrefixedValueValidation.unknownOptions).toEqual([]);
    expect(outputDashPrefixedValueValidation.unknownOptionCount).toBe(0);
    expect(outputDashPrefixedValueValidation.unsupportedOptionsError).toBeNull();
    expect(outputDashPrefixedValueValidation.validationErrorCode).toBeNull();
    const aliasStrictSubsetOutputValidation = createCliOptionValidation(
      ["--report-path", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      }
    );
    expect(aliasStrictSubsetOutputValidation.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(aliasStrictSubsetOutputValidation.unknownOptionCount).toBe(1);
    expect(aliasStrictSubsetOutputValidation.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only, -o, --report-path."
    );
    expect(aliasStrictSubsetOutputValidation.validationErrorCode).toBe(
      "unsupported_options"
    );
    const aliasStrictSubsetOnlyValidation = createCliOptionValidation(
      ["-o", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      }
    );
    expect(aliasStrictSubsetOnlyValidation.unknownOptions).toEqual([]);
    expect(aliasStrictSubsetOnlyValidation.unknownOptionCount).toBe(0);
    expect(aliasStrictSubsetOnlyValidation.unsupportedOptionsError).toBeNull();
    expect(aliasStrictSubsetOnlyValidation.validationErrorCode).toBeNull();
    const strictAliasSubsetFromLengthTraps =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--output"]);
    const lengthTrappedAliasStrictSubsetOutputValidation =
      createCliOptionValidation(["--report-path", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: strictAliasSubsetFromLengthTraps as never,
      });
    expect(
      lengthTrappedAliasStrictSubsetOutputValidation.unknownOptions
    ).toEqual(["-artifact-report.json"]);
    expect(
      lengthTrappedAliasStrictSubsetOutputValidation.unknownOptionCount
    ).toBe(1);
    expect(
      lengthTrappedAliasStrictSubsetOutputValidation.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only, -o, --report-path."
    );
    expect(
      lengthTrappedAliasStrictSubsetOutputValidation.validationErrorCode
    ).toBe("unsupported_options");
    const lengthTrappedAliasStrictSubsetOnlyValidation =
      createCliOptionValidation(["-o", "-artifact-report.json"], {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: strictAliasSubsetFromLengthTraps as never,
      });
    expect(lengthTrappedAliasStrictSubsetOnlyValidation.unknownOptions).toEqual(
      []
    );
    expect(lengthTrappedAliasStrictSubsetOnlyValidation.unknownOptionCount).toBe(0);
    expect(
      lengthTrappedAliasStrictSubsetOnlyValidation.unsupportedOptionsError
    ).toBeNull();
    expect(
      lengthTrappedAliasStrictSubsetOnlyValidation.validationErrorCode
    ).toBeNull();
  });

  it("derives cli validation failure messages with output priority", () => {
    const noFailureMessage = deriveCliValidationFailureMessage({
      outputPathError: null,
      unsupportedOptionsError: null,
    });
    expect(noFailureMessage).toBeNull();

    const unsupportedOnly = deriveCliValidationFailureMessage({
      outputPathError: null,
      unsupportedOptionsError: "Unsupported option(s): --mystery.",
    });
    expect(unsupportedOnly).toBe("Unsupported option(s): --mystery.");

    const outputPriority = deriveCliValidationFailureMessage({
      outputPathError: "Missing value for --output option.",
      unsupportedOptionsError: "Unsupported option(s): --mystery.",
    });
    expect(outputPriority).toBe("Missing value for --output option.");
  });

  it("creates cli option catalogs with canonical token mapping", () => {
    const catalog = createCliOptionCatalog({
      canonicalOptions: ["--json", "--no-build", "--output"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
    });

    expect(catalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--output",
      "--verify",
    ]);
    expect(catalog.supportedCliOptionCount).toBe(4);
    expect(catalog.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(catalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--output": "--output",
      "--verify": "--no-build",
    });
  });

  it("includes alias canonical keys in supported options when omitted from canonical list", () => {
    const catalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
    });

    expect(catalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(catalog.supportedCliOptionCount).toBe(3);
    expect(catalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
  });

  it("normalizes whitespace-padded cli option metadata tokens", () => {
    const catalog = createCliOptionCatalog({
      canonicalOptions: [" --json ", " --output ", "   "],
      optionAliases: {
        " --no-build ": [" --verify ", " "],
      },
    });

    expect(catalog.supportedCliOptions).toEqual([
      "--json",
      "--output",
      "--no-build",
      "--verify",
    ]);
    expect(catalog.supportedCliOptionCount).toBe(4);
    expect(catalog.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(catalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--output": "--output",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
  });

  it("merges duplicate canonical alias keys after whitespace normalization", () => {
    const optionAliases = Object.create(null) as {
      readonly "--no-build": string[];
      readonly " --no-build ": string[];
    };
    Object.defineProperty(optionAliases, " --no-build ", {
      configurable: true,
      enumerable: true,
      value: [" --verify "],
    });
    Object.defineProperty(optionAliases, "--no-build", {
      configurable: true,
      enumerable: true,
      value: [" -n ", " --verify "],
    });

    const catalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: optionAliases as never,
    });

    expect(catalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
      "-n",
    ]);
    expect(catalog.supportedCliOptionCount).toBe(4);
    expect(catalog.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify", "-n"],
    });
    expect(catalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
      "-n": "--no-build",
    });
  });

  it("sanitizes malformed cli option catalog inputs", () => {
    const canonicalOptions = ["--json", "--output"];
    Object.defineProperty(canonicalOptions, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const optionAliases = Object.create(null) as {
      readonly "--no-build": string[];
    };
    Object.defineProperty(optionAliases, "--no-build", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("alias trap");
      },
    });

    const catalog = createCliOptionCatalog({
      canonicalOptions: canonicalOptions as never,
      optionAliases: optionAliases as never,
    });

    expect(catalog.supportedCliOptions).toEqual(["--json", "--output"]);
    expect(catalog.supportedCliOptionCount).toBe(2);
    expect(catalog.availableCliOptionAliases).toEqual({});
    expect(catalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--output": "--output",
    });
    let canonicalCatalogReadCount = 0;
    const statefulCanonicalOptionsForCatalog = new Proxy(["--json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (property === "0") {
          canonicalCatalogReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulCanonicalCatalog = createCliOptionCatalog({
      canonicalOptions: statefulCanonicalOptionsForCatalog as never,
    });
    expect(statefulCanonicalCatalog.supportedCliOptions).toEqual(["--json"]);
    expect(statefulCanonicalCatalog.supportedCliOptionCount).toBe(1);
    expect(statefulCanonicalCatalog.availableCliOptionAliases).toEqual({});
    expect(statefulCanonicalCatalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
    });
    expect(canonicalCatalogReadCount).toBe(2);
    let aliasCatalogReadCount = 0;
    const statefulAliasCatalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": new Proxy(["--verify"], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) {
              throw new Error("iterator trap");
            }
            if (property === "length") {
              return 1;
            }
            if (property === "0") {
              aliasCatalogReadCount += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      },
    });
    expect(statefulAliasCatalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(statefulAliasCatalog.supportedCliOptionCount).toBe(3);
    expect(statefulAliasCatalog.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(statefulAliasCatalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(aliasCatalogReadCount).toBe(2);
    const fullyTrappedCanonicalOptions = createFullyTrappedStringArray([
      "--json",
      "--output",
    ]);
    const fullyTrappedCatalog = createCliOptionCatalog({
      canonicalOptions: fullyTrappedCanonicalOptions as never,
    });
    expect(fullyTrappedCatalog.supportedCliOptions).toEqual([]);
    expect(fullyTrappedCatalog.supportedCliOptionCount).toBe(0);
    expect(fullyTrappedCatalog.availableCliOptionAliases).toEqual({});
    expect(fullyTrappedCatalog.availableCliOptionCanonicalMap).toEqual({});
    const fullyTrappedCatalogWithAliasFallback = createCliOptionCatalog({
      canonicalOptions: fullyTrappedCanonicalOptions as never,
      optionAliases: {
        "--no-build": ["--verify"],
      },
    });
    expect(fullyTrappedCatalogWithAliasFallback.supportedCliOptions).toEqual([
      "--no-build",
      "--verify",
    ]);
    expect(fullyTrappedCatalogWithAliasFallback.supportedCliOptionCount).toBe(2);
    expect(fullyTrappedCatalogWithAliasFallback.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(
      fullyTrappedCatalogWithAliasFallback.availableCliOptionCanonicalMap
    ).toEqual({
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    const nonArrayCanonicalMetadataCatalog = createCliOptionCatalog({
      canonicalOptions: new Set(["--json", "--output"]) as never,
    });
    expect(nonArrayCanonicalMetadataCatalog.supportedCliOptions).toEqual([]);
    expect(nonArrayCanonicalMetadataCatalog.supportedCliOptionCount).toBe(0);
    expect(nonArrayCanonicalMetadataCatalog.availableCliOptionAliases).toEqual({});
    expect(nonArrayCanonicalMetadataCatalog.availableCliOptionCanonicalMap).toEqual(
      {}
    );
    const nonArrayCanonicalMetadataCatalogWithAliasFallback = createCliOptionCatalog(
      {
        canonicalOptions: new Set(["--json", "--output"]) as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );
    expect(nonArrayCanonicalMetadataCatalogWithAliasFallback.supportedCliOptions).toEqual(
      ["--no-build", "--verify"]
    );
    expect(
      nonArrayCanonicalMetadataCatalogWithAliasFallback.supportedCliOptionCount
    ).toBe(2);
    expect(
      nonArrayCanonicalMetadataCatalogWithAliasFallback.availableCliOptionAliases
    ).toEqual({
      "--no-build": ["--verify"],
    });
    expect(
      nonArrayCanonicalMetadataCatalogWithAliasFallback.availableCliOptionCanonicalMap
    ).toEqual({
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    const primitiveCanonicalMetadataCatalog = createCliOptionCatalog({
      canonicalOptions: "--json" as never,
    });
    expect(primitiveCanonicalMetadataCatalog.supportedCliOptions).toEqual([]);
    expect(primitiveCanonicalMetadataCatalog.supportedCliOptionCount).toBe(0);
    expect(primitiveCanonicalMetadataCatalog.availableCliOptionAliases).toEqual(
      {}
    );
    expect(primitiveCanonicalMetadataCatalog.availableCliOptionCanonicalMap).toEqual(
      {}
    );
    const primitiveCanonicalMetadataCatalogWithAliasFallback =
      createCliOptionCatalog({
        canonicalOptions: "--json" as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(
      primitiveCanonicalMetadataCatalogWithAliasFallback.supportedCliOptions
    ).toEqual(["--no-build", "--verify"]);
    expect(
      primitiveCanonicalMetadataCatalogWithAliasFallback.supportedCliOptionCount
    ).toBe(2);
    expect(
      primitiveCanonicalMetadataCatalogWithAliasFallback.availableCliOptionAliases
    ).toEqual({
      "--no-build": ["--verify"],
    });
    expect(
      primitiveCanonicalMetadataCatalogWithAliasFallback.availableCliOptionCanonicalMap
    ).toEqual({
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    const nonArrayAliasMetadataCatalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": new Set(["--verify"]) as never,
      },
    });
    expect(nonArrayAliasMetadataCatalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
    ]);
    expect(nonArrayAliasMetadataCatalog.supportedCliOptionCount).toBe(2);
    expect(nonArrayAliasMetadataCatalog.availableCliOptionAliases).toEqual({
      "--no-build": [],
    });
    expect(nonArrayAliasMetadataCatalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
    });
    const primitiveAliasMetadataCatalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": "--verify" as never,
      },
    });
    expect(primitiveAliasMetadataCatalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
    ]);
    expect(primitiveAliasMetadataCatalog.supportedCliOptionCount).toBe(2);
    expect(primitiveAliasMetadataCatalog.availableCliOptionAliases).toEqual({
      "--no-build": [],
    });
    expect(primitiveAliasMetadataCatalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
    });
    const mapAliasMetadataCatalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: new Map<string, string[]>([
        ["--no-build", ["--verify"]],
      ]) as never,
    });
    expect(mapAliasMetadataCatalog.supportedCliOptions).toEqual(["--json"]);
    expect(mapAliasMetadataCatalog.supportedCliOptionCount).toBe(1);
    expect(mapAliasMetadataCatalog.availableCliOptionAliases).toEqual({});
    expect(mapAliasMetadataCatalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
    });
    const mixedAliasMetadataCatalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": ["--verify", 1] as never,
      },
    });
    expect(mixedAliasMetadataCatalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(mixedAliasMetadataCatalog.supportedCliOptionCount).toBe(3);
    expect(mixedAliasMetadataCatalog.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(mixedAliasMetadataCatalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
  });

  it("salvages length-trapped alias token lists in cli option catalogs", () => {
    const fullyRecoverableAliasTokens =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--only-long"], 2);
    const fullyRecoverableCatalog = createCliOptionCatalog({
      canonicalOptions: ["--output"],
      optionAliases: {
        "--only": fullyRecoverableAliasTokens as never,
      },
    });

    expect(fullyRecoverableCatalog.supportedCliOptions).toEqual([
      "--output",
      "--only",
      "-o",
      "--only-long",
    ]);
    expect(fullyRecoverableCatalog.supportedCliOptionCount).toBe(4);
    expect(fullyRecoverableCatalog.availableCliOptionAliases).toEqual({
      "--only": ["-o", "--only-long"],
    });
    expect(fullyRecoverableCatalog.availableCliOptionCanonicalMap).toEqual({
      "--output": "--output",
      "--only": "--only",
      "-o": "--only",
      "--only-long": "--only",
    });

    const partiallyRecoverableAliasTokens =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--only-long"]);
    const partiallyRecoverableCatalog = createCliOptionCatalog({
      canonicalOptions: ["--output"],
      optionAliases: {
        "--only": partiallyRecoverableAliasTokens as never,
      },
    });

    expect(partiallyRecoverableCatalog.supportedCliOptions).toEqual([
      "--output",
      "--only",
      "-o",
    ]);
    expect(partiallyRecoverableCatalog.supportedCliOptionCount).toBe(3);
    expect(partiallyRecoverableCatalog.availableCliOptionAliases).toEqual({
      "--only": ["-o"],
    });
    expect(partiallyRecoverableCatalog.availableCliOptionCanonicalMap).toEqual({
      "--output": "--output",
      "--only": "--only",
      "-o": "--only",
    });
    const fullyTrappedAliasTokens = createFullyTrappedStringArray([
      "-o",
      "--only-long",
    ]);
    const fullyTrappedAliasCatalog = createCliOptionCatalog({
      canonicalOptions: ["--output"],
      optionAliases: {
        "--only": fullyTrappedAliasTokens as never,
      },
    });

    expect(fullyTrappedAliasCatalog.supportedCliOptions).toEqual([
      "--output",
      "--only",
    ]);
    expect(fullyTrappedAliasCatalog.supportedCliOptionCount).toBe(2);
    expect(fullyTrappedAliasCatalog.availableCliOptionAliases).toEqual({
      "--only": [],
    });
    expect(fullyTrappedAliasCatalog.availableCliOptionCanonicalMap).toEqual({
      "--output": "--output",
      "--only": "--only",
    });
  });

  it("salvages length-trapped canonical option metadata in cli option catalogs", () => {
    const fullyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(
        ["--json", "--output"],
        2
      );
    const fullyRecoverableCatalog = createCliOptionCatalog({
      canonicalOptions: fullyRecoverableLengthTrappedCanonicalOptions as never,
    });

    expect(fullyRecoverableCatalog.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(fullyRecoverableCatalog.supportedCliOptionCount).toBe(2);
    expect(fullyRecoverableCatalog.availableCliOptionAliases).toEqual({});
    expect(fullyRecoverableCatalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--output": "--output",
    });

    const partiallyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(["--json", "--output"]);
    const partiallyRecoverableCatalog = createCliOptionCatalog({
      canonicalOptions:
        partiallyRecoverableLengthTrappedCanonicalOptions as never,
      optionAliases: {
        "--no-build": ["--verify"],
      },
    });

    expect(partiallyRecoverableCatalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(partiallyRecoverableCatalog.supportedCliOptionCount).toBe(3);
    expect(partiallyRecoverableCatalog.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(partiallyRecoverableCatalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
  });

  it("preserves non-trapping alias entries when others are malformed", () => {
    const optionAliases = Object.create(null) as {
      readonly "--no-build": string[];
      readonly "--trap": string[];
    };
    Object.defineProperty(optionAliases, "--no-build", {
      configurable: true,
      enumerable: true,
      value: ["--verify"],
    });
    Object.defineProperty(optionAliases, "--trap", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("alias trap");
      },
    });

    const catalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: optionAliases as never,
    });

    expect(catalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(catalog.supportedCliOptionCount).toBe(3);
    expect(catalog.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(catalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
  });

  it("preserves duplicate canonical alias keys when trimmed siblings trap", () => {
    const optionAliases = Object.create(null) as {
      readonly "--no-build": string[];
      readonly " --no-build ": string[];
    };
    Object.defineProperty(optionAliases, "--no-build", {
      configurable: true,
      enumerable: true,
      value: ["--verify"],
    });
    Object.defineProperty(optionAliases, " --no-build ", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("alias trap");
      },
    });

    const catalog = createCliOptionCatalog({
      canonicalOptions: ["--json"],
      optionAliases: optionAliases as never,
    });

    expect(catalog.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(catalog.supportedCliOptionCount).toBe(3);
    expect(catalog.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(catalog.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
  });

  it("creates unified cli diagnostics metadata", () => {
    const diagnostics = createCliDiagnostics(
      ["--json", "--verify", "--output", "./report.json", "--mystery"],
      {
        canonicalOptions: ["--json", "--no-build", "--output"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--output"],
        outputPathError: null,
      }
    );

    expect(diagnostics.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--output",
      "--verify",
    ]);
    expect(diagnostics.supportedCliOptionCount).toBe(4);
    expect(diagnostics.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(diagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--output": "--output",
      "--verify": "--no-build",
    });
    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build, --output, --verify."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
    expect(diagnostics.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(3);
    expect(diagnostics.activeCliOptionTokens).toEqual([
      "--json",
      "--verify",
      "--output",
    ]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(3);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 1,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(3);

    const iteratorTrapArgs = ["--json", "--mystery", "--output", "./report.json"];
    Object.defineProperty(iteratorTrapArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const diagnosticsFromIteratorTrapArgs = createCliDiagnostics(
      iteratorTrapArgs as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(diagnosticsFromIteratorTrapArgs.unknownOptions).toEqual(["--mystery"]);
    expect(diagnosticsFromIteratorTrapArgs.unknownOptionCount).toBe(1);
    expect(diagnosticsFromIteratorTrapArgs.activeCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(diagnosticsFromIteratorTrapArgs.activeCliOptionCount).toBe(2);

    const diagnosticsFromLengthAndOwnKeysTrapArgs = createCliDiagnostics(
      new Proxy(["--json", "--mystery", "--output", "./report.json"], {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }) as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(diagnosticsFromLengthAndOwnKeysTrapArgs.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(diagnosticsFromLengthAndOwnKeysTrapArgs.supportedCliOptionCount).toBe(2);
    expect(diagnosticsFromLengthAndOwnKeysTrapArgs.unknownOptions).toEqual([]);
    expect(diagnosticsFromLengthAndOwnKeysTrapArgs.unknownOptionCount).toBe(0);
    expect(diagnosticsFromLengthAndOwnKeysTrapArgs.unsupportedOptionsError).toBeNull();
    expect(diagnosticsFromLengthAndOwnKeysTrapArgs.activeCliOptions).toEqual([]);
    expect(diagnosticsFromLengthAndOwnKeysTrapArgs.activeCliOptionCount).toBe(0);
    expect(diagnosticsFromLengthAndOwnKeysTrapArgs.activeCliOptionTokens).toEqual(
      []
    );
    expect(
      diagnosticsFromLengthAndOwnKeysTrapArgs.activeCliOptionResolutions
    ).toEqual([]);
    expect(
      diagnosticsFromLengthAndOwnKeysTrapArgs.activeCliOptionResolutionCount
    ).toBe(0);
    expect(
      diagnosticsFromLengthAndOwnKeysTrapArgs.activeCliOptionOccurrences
    ).toEqual([]);
    expect(
      diagnosticsFromLengthAndOwnKeysTrapArgs.activeCliOptionOccurrenceCount
    ).toBe(0);
  });

  it("sanitizes malformed metadata inputs in unified cli diagnostics", () => {
    const canonicalOptions = ["--json", "--output"];
    Object.defineProperty(canonicalOptions, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const optionAliases = Object.create(null) as {
      readonly "--no-build": string[];
    };
    Object.defineProperty(optionAliases, "--no-build", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("alias trap");
      },
    });

    const diagnostics = createCliDiagnostics(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: canonicalOptions as never,
        optionAliases: optionAliases as never,
      }
    );

    expect(diagnostics.supportedCliOptions).toEqual(["--json", "--output"]);
    expect(diagnostics.supportedCliOptionCount).toBe(2);
    expect(diagnostics.availableCliOptionAliases).toEqual({});
    expect(diagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--output": "--output",
    });
    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
    expect(diagnostics.activeCliOptions).toEqual(["--json", "--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--json", "--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(2);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
    let canonicalDiagnosticsReadCount = 0;
    const canonicalOptionsForDiagnosticsReadCount = new Proxy(["--json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (property === "0") {
          canonicalDiagnosticsReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const canonicalDiagnosticsReadCountResult = createCliDiagnostics(
      ["--json"],
      {
        canonicalOptions: canonicalOptionsForDiagnosticsReadCount as never,
      }
    );
    expect(canonicalDiagnosticsReadCountResult.supportedCliOptions).toEqual([
      "--json",
    ]);
    expect(canonicalDiagnosticsReadCountResult.supportedCliOptionCount).toBe(1);
    expect(canonicalDiagnosticsReadCountResult.availableCliOptionAliases).toEqual(
      {}
    );
    expect(
      canonicalDiagnosticsReadCountResult.availableCliOptionCanonicalMap
    ).toEqual({
      "--json": "--json",
    });
    expect(canonicalDiagnosticsReadCountResult.unknownOptions).toEqual([]);
    expect(canonicalDiagnosticsReadCountResult.unknownOptionCount).toBe(0);
    expect(canonicalDiagnosticsReadCountResult.unsupportedOptionsError).toBeNull();
    expect(canonicalDiagnosticsReadCountResult.validationErrorCode).toBeNull();
    expect(canonicalDiagnosticsReadCountResult.activeCliOptions).toEqual([
      "--json",
    ]);
    expect(canonicalDiagnosticsReadCountResult.activeCliOptionCount).toBe(1);
    expect(canonicalDiagnosticsReadCountResult.activeCliOptionTokens).toEqual([
      "--json",
    ]);
    expect(canonicalDiagnosticsReadCountResult.activeCliOptionResolutions).toEqual(
      [
        {
          token: "--json",
          canonicalOption: "--json",
        },
      ]
    );
    expect(
      canonicalDiagnosticsReadCountResult.activeCliOptionResolutionCount
    ).toBe(1);
    expect(canonicalDiagnosticsReadCountResult.activeCliOptionOccurrences).toEqual(
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(
      canonicalDiagnosticsReadCountResult.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(canonicalDiagnosticsReadCount).toBe(2);
    let statefulCanonicalOptionReadCount = 0;
    const statefulCanonicalOptions = new Proxy(["--json"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (property === "0") {
          statefulCanonicalOptionReadCount += 1;
          if (statefulCanonicalOptionReadCount > 1) {
            return undefined;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulCanonicalDiagnostics = createCliDiagnostics(["--json"], {
      canonicalOptions: statefulCanonicalOptions as never,
    });
    expect(statefulCanonicalDiagnostics.supportedCliOptions).toEqual(["--json"]);
    expect(statefulCanonicalDiagnostics.supportedCliOptionCount).toBe(1);
    expect(statefulCanonicalDiagnostics.availableCliOptionAliases).toEqual({});
    expect(statefulCanonicalDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
    });
    expect(statefulCanonicalDiagnostics.unknownOptions).toEqual([]);
    expect(statefulCanonicalDiagnostics.unknownOptionCount).toBe(0);
    expect(statefulCanonicalDiagnostics.unsupportedOptionsError).toBeNull();
    expect(statefulCanonicalDiagnostics.validationErrorCode).toBeNull();
    expect(statefulCanonicalDiagnostics.activeCliOptions).toEqual(["--json"]);
    expect(statefulCanonicalDiagnostics.activeCliOptionCount).toBe(1);
    expect(statefulCanonicalDiagnostics.activeCliOptionTokens).toEqual([
      "--json",
    ]);
    expect(statefulCanonicalDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(statefulCanonicalDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(statefulCanonicalDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(statefulCanonicalDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(statefulCanonicalOptionReadCount).toBe(2);
    let statefulAliasTokenReadCount = 0;
    const statefulAliasDiagnostics = createCliDiagnostics(["--verify"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": new Proxy(["--verify"], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) {
              throw new Error("iterator trap");
            }
            if (property === "length") {
              return 1;
            }
            if (property === "0") {
              statefulAliasTokenReadCount += 1;
              if (statefulAliasTokenReadCount > 1) {
                return undefined;
              }
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      },
    });
    expect(statefulAliasDiagnostics.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(statefulAliasDiagnostics.supportedCliOptionCount).toBe(3);
    expect(statefulAliasDiagnostics.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(statefulAliasDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(statefulAliasDiagnostics.unknownOptions).toEqual([]);
    expect(statefulAliasDiagnostics.unknownOptionCount).toBe(0);
    expect(statefulAliasDiagnostics.unsupportedOptionsError).toBeNull();
    expect(statefulAliasDiagnostics.validationErrorCode).toBeNull();
    expect(statefulAliasDiagnostics.activeCliOptions).toEqual(["--no-build"]);
    expect(statefulAliasDiagnostics.activeCliOptionCount).toBe(1);
    expect(statefulAliasDiagnostics.activeCliOptionTokens).toEqual([
      "--verify",
    ]);
    expect(statefulAliasDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(statefulAliasDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(statefulAliasDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(statefulAliasDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(statefulAliasTokenReadCount).toBe(2);
    let statefulArgsReadCount = 0;
    const statefulArgsDiagnostics = createCliDiagnostics(
      new Proxy(["--json"], {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            statefulArgsReadCount += 1;
            if (statefulArgsReadCount > 1) {
              return undefined;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }) as never,
      {
        canonicalOptions: ["--json"],
      }
    );
    expect(statefulArgsDiagnostics.supportedCliOptions).toEqual(["--json"]);
    expect(statefulArgsDiagnostics.supportedCliOptionCount).toBe(1);
    expect(statefulArgsDiagnostics.availableCliOptionAliases).toEqual({});
    expect(statefulArgsDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
    });
    expect(statefulArgsDiagnostics.unknownOptions).toEqual([]);
    expect(statefulArgsDiagnostics.unknownOptionCount).toBe(0);
    expect(statefulArgsDiagnostics.unsupportedOptionsError).toBeNull();
    expect(statefulArgsDiagnostics.validationErrorCode).toBeNull();
    expect(statefulArgsDiagnostics.activeCliOptions).toEqual(["--json"]);
    expect(statefulArgsDiagnostics.activeCliOptionCount).toBe(1);
    expect(statefulArgsDiagnostics.activeCliOptionTokens).toEqual(["--json"]);
    expect(statefulArgsDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(statefulArgsDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(statefulArgsDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(statefulArgsDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(statefulArgsReadCount).toBe(2);
    let statefulValueOptionReadCount = 0;
    const statefulValueOptionDiagnostics = createCliDiagnostics(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-l"],
        },
        optionsWithValues: new Proxy(["--output"], {
          get(target, property, receiver) {
            if (property === "0") {
              statefulValueOptionReadCount += 1;
              if (statefulValueOptionReadCount > 1) {
                return undefined;
              }
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      }
    );
    expect(statefulValueOptionDiagnostics.supportedCliOptions).toEqual([
      "--output",
      "--json",
      "-l",
    ]);
    expect(statefulValueOptionDiagnostics.supportedCliOptionCount).toBe(3);
    expect(statefulValueOptionDiagnostics.availableCliOptionAliases).toEqual({
      "--json": ["-l"],
    });
    expect(statefulValueOptionDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--output": "--output",
      "--json": "--json",
      "-l": "--json",
    });
    expect(statefulValueOptionDiagnostics.unknownOptions).toEqual([]);
    expect(statefulValueOptionDiagnostics.unknownOptionCount).toBe(0);
    expect(statefulValueOptionDiagnostics.unsupportedOptionsError).toBeNull();
    expect(statefulValueOptionDiagnostics.validationErrorCode).toBeNull();
    expect(statefulValueOptionDiagnostics.activeCliOptions).toEqual([
      "--output",
    ]);
    expect(statefulValueOptionDiagnostics.activeCliOptionCount).toBe(1);
    expect(statefulValueOptionDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
    ]);
    expect(statefulValueOptionDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(statefulValueOptionDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(statefulValueOptionDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(statefulValueOptionDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(statefulValueOptionReadCount).toBe(1);
    let statefulStrictValueOptionReadCount = 0;
    const statefulStrictValueOptionDiagnostics = createCliDiagnostics(
      ["--output", "-j"],
      {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: new Proxy(["--output"], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) {
              throw new Error("iterator trap");
            }
            if (property === "length") {
              return 1;
            }
            if (property === "0") {
              statefulStrictValueOptionReadCount += 1;
              if (statefulStrictValueOptionReadCount > 1) {
                return undefined;
              }
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      }
    );
    expect(statefulStrictValueOptionDiagnostics.supportedCliOptions).toEqual([
      "--output",
      "--json",
      "-j",
    ]);
    expect(statefulStrictValueOptionDiagnostics.supportedCliOptionCount).toBe(3);
    expect(statefulStrictValueOptionDiagnostics.availableCliOptionAliases).toEqual({
      "--json": ["-j"],
    });
    expect(
      statefulStrictValueOptionDiagnostics.availableCliOptionCanonicalMap
    ).toEqual({
      "--output": "--output",
      "--json": "--json",
      "-j": "--json",
    });
    expect(statefulStrictValueOptionDiagnostics.unknownOptions).toEqual([]);
    expect(statefulStrictValueOptionDiagnostics.unknownOptionCount).toBe(0);
    expect(statefulStrictValueOptionDiagnostics.unsupportedOptionsError).toBeNull();
    expect(statefulStrictValueOptionDiagnostics.validationErrorCode).toBeNull();
    expect(statefulStrictValueOptionDiagnostics.activeCliOptions).toEqual([
      "--output",
      "--json",
    ]);
    expect(statefulStrictValueOptionDiagnostics.activeCliOptionCount).toBe(2);
    expect(statefulStrictValueOptionDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
      "-j",
    ]);
    expect(
      statefulStrictValueOptionDiagnostics.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(
      statefulStrictValueOptionDiagnostics.activeCliOptionResolutionCount
    ).toBe(2);
    expect(
      statefulStrictValueOptionDiagnostics.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(
      statefulStrictValueOptionDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(2);
    expect(statefulStrictValueOptionReadCount).toBe(2);
    const nonArrayAliasMetadataDiagnostics = createCliDiagnostics(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": new Set(["--verify"]) as never,
        },
      }
    );
    expect(nonArrayAliasMetadataDiagnostics.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
    ]);
    expect(nonArrayAliasMetadataDiagnostics.supportedCliOptionCount).toBe(2);
    expect(nonArrayAliasMetadataDiagnostics.availableCliOptionAliases).toEqual({
      "--no-build": [],
    });
    expect(
      nonArrayAliasMetadataDiagnostics.availableCliOptionCanonicalMap
    ).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
    });
    expect(nonArrayAliasMetadataDiagnostics.unknownOptions).toEqual([
      "--verify",
      "--mystery",
    ]);
    expect(nonArrayAliasMetadataDiagnostics.unknownOptionCount).toBe(2);
    expect(nonArrayAliasMetadataDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --verify, --mystery. Supported options: --json, --no-build."
    );
    expect(nonArrayAliasMetadataDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(nonArrayAliasMetadataDiagnostics.activeCliOptions).toEqual([]);
    expect(nonArrayAliasMetadataDiagnostics.activeCliOptionCount).toBe(0);
    expect(nonArrayAliasMetadataDiagnostics.activeCliOptionTokens).toEqual([]);
    expect(nonArrayAliasMetadataDiagnostics.activeCliOptionResolutions).toEqual(
      []
    );
    expect(
      nonArrayAliasMetadataDiagnostics.activeCliOptionResolutionCount
    ).toBe(0);
    expect(nonArrayAliasMetadataDiagnostics.activeCliOptionOccurrences).toEqual(
      []
    );
    expect(
      nonArrayAliasMetadataDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(0);
    const nonArrayAliasMetadataCanonicalKeyDiagnostics = createCliDiagnostics(
      ["--no-build", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": new Set(["--verify"]) as never,
        },
      }
    );
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.supportedCliOptions
    ).toEqual(["--json", "--no-build"]);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.supportedCliOptionCount
    ).toBe(2);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.availableCliOptionAliases
    ).toEqual({
      "--no-build": [],
    });
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.availableCliOptionCanonicalMap
    ).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
    });
    expect(nonArrayAliasMetadataCanonicalKeyDiagnostics.unknownOptions).toEqual([
      "--mystery",
    ]);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.unknownOptionCount
    ).toBe(1);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build."
    );
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.validationErrorCode
    ).toBe("unsupported_options");
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.activeCliOptionCount
    ).toBe(1);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.activeCliOptionTokens
    ).toEqual(["--no-build"]);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      nonArrayAliasMetadataCanonicalKeyDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    const primitiveAliasMetadataDiagnostics = createCliDiagnostics(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": "--verify" as never,
        },
      }
    );
    expect(primitiveAliasMetadataDiagnostics.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
    ]);
    expect(primitiveAliasMetadataDiagnostics.supportedCliOptionCount).toBe(2);
    expect(primitiveAliasMetadataDiagnostics.availableCliOptionAliases).toEqual({
      "--no-build": [],
    });
    expect(
      primitiveAliasMetadataDiagnostics.availableCliOptionCanonicalMap
    ).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
    });
    expect(primitiveAliasMetadataDiagnostics.unknownOptions).toEqual([
      "--verify",
      "--mystery",
    ]);
    expect(primitiveAliasMetadataDiagnostics.unknownOptionCount).toBe(2);
    expect(primitiveAliasMetadataDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --verify, --mystery. Supported options: --json, --no-build."
    );
    expect(primitiveAliasMetadataDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(primitiveAliasMetadataDiagnostics.activeCliOptions).toEqual([]);
    expect(primitiveAliasMetadataDiagnostics.activeCliOptionCount).toBe(0);
    expect(primitiveAliasMetadataDiagnostics.activeCliOptionTokens).toEqual([]);
    expect(primitiveAliasMetadataDiagnostics.activeCliOptionResolutions).toEqual(
      []
    );
    expect(
      primitiveAliasMetadataDiagnostics.activeCliOptionResolutionCount
    ).toBe(0);
    expect(primitiveAliasMetadataDiagnostics.activeCliOptionOccurrences).toEqual(
      []
    );
    expect(
      primitiveAliasMetadataDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(0);
    const primitiveAliasMetadataCanonicalKeyDiagnostics = createCliDiagnostics(
      ["--no-build", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": "--verify" as never,
        },
      }
    );
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.supportedCliOptions
    ).toEqual(["--json", "--no-build"]);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.supportedCliOptionCount
    ).toBe(2);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.availableCliOptionAliases
    ).toEqual({
      "--no-build": [],
    });
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.availableCliOptionCanonicalMap
    ).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
    });
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.unknownOptions
    ).toEqual(["--mystery"]);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.unknownOptionCount
    ).toBe(1);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build."
    );
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.validationErrorCode
    ).toBe("unsupported_options");
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.activeCliOptionCount
    ).toBe(1);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.activeCliOptionTokens
    ).toEqual(["--no-build"]);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      primitiveAliasMetadataCanonicalKeyDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    const mapAliasMetadataDiagnostics = createCliDiagnostics(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: new Map<string, string[]>([
          ["--no-build", ["--verify"]],
        ]) as never,
      }
    );
    expect(mapAliasMetadataDiagnostics.supportedCliOptions).toEqual(["--json"]);
    expect(mapAliasMetadataDiagnostics.supportedCliOptionCount).toBe(1);
    expect(mapAliasMetadataDiagnostics.availableCliOptionAliases).toEqual({});
    expect(mapAliasMetadataDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
    });
    expect(mapAliasMetadataDiagnostics.unknownOptions).toEqual([
      "--verify",
      "--mystery",
    ]);
    expect(mapAliasMetadataDiagnostics.unknownOptionCount).toBe(2);
    expect(mapAliasMetadataDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --verify, --mystery. Supported options: --json."
    );
    expect(mapAliasMetadataDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(mapAliasMetadataDiagnostics.activeCliOptions).toEqual([]);
    expect(mapAliasMetadataDiagnostics.activeCliOptionCount).toBe(0);
    expect(mapAliasMetadataDiagnostics.activeCliOptionTokens).toEqual([]);
    expect(mapAliasMetadataDiagnostics.activeCliOptionResolutions).toEqual([]);
    expect(mapAliasMetadataDiagnostics.activeCliOptionResolutionCount).toBe(0);
    expect(mapAliasMetadataDiagnostics.activeCliOptionOccurrences).toEqual([]);
    expect(mapAliasMetadataDiagnostics.activeCliOptionOccurrenceCount).toBe(0);
    const mixedAliasMetadataDiagnostics = createCliDiagnostics(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify", 1] as never,
        },
      }
    );
    expect(mixedAliasMetadataDiagnostics.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(mixedAliasMetadataDiagnostics.supportedCliOptionCount).toBe(3);
    expect(mixedAliasMetadataDiagnostics.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(mixedAliasMetadataDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(mixedAliasMetadataDiagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(mixedAliasMetadataDiagnostics.unknownOptionCount).toBe(1);
    expect(mixedAliasMetadataDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build, --verify."
    );
    expect(mixedAliasMetadataDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(mixedAliasMetadataDiagnostics.activeCliOptions).toEqual([
      "--no-build",
    ]);
    expect(mixedAliasMetadataDiagnostics.activeCliOptionCount).toBe(1);
    expect(mixedAliasMetadataDiagnostics.activeCliOptionTokens).toEqual([
      "--verify",
    ]);
    expect(mixedAliasMetadataDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(mixedAliasMetadataDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(mixedAliasMetadataDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(mixedAliasMetadataDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    const nonArrayCanonicalOptions = new Set(["--json", "--output"]);
    const nonArrayCanonicalMetadataDiagnostics = createCliDiagnostics(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: nonArrayCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );
    expect(nonArrayCanonicalMetadataDiagnostics.supportedCliOptions).toEqual([]);
    expect(nonArrayCanonicalMetadataDiagnostics.supportedCliOptionCount).toBe(0);
    expect(nonArrayCanonicalMetadataDiagnostics.availableCliOptionAliases).toEqual(
      {}
    );
    expect(
      nonArrayCanonicalMetadataDiagnostics.availableCliOptionCanonicalMap
    ).toEqual({});
    expect(nonArrayCanonicalMetadataDiagnostics.unknownOptions).toEqual([
      "--json",
      "--mystery",
      "--output",
    ]);
    expect(nonArrayCanonicalMetadataDiagnostics.unknownOptionCount).toBe(3);
    expect(nonArrayCanonicalMetadataDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --json, --mystery, --output. Supported options: (none)."
    );
    expect(nonArrayCanonicalMetadataDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(nonArrayCanonicalMetadataDiagnostics.activeCliOptions).toEqual([]);
    expect(nonArrayCanonicalMetadataDiagnostics.activeCliOptionCount).toBe(0);
    expect(nonArrayCanonicalMetadataDiagnostics.activeCliOptionTokens).toEqual(
      []
    );
    expect(nonArrayCanonicalMetadataDiagnostics.activeCliOptionResolutions).toEqual(
      []
    );
    expect(
      nonArrayCanonicalMetadataDiagnostics.activeCliOptionResolutionCount
    ).toBe(0);
    expect(
      nonArrayCanonicalMetadataDiagnostics.activeCliOptionOccurrences
    ).toEqual([]);
    expect(
      nonArrayCanonicalMetadataDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(0);
    const nonArrayCanonicalMetadataDiagnosticsWithAliasFallback =
      createCliDiagnostics(["--verify", "--json", "--mystery"], {
        canonicalOptions: nonArrayCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.supportedCliOptions
    ).toEqual(["--no-build", "--verify"]);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.supportedCliOptionCount
    ).toBe(2);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.availableCliOptionAliases
    ).toEqual({
      "--no-build": ["--verify"],
    });
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.availableCliOptionCanonicalMap
    ).toEqual({
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.unknownOptions
    ).toEqual(["--json", "--mystery"]);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.unknownOptionCount
    ).toBe(2);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --json, --mystery. Supported options: --no-build, --verify."
    );
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.validationErrorCode
    ).toBe("unsupported_options");
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionCount
    ).toBe(1);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionTokens
    ).toEqual(["--verify"]);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      nonArrayCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionOccurrenceCount
    ).toBe(1);
    const primitiveCanonicalMetadataDiagnostics = createCliDiagnostics(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions: "--json" as never,
        optionsWithValues: ["--output"],
      }
    );
    expect(primitiveCanonicalMetadataDiagnostics.supportedCliOptions).toEqual([]);
    expect(primitiveCanonicalMetadataDiagnostics.supportedCliOptionCount).toBe(0);
    expect(primitiveCanonicalMetadataDiagnostics.availableCliOptionAliases).toEqual(
      {}
    );
    expect(
      primitiveCanonicalMetadataDiagnostics.availableCliOptionCanonicalMap
    ).toEqual({});
    expect(primitiveCanonicalMetadataDiagnostics.unknownOptions).toEqual([
      "--json",
      "--mystery",
      "--output",
    ]);
    expect(primitiveCanonicalMetadataDiagnostics.unknownOptionCount).toBe(3);
    expect(primitiveCanonicalMetadataDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --json, --mystery, --output. Supported options: (none)."
    );
    expect(primitiveCanonicalMetadataDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(primitiveCanonicalMetadataDiagnostics.activeCliOptions).toEqual([]);
    expect(primitiveCanonicalMetadataDiagnostics.activeCliOptionCount).toBe(0);
    expect(primitiveCanonicalMetadataDiagnostics.activeCliOptionTokens).toEqual(
      []
    );
    expect(
      primitiveCanonicalMetadataDiagnostics.activeCliOptionResolutions
    ).toEqual([]);
    expect(
      primitiveCanonicalMetadataDiagnostics.activeCliOptionResolutionCount
    ).toBe(0);
    expect(
      primitiveCanonicalMetadataDiagnostics.activeCliOptionOccurrences
    ).toEqual([]);
    expect(
      primitiveCanonicalMetadataDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(0);
    const primitiveCanonicalMetadataDiagnosticsWithAliasFallback =
      createCliDiagnostics(["--verify", "--json", "--mystery"], {
        canonicalOptions: "--json" as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.supportedCliOptions
    ).toEqual(["--no-build", "--verify"]);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.supportedCliOptionCount
    ).toBe(2);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.availableCliOptionAliases
    ).toEqual({
      "--no-build": ["--verify"],
    });
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.availableCliOptionCanonicalMap
    ).toEqual({
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.unknownOptions
    ).toEqual(["--json", "--mystery"]);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.unknownOptionCount
    ).toBe(2);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --json, --mystery. Supported options: --no-build, --verify."
    );
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.validationErrorCode
    ).toBe("unsupported_options");
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionCount
    ).toBe(1);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionTokens
    ).toEqual(["--verify"]);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      primitiveCanonicalMetadataDiagnosticsWithAliasFallback.activeCliOptionOccurrenceCount
    ).toBe(1);
    const fullyTrappedCanonicalOptions = createFullyTrappedStringArray([
      "--json",
      "--output",
    ]);
    const diagnosticsFromFullyTrappedCanonicalOptions = createCliDiagnostics(
      ["--json", "--mystery"],
      {
        canonicalOptions: fullyTrappedCanonicalOptions as never,
      }
    );
    expect(diagnosticsFromFullyTrappedCanonicalOptions.supportedCliOptions).toEqual(
      []
    );
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.supportedCliOptionCount
    ).toBe(0);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.availableCliOptionAliases
    ).toEqual({});
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.availableCliOptionCanonicalMap
    ).toEqual({});
    expect(diagnosticsFromFullyTrappedCanonicalOptions.unknownOptions).toEqual([
      "--json",
      "--mystery",
    ]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.unknownOptionCount
    ).toBe(2);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --json, --mystery. Supported options: (none)."
    );
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.validationErrorCode
    ).toBe("unsupported_options");
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.activeCliOptions
    ).toEqual([]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.activeCliOptionCount
    ).toBe(0);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.activeCliOptionTokens
    ).toEqual([]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.activeCliOptionResolutions
    ).toEqual([]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.activeCliOptionResolutionCount
    ).toBe(0);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.activeCliOptionOccurrences
    ).toEqual([]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptions.activeCliOptionOccurrenceCount
    ).toBe(0);
    const diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback =
      createCliDiagnostics(["--verify", "--mystery"], {
        canonicalOptions: fullyTrappedCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.supportedCliOptions
    ).toEqual(["--no-build", "--verify"]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.supportedCliOptionCount
    ).toBe(2);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.availableCliOptionAliases
    ).toEqual({
      "--no-build": ["--verify"],
    });
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.availableCliOptionCanonicalMap
    ).toEqual({
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.unknownOptions
    ).toEqual(["--mystery"]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.unknownOptionCount
    ).toBe(1);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery. Supported options: --no-build, --verify."
    );
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.validationErrorCode
    ).toBe("unsupported_options");
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.activeCliOptionCount
    ).toBe(1);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.activeCliOptionTokens
    ).toEqual(["--verify"]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      diagnosticsFromFullyTrappedCanonicalOptionsWithAliasFallback.activeCliOptionOccurrenceCount
    ).toBe(1);
  });

  it("tracks length-trapped alias token recovery in unified cli diagnostics", () => {
    const fullyRecoverableAliasTokens =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--only-long"], 2);
    const recoverableDiagnostics = createCliDiagnostics(
      ["--only-long", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": fullyRecoverableAliasTokens as never,
        },
      }
    );

    expect(recoverableDiagnostics.supportedCliOptions).toEqual([
      "--output",
      "--only",
      "-o",
      "--only-long",
    ]);
    expect(recoverableDiagnostics.supportedCliOptionCount).toBe(4);
    expect(recoverableDiagnostics.availableCliOptionAliases).toEqual({
      "--only": ["-o", "--only-long"],
    });
    expect(recoverableDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--output": "--output",
      "--only": "--only",
      "-o": "--only",
      "--only-long": "--only",
    });
    expect(recoverableDiagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(recoverableDiagnostics.unknownOptionCount).toBe(1);
    expect(recoverableDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --output, --only, -o, --only-long."
    );
    expect(recoverableDiagnostics.validationErrorCode).toBe("unsupported_options");
    expect(recoverableDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(recoverableDiagnostics.activeCliOptionCount).toBe(1);
    expect(recoverableDiagnostics.activeCliOptionTokens).toEqual(["--only-long"]);
    expect(recoverableDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only-long",
        canonicalOption: "--only",
      },
    ]);
    expect(recoverableDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(recoverableDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only-long",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(recoverableDiagnostics.activeCliOptionOccurrenceCount).toBe(1);

    const partiallyRecoverableAliasTokens =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--only-long"]);
    const partiallyRecoverableDiagnostics = createCliDiagnostics(
      ["--only-long", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": partiallyRecoverableAliasTokens as never,
        },
      }
    );

    expect(partiallyRecoverableDiagnostics.supportedCliOptions).toEqual([
      "--output",
      "--only",
      "-o",
    ]);
    expect(partiallyRecoverableDiagnostics.supportedCliOptionCount).toBe(3);
    expect(partiallyRecoverableDiagnostics.availableCliOptionAliases).toEqual({
      "--only": ["-o"],
    });
    expect(partiallyRecoverableDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--output": "--output",
      "--only": "--only",
      "-o": "--only",
    });
    expect(partiallyRecoverableDiagnostics.unknownOptions).toEqual([
      "--only-long",
      "--mystery",
    ]);
    expect(partiallyRecoverableDiagnostics.unknownOptionCount).toBe(2);
    expect(partiallyRecoverableDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --only-long, --mystery. Supported options: --output, --only, -o."
    );
    expect(partiallyRecoverableDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(partiallyRecoverableDiagnostics.activeCliOptions).toEqual([]);
    expect(partiallyRecoverableDiagnostics.activeCliOptionCount).toBe(0);
    expect(partiallyRecoverableDiagnostics.activeCliOptionTokens).toEqual([]);
    expect(partiallyRecoverableDiagnostics.activeCliOptionResolutions).toEqual(
      []
    );
    expect(partiallyRecoverableDiagnostics.activeCliOptionResolutionCount).toBe(0);
    expect(partiallyRecoverableDiagnostics.activeCliOptionOccurrences).toEqual([]);
    expect(partiallyRecoverableDiagnostics.activeCliOptionOccurrenceCount).toBe(0);
    const fullyTrappedAliasTokens = createFullyTrappedStringArray([
      "-o",
      "--only-long",
    ]);
    const fullyTrappedDiagnostics = createCliDiagnostics(
      ["--only", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": fullyTrappedAliasTokens as never,
        },
      }
    );
    expect(fullyTrappedDiagnostics.supportedCliOptions).toEqual([
      "--output",
      "--only",
    ]);
    expect(fullyTrappedDiagnostics.supportedCliOptionCount).toBe(2);
    expect(fullyTrappedDiagnostics.availableCliOptionAliases).toEqual({
      "--only": [],
    });
    expect(fullyTrappedDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--output": "--output",
      "--only": "--only",
    });
    expect(fullyTrappedDiagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(fullyTrappedDiagnostics.unknownOptionCount).toBe(1);
    expect(fullyTrappedDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --output, --only."
    );
    expect(fullyTrappedDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(fullyTrappedDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(fullyTrappedDiagnostics.activeCliOptionCount).toBe(1);
    expect(fullyTrappedDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(fullyTrappedDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(fullyTrappedDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(fullyTrappedDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(fullyTrappedDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("tracks length-trapped canonical option recovery in unified cli diagnostics", () => {
    const fullyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(
        ["--json", "--output"],
        2
      );
    const fullyRecoverableDiagnostics = createCliDiagnostics(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions:
          fullyRecoverableLengthTrappedCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );

    expect(fullyRecoverableDiagnostics.supportedCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(fullyRecoverableDiagnostics.supportedCliOptionCount).toBe(2);
    expect(fullyRecoverableDiagnostics.availableCliOptionAliases).toEqual({});
    expect(fullyRecoverableDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--output": "--output",
    });
    expect(fullyRecoverableDiagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(fullyRecoverableDiagnostics.unknownOptionCount).toBe(1);
    expect(fullyRecoverableDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output."
    );
    expect(fullyRecoverableDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(fullyRecoverableDiagnostics.activeCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(fullyRecoverableDiagnostics.activeCliOptionCount).toBe(2);
    expect(fullyRecoverableDiagnostics.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
    ]);
    expect(fullyRecoverableDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(fullyRecoverableDiagnostics.activeCliOptionResolutionCount).toBe(2);
    expect(fullyRecoverableDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(fullyRecoverableDiagnostics.activeCliOptionOccurrenceCount).toBe(2);

    const partiallyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(["--json", "--output"]);
    const partiallyRecoverableDiagnostics = createCliDiagnostics(
      ["--json", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions:
          partiallyRecoverableLengthTrappedCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );

    expect(partiallyRecoverableDiagnostics.supportedCliOptions).toEqual([
      "--json",
    ]);
    expect(partiallyRecoverableDiagnostics.supportedCliOptionCount).toBe(1);
    expect(partiallyRecoverableDiagnostics.availableCliOptionAliases).toEqual({});
    expect(partiallyRecoverableDiagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
    });
    expect(partiallyRecoverableDiagnostics.unknownOptions).toEqual([
      "--mystery",
      "--output",
    ]);
    expect(partiallyRecoverableDiagnostics.unknownOptionCount).toBe(2);
    expect(partiallyRecoverableDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery, --output. Supported options: --json."
    );
    expect(partiallyRecoverableDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    expect(partiallyRecoverableDiagnostics.activeCliOptions).toEqual(["--json"]);
    expect(partiallyRecoverableDiagnostics.activeCliOptionCount).toBe(1);
    expect(partiallyRecoverableDiagnostics.activeCliOptionTokens).toEqual([
      "--json",
    ]);
    expect(partiallyRecoverableDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(partiallyRecoverableDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(partiallyRecoverableDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(partiallyRecoverableDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    const partiallyRecoverableDiagnosticsWithAliasFallback = createCliDiagnostics(
      ["--verify", "--mystery", "--output", "./report.json"],
      {
        canonicalOptions:
          partiallyRecoverableLengthTrappedCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--output"],
      }
    );
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.supportedCliOptions
    ).toEqual(["--json", "--no-build", "--verify"]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.supportedCliOptionCount
    ).toBe(3);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.availableCliOptionAliases
    ).toEqual({
      "--no-build": ["--verify"],
    });
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.availableCliOptionCanonicalMap
    ).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(partiallyRecoverableDiagnosticsWithAliasFallback.unknownOptions).toEqual([
      "--mystery",
      "--output",
    ]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.unknownOptionCount
    ).toBe(2);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --mystery, --output. Supported options: --json, --no-build, --verify."
    );
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.validationErrorCode
    ).toBe("unsupported_options");
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.activeCliOptionCount
    ).toBe(1);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.activeCliOptionTokens
    ).toEqual(["--verify"]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallback.activeCliOptionOccurrenceCount
    ).toBe(1);
    const partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue =
      createCliDiagnostics(["--verify", "--output", "-artifact-report.json"], {
        canonicalOptions:
          partiallyRecoverableLengthTrappedCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      });
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.supportedCliOptions
    ).toEqual(["--json", "--no-build", "--verify"]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.supportedCliOptionCount
    ).toBe(3);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.availableCliOptionAliases
    ).toEqual({
      "--no-build": ["--verify"],
    });
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.availableCliOptionCanonicalMap
    ).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.unknownOptions
    ).toEqual(["--output", "-artifact-report.json"]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.unknownOptionCount
    ).toBe(2);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): --output, -artifact-report.json. Supported options: --json, --no-build, --verify."
    );
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.validationErrorCode
    ).toBe("unsupported_options");
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.activeCliOptionCount
    ).toBe(1);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.activeCliOptionTokens
    ).toEqual(["--verify"]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      partiallyRecoverableDiagnosticsWithAliasFallbackAndDashValue.activeCliOptionOccurrenceCount
    ).toBe(1);
  });

  it("keeps pre-terminator aliases active while ignoring post-terminator misuse", () => {
    const diagnostics = createCliDiagnostics(
      ["--json", "--verify", "--", "--verify=1", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );

    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
    expect(diagnostics.activeCliOptions).toEqual(["--json", "--no-build"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--json", "--verify"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(2);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 1,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("ignores post-terminator unknown options while preserving pre-terminator diagnostics", () => {
    const diagnostics = createCliDiagnostics(
      ["--mystery", "--json", "--", "--another-mystery", "--json=1"],
      {
        canonicalOptions: ["--json"],
      }
    );

    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
    expect(diagnostics.activeCliOptions).toEqual(["--json"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--json"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("prioritizes output validation in unified diagnostics", () => {
    const diagnostics = createCliDiagnostics(
      ["--json", "--mystery", "--output"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
        outputPathError: "Missing value for --output option.",
      }
    );

    expect(diagnostics.validationErrorCode).toBe("output_option_missing_value");
    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.supportedCliOptions).toEqual(["--json", "--output"]);
    expect(diagnostics.supportedCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptions).toEqual(["--json", "--output"]);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--json", "--output"]);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("resolves aliases canonically when canonical token list includes aliases", () => {
    const diagnostics = createCliDiagnostics(["-l", "--verify"], {
      canonicalOptions: [
        "-l",
        "--list",
        "--list-checks",
        "--no-build",
        "--verify",
      ],
      optionAliases: {
        "--list-checks": ["--list", "-l"],
        "--no-build": ["--verify"],
      },
    });

    expect(diagnostics.availableCliOptionCanonicalMap).toEqual({
      "-l": "--list-checks",
      "--list": "--list-checks",
      "--list-checks": "--list-checks",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(diagnostics.supportedCliOptionCount).toBe(5);
    expect(diagnostics.activeCliOptions).toEqual(["--list-checks", "--no-build"]);
    expect(diagnostics.activeCliOptionTokens).toEqual(["-l", "--verify"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "-l",
        canonicalOption: "--list-checks",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
  });

  it("builds diagnostics when canonical options come only from alias config", () => {
    const diagnostics = createCliDiagnostics(["--verify", "--mystery"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
    });

    expect(diagnostics.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(diagnostics.supportedCliOptionCount).toBe(3);
    expect(diagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--no-build": "--no-build",
      "--verify": "--no-build",
    });
    expect(diagnostics.activeCliOptions).toEqual(["--no-build"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--verify"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --no-build, --verify."
    );
  });

  it("builds diagnostics for canonical tokens defined through alias config", () => {
    const diagnostics = createCliDiagnostics(["--no-build", "--mystery"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
    });

    expect(diagnostics.supportedCliOptions).toEqual([
      "--json",
      "--no-build",
      "--verify",
    ]);
    expect(diagnostics.activeCliOptions).toEqual(["--no-build"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--no-build"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
      },
    ]);
    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
  });

  it("builds diagnostics for alias-defined canonical value options", () => {
    const diagnostics = createCliDiagnostics(
      ["--report-path=./report.json", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--output"],
      }
    );

    expect(diagnostics.supportedCliOptions).toEqual([
      "--json",
      "--output",
      "--report-path",
    ]);
    expect(diagnostics.supportedCliOptionCount).toBe(3);
    expect(diagnostics.availableCliOptionCanonicalMap).toEqual({
      "--json": "--json",
      "--output": "--output",
      "--report-path": "--output",
    });
    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--report-path=./report.json"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output, --report-path."
    );
  });

  it("normalizes unknown inline option tokens in diagnostics", () => {
    const diagnostics = createCliDiagnostics(
      ["--json", "--mystery=alpha", "--mystery=beta", "-x=1", "-x=2"],
      {
        canonicalOptions: ["--json"],
      }
    );

    expect(diagnostics.unknownOptions).toEqual(["--mystery", "-x"]);
    expect(diagnostics.unknownOptionCount).toBe(2);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery, -x. Supported options: --json."
    );
  });

  it("ignores unsupported value-option metadata tokens in diagnostics", () => {
    const diagnostics = createCliDiagnostics(["--mystery=alpha"], {
      canonicalOptions: ["--json"],
      optionsWithValues: ["--mystery"],
    });

    expect(diagnostics.activeCliOptions).toEqual([]);
    expect(diagnostics.activeCliOptionCount).toBe(0);
    expect(diagnostics.activeCliOptionTokens).toEqual([]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(0);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(0);
    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("redacts inline known-flag misuse tokens in diagnostics", () => {
    const diagnostics = createCliDiagnostics(
      ["--json=1", "--json=2", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
      }
    );

    expect(diagnostics.unknownOptions).toEqual([
      "--json=<value>",
      "--mystery",
    ]);
    expect(diagnostics.unknownOptionCount).toBe(2);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --json."
    );
  });

  it("redacts inline alias misuse tokens in diagnostics", () => {
    const diagnostics = createCliDiagnostics(
      ["--verify=1", "--no-build=2", "-j=1", "--json=2", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
          "--json": ["-j"],
        },
      }
    );

    expect(diagnostics.unknownOptions).toEqual([
      "--no-build=<value>",
      "--json=<value>",
      "--mystery",
    ]);
    expect(diagnostics.unknownOptionCount).toBe(3);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --no-build=<value>, --json=<value>, --mystery. Supported options: --json, --no-build, --verify, -j."
    );
  });

  it("deduplicates literal alias placeholders in diagnostics", () => {
    const diagnostics = createCliDiagnostics(
      [
        "--verify=<value>",
        "--verify=1",
        "--no-build=2",
        "-j=<value>",
        "-j=1",
        "--json=2",
        "--mystery=alpha",
      ],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
          "--json": ["-j"],
        },
      }
    );

    expect(diagnostics.unknownOptions).toEqual([
      "--no-build=<value>",
      "--json=<value>",
      "--mystery",
    ]);
    expect(diagnostics.unknownOptionCount).toBe(3);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --no-build=<value>, --json=<value>, --mystery. Supported options: --json, --no-build, --verify, -j."
    );
  });

  it("separates active options from inline misuse diagnostics", () => {
    const diagnostics = createCliDiagnostics(
      [
        "--json",
        "--list-checks",
        "--json=1",
        "--verify=2",
        "--list=3",
        "--output=./report.json",
        "--mystery=alpha",
      ],
      {
        canonicalOptions: ["--json", "--list-checks", "--no-build", "--output"],
        optionAliases: {
          "--no-build": ["--verify"],
          "--list-checks": ["--list", "-l"],
        },
        optionsWithValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual([
      "--json",
      "--list-checks",
      "--output",
    ]);
    expect(diagnostics.activeCliOptionCount).toBe(3);
    expect(diagnostics.activeCliOptionTokens).toEqual([
      "--json",
      "--list-checks",
      "--output=./report.json",
    ]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--list-checks",
        canonicalOption: "--list-checks",
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(3);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--list-checks",
        canonicalOption: "--list-checks",
        index: 1,
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
        index: 5,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(3);
    expect(diagnostics.unknownOptions).toEqual([
      "--json=<value>",
      "--no-build=<value>",
      "--list-checks=<value>",
      "--mystery",
    ]);
    expect(diagnostics.unknownOptionCount).toBe(4);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --json=<value>, --no-build=<value>, --list-checks=<value>, --mystery. Supported options: --json, --list-checks, --no-build, --output, --verify, --list, -l."
    );
  });

  it("keeps recognized alias options active while redacting inline alias misuse", () => {
    const diagnostics = createCliDiagnostics(
      [
        "--json",
        "--verify",
        "--verify=2",
        "--no-build=3",
        "--output=./report.json",
        "--mystery=alpha",
      ],
      {
        canonicalOptions: ["--json", "--no-build", "--output"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual([
      "--json",
      "--no-build",
      "--output",
    ]);
    expect(diagnostics.activeCliOptionCount).toBe(3);
    expect(diagnostics.activeCliOptionTokens).toEqual([
      "--json",
      "--verify",
      "--output=./report.json",
    ]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(3);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 1,
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
        index: 4,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(3);
    expect(diagnostics.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(2);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --json, --no-build, --output, --verify."
    );
  });

  it("redacts malformed inline option names in diagnostics", () => {
    const diagnostics = createCliDiagnostics(
      ["--=secret", "--=token", "--=", "-=secret", "-=token", "-="],
      {
        canonicalOptions: ["--json"],
      }
    );

    expect(diagnostics.unknownOptions).toEqual(["--=<value>", "-=<value>"]);
    expect(diagnostics.unknownOptionCount).toBe(2);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --json."
    );
  });

  it("builds diagnostics when value options are declared by alias token", () => {
    const diagnostics = createCliDiagnostics(
      ["--report-path=./report.json", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--report-path"],
      }
    );

    expect(diagnostics.supportedCliOptions).toEqual([
      "--json",
      "--output",
      "--report-path",
    ]);
    expect(diagnostics.supportedCliOptionCount).toBe(3);
    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--report-path=./report.json"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.unknownOptions).toEqual(["--mystery"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --mystery. Supported options: --json, --output, --report-path."
    );
  });

  it("treats recognized option tokens as active for strict value options", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--list-checks", "--output"],
      optionAliases: {
        "--list-checks": ["-l"],
      },
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output", "-l"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "-l",
        canonicalOption: "--list-checks",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(2);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-l",
        canonicalOption: "--list-checks",
        index: 1,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
  });

  it("reports unknown short tokens after strict value options", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("reports unknown short tokens with primitive strict metadata", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: ["--output"],
      optionsWithStrictValues: "--output" as never,
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("reports unknown short tokens across value options with primitive strict metadata", () => {
    const diagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only"],
      optionsWithStrictValues: "--output" as never,
    });

    expect(diagnostics.activeCliOptions).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("reports unknown short tokens across value options with set strict metadata", () => {
    const setStrictValueMetadata = new Set(["--output"]);
    const diagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only"],
      optionsWithStrictValues: setStrictValueMetadata as never,
    });

    expect(diagnostics.activeCliOptions).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("reports unknown short tokens with unsupported strict metadata", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--mystery"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("preserves strict subsets when mixed strict metadata contains malformed entries", () => {
    const strictOptionDiagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only"],
      optionsWithStrictValues: ["--output", 1] as never,
    });

    expect(strictOptionDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(strictOptionDiagnostics.activeCliOptionCount).toBe(1);
    expect(strictOptionDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(strictOptionDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(strictOptionDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(strictOptionDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(strictOptionDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(strictOptionDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(strictOptionDiagnostics.unknownOptionCount).toBe(1);
    expect(strictOptionDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(strictOptionDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );

    const nonStrictOptionDiagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only"],
      optionsWithStrictValues: ["--output", 1] as never,
    });

    expect(nonStrictOptionDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(nonStrictOptionDiagnostics.activeCliOptionCount).toBe(1);
    expect(nonStrictOptionDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(nonStrictOptionDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(nonStrictOptionDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(nonStrictOptionDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(nonStrictOptionDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(nonStrictOptionDiagnostics.unknownOptions).toEqual([]);
    expect(nonStrictOptionDiagnostics.unknownOptionCount).toBe(0);
    expect(nonStrictOptionDiagnostics.unsupportedOptionsError).toBeNull();
    expect(nonStrictOptionDiagnostics.validationErrorCode).toBeNull();
  });

  it("preserves strict subsets when strict metadata is partially recovered from traps", () => {
    const partiallyRecoveredStrictValueOptions = createPartiallyRecoveredStringArray(
      ["--output", "--only"]
    );
    const strictOptionDiagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only"],
      optionsWithStrictValues: partiallyRecoveredStrictValueOptions as never,
    });

    expect(strictOptionDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(strictOptionDiagnostics.activeCliOptionCount).toBe(1);
    expect(strictOptionDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(strictOptionDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(strictOptionDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(strictOptionDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(strictOptionDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(strictOptionDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(strictOptionDiagnostics.unknownOptionCount).toBe(1);
    expect(strictOptionDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(strictOptionDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );

    const nonStrictOptionDiagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only"],
      optionsWithStrictValues: partiallyRecoveredStrictValueOptions as never,
    });

    expect(nonStrictOptionDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(nonStrictOptionDiagnostics.activeCliOptionCount).toBe(1);
    expect(nonStrictOptionDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(nonStrictOptionDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(nonStrictOptionDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(nonStrictOptionDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(nonStrictOptionDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(nonStrictOptionDiagnostics.unknownOptions).toEqual([]);
    expect(nonStrictOptionDiagnostics.unknownOptionCount).toBe(0);
    expect(nonStrictOptionDiagnostics.unsupportedOptionsError).toBeNull();
    expect(nonStrictOptionDiagnostics.validationErrorCode).toBeNull();
  });

  it("preserves strict subsets when strict metadata is partially recovered from length traps", () => {
    const lengthTrappedPartiallyRecoveredStrictValueOptions =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--output",
        "--only",
      ]);
    const strictOptionDiagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only"],
      optionsWithStrictValues:
        lengthTrappedPartiallyRecoveredStrictValueOptions as never,
    });

    expect(strictOptionDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(strictOptionDiagnostics.activeCliOptionCount).toBe(1);
    expect(strictOptionDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(strictOptionDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(strictOptionDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(strictOptionDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(strictOptionDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(strictOptionDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(strictOptionDiagnostics.unknownOptionCount).toBe(1);
    expect(strictOptionDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(strictOptionDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    const strictInlineShortDiagnostics = createCliDiagnostics(
      ["--output", "-l=1"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictValueOptions as never,
      }
    );
    expect(strictInlineShortDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(strictInlineShortDiagnostics.activeCliOptionCount).toBe(1);
    expect(strictInlineShortDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
    ]);
    expect(strictInlineShortDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(strictInlineShortDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(strictInlineShortDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(strictInlineShortDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(strictInlineShortDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(strictInlineShortDiagnostics.unknownOptionCount).toBe(1);
    expect(strictInlineShortDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(strictInlineShortDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );

    const nonStrictOptionDiagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only"],
      optionsWithStrictValues:
        lengthTrappedPartiallyRecoveredStrictValueOptions as never,
    });

    expect(nonStrictOptionDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(nonStrictOptionDiagnostics.activeCliOptionCount).toBe(1);
    expect(nonStrictOptionDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(nonStrictOptionDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(nonStrictOptionDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(nonStrictOptionDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(nonStrictOptionDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(nonStrictOptionDiagnostics.unknownOptions).toEqual([]);
    expect(nonStrictOptionDiagnostics.unknownOptionCount).toBe(0);
    expect(nonStrictOptionDiagnostics.unsupportedOptionsError).toBeNull();
    expect(nonStrictOptionDiagnostics.validationErrorCode).toBeNull();
  });

  it("reports unknown short tokens with mixed value metadata and unsupported strict metadata", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: ["--output", 1] as never,
      optionsWithStrictValues: ["--mystery"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("reports unknown short tokens with mixed value metadata without strict metadata", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: ["--output", 1] as never,
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("applies conservative strict guards across value options when mixed metadata is unavailable", () => {
    const onlyDiagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only", 1] as never,
    });

    expect(onlyDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(onlyDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(onlyDiagnostics.validationErrorCode).toBe("unsupported_options");

    const onlyDashPathDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
      }
    );

    expect(onlyDashPathDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDashPathDiagnostics.unknownOptions).toEqual([]);
    expect(onlyDashPathDiagnostics.unknownOptionCount).toBe(0);
    expect(onlyDashPathDiagnostics.unsupportedOptionsError).toBeNull();
    expect(onlyDashPathDiagnostics.validationErrorCode).toBeNull();
  });

  it("applies partial strict guards when value metadata is partially recovered from traps", () => {
    const partiallyRecoveredValueOptions = createPartiallyRecoveredStringArray([
      "--output",
      "--only",
    ]);
    const outputDiagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: partiallyRecoveredValueOptions as never,
    });

    expect(outputDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(outputDiagnostics.activeCliOptionCount).toBe(1);
    expect(outputDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(outputDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(outputDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(outputDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(outputDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(outputDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(outputDiagnostics.unknownOptionCount).toBe(1);
    expect(outputDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(outputDiagnostics.validationErrorCode).toBe("unsupported_options");

    const onlyDiagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: partiallyRecoveredValueOptions as never,
    });

    expect(onlyDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(onlyDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(onlyDiagnostics.validationErrorCode).toBe("unsupported_options");

    const onlyDashPathDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
      }
    );

    expect(onlyDashPathDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDashPathDiagnostics.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(onlyDashPathDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyDashPathDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(onlyDashPathDiagnostics.validationErrorCode).toBe("unsupported_options");

    const partiallyRecoveredStrictSubsetOptions = createPartiallyRecoveredStringArray(
      ["--only", "--output"]
    );
    const outputWithStrictSubsetDiagnostics = createCliDiagnostics(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      }
    );
    expect(outputWithStrictSubsetDiagnostics.activeCliOptions).toEqual([
      "--output",
    ]);
    expect(outputWithStrictSubsetDiagnostics.activeCliOptionCount).toBe(1);
    expect(outputWithStrictSubsetDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
    ]);
    expect(outputWithStrictSubsetDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(outputWithStrictSubsetDiagnostics.activeCliOptionResolutionCount).toBe(
      1
    );
    expect(outputWithStrictSubsetDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(outputWithStrictSubsetDiagnostics.activeCliOptionOccurrenceCount).toBe(
      1
    );
    expect(outputWithStrictSubsetDiagnostics.unknownOptions).toEqual([]);
    expect(outputWithStrictSubsetDiagnostics.unknownOptionCount).toBe(0);
    expect(outputWithStrictSubsetDiagnostics.unsupportedOptionsError).toBeNull();
    expect(outputWithStrictSubsetDiagnostics.validationErrorCode).toBeNull();

    const onlyWithStrictSubsetDiagnostics = createCliDiagnostics(
      ["--only", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      }
    );
    expect(onlyWithStrictSubsetDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyWithStrictSubsetDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyWithStrictSubsetDiagnostics.activeCliOptionTokens).toEqual([
      "--only",
    ]);
    expect(onlyWithStrictSubsetDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyWithStrictSubsetDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyWithStrictSubsetDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyWithStrictSubsetDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyWithStrictSubsetDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(onlyWithStrictSubsetDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyWithStrictSubsetDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(onlyWithStrictSubsetDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    const onlyWithStrictSubsetDashPathDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      }
    );
    expect(onlyWithStrictSubsetDashPathDiagnostics.activeCliOptions).toEqual([
      "--only",
    ]);
    expect(onlyWithStrictSubsetDashPathDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyWithStrictSubsetDashPathDiagnostics.activeCliOptionTokens).toEqual([
      "--only",
    ]);
    expect(onlyWithStrictSubsetDashPathDiagnostics.activeCliOptionResolutions).toEqual(
      [
        {
          token: "--only",
          canonicalOption: "--only",
        },
      ]
    );
    expect(
      onlyWithStrictSubsetDashPathDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(onlyWithStrictSubsetDashPathDiagnostics.activeCliOptionOccurrences).toEqual(
      [
        {
          token: "--only",
          canonicalOption: "--only",
          index: 0,
        },
      ]
    );
    expect(
      onlyWithStrictSubsetDashPathDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(onlyWithStrictSubsetDashPathDiagnostics.unknownOptions).toEqual([]);
    expect(onlyWithStrictSubsetDashPathDiagnostics.unknownOptionCount).toBe(0);
    expect(onlyWithStrictSubsetDashPathDiagnostics.unsupportedOptionsError).toBeNull();
    expect(onlyWithStrictSubsetDashPathDiagnostics.validationErrorCode).toBeNull();
  });

  it("applies partial strict guards when value metadata is partially recovered from length traps", () => {
    const lengthTrappedPartiallyRecoveredValueOptions =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--output",
        "--only",
      ]);
    const outputDiagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
    });

    expect(outputDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(outputDiagnostics.activeCliOptionCount).toBe(1);
    expect(outputDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(outputDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(outputDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(outputDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(outputDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(outputDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(outputDiagnostics.unknownOptionCount).toBe(1);
    expect(outputDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(outputDiagnostics.validationErrorCode).toBe("unsupported_options");
    const outputInlineShortDiagnostics = createCliDiagnostics(
      ["--output", "-l=1"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
      }
    );
    expect(outputInlineShortDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(outputInlineShortDiagnostics.activeCliOptionCount).toBe(1);
    expect(outputInlineShortDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
    ]);
    expect(outputInlineShortDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(outputInlineShortDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(outputInlineShortDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(outputInlineShortDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(outputInlineShortDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(outputInlineShortDiagnostics.unknownOptionCount).toBe(1);
    expect(outputInlineShortDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(outputInlineShortDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );

    const onlyDashPathDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(onlyDashPathDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDashPathDiagnostics.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(onlyDashPathDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyDashPathDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(onlyDashPathDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    const onlyInlineShortDiagnostics = createCliDiagnostics(
      ["--only", "-l=1"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
        optionsWithStrictValues: ["--output"],
      }
    );
    expect(onlyInlineShortDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyInlineShortDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyInlineShortDiagnostics.activeCliOptionTokens).toEqual([
      "--only",
    ]);
    expect(onlyInlineShortDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyInlineShortDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyInlineShortDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyInlineShortDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyInlineShortDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(onlyInlineShortDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyInlineShortDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(onlyInlineShortDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
  });

  it("preserves recoverable strict subsets when value metadata is unavailable", () => {
    const outputDiagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", 1] as never,
      optionsWithStrictValues: ["--only"],
    });

    expect(outputDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(outputDiagnostics.activeCliOptionCount).toBe(1);
    expect(outputDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(outputDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(outputDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(outputDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(outputDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(outputDiagnostics.unknownOptions).toEqual([]);
    expect(outputDiagnostics.unknownOptionCount).toBe(0);
    expect(outputDiagnostics.unsupportedOptionsError).toBeNull();
    expect(outputDiagnostics.validationErrorCode).toBeNull();

    const onlyDiagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", 1] as never,
      optionsWithStrictValues: ["--only"],
    });

    expect(onlyDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(onlyDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(onlyDiagnostics.validationErrorCode).toBe("unsupported_options");

    const onlyDashPathDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--only"],
      }
    );

    expect(onlyDashPathDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDashPathDiagnostics.unknownOptions).toEqual([]);
    expect(onlyDashPathDiagnostics.unknownOptionCount).toBe(0);
    expect(onlyDashPathDiagnostics.unsupportedOptionsError).toBeNull();
    expect(onlyDashPathDiagnostics.validationErrorCode).toBeNull();
  });

  it("applies conservative strict guards for all recovered value options when strict metadata is unavailable", () => {
    const onlyDiagnostics = createCliDiagnostics(["--only", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionsWithValues: ["--output", "--only", 1] as never,
      optionsWithStrictValues: ["--mystery"],
    });

    expect(onlyDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(onlyDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only."
    );
    expect(onlyDiagnostics.validationErrorCode).toBe("unsupported_options");

    const onlyDashPathDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      }
    );

    expect(onlyDashPathDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(onlyDashPathDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(onlyDashPathDiagnostics.unknownOptions).toEqual([]);
    expect(onlyDashPathDiagnostics.unknownOptionCount).toBe(0);
    expect(onlyDashPathDiagnostics.unsupportedOptionsError).toBeNull();
    expect(onlyDashPathDiagnostics.validationErrorCode).toBeNull();
  });

  it("reports unknown short tokens with unresolved value metadata and supported strict metadata", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: ["--mystery"],
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("applies strict fallback behavior when value metadata is a non-array object", () => {
    const setValueMetadata = new Set(["--output"]);
    const strictDiagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: setValueMetadata as never,
      optionsWithStrictValues: ["--output"],
    });

    expect(strictDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(strictDiagnostics.activeCliOptionCount).toBe(1);
    expect(strictDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(strictDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(strictDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(strictDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(strictDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(strictDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(strictDiagnostics.unknownOptionCount).toBe(1);
    expect(strictDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(strictDiagnostics.validationErrorCode).toBe("unsupported_options");

    const noStrictDiagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: setValueMetadata as never,
      }
    );

    expect(noStrictDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(noStrictDiagnostics.activeCliOptionCount).toBe(1);
    expect(noStrictDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(noStrictDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(noStrictDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(noStrictDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(noStrictDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(noStrictDiagnostics.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(noStrictDiagnostics.unknownOptionCount).toBe(1);
    expect(noStrictDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output."
    );
    expect(noStrictDiagnostics.validationErrorCode).toBe("unsupported_options");
    const mapValueMetadata = new Map<string, boolean>([["--output", true]]);
    const mapStrictDiagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: mapValueMetadata as never,
      optionsWithStrictValues: ["--output"],
    });
    expect(mapStrictDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(mapStrictDiagnostics.activeCliOptionCount).toBe(1);
    expect(mapStrictDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(mapStrictDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(mapStrictDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(mapStrictDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(mapStrictDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(mapStrictDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(mapStrictDiagnostics.unknownOptionCount).toBe(1);
    expect(mapStrictDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(mapStrictDiagnostics.validationErrorCode).toBe("unsupported_options");

    const mapNoStrictDiagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: mapValueMetadata as never,
      }
    );

    expect(mapNoStrictDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(mapNoStrictDiagnostics.activeCliOptionCount).toBe(1);
    expect(mapNoStrictDiagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(mapNoStrictDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(mapNoStrictDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(mapNoStrictDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(mapNoStrictDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(mapNoStrictDiagnostics.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(mapNoStrictDiagnostics.unknownOptionCount).toBe(1);
    expect(mapNoStrictDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output."
    );
    expect(mapNoStrictDiagnostics.validationErrorCode).toBe("unsupported_options");
    const mapStrictValueMetadata = new Map<string, boolean>([
      ["--output", true],
    ]);
    const mapStrictMetadataDiagnostics = createCliDiagnostics(
      ["--output", "-l"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: mapStrictValueMetadata as never,
      }
    );
    expect(mapStrictMetadataDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(mapStrictMetadataDiagnostics.activeCliOptionCount).toBe(1);
    expect(mapStrictMetadataDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
    ]);
    expect(mapStrictMetadataDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(mapStrictMetadataDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(mapStrictMetadataDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(mapStrictMetadataDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(mapStrictMetadataDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(mapStrictMetadataDiagnostics.unknownOptionCount).toBe(1);
    expect(mapStrictMetadataDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(mapStrictMetadataDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
  });

  it("applies set value metadata strict-subset fallback across sibling options in diagnostics", () => {
    const setValueMetadata = new Set(["--output"]);
    const onlyDashPrefixedValueDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(onlyDashPrefixedValueDiagnostics.activeCliOptions).toEqual([
      "--only",
    ]);
    expect(onlyDashPrefixedValueDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDashPrefixedValueDiagnostics.activeCliOptionTokens).toEqual([
      "--only",
    ]);
    expect(onlyDashPrefixedValueDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(
      onlyDashPrefixedValueDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(onlyDashPrefixedValueDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(
      onlyDashPrefixedValueDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(onlyDashPrefixedValueDiagnostics.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(onlyDashPrefixedValueDiagnostics.unknownOptionCount).toBe(1);
    expect(onlyDashPrefixedValueDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(onlyDashPrefixedValueDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );

    const outputDashPrefixedValueDiagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(outputDashPrefixedValueDiagnostics.activeCliOptions).toEqual([
      "--output",
    ]);
    expect(outputDashPrefixedValueDiagnostics.activeCliOptionCount).toBe(1);
    expect(outputDashPrefixedValueDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
    ]);
    expect(outputDashPrefixedValueDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(
      outputDashPrefixedValueDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      outputDashPrefixedValueDiagnostics.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(
      outputDashPrefixedValueDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(outputDashPrefixedValueDiagnostics.unknownOptions).toEqual([]);
    expect(outputDashPrefixedValueDiagnostics.unknownOptionCount).toBe(0);
    expect(outputDashPrefixedValueDiagnostics.unsupportedOptionsError).toBeNull();
    expect(outputDashPrefixedValueDiagnostics.validationErrorCode).toBeNull();
  });

  it("applies inverse set value strict-subset fallback across sibling options in diagnostics", () => {
    const setValueMetadata = new Set(["--output"]);
    const outputDashPrefixedValueDiagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      }
    );

    expect(outputDashPrefixedValueDiagnostics.activeCliOptions).toEqual([
      "--output",
    ]);
    expect(outputDashPrefixedValueDiagnostics.activeCliOptionCount).toBe(1);
    expect(outputDashPrefixedValueDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
    ]);
    expect(outputDashPrefixedValueDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(
      outputDashPrefixedValueDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      outputDashPrefixedValueDiagnostics.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(
      outputDashPrefixedValueDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(outputDashPrefixedValueDiagnostics.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(outputDashPrefixedValueDiagnostics.unknownOptionCount).toBe(1);
    expect(outputDashPrefixedValueDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(outputDashPrefixedValueDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );

    const onlyDashPrefixedValueDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      }
    );

    expect(onlyDashPrefixedValueDiagnostics.activeCliOptions).toEqual([
      "--only",
    ]);
    expect(onlyDashPrefixedValueDiagnostics.activeCliOptionCount).toBe(1);
    expect(onlyDashPrefixedValueDiagnostics.activeCliOptionTokens).toEqual([
      "--only",
    ]);
    expect(onlyDashPrefixedValueDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(
      onlyDashPrefixedValueDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(onlyDashPrefixedValueDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(
      onlyDashPrefixedValueDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(onlyDashPrefixedValueDiagnostics.unknownOptions).toEqual([]);
    expect(onlyDashPrefixedValueDiagnostics.unknownOptionCount).toBe(0);
    expect(onlyDashPrefixedValueDiagnostics.unsupportedOptionsError).toBeNull();
    expect(onlyDashPrefixedValueDiagnostics.validationErrorCode).toBeNull();
    const mapValueMetadata = new Map<string, boolean>([["--output", true]]);
    const mapOutputDashPrefixedValueDiagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: mapValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      }
    );
    expect(mapOutputDashPrefixedValueDiagnostics.activeCliOptions).toEqual([
      "--output",
    ]);
    expect(mapOutputDashPrefixedValueDiagnostics.activeCliOptionCount).toBe(1);
    expect(mapOutputDashPrefixedValueDiagnostics.activeCliOptionTokens).toEqual([
      "--output",
    ]);
    expect(mapOutputDashPrefixedValueDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(
      mapOutputDashPrefixedValueDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(mapOutputDashPrefixedValueDiagnostics.activeCliOptionOccurrences).toEqual(
      [
        {
          token: "--output",
          canonicalOption: "--output",
          index: 0,
        },
      ]
    );
    expect(
      mapOutputDashPrefixedValueDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(mapOutputDashPrefixedValueDiagnostics.unknownOptions).toEqual([
      "-artifact-report.json",
    ]);
    expect(mapOutputDashPrefixedValueDiagnostics.unknownOptionCount).toBe(1);
    expect(mapOutputDashPrefixedValueDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only."
    );
    expect(mapOutputDashPrefixedValueDiagnostics.validationErrorCode).toBe(
      "unsupported_options"
    );
    const mapOnlyDashPrefixedValueDiagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: mapValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      }
    );
    expect(mapOnlyDashPrefixedValueDiagnostics.activeCliOptions).toEqual([
      "--only",
    ]);
    expect(mapOnlyDashPrefixedValueDiagnostics.activeCliOptionCount).toBe(1);
    expect(mapOnlyDashPrefixedValueDiagnostics.activeCliOptionTokens).toEqual([
      "--only",
    ]);
    expect(mapOnlyDashPrefixedValueDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(mapOnlyDashPrefixedValueDiagnostics.activeCliOptionResolutionCount).toBe(
      1
    );
    expect(mapOnlyDashPrefixedValueDiagnostics.activeCliOptionOccurrences).toEqual(
      [
        {
          token: "--only",
          canonicalOption: "--only",
          index: 0,
        },
      ]
    );
    expect(mapOnlyDashPrefixedValueDiagnostics.activeCliOptionOccurrenceCount).toBe(
      1
    );
    expect(mapOnlyDashPrefixedValueDiagnostics.unknownOptions).toEqual([]);
    expect(mapOnlyDashPrefixedValueDiagnostics.unknownOptionCount).toBe(0);
    expect(mapOnlyDashPrefixedValueDiagnostics.unsupportedOptionsError).toBeNull();
    expect(mapOnlyDashPrefixedValueDiagnostics.validationErrorCode).toBeNull();
  });

  it("resolves alias strict subsets when value metadata is a non-array object in diagnostics", () => {
    const setValueMetadata = new Set(["--output"]);
    const outputDiagnostics = createCliDiagnostics(
      ["--report-path", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      }
    );

    expect(outputDiagnostics.activeCliOptions).toEqual(["--output"]);
    expect(outputDiagnostics.activeCliOptionCount).toBe(1);
    expect(outputDiagnostics.activeCliOptionTokens).toEqual(["--report-path"]);
    expect(outputDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
    ]);
    expect(outputDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(outputDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(outputDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(outputDiagnostics.unknownOptions).toEqual(["-artifact-report.json"]);
    expect(outputDiagnostics.unknownOptionCount).toBe(1);
    expect(outputDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only, -o, --report-path."
    );
    expect(outputDiagnostics.validationErrorCode).toBe("unsupported_options");

    const strictAliasDiagnostics = createCliDiagnostics(["-o", "-l"], {
      canonicalOptions: ["--output", "--only"],
      optionAliases: {
        "--only": ["-o"],
        "--output": ["--report-path"],
      },
      optionsWithValues: setValueMetadata as never,
      optionsWithStrictValues: ["-o"],
    });

    expect(strictAliasDiagnostics.activeCliOptions).toEqual(["--only"]);
    expect(strictAliasDiagnostics.activeCliOptionCount).toBe(1);
    expect(strictAliasDiagnostics.activeCliOptionTokens).toEqual(["-o"]);
    expect(strictAliasDiagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "-o",
        canonicalOption: "--only",
      },
    ]);
    expect(strictAliasDiagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(strictAliasDiagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "-o",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(strictAliasDiagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(strictAliasDiagnostics.unknownOptions).toEqual(["-l"]);
    expect(strictAliasDiagnostics.unknownOptionCount).toBe(1);
    expect(strictAliasDiagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output, --only, -o, --report-path."
    );
    expect(strictAliasDiagnostics.validationErrorCode).toBe("unsupported_options");
    const strictAliasSubsetFromLengthTraps =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--output"]);
    const lengthTrappedAliasStrictSubsetOutputDiagnostics = createCliDiagnostics(
      ["--report-path", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: strictAliasSubsetFromLengthTraps as never,
      }
    );
    expect(lengthTrappedAliasStrictSubsetOutputDiagnostics.activeCliOptions).toEqual(
      ["--output"]
    );
    expect(
      lengthTrappedAliasStrictSubsetOutputDiagnostics.activeCliOptionCount
    ).toBe(1);
    expect(
      lengthTrappedAliasStrictSubsetOutputDiagnostics.activeCliOptionTokens
    ).toEqual(["--report-path"]);
    expect(
      lengthTrappedAliasStrictSubsetOutputDiagnostics.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
    ]);
    expect(
      lengthTrappedAliasStrictSubsetOutputDiagnostics.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      lengthTrappedAliasStrictSubsetOutputDiagnostics.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(
      lengthTrappedAliasStrictSubsetOutputDiagnostics.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(lengthTrappedAliasStrictSubsetOutputDiagnostics.unknownOptions).toEqual(
      ["-artifact-report.json"]
    );
    expect(lengthTrappedAliasStrictSubsetOutputDiagnostics.unknownOptionCount).toBe(
      1
    );
    expect(
      lengthTrappedAliasStrictSubsetOutputDiagnostics.unsupportedOptionsError
    ).toBe(
      "Unsupported option(s): -artifact-report.json. Supported options: --output, --only, -o, --report-path."
    );
    expect(
      lengthTrappedAliasStrictSubsetOutputDiagnostics.validationErrorCode
    ).toBe("unsupported_options");
  });

  it("reports unknown short tokens with strict metadata only", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("keeps strict unknown short diagnostics when strict metadata traps", () => {
    const trappedStrictValueOptions = new Proxy(["--output"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: ["--output"],
      optionsWithStrictValues: trappedStrictValueOptions as never,
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("keeps strict unknown short diagnostics when value metadata traps", () => {
    const trappedValueOptions = new Proxy(["--output"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: trappedValueOptions as never,
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("keeps strict unknown short diagnostics with primitive value metadata", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l"], {
      canonicalOptions: ["--output"],
      optionsWithValues: "--output" as never,
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("keeps strict inline short diagnostics when value metadata traps", () => {
    const trappedValueOptions = new Proxy(["--output"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const diagnostics = createCliDiagnostics(["--output", "-l=1"], {
      canonicalOptions: ["--output"],
      optionsWithValues: trappedValueOptions as never,
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("keeps dash-prefixed strict values when value metadata traps", () => {
    const trappedValueOptions = new Proxy(["--output"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: trappedValueOptions as never,
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed strict values with primitive value metadata", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: "--output" as never,
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("reports unknown inline short tokens after strict value options", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l=1"], {
      canonicalOptions: ["--output"],
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["-l"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): -l. Supported options: --output."
    );
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
  });

  it("keeps dash-prefixed path values after strict value options", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed path values with primitive strict metadata", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: "--output" as never,
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed path values across value options with primitive strict metadata", () => {
    const diagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: "--output" as never,
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed path values across value options with set strict metadata", () => {
    const setStrictValueMetadata = new Set(["--output"]);
    const diagnostics = createCliDiagnostics(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: setStrictValueMetadata as never,
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed path values with unsupported strict metadata", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--mystery"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed path values with mixed value metadata and unsupported strict metadata", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed path values with mixed value metadata without strict metadata", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--output", 1] as never,
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed path values with unresolved value metadata and supported strict metadata", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithValues: ["--mystery"],
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("keeps dash-prefixed path values with strict metadata only", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-artifact-report.json"],
      {
        canonicalOptions: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
    expect(diagnostics.validationErrorCode).toBeNull();
  });

  it("reports recognized inline option misuse for strict value options", () => {
    const diagnostics = createCliDiagnostics(["--output", "-l=1"], {
      canonicalOptions: ["--list-checks", "--output"],
      optionAliases: {
        "--list-checks": ["-l"],
      },
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["--list-checks=<value>"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --list-checks=<value>. Supported options: --list-checks, --output, -l."
    );
  });

  it("tracks recognized aliases after strict value options as active", () => {
    const diagnostics = createCliDiagnostics(["--output", "--verify"], {
      canonicalOptions: ["--no-build", "--output"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--no-build", "--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output", "--verify"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(2);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 1,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
  });

  it("keeps strict aliases active when trailing value option resolves later", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "-l", "--output=./final-report.json"],
      {
        canonicalOptions: ["--list-checks", "--output"],
        optionAliases: {
          "--list-checks": ["-l"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual([
      "--output",
      "-l",
      "--output=./final-report.json",
    ]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "-l",
        canonicalOption: "--list-checks",
      },
      {
        token: "--output=./final-report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(3);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-l",
        canonicalOption: "--list-checks",
        index: 1,
      },
      {
        token: "--output=./final-report.json",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(3);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
  });

  it("keeps strict no-build aliases active when trailing only value resolves later", () => {
    const diagnostics = createCliDiagnostics(
      ["--only", "--verify", "--only=client"],
      {
        canonicalOptions: ["--no-build", "--only"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--only"],
        optionsWithStrictValues: ["--only"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual([
      "--only",
      "--verify",
      "--only=client",
    ]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
      {
        token: "--only=client",
        canonicalOption: "--only",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(3);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 1,
      },
      {
        token: "--only=client",
        canonicalOption: "--only",
        index: 2,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(3);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
  });

  it("keeps trailing output resolution with inline no-build misuse in strict output options", () => {
    const diagnostics = createCliDiagnostics(
      ["--output", "--verify=1", "--output=./final-report.json"],
      {
        canonicalOptions: ["--no-build", "--output"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual([
      "--output",
      "--output=./final-report.json",
    ]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--output=./final-report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(2);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "--output=./final-report.json",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
    expect(diagnostics.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --no-build=<value>. Supported options: --no-build, --output, --verify."
    );
  });

  it("keeps strict only parsing active with inline output tokens before trailing only values", () => {
    const diagnostics = createCliDiagnostics(
      ["--only", "--output=./report.json", "--only=client"],
      {
        canonicalOptions: ["--only", "--output"],
        optionsWithValues: ["--only", "--output"],
        optionsWithStrictValues: ["--only"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--only", "--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual([
      "--only",
      "--output=./report.json",
      "--only=client",
    ]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
      },
      {
        token: "--only=client",
        canonicalOption: "--only",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(3);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
        index: 1,
      },
      {
        token: "--only=client",
        canonicalOption: "--only",
        index: 2,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(3);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
  });

  it("tracks recognized canonical options after strict value options as active", () => {
    const diagnostics = createCliDiagnostics(["--output", "--no-build"], {
      canonicalOptions: ["--no-build", "--output"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--output"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--no-build", "--output"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--output", "--no-build"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--no-build",
        canonicalOption: "--no-build",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(2);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "--no-build",
        canonicalOption: "--no-build",
        index: 1,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
  });

  it("tracks recognized no-build aliases after strict only options as active", () => {
    const diagnostics = createCliDiagnostics(["--only", "--verify"], {
      canonicalOptions: ["--no-build", "--only"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
      optionsWithValues: ["--only"],
      optionsWithStrictValues: ["--only"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(diagnostics.activeCliOptionCount).toBe(2);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--only", "--verify"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(2);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 1,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
    expect(diagnostics.unknownOptions).toEqual([]);
    expect(diagnostics.unknownOptionCount).toBe(0);
    expect(diagnostics.unsupportedOptionsError).toBeNull();
  });

  it("reports inline no-build alias misuse after strict only options as unsupported", () => {
    const diagnostics = createCliDiagnostics(["--only", "--verify=1"], {
      canonicalOptions: ["--no-build", "--only"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
      optionsWithValues: ["--only"],
      optionsWithStrictValues: ["--only"],
    });

    expect(diagnostics.activeCliOptions).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(1);
    expect(diagnostics.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --no-build=<value>. Supported options: --no-build, --only, --verify."
    );
  });

  it("tracks strict only telemetry with inline no-build misuse and trailing only token", () => {
    const diagnostics = createCliDiagnostics(
      ["--only", "devEnvironment", "--verify=1", "--only"],
      {
        canonicalOptions: ["--no-build", "--only"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--only"],
        optionsWithStrictValues: ["--only"],
      }
    );

    expect(diagnostics.activeCliOptions).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionCount).toBe(1);
    expect(diagnostics.activeCliOptionTokens).toEqual(["--only"]);
    expect(diagnostics.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(diagnostics.activeCliOptionResolutionCount).toBe(1);
    expect(diagnostics.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--only",
        canonicalOption: "--only",
        index: 3,
      },
    ]);
    expect(diagnostics.activeCliOptionOccurrenceCount).toBe(2);
    expect(diagnostics.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(diagnostics.unknownOptionCount).toBe(1);
    expect(diagnostics.validationErrorCode).toBe("unsupported_options");
    expect(diagnostics.unsupportedOptionsError).toBe(
      "Unsupported option(s): --no-build=<value>. Supported options: --no-build, --only, --verify."
    );
  });

  it("parses active cli option metadata with aliases and option values", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      [
        "--json",
        "--output",
        "-l",
        "--verify",
        "--verify",
        "--output=./report.json",
        "--",
        "--json",
      ],
      {
        canonicalOptions: ["--json", "--no-build", "--output"],
        optionAliases: {
          "--no-build": ["--verify"],
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
      }
    );
    expect(activeMetadata.activeCliOptions).toEqual([
      "--json",
      "--no-build",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionCount).toBe(3);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
      "--verify",
      "--output=./report.json",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(4);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 1,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 3,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 4,
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
        index: 5,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(5);
    const activeMetadataWithMalformedOptionArgsOverride =
      parseActiveCliOptionMetadata(["--json"], {
        canonicalOptions: ["--json", "--output"],
        optionArgs: "--output" as never,
      });
    expect(activeMetadataWithMalformedOptionArgsOverride.activeCliOptions).toEqual([
      "--json",
    ]);
    expect(activeMetadataWithMalformedOptionArgsOverride.activeCliOptionCount).toBe(
      1
    );
    expect(
      activeMetadataWithMalformedOptionArgsOverride.activeCliOptionTokens
    ).toEqual(["--json"]);
    expect(
      activeMetadataWithMalformedOptionArgsOverride.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(
      activeMetadataWithMalformedOptionArgsOverride.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataWithMalformedOptionArgsOverride.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(
      activeMetadataWithMalformedOptionArgsOverride.activeCliOptionOccurrenceCount
    ).toBe(1);
    const activeMetadataWithMalformedArrayOptionArgsOverride =
      parseActiveCliOptionMetadata(["--json"], {
        canonicalOptions: ["--json", "--output"],
        optionArgs: createFullyTrappedStringArray(["--output"]) as never,
      });
    expect(
      activeMetadataWithMalformedArrayOptionArgsOverride.activeCliOptions
    ).toEqual(["--json"]);
    expect(
      activeMetadataWithMalformedArrayOptionArgsOverride.activeCliOptionCount
    ).toBe(1);
    expect(
      activeMetadataWithMalformedArrayOptionArgsOverride.activeCliOptionTokens
    ).toEqual(["--json"]);
    expect(
      activeMetadataWithMalformedArrayOptionArgsOverride.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(
      activeMetadataWithMalformedArrayOptionArgsOverride.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataWithMalformedArrayOptionArgsOverride.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(
      activeMetadataWithMalformedArrayOptionArgsOverride.activeCliOptionOccurrenceCount
    ).toBe(1);
    const activeMetadataWithMixedArrayOptionArgsOverride =
      parseActiveCliOptionMetadata(["--json"], {
        canonicalOptions: ["--json", "--output"],
        optionArgs: ["--output", 1] as never,
      });
    expect(activeMetadataWithMixedArrayOptionArgsOverride.activeCliOptions).toEqual([
      "--json",
    ]);
    expect(activeMetadataWithMixedArrayOptionArgsOverride.activeCliOptionCount).toBe(
      1
    );
    expect(
      activeMetadataWithMixedArrayOptionArgsOverride.activeCliOptionTokens
    ).toEqual(["--json"]);
    expect(
      activeMetadataWithMixedArrayOptionArgsOverride.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(
      activeMetadataWithMixedArrayOptionArgsOverride.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataWithMixedArrayOptionArgsOverride.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(
      activeMetadataWithMixedArrayOptionArgsOverride.activeCliOptionOccurrenceCount
    ).toBe(1);
    const activeMetadataWithMalformedValueMetadataOverride =
      parseActiveCliOptionMetadata(["--output", "-j"], {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        valueOptionTokenMetadata: {
          tokens: createFullyTrappedStringArray(["--output"]) as never,
          unavailable: false,
        } as never,
      });
    expect(
      activeMetadataWithMalformedValueMetadataOverride.activeCliOptions
    ).toEqual(["--output"]);
    expect(
      activeMetadataWithMalformedValueMetadataOverride.activeCliOptionCount
    ).toBe(1);
    expect(
      activeMetadataWithMalformedValueMetadataOverride.activeCliOptionTokens
    ).toEqual(["--output"]);
    expect(
      activeMetadataWithMalformedValueMetadataOverride.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(
      activeMetadataWithMalformedValueMetadataOverride.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataWithMalformedValueMetadataOverride.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(
      activeMetadataWithMalformedValueMetadataOverride.activeCliOptionOccurrenceCount
    ).toBe(1);
    const activeMetadataWithUnavailableValueMetadataOverride =
      parseActiveCliOptionMetadata(["--output", "-j"], {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        valueOptionTokenMetadata: {
          tokens: ["--output"],
          unavailable: true,
        } as never,
      });
    expect(
      activeMetadataWithUnavailableValueMetadataOverride.activeCliOptions
    ).toEqual(["--output", "--json"]);
    expect(
      activeMetadataWithUnavailableValueMetadataOverride.activeCliOptionCount
    ).toBe(2);
    expect(
      activeMetadataWithUnavailableValueMetadataOverride.activeCliOptionTokens
    ).toEqual(["--output", "-j"]);
    expect(
      activeMetadataWithUnavailableValueMetadataOverride.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(
      activeMetadataWithUnavailableValueMetadataOverride.activeCliOptionResolutionCount
    ).toBe(2);
    expect(
      activeMetadataWithUnavailableValueMetadataOverride.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(
      activeMetadataWithUnavailableValueMetadataOverride.activeCliOptionOccurrenceCount
    ).toBe(2);
    const activeMetadataWithUnavailableStrictMetadataOverride =
      parseActiveCliOptionMetadata(["--output", "-j"], {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        strictValueOptionTokenMetadata: {
          tokens: [],
          unavailable: true,
        } as never,
      });
    expect(
      activeMetadataWithUnavailableStrictMetadataOverride.activeCliOptions
    ).toEqual(["--output", "--json"]);
    expect(
      activeMetadataWithUnavailableStrictMetadataOverride.activeCliOptionCount
    ).toBe(2);
    expect(
      activeMetadataWithUnavailableStrictMetadataOverride.activeCliOptionTokens
    ).toEqual(["--output", "-j"]);
    expect(
      activeMetadataWithUnavailableStrictMetadataOverride.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(
      activeMetadataWithUnavailableStrictMetadataOverride.activeCliOptionResolutionCount
    ).toBe(2);
    expect(
      activeMetadataWithUnavailableStrictMetadataOverride.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(
      activeMetadataWithUnavailableStrictMetadataOverride.activeCliOptionOccurrenceCount
    ).toBe(2);
    const activeMetadataWithMalformedStrictMetadataOverride =
      parseActiveCliOptionMetadata(["--output", "-j"], {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: ["--output"],
        strictValueOptionTokenMetadata: {
          tokens: createFullyTrappedStringArray(["--output"]) as never,
          unavailable: false,
        } as never,
      });
    expect(
      activeMetadataWithMalformedStrictMetadataOverride.activeCliOptions
    ).toEqual(["--output", "--json"]);
    expect(
      activeMetadataWithMalformedStrictMetadataOverride.activeCliOptionCount
    ).toBe(2);
    expect(
      activeMetadataWithMalformedStrictMetadataOverride.activeCliOptionTokens
    ).toEqual(["--output", "-j"]);
    expect(
      activeMetadataWithMalformedStrictMetadataOverride.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(
      activeMetadataWithMalformedStrictMetadataOverride.activeCliOptionResolutionCount
    ).toBe(2);
    expect(
      activeMetadataWithMalformedStrictMetadataOverride.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(
      activeMetadataWithMalformedStrictMetadataOverride.activeCliOptionOccurrenceCount
    ).toBe(2);

    const iteratorTrapArgs = ["--json", "--output", "./report.json"];
    Object.defineProperty(iteratorTrapArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const activeMetadataFromIteratorTrapArgs = parseActiveCliOptionMetadata(
      iteratorTrapArgs as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(activeMetadataFromIteratorTrapArgs.activeCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(activeMetadataFromIteratorTrapArgs.activeCliOptionCount).toBe(2);
    expect(activeMetadataFromIteratorTrapArgs.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
    ]);
    expect(activeMetadataFromIteratorTrapArgs.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 1,
      },
    ]);
    expect(activeMetadataFromIteratorTrapArgs.activeCliOptionOccurrenceCount).toBe(
      2
    );
    const activeMetadataFromLengthAndOwnKeysTrapArgs = parseActiveCliOptionMetadata(
      new Proxy(["--json", "--output", "./report.json"], {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }) as never,
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );
    expect(activeMetadataFromLengthAndOwnKeysTrapArgs.activeCliOptions).toEqual([]);
    expect(activeMetadataFromLengthAndOwnKeysTrapArgs.activeCliOptionCount).toBe(0);
    expect(activeMetadataFromLengthAndOwnKeysTrapArgs.activeCliOptionTokens).toEqual(
      []
    );
    expect(
      activeMetadataFromLengthAndOwnKeysTrapArgs.activeCliOptionResolutions
    ).toEqual([]);
    expect(
      activeMetadataFromLengthAndOwnKeysTrapArgs.activeCliOptionResolutionCount
    ).toBe(0);
    expect(
      activeMetadataFromLengthAndOwnKeysTrapArgs.activeCliOptionOccurrences
    ).toEqual([]);
    expect(
      activeMetadataFromLengthAndOwnKeysTrapArgs.activeCliOptionOccurrenceCount
    ).toBe(0);
  });

  it("sanitizes malformed active-cli option metadata inputs", () => {
    const canonicalOptions = ["--json", "--output"];
    Object.defineProperty(canonicalOptions, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const optionAliases = Object.create(null) as {
      readonly "--no-build": string[];
    };
    Object.defineProperty(optionAliases, "--no-build", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("alias trap");
      },
    });
    const optionsWithValues = ["--output"];
    Object.defineProperty(optionsWithValues, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    const activeMetadata = parseActiveCliOptionMetadata(
      ["--json", "--output", "./report.json"],
      {
        canonicalOptions: canonicalOptions as never,
        optionAliases: optionAliases as never,
        optionsWithValues: optionsWithValues as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
    let canonicalActiveReadCount = 0;
    const activeMetadataFromCanonicalReadCount = parseActiveCliOptionMetadata(
      ["--json"],
      {
        canonicalOptions: new Proxy(["--json"], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) {
              throw new Error("iterator trap");
            }
            if (property === "length") {
              return 1;
            }
            if (property === "0") {
              canonicalActiveReadCount += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      }
    );
    expect(activeMetadataFromCanonicalReadCount.activeCliOptions).toEqual([
      "--json",
    ]);
    expect(activeMetadataFromCanonicalReadCount.activeCliOptionCount).toBe(1);
    expect(activeMetadataFromCanonicalReadCount.activeCliOptionTokens).toEqual([
      "--json",
    ]);
    expect(activeMetadataFromCanonicalReadCount.activeCliOptionResolutions).toEqual(
      [
        {
          token: "--json",
          canonicalOption: "--json",
        },
      ]
    );
    expect(
      activeMetadataFromCanonicalReadCount.activeCliOptionResolutionCount
    ).toBe(1);
    expect(activeMetadataFromCanonicalReadCount.activeCliOptionOccurrences).toEqual(
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(
      activeMetadataFromCanonicalReadCount.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(canonicalActiveReadCount).toBe(2);
    let aliasActiveReadCount = 0;
    const activeMetadataFromAliasReadCount = parseActiveCliOptionMetadata(
      ["--verify"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": new Proxy(["--verify"], {
            get(target, property, receiver) {
              if (property === Symbol.iterator) {
                throw new Error("iterator trap");
              }
              if (property === "length") {
                return 1;
              }
              if (property === "0") {
                aliasActiveReadCount += 1;
              }
              return Reflect.get(target, property, receiver);
            },
          }) as never,
        },
      }
    );
    expect(activeMetadataFromAliasReadCount.activeCliOptions).toEqual([
      "--no-build",
    ]);
    expect(activeMetadataFromAliasReadCount.activeCliOptionCount).toBe(1);
    expect(activeMetadataFromAliasReadCount.activeCliOptionTokens).toEqual([
      "--verify",
    ]);
    expect(activeMetadataFromAliasReadCount.activeCliOptionResolutions).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(activeMetadataFromAliasReadCount.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadataFromAliasReadCount.activeCliOptionOccurrences).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(activeMetadataFromAliasReadCount.activeCliOptionOccurrenceCount).toBe(1);
    expect(aliasActiveReadCount).toBe(2);
    let optionArgsActiveReadCount = 0;
    const activeMetadataFromOptionArgsReadCount = parseActiveCliOptionMetadata(
      new Proxy(["--json"], {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (property === "0") {
            optionArgsActiveReadCount += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      }) as never,
      {
        canonicalOptions: ["--json"],
      }
    );
    expect(activeMetadataFromOptionArgsReadCount.activeCliOptions).toEqual([
      "--json",
    ]);
    expect(activeMetadataFromOptionArgsReadCount.activeCliOptionCount).toBe(1);
    expect(activeMetadataFromOptionArgsReadCount.activeCliOptionTokens).toEqual([
      "--json",
    ]);
    expect(
      activeMetadataFromOptionArgsReadCount.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(
      activeMetadataFromOptionArgsReadCount.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataFromOptionArgsReadCount.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(
      activeMetadataFromOptionArgsReadCount.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(optionArgsActiveReadCount).toBe(2);
    let valueMetadataActiveReadCount = 0;
    const activeMetadataFromValueMetadataReadCount =
      parseActiveCliOptionMetadata(["--output", "-j"], {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: new Proxy(["--output"], {
          get(target, property, receiver) {
            if (property === "0") {
              valueMetadataActiveReadCount += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      });
    expect(activeMetadataFromValueMetadataReadCount.activeCliOptions).toEqual([
      "--output",
    ]);
    expect(activeMetadataFromValueMetadataReadCount.activeCliOptionCount).toBe(1);
    expect(activeMetadataFromValueMetadataReadCount.activeCliOptionTokens).toEqual(
      ["--output"]
    );
    expect(
      activeMetadataFromValueMetadataReadCount.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(
      activeMetadataFromValueMetadataReadCount.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataFromValueMetadataReadCount.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(
      activeMetadataFromValueMetadataReadCount.activeCliOptionOccurrenceCount
    ).toBe(1);
    expect(valueMetadataActiveReadCount).toBe(1);
    let strictMetadataActiveReadCount = 0;
    const activeMetadataFromStrictMetadataReadCount =
      parseActiveCliOptionMetadata(["--output", "-j"], {
        canonicalOptions: ["--output", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: ["--output"],
        optionsWithStrictValues: new Proxy(["--output"], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) {
              throw new Error("iterator trap");
            }
            if (property === "length") {
              return 1;
            }
            if (property === "0") {
              strictMetadataActiveReadCount += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        }) as never,
      });
    expect(activeMetadataFromStrictMetadataReadCount.activeCliOptions).toEqual([
      "--output",
      "--json",
    ]);
    expect(activeMetadataFromStrictMetadataReadCount.activeCliOptionCount).toBe(2);
    expect(activeMetadataFromStrictMetadataReadCount.activeCliOptionTokens).toEqual(
      ["--output", "-j"]
    );
    expect(
      activeMetadataFromStrictMetadataReadCount.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(
      activeMetadataFromStrictMetadataReadCount.activeCliOptionResolutionCount
    ).toBe(2);
    expect(
      activeMetadataFromStrictMetadataReadCount.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(
      activeMetadataFromStrictMetadataReadCount.activeCliOptionOccurrenceCount
    ).toBe(2);
    expect(strictMetadataActiveReadCount).toBe(2);
  });

  it("tracks active canonical options when aliases are configured outside canonical list", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--verify"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--no-build": ["--verify"],
      },
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--no-build"]);
    expect(activeMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--verify"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("tracks active options when metadata tokens are whitespace-padded", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--verify"], {
      canonicalOptions: [" --json "],
      optionAliases: {
        " --no-build ": [" --verify "],
      },
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--no-build"]);
    expect(activeMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--verify"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("tracks non-array alias metadata deterministically in active metadata parsing", () => {
    const activeMetadataFromAliasValue = parseActiveCliOptionMetadata(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": new Set(["--verify"]) as never,
        },
      }
    );

    expect(activeMetadataFromAliasValue.activeCliOptions).toEqual([]);
    expect(activeMetadataFromAliasValue.activeCliOptionCount).toBe(0);
    expect(activeMetadataFromAliasValue.activeCliOptionTokens).toEqual([]);
    expect(activeMetadataFromAliasValue.activeCliOptionResolutions).toEqual([]);
    expect(activeMetadataFromAliasValue.activeCliOptionResolutionCount).toBe(0);
    expect(activeMetadataFromAliasValue.activeCliOptionOccurrences).toEqual([]);
    expect(activeMetadataFromAliasValue.activeCliOptionOccurrenceCount).toBe(0);

    const activeMetadataFromCanonicalAliasKey = parseActiveCliOptionMetadata(
      ["--no-build", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": new Set(["--verify"]) as never,
        },
      }
    );

    expect(activeMetadataFromCanonicalAliasKey.activeCliOptions).toEqual([
      "--no-build",
    ]);
    expect(activeMetadataFromCanonicalAliasKey.activeCliOptionCount).toBe(1);
    expect(activeMetadataFromCanonicalAliasKey.activeCliOptionTokens).toEqual([
      "--no-build",
    ]);
    expect(activeMetadataFromCanonicalAliasKey.activeCliOptionResolutions).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
      },
    ]);
    expect(activeMetadataFromCanonicalAliasKey.activeCliOptionResolutionCount).toBe(
      1
    );
    expect(activeMetadataFromCanonicalAliasKey.activeCliOptionOccurrences).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(activeMetadataFromCanonicalAliasKey.activeCliOptionOccurrenceCount).toBe(
      1
    );
    const activeMetadataFromPrimitiveAliasValue = parseActiveCliOptionMetadata(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": "--verify" as never,
        },
      }
    );
    expect(activeMetadataFromPrimitiveAliasValue.activeCliOptions).toEqual([]);
    expect(activeMetadataFromPrimitiveAliasValue.activeCliOptionCount).toBe(0);
    expect(activeMetadataFromPrimitiveAliasValue.activeCliOptionTokens).toEqual([]);
    expect(activeMetadataFromPrimitiveAliasValue.activeCliOptionResolutions).toEqual(
      []
    );
    expect(
      activeMetadataFromPrimitiveAliasValue.activeCliOptionResolutionCount
    ).toBe(0);
    expect(activeMetadataFromPrimitiveAliasValue.activeCliOptionOccurrences).toEqual(
      []
    );
    expect(
      activeMetadataFromPrimitiveAliasValue.activeCliOptionOccurrenceCount
    ).toBe(0);
    const activeMetadataFromPrimitiveCanonicalAliasKey =
      parseActiveCliOptionMetadata(["--no-build", "--mystery"], {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": "--verify" as never,
        },
      });
    expect(activeMetadataFromPrimitiveCanonicalAliasKey.activeCliOptions).toEqual([
      "--no-build",
    ]);
    expect(activeMetadataFromPrimitiveCanonicalAliasKey.activeCliOptionCount).toBe(
      1
    );
    expect(activeMetadataFromPrimitiveCanonicalAliasKey.activeCliOptionTokens).toEqual(
      ["--no-build"]
    );
    expect(
      activeMetadataFromPrimitiveCanonicalAliasKey.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      activeMetadataFromPrimitiveCanonicalAliasKey.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataFromPrimitiveCanonicalAliasKey.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--no-build",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      activeMetadataFromPrimitiveCanonicalAliasKey.activeCliOptionOccurrenceCount
    ).toBe(1);
    const activeMetadataFromMapAliasMetadata = parseActiveCliOptionMetadata(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: new Map<string, string[]>([
          ["--no-build", ["--verify"]],
        ]) as never,
      }
    );
    expect(activeMetadataFromMapAliasMetadata.activeCliOptions).toEqual([]);
    expect(activeMetadataFromMapAliasMetadata.activeCliOptionCount).toBe(0);
    expect(activeMetadataFromMapAliasMetadata.activeCliOptionTokens).toEqual([]);
    expect(activeMetadataFromMapAliasMetadata.activeCliOptionResolutions).toEqual(
      []
    );
    expect(activeMetadataFromMapAliasMetadata.activeCliOptionResolutionCount).toBe(
      0
    );
    expect(activeMetadataFromMapAliasMetadata.activeCliOptionOccurrences).toEqual(
      []
    );
    expect(activeMetadataFromMapAliasMetadata.activeCliOptionOccurrenceCount).toBe(
      0
    );
    const activeMetadataFromMixedAliasMetadata = parseActiveCliOptionMetadata(
      ["--verify", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify", 1] as never,
        },
      }
    );
    expect(activeMetadataFromMixedAliasMetadata.activeCliOptions).toEqual([
      "--no-build",
    ]);
    expect(activeMetadataFromMixedAliasMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadataFromMixedAliasMetadata.activeCliOptionTokens).toEqual([
      "--verify",
    ]);
    expect(activeMetadataFromMixedAliasMetadata.activeCliOptionResolutions).toEqual(
      [
        {
          token: "--verify",
          canonicalOption: "--no-build",
        },
      ]
    );
    expect(
      activeMetadataFromMixedAliasMetadata.activeCliOptionResolutionCount
    ).toBe(1);
    expect(activeMetadataFromMixedAliasMetadata.activeCliOptionOccurrences).toEqual(
      [
        {
          token: "--verify",
          canonicalOption: "--no-build",
          index: 0,
        },
      ]
    );
    expect(
      activeMetadataFromMixedAliasMetadata.activeCliOptionOccurrenceCount
    ).toBe(1);
  });

  it("tracks non-array canonical metadata deterministically in active metadata parsing", () => {
    const nonArrayCanonicalOptions = new Set(["--json", "--output"]);
    const activeMetadataFromNonArrayCanonicalOptions = parseActiveCliOptionMetadata(
      ["--json", "--output", "./report.json"],
      {
        canonicalOptions: nonArrayCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );

    expect(activeMetadataFromNonArrayCanonicalOptions.activeCliOptions).toEqual([]);
    expect(activeMetadataFromNonArrayCanonicalOptions.activeCliOptionCount).toBe(0);
    expect(activeMetadataFromNonArrayCanonicalOptions.activeCliOptionTokens).toEqual(
      []
    );
    expect(
      activeMetadataFromNonArrayCanonicalOptions.activeCliOptionResolutions
    ).toEqual([]);
    expect(
      activeMetadataFromNonArrayCanonicalOptions.activeCliOptionResolutionCount
    ).toBe(0);
    expect(
      activeMetadataFromNonArrayCanonicalOptions.activeCliOptionOccurrences
    ).toEqual([]);
    expect(
      activeMetadataFromNonArrayCanonicalOptions.activeCliOptionOccurrenceCount
    ).toBe(0);

    const activeMetadataFromNonArrayCanonicalOptionsWithAliasFallback =
      parseActiveCliOptionMetadata(["--verify", "--json"], {
        canonicalOptions: nonArrayCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(
      activeMetadataFromNonArrayCanonicalOptionsWithAliasFallback.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      activeMetadataFromNonArrayCanonicalOptionsWithAliasFallback.activeCliOptionCount
    ).toBe(1);
    expect(
      activeMetadataFromNonArrayCanonicalOptionsWithAliasFallback.activeCliOptionTokens
    ).toEqual(["--verify"]);
    expect(
      activeMetadataFromNonArrayCanonicalOptionsWithAliasFallback.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      activeMetadataFromNonArrayCanonicalOptionsWithAliasFallback.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataFromNonArrayCanonicalOptionsWithAliasFallback.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      activeMetadataFromNonArrayCanonicalOptionsWithAliasFallback.activeCliOptionOccurrenceCount
    ).toBe(1);
    const activeMetadataFromPrimitiveCanonicalOptions = parseActiveCliOptionMetadata(
      ["--json", "--output", "./report.json"],
      {
        canonicalOptions: "--json" as never,
        optionsWithValues: ["--output"],
      }
    );
    expect(activeMetadataFromPrimitiveCanonicalOptions.activeCliOptions).toEqual(
      []
    );
    expect(activeMetadataFromPrimitiveCanonicalOptions.activeCliOptionCount).toBe(
      0
    );
    expect(activeMetadataFromPrimitiveCanonicalOptions.activeCliOptionTokens).toEqual(
      []
    );
    expect(
      activeMetadataFromPrimitiveCanonicalOptions.activeCliOptionResolutions
    ).toEqual([]);
    expect(
      activeMetadataFromPrimitiveCanonicalOptions.activeCliOptionResolutionCount
    ).toBe(0);
    expect(
      activeMetadataFromPrimitiveCanonicalOptions.activeCliOptionOccurrences
    ).toEqual([]);
    expect(
      activeMetadataFromPrimitiveCanonicalOptions.activeCliOptionOccurrenceCount
    ).toBe(0);
    const activeMetadataFromPrimitiveCanonicalOptionsWithAliasFallback =
      parseActiveCliOptionMetadata(["--verify", "--json"], {
        canonicalOptions: "--json" as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(
      activeMetadataFromPrimitiveCanonicalOptionsWithAliasFallback.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      activeMetadataFromPrimitiveCanonicalOptionsWithAliasFallback.activeCliOptionCount
    ).toBe(1);
    expect(
      activeMetadataFromPrimitiveCanonicalOptionsWithAliasFallback.activeCliOptionTokens
    ).toEqual(["--verify"]);
    expect(
      activeMetadataFromPrimitiveCanonicalOptionsWithAliasFallback.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      activeMetadataFromPrimitiveCanonicalOptionsWithAliasFallback.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      activeMetadataFromPrimitiveCanonicalOptionsWithAliasFallback.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      activeMetadataFromPrimitiveCanonicalOptionsWithAliasFallback.activeCliOptionOccurrenceCount
    ).toBe(1);
  });

  it("tracks alias-defined canonical options that consume values", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--output", "./report.json", "--mystery"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--output"],
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--output"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("tracks alias tokens for canonical options that consume values", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--report-path=./report.json"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--output"],
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path=./report.json"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path=./report.json",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("tracks fully trapped alias token lists as canonical keys in active metadata parsing", () => {
    const fullyTrappedAliasTokens = createFullyTrappedStringArray([
      "-o",
      "--only-long",
    ]);
    const activeMetadata = parseActiveCliOptionMetadata(["--only", "--mystery"], {
      canonicalOptions: ["--output"],
      optionAliases: {
        "--only": fullyTrappedAliasTokens as never,
      },
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--only"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(1);
    const aliasValueActiveMetadata = parseActiveCliOptionMetadata(
      ["-o", "--mystery"],
      {
        canonicalOptions: ["--output"],
        optionAliases: {
          "--only": fullyTrappedAliasTokens as never,
        },
      }
    );
    expect(aliasValueActiveMetadata.activeCliOptions).toEqual([]);
    expect(aliasValueActiveMetadata.activeCliOptionCount).toBe(0);
    expect(aliasValueActiveMetadata.activeCliOptionTokens).toEqual([]);
    expect(aliasValueActiveMetadata.activeCliOptionResolutions).toEqual([]);
    expect(aliasValueActiveMetadata.activeCliOptionResolutionCount).toBe(0);
    expect(aliasValueActiveMetadata.activeCliOptionOccurrences).toEqual([]);
    expect(aliasValueActiveMetadata.activeCliOptionOccurrenceCount).toBe(0);
  });

  it("tracks alias-valued options when optionsWithValues uses alias tokens", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--report-path=./report.json"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--output": ["--report-path"],
        },
        optionsWithValues: ["--report-path"],
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path=./report.json"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path=./report.json",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("ignores inline misuse tokens that appear after option terminator", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--json", "--output=./report.json", "--", "--json=1", "--output=./ignored.json"],
      {
        canonicalOptions: ["--json", "--output"],
        optionsWithValues: ["--output"],
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--json",
      "--output=./report.json",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("ignores unsupported value-option metadata tokens in active metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--mystery=alpha"], {
      canonicalOptions: ["--json"],
      optionsWithValues: ["--mystery"],
    });

    expect(activeMetadata.activeCliOptions).toEqual([]);
    expect(activeMetadata.activeCliOptionCount).toBe(0);
    expect(activeMetadata.activeCliOptionTokens).toEqual([]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(0);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(0);
  });

  it("salvages length-trapped canonical option metadata in active metadata parsing", () => {
    const fullyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(
        ["--json", "--output"],
        2
      );
    const fullyRecoverableActiveMetadata = parseActiveCliOptionMetadata(
      ["--json", "--output", "./report.json"],
      {
        canonicalOptions:
          fullyRecoverableLengthTrappedCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );

    expect(fullyRecoverableActiveMetadata.activeCliOptions).toEqual([
      "--json",
      "--output",
    ]);
    expect(fullyRecoverableActiveMetadata.activeCliOptionCount).toBe(2);
    expect(fullyRecoverableActiveMetadata.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
    ]);
    expect(fullyRecoverableActiveMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(fullyRecoverableActiveMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(fullyRecoverableActiveMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 1,
      },
    ]);
    expect(fullyRecoverableActiveMetadata.activeCliOptionOccurrenceCount).toBe(2);

    const partiallyRecoverableLengthTrappedCanonicalOptions =
      createLengthTrappedPartiallyRecoveredStringArray(["--json", "--output"]);
    const partiallyRecoverableActiveMetadata = parseActiveCliOptionMetadata(
      ["--json", "--output", "./report.json"],
      {
        canonicalOptions:
          partiallyRecoverableLengthTrappedCanonicalOptions as never,
        optionsWithValues: ["--output"],
      }
    );

    expect(partiallyRecoverableActiveMetadata.activeCliOptions).toEqual([
      "--json",
    ]);
    expect(partiallyRecoverableActiveMetadata.activeCliOptionCount).toBe(1);
    expect(partiallyRecoverableActiveMetadata.activeCliOptionTokens).toEqual([
      "--json",
    ]);
    expect(partiallyRecoverableActiveMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(partiallyRecoverableActiveMetadata.activeCliOptionResolutionCount).toBe(
      1
    );
    expect(partiallyRecoverableActiveMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(partiallyRecoverableActiveMetadata.activeCliOptionOccurrenceCount).toBe(
      1
    );
    const partiallyRecoverableActiveMetadataWithAliasFallback =
      parseActiveCliOptionMetadata(["--verify", "--json"], {
        canonicalOptions:
          partiallyRecoverableLengthTrappedCanonicalOptions as never,
        optionAliases: {
          "--no-build": ["--verify"],
        },
      });
    expect(partiallyRecoverableActiveMetadataWithAliasFallback.activeCliOptions).toEqual(
      ["--json", "--no-build"]
    );
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallback.activeCliOptionCount
    ).toBe(2);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallback.activeCliOptionTokens
    ).toEqual(["--verify", "--json"]);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallback.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallback.activeCliOptionResolutionCount
    ).toBe(2);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallback.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
      {
        token: "--json",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallback.activeCliOptionOccurrenceCount
    ).toBe(2);
    const partiallyRecoverableActiveMetadataWithAliasFallbackAndDashValue =
      parseActiveCliOptionMetadata(
        ["--verify", "--output", "-artifact-report.json"],
        {
          canonicalOptions:
            partiallyRecoverableLengthTrappedCanonicalOptions as never,
          optionAliases: {
            "--no-build": ["--verify"],
          },
          optionsWithValues: ["--output"],
          optionsWithStrictValues: ["--output"],
        }
      );
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallbackAndDashValue.activeCliOptions
    ).toEqual(["--no-build"]);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallbackAndDashValue.activeCliOptionCount
    ).toBe(1);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallbackAndDashValue.activeCliOptionTokens
    ).toEqual(["--verify"]);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallbackAndDashValue.activeCliOptionResolutions
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallbackAndDashValue.activeCliOptionResolutionCount
    ).toBe(1);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallbackAndDashValue.activeCliOptionOccurrences
    ).toEqual([
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 0,
      },
    ]);
    expect(
      partiallyRecoverableActiveMetadataWithAliasFallbackAndDashValue.activeCliOptionOccurrenceCount
    ).toBe(1);
  });

  it("keeps pre-terminator aliases active while ignoring post-terminator alias misuse", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--json", "--verify", "--", "--verify=1", "--mystery=alpha"],
      {
        canonicalOptions: ["--json"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--no-build"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--json", "--verify"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("excludes inline misuse tokens from active option metadata", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--json=1", "--verify=2", "--output=./report.json"],
      {
        canonicalOptions: ["--json", "--no-build", "--output"],
        optionAliases: {
          "--no-build": ["--verify"],
        },
        optionsWithValues: ["--output"],
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--output=./report.json"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--output=./report.json",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("skips alias-shaped value tokens for canonical options that consume values", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--report-path", "-j"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--output": ["--report-path"],
        "--json": ["-j"],
      },
      optionsWithValues: ["--output"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(1);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("treats recognized option tokens as active for strict value options in metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--report-path", "-j"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--output": ["--report-path"],
        "--json": ["-j"],
      },
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--output"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("preserves strict subsets for active metadata when strict token lists are mixed", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: ["--output", 1] as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("preserves strict subsets for active metadata when strict token lists are partially recovered from traps", () => {
    const partiallyRecoveredStrictValueOptions = createPartiallyRecoveredStringArray(
      ["--output", "--only"]
    );
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: partiallyRecoveredStrictValueOptions as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("preserves strict subsets for active metadata when strict token lists are partially recovered from length traps", () => {
    const lengthTrappedPartiallyRecoveredStrictValueOptions =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--output",
        "--only",
      ]);
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictValueOptions as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
    const inlineShortActiveMetadata = parseActiveCliOptionMetadata(
      ["--output", "-l=1", "--only", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues:
          lengthTrappedPartiallyRecoveredStrictValueOptions as never,
      }
    );

    expect(inlineShortActiveMetadata.activeCliOptions).toEqual([
      "--output",
      "--only",
    ]);
    expect(inlineShortActiveMetadata.activeCliOptionCount).toBe(2);
    expect(inlineShortActiveMetadata.activeCliOptionTokens).toEqual([
      "--output",
      "--only",
    ]);
    expect(inlineShortActiveMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(inlineShortActiveMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(inlineShortActiveMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "--only",
        canonicalOption: "--only",
        index: 2,
      },
    ]);
    expect(inlineShortActiveMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("preserves recoverable strict subsets for active metadata when value metadata is unavailable", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
        optionsWithStrictValues: ["--only"],
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("applies partial strict guards for active metadata when value metadata is partially recovered", () => {
    const partiallyRecoveredValueOptions = createPartiallyRecoveredStringArray([
      "--output",
      "--only",
    ]);
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("applies partial strict guards for active metadata when value metadata is partially recovered from length traps", () => {
    const lengthTrappedPartiallyRecoveredValueOptions =
      createLengthTrappedPartiallyRecoveredStringArray([
        "--output",
        "--only",
      ]);
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
    const inlineShortActiveMetadata = parseActiveCliOptionMetadata(
      ["--output", "-l=1", "--only", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: lengthTrappedPartiallyRecoveredValueOptions as never,
      }
    );

    expect(inlineShortActiveMetadata.activeCliOptions).toEqual([
      "--output",
      "--only",
    ]);
    expect(inlineShortActiveMetadata.activeCliOptionCount).toBe(2);
    expect(inlineShortActiveMetadata.activeCliOptionTokens).toEqual([
      "--output",
      "--only",
    ]);
    expect(inlineShortActiveMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(inlineShortActiveMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(inlineShortActiveMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "--only",
        canonicalOption: "--only",
        index: 2,
      },
    ]);
    expect(inlineShortActiveMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("preserves strict subsets for active metadata when value and strict metadata are both partially recovered", () => {
    const partiallyRecoveredValueOptions = createPartiallyRecoveredStringArray([
      "--output",
      "--only",
    ]);
    const partiallyRecoveredStrictSubsetOptions = createPartiallyRecoveredStringArray(
      ["--only", "--output"]
    );
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: partiallyRecoveredValueOptions as never,
        optionsWithStrictValues: partiallyRecoveredStrictSubsetOptions as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("applies conservative strict guards for active metadata when strict metadata is unavailable", () => {
    const shortTokenActiveMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      }
    );

    expect(shortTokenActiveMetadata.activeCliOptions).toEqual(["--only"]);
    expect(shortTokenActiveMetadata.activeCliOptionCount).toBe(1);
    expect(shortTokenActiveMetadata.activeCliOptionTokens).toEqual(["--only"]);
    expect(shortTokenActiveMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(shortTokenActiveMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(shortTokenActiveMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(shortTokenActiveMetadata.activeCliOptionOccurrenceCount).toBe(1);

    const dashValueActiveMetadata = parseActiveCliOptionMetadata(
      ["--only", "-artifact-report.json"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only", 1] as never,
        optionsWithStrictValues: ["--mystery"],
      }
    );

    expect(dashValueActiveMetadata.activeCliOptions).toEqual(["--only"]);
    expect(dashValueActiveMetadata.activeCliOptionCount).toBe(1);
    expect(dashValueActiveMetadata.activeCliOptionTokens).toEqual(["--only"]);
    expect(dashValueActiveMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(dashValueActiveMetadata.activeCliOptionResolutionCount).toBe(1);
    expect(dashValueActiveMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(dashValueActiveMetadata.activeCliOptionOccurrenceCount).toBe(1);
  });

  it("treats recognized option tokens as active with primitive strict metadata in metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--report-path", "-j"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--output": ["--report-path"],
        "--json": ["-j"],
      },
      optionsWithValues: ["--output"],
      optionsWithStrictValues: "--output" as never,
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("preserves strict guards across value options with primitive strict metadata in metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: "--output" as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("preserves strict guards across value options with set strict metadata in metadata parsing", () => {
    const setStrictValueMetadata = new Set(["--output"]);
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: setStrictValueMetadata as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("preserves strict guards across value options with map strict metadata in metadata parsing", () => {
    const mapStrictValueMetadata = new Map<string, boolean>([
      ["--output", true],
    ]);
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--only", "-l", "--output", "-s"],
      {
        canonicalOptions: ["--output", "--only"],
        optionsWithValues: ["--output", "--only"],
        optionsWithStrictValues: mapStrictValueMetadata as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual(["--output", "--only"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--only",
      "--output",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("keeps sibling aliases active when value metadata is a map strict subset in metadata parsing", () => {
    const mapValueMetadata = new Map<string, boolean>([["--output", true]]);
    const activeMetadata = parseActiveCliOptionMetadata(["--only", "-j"], {
      canonicalOptions: ["--output", "--only", "--json"],
      optionAliases: {
        "--json": ["-j"],
      },
      optionsWithValues: mapValueMetadata as never,
      optionsWithStrictValues: ["--output"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--only", "--json"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--only", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("keeps sibling aliases active when value metadata is a set strict subset in metadata parsing", () => {
    const setValueMetadata = new Set(["--output"]);
    const activeMetadata = parseActiveCliOptionMetadata(["--only", "-j"], {
      canonicalOptions: ["--output", "--only", "--json"],
      optionAliases: {
        "--json": ["-j"],
      },
      optionsWithValues: setValueMetadata as never,
      optionsWithStrictValues: ["--output"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--only", "--json"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--only", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("keeps output sibling aliases active when inverse set strict subset is used in metadata parsing", () => {
    const setValueMetadata = new Set(["--output"]);
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--output", "-j", "--only", "-l"],
      {
        canonicalOptions: ["--output", "--only", "--json"],
        optionAliases: {
          "--json": ["-j"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["--only"],
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual([
      "--output",
      "--only",
      "--json",
    ]);
    expect(activeMetadata.activeCliOptionCount).toBe(3);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--output",
      "-j",
      "--only",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
      {
        token: "--only",
        canonicalOption: "--only",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(3);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--output",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
      {
        token: "--only",
        canonicalOption: "--only",
        index: 2,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(3);
  });

  it("keeps alias strict subsets active when value metadata is a set in metadata parsing", () => {
    const setValueMetadata = new Set(["--output"]);
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--report-path", "-o", "-l", "-j"],
      {
        canonicalOptions: ["--output", "--only", "--json"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
          "--json": ["-j"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: ["-o"],
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual([
      "--output",
      "--only",
      "--json",
    ]);
    expect(activeMetadata.activeCliOptionCount).toBe(3);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--report-path",
      "-o",
      "-j",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-o",
        canonicalOption: "--only",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(3);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-o",
        canonicalOption: "--only",
        index: 1,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 3,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(3);
  });

  it("keeps length-trapped alias strict subsets active when value metadata is a set in metadata parsing", () => {
    const setValueMetadata = new Set(["--output"]);
    const strictAliasSubsetFromLengthTraps =
      createLengthTrappedPartiallyRecoveredStringArray(["-o", "--output"]);
    const activeMetadata = parseActiveCliOptionMetadata(
      ["--report-path", "-o", "-l", "-j"],
      {
        canonicalOptions: ["--output", "--only", "--json"],
        optionAliases: {
          "--only": ["-o"],
          "--output": ["--report-path"],
          "--json": ["-j"],
        },
        optionsWithValues: setValueMetadata as never,
        optionsWithStrictValues: strictAliasSubsetFromLengthTraps as never,
      }
    );

    expect(activeMetadata.activeCliOptions).toEqual([
      "--output",
      "--only",
      "--json",
    ]);
    expect(activeMetadata.activeCliOptionCount).toBe(3);
    expect(activeMetadata.activeCliOptionTokens).toEqual([
      "--report-path",
      "-o",
      "-j",
    ]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-o",
        canonicalOption: "--only",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(3);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-o",
        canonicalOption: "--only",
        index: 1,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 3,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(3);
  });

  it("treats recognized option tokens as active with unsupported strict metadata in metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--report-path", "-j"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--output": ["--report-path"],
        "--json": ["-j"],
      },
      optionsWithValues: ["--output"],
      optionsWithStrictValues: ["--mystery"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("treats recognized option tokens as active with mixed value metadata and unsupported strict metadata in metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--report-path", "-j"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--output": ["--report-path"],
        "--json": ["-j"],
      },
      optionsWithValues: ["--output", 1] as never,
      optionsWithStrictValues: ["--mystery"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("treats recognized option tokens as active with unresolved value metadata and supported strict metadata in metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--report-path", "-j"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--output": ["--report-path"],
        "--json": ["-j"],
      },
      optionsWithValues: ["--mystery"],
      optionsWithStrictValues: ["--output"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("treats recognized option tokens as active with strict metadata only in metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--report-path", "-j"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--output": ["--report-path"],
        "--json": ["-j"],
      },
      optionsWithStrictValues: ["--output"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
  });

  it("treats recognized option tokens as active with primitive value metadata in metadata parsing", () => {
    const activeMetadata = parseActiveCliOptionMetadata(["--report-path", "-j"], {
      canonicalOptions: ["--json"],
      optionAliases: {
        "--output": ["--report-path"],
        "--json": ["-j"],
      },
      optionsWithValues: "--output" as never,
      optionsWithStrictValues: ["--output"],
    });

    expect(activeMetadata.activeCliOptions).toEqual(["--json", "--output"]);
    expect(activeMetadata.activeCliOptionCount).toBe(2);
    expect(activeMetadata.activeCliOptionTokens).toEqual(["--report-path", "-j"]);
    expect(activeMetadata.activeCliOptionResolutions).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
      },
      {
        token: "-j",
        canonicalOption: "--json",
      },
    ]);
    expect(activeMetadata.activeCliOptionResolutionCount).toBe(2);
    expect(activeMetadata.activeCliOptionOccurrences).toEqual([
      {
        token: "--report-path",
        canonicalOption: "--output",
        index: 0,
      },
      {
        token: "-j",
        canonicalOption: "--json",
        index: 1,
      },
    ]);
    expect(activeMetadata.activeCliOptionOccurrenceCount).toBe(2);
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

  it("clamps timed report duration when clock regresses", () => {
    const nowValues = [2_000, 1_000];
    let nowIndex = 0;
    const withTiming = createTimedReportBuilder(
      () => {
        const currentValue =
          nowValues[nowIndex] ?? nowValues[nowValues.length - 1];
        nowIndex += 1;
        return currentValue;
      },
      (value) => `iso-${value}`
    );

    expect(withTiming({ passed: true, exitCode: 0 })).toEqual({
      passed: true,
      exitCode: 0,
      startedAt: "iso-2000",
      endedAt: "iso-1000",
      durationMs: 0,
    });
  });

  it("counts record entries for map-style metadata", () => {
    expect(countRecordEntries({})).toBe(0);
    expect(countRecordEntries({ a: 1, b: 2 })).toBe(2);
    expect(countRecordEntries([])).toBe(0);
    expect(countRecordEntries(null)).toBe(0);
    expect(countRecordEntries("text")).toBe(0);
    expect(countRecordEntries(10)).toBe(0);
    expect(countRecordEntries(true)).toBe(0);
    const trapRecord = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
      }
    );
    expect(countRecordEntries(trapRecord)).toBe(0);
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
      passedSteps: ["step-a"],
      failedSteps: ["step-b"],
      skippedSteps: ["step-c"],
    });
  });

  it("summarizes step outcomes with malformed/trap step entries", () => {
    const stepWithTrapName = Object.create(null) as {
      readonly name: string;
      readonly passed: boolean;
      readonly skipped: boolean;
    };
    Object.defineProperty(stepWithTrapName, "name", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("name trap");
      },
    });
    Object.defineProperty(stepWithTrapName, "passed", {
      configurable: true,
      enumerable: true,
      value: false,
    });
    Object.defineProperty(stepWithTrapName, "skipped", {
      configurable: true,
      enumerable: true,
      value: false,
    });
    const iteratorTrapSteps = [{ name: "step-a", passed: true, skipped: false }];
    Object.defineProperty(iteratorTrapSteps, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    expect(
      summarizeStepResults([
        { name: "step-a", passed: true, skipped: false },
        stepWithTrapName,
        { name: "step-c", passed: false, skipped: false },
      ])
    ).toEqual({
      totalSteps: 3,
      passedStepCount: 1,
      failedStepCount: 1,
      skippedStepCount: 0,
      firstFailedStep: "step-c",
      passedSteps: ["step-a"],
      failedSteps: ["step-c"],
      skippedSteps: [],
    });
    expect(summarizeStepResults(iteratorTrapSteps as never)).toEqual({
      totalSteps: 1,
      passedStepCount: 1,
      failedStepCount: 0,
      skippedStepCount: 0,
      firstFailedStep: null,
      passedSteps: ["step-a"],
      failedSteps: [],
      skippedSteps: [],
    });
    let statefulUndefinedPrefixReadCount = 0;
    const statefulUndefinedPrefixSteps = new Proxy(
      [
        { name: "step-a", passed: true, skipped: false },
        { name: "step-b", passed: false, skipped: false },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulUndefinedPrefixReadCount += 1;
            if (statefulUndefinedPrefixReadCount === 1) {
              return undefined;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(statefulUndefinedPrefixSteps as never)).toEqual({
      totalSteps: 2,
      passedStepCount: 1,
      failedStepCount: 1,
      skippedStepCount: 0,
      firstFailedStep: "step-b",
      passedSteps: ["step-a"],
      failedSteps: ["step-b"],
      skippedSteps: [],
    });
    let statefulNullPrefixReadCount = 0;
    const statefulNullPrefixSteps = new Proxy(
      [
        { name: "step-a", passed: true, skipped: false },
        { name: "step-b", passed: false, skipped: false },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNullPrefixReadCount += 1;
            if (statefulNullPrefixReadCount === 1) {
              return null;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(statefulNullPrefixSteps as never)).toEqual({
      totalSteps: 2,
      passedStepCount: 1,
      failedStepCount: 1,
      skippedStepCount: 0,
      firstFailedStep: "step-b",
      passedSteps: ["step-a"],
      failedSteps: ["step-b"],
      skippedSteps: [],
    });
    let statefulNumericPrefixStepReadCount = 0;
    const statefulNumericPrefixSteps = new Proxy(
      [
        { name: "step-a", passed: true, skipped: false },
        { name: "step-b", passed: false, skipped: false },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNumericPrefixStepReadCount += 1;
            if (statefulNumericPrefixStepReadCount === 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(statefulNumericPrefixSteps as never)).toEqual({
      totalSteps: 2,
      passedStepCount: 1,
      failedStepCount: 1,
      skippedStepCount: 0,
      firstFailedStep: "step-b",
      passedSteps: ["step-a"],
      failedSteps: ["step-b"],
      skippedSteps: [],
    });
    let statefulObjectReplacementStepReadCount = 0;
    const statefulObjectReplacementSteps = new Proxy(
      [{ name: "step-a", passed: true, skipped: false }],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementStepReadCount += 1;
            if (statefulObjectReplacementStepReadCount > 1) {
              return { name: "step-b", passed: false, skipped: false };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(statefulObjectReplacementSteps as never)).toEqual({
      totalSteps: 1,
      passedStepCount: 1,
      failedStepCount: 0,
      skippedStepCount: 0,
      firstFailedStep: null,
      passedSteps: ["step-a"],
      failedSteps: [],
      skippedSteps: [],
    });
    let equalLengthStepFailureIndexZeroReadCount = 0;
    let equalLengthStepFailureIndexOneReadCount = 0;
    const equalLengthReplacementSteps = new Proxy(
      [
        { name: "step-a", passed: true, skipped: false },
        { name: "step-b", passed: false, skipped: false },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            equalLengthStepFailureIndexZeroReadCount += 1;
            if (equalLengthStepFailureIndexZeroReadCount === 1) {
              return 1;
            }
          }
          if (propertyKey === "1") {
            equalLengthStepFailureIndexOneReadCount += 1;
            if (equalLengthStepFailureIndexOneReadCount > 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(equalLengthReplacementSteps as never)).toEqual({
      totalSteps: 2,
      passedStepCount: 1,
      failedStepCount: 1,
      skippedStepCount: 0,
      firstFailedStep: "step-b",
      passedSteps: ["step-a"],
      failedSteps: ["step-b"],
      skippedSteps: [],
    });

    const cappedSupplementedStepsTarget: Array<
      number | { readonly name: string; readonly passed: boolean; readonly skipped: boolean }
    > = [];
    cappedSupplementedStepsTarget[0] = {
      name: "step-a",
      passed: true,
      skipped: false,
    };
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedStepsTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedStepsTarget[5_000 + index] = {
        name: `step-k${index}`,
        passed: true,
        skipped: false,
      };
    }
    const cappedSupplementedStepKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedSteps = new Proxy(cappedSupplementedStepsTarget, {
      ownKeys() {
        return [...cappedSupplementedStepKeyList, "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const cappedSupplementedStepSummary = summarizeStepResults(
      cappedSupplementedSteps as never
    );
    expect(cappedSupplementedStepSummary.totalSteps).toBe(1_024);
    expect(cappedSupplementedStepSummary.passedStepCount).toBe(1_024);
    expect(cappedSupplementedStepSummary.failedStepCount).toBe(0);
    expect(cappedSupplementedStepSummary.skippedStepCount).toBe(0);
    expect(cappedSupplementedStepSummary.firstFailedStep).toBeNull();
    expect(cappedSupplementedStepSummary.passedSteps[0]).toBe("step-a");
    expect(cappedSupplementedStepSummary.passedSteps.includes("step-k1022")).toBe(
      true
    );
    expect(cappedSupplementedStepSummary.passedSteps.includes("step-k1023")).toBe(
      false
    );
    expect(cappedSupplementedStepSummary.failedSteps).toEqual([]);
    expect(cappedSupplementedStepSummary.skippedSteps).toEqual([]);

    const uncappedSupplementedStepsTarget: Array<
      number | { readonly name: string; readonly passed: boolean; readonly skipped: boolean }
    > = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedSupplementedStepsTarget[index] = {
        name: `step-low${index}`,
        passed: true,
        skipped: false,
      };
      uncappedSupplementedStepsTarget[5_000 + index] = {
        name: `step-high${index}`,
        passed: true,
        skipped: false,
      };
    }
    Object.defineProperty(uncappedSupplementedStepsTarget, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: function* () {
        for (let index = 0; index < 450; index += 1) {
          yield index;
        }
        for (let index = 0; index < 450; index += 1) {
          yield uncappedSupplementedStepsTarget[5_000 + index];
        }
      },
    });
    const uncappedSupplementedStepSummary = summarizeStepResults(
      uncappedSupplementedStepsTarget as never
    );
    expect(uncappedSupplementedStepSummary.totalSteps).toBe(1_024);
    expect(uncappedSupplementedStepSummary.passedStepCount).toBe(1_024);
    expect(uncappedSupplementedStepSummary.failedStepCount).toBe(0);
    expect(uncappedSupplementedStepSummary.skippedStepCount).toBe(0);
    expect(uncappedSupplementedStepSummary.firstFailedStep).toBeNull();
    expect(uncappedSupplementedStepSummary.passedSteps[0]).toBe("step-low0");
    expect(uncappedSupplementedStepSummary.passedSteps.includes("step-high123")).toBe(
      true
    );
    expect(uncappedSupplementedStepSummary.failedSteps).toEqual([]);
    expect(uncappedSupplementedStepSummary.skippedSteps).toEqual([]);

    const uncappedDisjointSupplementedStepsTarget: Array<
      { readonly name: string; readonly passed: boolean; readonly skipped: boolean }
    > = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedDisjointSupplementedStepsTarget[5_000 + index] = {
        name: `step-high${index}`,
        passed: true,
        skipped: false,
      };
    }
    Object.defineProperty(
      uncappedDisjointSupplementedStepsTarget,
      Symbol.iterator,
      {
        configurable: true,
        enumerable: false,
        value: function* () {
          for (let index = 0; index < 450; index += 1) {
            yield index;
          }
          for (let index = 0; index < 450; index += 1) {
            yield {
              name: `step-iter${index}`,
              passed: true,
              skipped: false,
            };
          }
        },
      }
    );
    const uncappedDisjointSupplementedStepSummary = summarizeStepResults(
      uncappedDisjointSupplementedStepsTarget as never
    );
    expect(uncappedDisjointSupplementedStepSummary.totalSteps).toBe(1_350);
    expect(uncappedDisjointSupplementedStepSummary.passedStepCount).toBe(1_350);
    expect(uncappedDisjointSupplementedStepSummary.failedStepCount).toBe(0);
    expect(uncappedDisjointSupplementedStepSummary.skippedStepCount).toBe(0);
    expect(uncappedDisjointSupplementedStepSummary.firstFailedStep).toBeNull();
    expect(
      uncappedDisjointSupplementedStepSummary.passedSteps.includes("step-iter0")
    ).toBe(true);
    expect(
      uncappedDisjointSupplementedStepSummary.passedSteps.includes("step-high899")
    ).toBe(true);
    expect(uncappedDisjointSupplementedStepSummary.failedSteps).toEqual([]);
    expect(uncappedDisjointSupplementedStepSummary.skippedSteps).toEqual([]);

    const ownKeysTrapSteps = new Proxy(
      [{ name: "step-a", passed: true, skipped: false }],
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(ownKeysTrapSteps as never)).toEqual({
      totalSteps: 1,
      passedStepCount: 1,
      failedStepCount: 0,
      skippedStepCount: 0,
      firstFailedStep: null,
      passedSteps: ["step-a"],
      failedSteps: [],
      skippedSteps: [],
    });

    const ownKeysHasTrapSteps = new Proxy(
      [{ name: "step-a", passed: true, skipped: false }],
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
        has(target, property) {
          if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
            throw new Error("has trap");
          }
          return Reflect.has(target, property);
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(ownKeysHasTrapSteps as never)).toEqual({
      totalSteps: 1,
      passedStepCount: 1,
      failedStepCount: 0,
      skippedStepCount: 0,
      firstFailedStep: null,
      passedSteps: ["step-a"],
      failedSteps: [],
      skippedSteps: [],
    });

    const largeLengthOwnKeysTrapSteps = new Proxy(
      [{ name: "step-a", passed: true, skipped: false }],
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(largeLengthOwnKeysTrapSteps as never)).toEqual({
      totalSteps: 1,
      passedStepCount: 1,
      failedStepCount: 0,
      skippedStepCount: 0,
      firstFailedStep: null,
      passedSteps: ["step-a"],
      failedSteps: [],
      skippedSteps: [],
    });

    const lengthAndOwnKeysTrapSteps = new Proxy(
      [{ name: "step-a", passed: true, skipped: false }],
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeStepResults(lengthAndOwnKeysTrapSteps as never)).toEqual({
      totalSteps: 0,
      passedStepCount: 0,
      failedStepCount: 0,
      skippedStepCount: 0,
      firstFailedStep: null,
      passedSteps: [],
      failedSteps: [],
      skippedSteps: [],
    });
  });

  it("summarizes failed step entries with message fallbacks", () => {
    const failureSummaries = summarizeStepFailureResults([
      {
        name: "step-a",
        scriptName: "check-a.mjs",
        supportsNoBuild: true,
        stepIndex: 0,
        passed: true,
        skipped: false,
        exitCode: 0,
        report: null,
        output: null,
      },
      {
        name: "step-b",
        scriptName: "check-b.mjs",
        supportsNoBuild: false,
        checkCommand: "node",
        checkArgs: ["check-b.mjs", "--json"],
        checkArgCount: 2,
        stepIndex: 1,
        passed: false,
        skipped: false,
        exitCode: 2,
        report: { message: "report failure" },
        output: "output failure",
      },
      {
        name: "step-c",
        scriptName: "check-c.mjs",
        supportsNoBuild: true,
        checkCommand: "pnpm",
        checkArgs: ["run", "check-c"],
        checkArgCount: 2,
        stepIndex: 2,
        passed: false,
        skipped: false,
        exitCode: 3,
        report: null,
        output: "output failure",
      },
      {
        name: "step-d",
        scriptName: "check-d.mjs",
        supportsNoBuild: false,
        stepIndex: 3,
        passed: false,
        skipped: false,
        exitCode: null,
        report: null,
        output: "",
      },
      {
        name: "step-e",
        scriptName: "check-e.mjs",
        supportsNoBuild: true,
        stepIndex: 4,
        passed: false,
        skipped: true,
        exitCode: null,
        report: null,
        output: null,
      },
    ]);

    expect(failureSummaries).toEqual([
      {
        name: "step-b",
        scriptName: "check-b.mjs",
        supportsNoBuild: false,
        stepIndex: 1,
        checkCommand: "node",
        checkArgs: ["check-b.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "report failure",
      },
      {
        name: "step-c",
        scriptName: "check-c.mjs",
        supportsNoBuild: true,
        stepIndex: 2,
        checkCommand: "pnpm",
        checkArgs: ["run", "check-c"],
        checkArgCount: 2,
        exitCode: 3,
        message: "output failure",
      },
      {
        name: "step-d",
        scriptName: "check-d.mjs",
        supportsNoBuild: false,
        stepIndex: 3,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 1,
        message: "Step failed.",
      },
    ]);
  });

  it("summarizes failed check entries with message fallbacks", () => {
    const failureSummaries = summarizeCheckFailureResults([
      {
        name: "devEnvironment",
        scriptName: "check-dev-env.mjs",
        supportsNoBuild: false,
        checkIndex: 0,
        passed: true,
        exitCode: 0,
        report: null,
        output: null,
      },
      {
        name: "tsCore",
        scriptName: "check-ts-core.mjs",
        supportsNoBuild: true,
        checkCommand: "node",
        checkArgs: ["check-ts-core.mjs", "--json", "--compact"],
        checkArgCount: 3,
        checkIndex: 2,
        passed: false,
        exitCode: 2,
        report: { message: "ts core failed" },
        output: "output failure",
      },
      {
        name: "client",
        scriptName: "check-client.mjs",
        supportsNoBuild: true,
        checkCommand: "node",
        checkArgs: ["check-client.mjs", "--json", "--compact", "--no-build"],
        checkArgCount: 4,
        checkIndex: 4,
        passed: false,
        exitCode: 3,
        report: null,
        output: "output failure",
      },
      {
        name: "wasmPack",
        scriptName: "check-wasm-pack.mjs",
        supportsNoBuild: false,
        checkIndex: null,
        passed: false,
        exitCode: null,
        report: null,
        output: "",
      },
    ]);

    expect(failureSummaries).toEqual([
      {
        name: "tsCore",
        scriptName: "check-ts-core.mjs",
        supportsNoBuild: true,
        checkIndex: 2,
        checkCommand: "node",
        checkArgs: ["check-ts-core.mjs", "--json", "--compact"],
        checkArgCount: 3,
        exitCode: 2,
        message: "ts core failed",
      },
      {
        name: "client",
        scriptName: "check-client.mjs",
        supportsNoBuild: true,
        checkIndex: 4,
        checkCommand: "node",
        checkArgs: ["check-client.mjs", "--json", "--compact", "--no-build"],
        checkArgCount: 4,
        exitCode: 3,
        message: "output failure",
      },
      {
        name: "wasmPack",
        scriptName: "check-wasm-pack.mjs",
        supportsNoBuild: false,
        checkIndex: null,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 1,
        message: "Preflight check failed.",
      },
    ]);
  });

  it("normalizes whitespace-only summary name and command fields", () => {
    const stepSummary = summarizeStepResults([
      { name: "  step-a  ", passed: true, skipped: false },
      { name: "   ", passed: false, skipped: false },
      { name: "  step-b  ", passed: false, skipped: false },
      { name: "  step-c  ", passed: false, skipped: true },
    ]);
    expect(stepSummary).toEqual({
      totalSteps: 4,
      passedStepCount: 1,
      failedStepCount: 1,
      skippedStepCount: 1,
      firstFailedStep: "step-b",
      passedSteps: ["step-a"],
      failedSteps: ["step-b"],
      skippedSteps: ["step-c"],
    });

    const checkSummary = summarizeCheckResults([
      { name: "  check-a  ", passed: true },
      { name: "   ", passed: false },
      { name: "  check-b  ", passed: false },
    ]);
    expect(checkSummary).toEqual({
      totalChecks: 3,
      passedCheckCount: 1,
      failedCheckCount: 1,
      firstFailedCheck: "check-b",
      passedChecks: ["check-a"],
      failedChecks: ["check-b"],
    });

    const stepFailures = summarizeStepFailureResults([
      {
        name: "  step-a  ",
        scriptName: "  check-a.mjs  ",
        supportsNoBuild: false,
        checkCommand: "  node  ",
        checkArgs: ["check-a.mjs"],
        stepIndex: 0,
        passed: false,
        skipped: false,
        exitCode: 2,
        report: null,
        output: "   ",
      },
      {
        name: "  step-b  ",
        scriptName: "  check-b.mjs  ",
        supportsNoBuild: false,
        checkCommand: "  node  ",
        checkArgs: ["check-b.mjs"],
        stepIndex: 1,
        passed: false,
        skipped: false,
        exitCode: 2,
        report: null,
        output:
          "\u001b]0;step summary\u0007\u001b[31m  output failure  \u001b[0m\nadditional detail",
      },
      {
        name: "   ",
        scriptName: "check-b.mjs",
        supportsNoBuild: false,
        stepIndex: 2,
        passed: false,
        skipped: false,
        exitCode: 2,
        report: null,
        output: "output failure",
      },
    ]);
    expect(stepFailures).toEqual([
      {
        name: "step-a",
        scriptName: "check-a.mjs",
        supportsNoBuild: false,
        stepIndex: 0,
        checkCommand: "node",
        checkArgs: ["check-a.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
      {
        name: "step-b",
        scriptName: "check-b.mjs",
        supportsNoBuild: false,
        stepIndex: 1,
        checkCommand: "node",
        checkArgs: ["check-b.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "output failure",
      },
    ]);

    const checkFailures = summarizeCheckFailureResults([
      {
        name: "  check-a  ",
        scriptName: "  check-a.mjs  ",
        supportsNoBuild: false,
        checkCommand: "  node  ",
        checkArgs: ["check-a.mjs"],
        checkIndex: 0,
        passed: false,
        exitCode: 2,
        report: null,
        output: "   ",
      },
      {
        name: "  check-b  ",
        scriptName: "  check-b.mjs  ",
        supportsNoBuild: false,
        checkCommand: "  node  ",
        checkArgs: ["check-b.mjs"],
        checkIndex: 1,
        passed: false,
        exitCode: 2,
        report: null,
        output:
          "\u001b]0;check summary\u0007\u001b[33m  output failure  \u001b[0m\nadditional detail",
      },
      {
        name: "   ",
        scriptName: "check-b.mjs",
        supportsNoBuild: false,
        checkIndex: 2,
        passed: false,
        exitCode: 2,
        report: null,
        output: "output failure",
      },
    ]);
    expect(checkFailures).toEqual([
      {
        name: "check-a",
        scriptName: "check-a.mjs",
        supportsNoBuild: false,
        checkIndex: 0,
        checkCommand: "node",
        checkArgs: ["check-a.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
      {
        name: "check-b",
        scriptName: "check-b.mjs",
        supportsNoBuild: false,
        checkIndex: 1,
        checkCommand: "node",
        checkArgs: ["check-b.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "output failure",
      },
    ]);
  });

  it("sanitizes malformed check-args arrays in failure summaries", () => {
    const throwingIteratorArgs = ["check-proxy.mjs", "--json"];
    Object.defineProperty(throwingIteratorArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    expect(
      summarizeStepFailureResults([
        {
          name: "step-proxy",
          scriptName: "check-proxy.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: throwingIteratorArgs,
          stepIndex: 0,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-proxy",
        scriptName: "check-proxy.mjs",
        supportsNoBuild: false,
        stepIndex: 0,
        checkCommand: "node",
        checkArgs: ["check-proxy.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    const ownKeysHasTrapArgs = new Proxy(["check-proxy.mjs", "--json"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      has(target, property) {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          throw new Error("has trap");
        }
        return Reflect.has(target, property);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      summarizeStepFailureResults([
        {
          name: "step-proxy-ownkeys",
          scriptName: "check-proxy.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: ownKeysHasTrapArgs,
          stepIndex: 2,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-proxy-ownkeys",
        scriptName: "check-proxy.mjs",
        supportsNoBuild: false,
        stepIndex: 2,
        checkCommand: "node",
        checkArgs: ["check-proxy.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    expect(
      summarizeStepFailureResults([
        {
          name: "step-invalid-count",
          scriptName: "check-invalid-count.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: ["check-invalid-count.mjs", "--json"],
          checkArgCount: Number.NaN,
          stepIndex: 0,
          passed: false,
          skipped: false,
          exitCode: Number.NaN,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-invalid-count",
        scriptName: "check-invalid-count.mjs",
        supportsNoBuild: false,
        stepIndex: 0,
        checkCommand: "node",
        checkArgs: ["check-invalid-count.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 1,
        message: "Step failed.",
      },
    ]);
    expect(
      summarizeStepFailureResults([
        {
          name: "step-overflow-count",
          scriptName: "check-overflow-count.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: ["check-overflow-count.mjs", "--json"],
          checkArgCount: Number.MAX_SAFE_INTEGER + 1,
          stepIndex: 0,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-overflow-count",
        scriptName: "check-overflow-count.mjs",
        supportsNoBuild: false,
        stepIndex: 0,
        checkCommand: "node",
        checkArgs: ["check-overflow-count.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    expect(
      summarizeStepFailureResults([
        {
          name: "step-overflow-index",
          scriptName: "check-overflow-index.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: ["check-overflow-index.mjs", "--json"],
          stepIndex: Number.MAX_SAFE_INTEGER + 1,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-overflow-index",
        scriptName: "check-overflow-index.mjs",
        supportsNoBuild: false,
        stepIndex: null,
        checkCommand: "node",
        checkArgs: ["check-overflow-index.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    let statefulNullPrefixStepArgReadCount = 0;
    const statefulNullPrefixStepArgsTarget: string[] = [];
    statefulNullPrefixStepArgsTarget[0] = "check-stateful-null-step.mjs";
    statefulNullPrefixStepArgsTarget[1] = "--json";
    const statefulNullPrefixStepArgs = new Proxy(statefulNullPrefixStepArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 2;
        }
        if (propertyKey === "0") {
          statefulNullPrefixStepArgReadCount += 1;
          if (statefulNullPrefixStepArgReadCount === 1) {
            return null;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      summarizeStepFailureResults([
        {
          name: "step-stateful-null-args",
          scriptName: "check-stateful-null-step.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: statefulNullPrefixStepArgs,
          stepIndex: 3,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-stateful-null-args",
        scriptName: "check-stateful-null-step.mjs",
        supportsNoBuild: false,
        stepIndex: 3,
        checkCommand: "node",
        checkArgs: ["check-stateful-null-step.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    let statefulObjectReplacementStepArgReadCount = 0;
    const statefulObjectReplacementStepArgs = new Proxy(
      ["check-stateful-object-step.mjs"],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementStepArgReadCount += 1;
            if (statefulObjectReplacementStepArgReadCount > 1) {
              return { malformed: true };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeStepFailureResults([
        {
          name: "step-stateful-object-args",
          scriptName: "check-stateful-object-step.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: statefulObjectReplacementStepArgs,
          stepIndex: 7,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-stateful-object-args",
        scriptName: "check-stateful-object-step.mjs",
        supportsNoBuild: false,
        stepIndex: 7,
        checkCommand: "node",
        checkArgs: ["check-stateful-object-step.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    let statefulStringReplacementStepArgReadCount = 0;
    const statefulStringReplacementStepArgs = new Proxy(
      ["check-stateful-string-step.mjs"],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulStringReplacementStepArgReadCount += 1;
            if (statefulStringReplacementStepArgReadCount > 1) {
              return "check-replaced-step.mjs";
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeStepFailureResults([
        {
          name: "step-stateful-string-args",
          scriptName: "check-stateful-string-step.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: statefulStringReplacementStepArgs,
          stepIndex: 9,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-stateful-string-args",
        scriptName: "check-stateful-string-step.mjs",
        supportsNoBuild: false,
        stepIndex: 9,
        checkCommand: "node",
        checkArgs: ["check-stateful-string-step.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);

    expect(
      summarizeCheckFailureResults([
        {
          name: "check-proxy",
          scriptName: "check-proxy.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: ["check-proxy.mjs", 1, null],
          checkIndex: 0,
          passed: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-proxy",
        scriptName: "check-proxy.mjs",
        supportsNoBuild: false,
        checkIndex: 0,
        checkCommand: "node",
        checkArgs: ["check-proxy.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    expect(
      summarizeCheckFailureResults([
        {
          name: "check-overflow-index",
          scriptName: "check-overflow-index.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: ["check-overflow-index.mjs", "--json"],
          checkIndex: Number.MAX_SAFE_INTEGER + 1,
          passed: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-overflow-index",
        scriptName: "check-overflow-index.mjs",
        supportsNoBuild: false,
        checkIndex: null,
        checkCommand: "node",
        checkArgs: ["check-overflow-index.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    expect(
      summarizeCheckFailureResults([
        {
          name: "check-proxy-trap",
          scriptName: "check-proxy.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: throwingIteratorArgs,
          checkIndex: 2,
          passed: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-proxy-trap",
        scriptName: "check-proxy.mjs",
        supportsNoBuild: false,
        checkIndex: 2,
        checkCommand: "node",
        checkArgs: ["check-proxy.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    expect(
      summarizeCheckFailureResults([
        {
          name: "check-invalid-count",
          scriptName: "check-invalid-count.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: ["check-invalid-count.mjs", "--json"],
          checkArgCount: -1,
          checkIndex: Number.NaN,
          passed: false,
          exitCode: Number.NaN,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-invalid-count",
        scriptName: "check-invalid-count.mjs",
        supportsNoBuild: false,
        checkIndex: null,
        checkCommand: "node",
        checkArgs: ["check-invalid-count.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 1,
        message: "Preflight check failed.",
      },
    ]);
    expect(
      summarizeCheckFailureResults([
        {
          name: "check-overflow-count",
          scriptName: "check-overflow-count.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: ["check-overflow-count.mjs", "--json"],
          checkArgCount: Number.MAX_SAFE_INTEGER + 1,
          checkIndex: 0,
          passed: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-overflow-count",
        scriptName: "check-overflow-count.mjs",
        supportsNoBuild: false,
        checkIndex: 0,
        checkCommand: "node",
        checkArgs: ["check-overflow-count.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    let statefulNullPrefixCheckArgReadCount = 0;
    const statefulNullPrefixCheckArgsTarget: string[] = [];
    statefulNullPrefixCheckArgsTarget[0] = "check-stateful-null-check.mjs";
    statefulNullPrefixCheckArgsTarget[1] = "--json";
    const statefulNullPrefixCheckArgs = new Proxy(
      statefulNullPrefixCheckArgsTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNullPrefixCheckArgReadCount += 1;
            if (statefulNullPrefixCheckArgReadCount === 1) {
              return null;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeCheckFailureResults([
        {
          name: "check-stateful-null-args",
          scriptName: "check-stateful-null-check.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: statefulNullPrefixCheckArgs,
          checkIndex: 4,
          passed: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-stateful-null-args",
        scriptName: "check-stateful-null-check.mjs",
        supportsNoBuild: false,
        checkIndex: 4,
        checkCommand: "node",
        checkArgs: ["check-stateful-null-check.mjs", "--json"],
        checkArgCount: 2,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    let statefulObjectReplacementCheckArgReadCount = 0;
    const statefulObjectReplacementCheckArgs = new Proxy(
      ["check-stateful-object-check.mjs"],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementCheckArgReadCount += 1;
            if (statefulObjectReplacementCheckArgReadCount > 1) {
              return { malformed: true };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeCheckFailureResults([
        {
          name: "check-stateful-object-args",
          scriptName: "check-stateful-object-check.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: statefulObjectReplacementCheckArgs,
          checkIndex: 8,
          passed: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-stateful-object-args",
        scriptName: "check-stateful-object-check.mjs",
        supportsNoBuild: false,
        checkIndex: 8,
        checkCommand: "node",
        checkArgs: ["check-stateful-object-check.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    let statefulStringReplacementCheckArgReadCount = 0;
    const statefulStringReplacementCheckArgs = new Proxy(
      ["check-stateful-string-check.mjs"],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulStringReplacementCheckArgReadCount += 1;
            if (statefulStringReplacementCheckArgReadCount > 1) {
              return "check-replaced-check.mjs";
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeCheckFailureResults([
        {
          name: "check-stateful-string-args",
          scriptName: "check-stateful-string-check.mjs",
          supportsNoBuild: false,
          checkCommand: "node",
          checkArgs: statefulStringReplacementCheckArgs,
          checkIndex: 10,
          passed: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-stateful-string-args",
        scriptName: "check-stateful-string-check.mjs",
        supportsNoBuild: false,
        checkIndex: 10,
        checkCommand: "node",
        checkArgs: ["check-stateful-string-check.mjs"],
        checkArgCount: 1,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    const cappedSupplementedStepFailureArgsTarget: Array<string | number> = [];
    cappedSupplementedStepFailureArgsTarget[0] = "check-step-capped.mjs";
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedStepFailureArgsTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedStepFailureArgsTarget[5_000 + index] = `--k${index}`;
    }
    const cappedSupplementedStepFailureArgKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedStepFailureArgs = new Proxy(
      cappedSupplementedStepFailureArgsTarget,
      {
        ownKeys() {
          return [...cappedSupplementedStepFailureArgKeyList, "length"];
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeStepFailureResults([
        {
          name: "step-capped-args",
          scriptName: "check-step-capped.mjs",
          supportsNoBuild: true,
          checkCommand: "node",
          checkArgs: cappedSupplementedStepFailureArgs,
          stepIndex: 5,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-capped-args",
        scriptName: "check-step-capped.mjs",
        supportsNoBuild: true,
        stepIndex: 5,
        checkCommand: "node",
        checkArgs: expect.any(Array),
        checkArgCount: 1_024,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    const cappedStepFailureSummaries = summarizeStepFailureResults([
      {
        name: "step-capped-args",
        scriptName: "check-step-capped.mjs",
        supportsNoBuild: true,
        checkCommand: "node",
        checkArgs: cappedSupplementedStepFailureArgs,
        stepIndex: 5,
        passed: false,
        skipped: false,
        exitCode: 2,
        report: null,
        output: null,
      },
    ]);
    const cappedStepFailureCheckArgs = cappedStepFailureSummaries[0]?.checkArgs ?? [];
    expect(cappedStepFailureCheckArgs).toHaveLength(1_024);
    expect(cappedStepFailureCheckArgs[0]).toBe("check-step-capped.mjs");
    expect(cappedStepFailureCheckArgs.includes("--k1022")).toBe(true);
    expect(cappedStepFailureCheckArgs.includes("--k1023")).toBe(false);

    const cappedSupplementedCheckFailureArgsTarget: Array<string | number> = [];
    cappedSupplementedCheckFailureArgsTarget[0] = "check-check-capped.mjs";
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedCheckFailureArgsTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedCheckFailureArgsTarget[5_000 + index] = `--k${index}`;
    }
    const cappedSupplementedCheckFailureArgKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedCheckFailureArgs = new Proxy(
      cappedSupplementedCheckFailureArgsTarget,
      {
        ownKeys() {
          return [...cappedSupplementedCheckFailureArgKeyList, "length"];
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const cappedCheckFailureSummaries = summarizeCheckFailureResults([
      {
        name: "check-capped-args",
        scriptName: "check-check-capped.mjs",
        supportsNoBuild: true,
        checkCommand: "node",
        checkArgs: cappedSupplementedCheckFailureArgs,
        checkIndex: 6,
        passed: false,
        exitCode: 2,
        report: null,
        output: null,
      },
    ]);
    expect(cappedCheckFailureSummaries).toEqual([
      {
        name: "check-capped-args",
        scriptName: "check-check-capped.mjs",
        supportsNoBuild: true,
        checkIndex: 6,
        checkCommand: "node",
        checkArgs: expect.any(Array),
        checkArgCount: 1_024,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    const cappedCheckFailureCheckArgs =
      cappedCheckFailureSummaries[0]?.checkArgs ?? [];
    expect(cappedCheckFailureCheckArgs).toHaveLength(1_024);
    expect(cappedCheckFailureCheckArgs[0]).toBe("check-check-capped.mjs");
    expect(cappedCheckFailureCheckArgs.includes("--k1022")).toBe(true);
    expect(cappedCheckFailureCheckArgs.includes("--k1023")).toBe(false);
  });

  it("sanitizes malformed step/check failure entries with trap inputs", () => {
    const stepWithTrapPassed = Object.create(null) as {
      readonly name: string;
      readonly passed: boolean;
      readonly skipped: boolean;
    };
    Object.defineProperty(stepWithTrapPassed, "name", {
      configurable: true,
      enumerable: true,
      value: "step-trap-passed",
    });
    Object.defineProperty(stepWithTrapPassed, "passed", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("passed trap");
      },
    });
    Object.defineProperty(stepWithTrapPassed, "skipped", {
      configurable: true,
      enumerable: true,
      value: false,
    });

    const stepWithTrapName = Object.create(null) as {
      readonly name: string;
      readonly passed: boolean;
      readonly skipped: boolean;
    };
    Object.defineProperty(stepWithTrapName, "name", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("name trap");
      },
    });
    Object.defineProperty(stepWithTrapName, "passed", {
      configurable: true,
      enumerable: true,
      value: false,
    });
    Object.defineProperty(stepWithTrapName, "skipped", {
      configurable: true,
      enumerable: true,
      value: false,
    });

    expect(
      summarizeStepFailureResults([
        stepWithTrapPassed,
        stepWithTrapName,
        {
          name: "step-valid",
          scriptName: "check-valid.mjs",
          supportsNoBuild: true,
          stepIndex: 1,
          passed: false,
          skipped: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "step-valid",
        scriptName: "check-valid.mjs",
        supportsNoBuild: true,
        stepIndex: 1,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);

    const iteratorTrapSteps = [
      {
        name: "step-valid",
        scriptName: "check-valid.mjs",
        supportsNoBuild: true,
        stepIndex: 1,
        passed: false,
        skipped: false,
        exitCode: 2,
      },
    ];
    Object.defineProperty(iteratorTrapSteps, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    expect(summarizeStepFailureResults(iteratorTrapSteps as never)).toEqual([
      {
        name: "step-valid",
        scriptName: "check-valid.mjs",
        supportsNoBuild: true,
        stepIndex: 1,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    const lengthAndOwnKeysTrapSteps = new Proxy(iteratorTrapSteps, {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      summarizeStepFailureResults(lengthAndOwnKeysTrapSteps as never)
    ).toEqual([]);
    let statefulNumericPrefixCheckReadCount = 0;
    const statefulNumericPrefixSteps = new Proxy(
      [
        {
          name: "step-valid",
          scriptName: "check-valid.mjs",
          supportsNoBuild: true,
          stepIndex: 1,
          passed: false,
          skipped: false,
          exitCode: 2,
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulNumericPrefixCheckReadCount += 1;
            if (statefulNumericPrefixCheckReadCount === 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeStepFailureResults(statefulNumericPrefixSteps as never)
    ).toEqual([
      {
        name: "step-valid",
        scriptName: "check-valid.mjs",
        supportsNoBuild: true,
        stepIndex: 1,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    let equalLengthStepFailureIndexZeroReadCount = 0;
    let equalLengthStepFailureIndexOneReadCount = 0;
    const equalLengthReplacementFailureSteps = new Proxy(
      [
        {
          name: "step-preferred",
          scriptName: "check-preferred.mjs",
          supportsNoBuild: true,
          stepIndex: 0,
          passed: false,
          skipped: false,
          exitCode: 2,
        },
        {
          name: "step-secondary",
          scriptName: "check-secondary.mjs",
          supportsNoBuild: true,
          stepIndex: 1,
          passed: false,
          skipped: false,
          exitCode: 3,
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            equalLengthStepFailureIndexZeroReadCount += 1;
            if (equalLengthStepFailureIndexZeroReadCount === 1) {
              return 1;
            }
          }
          if (propertyKey === "1") {
            equalLengthStepFailureIndexOneReadCount += 1;
            if (equalLengthStepFailureIndexOneReadCount > 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeStepFailureResults(equalLengthReplacementFailureSteps as never)
    ).toEqual([
      {
        name: "step-preferred",
        scriptName: "check-preferred.mjs",
        supportsNoBuild: true,
        stepIndex: 0,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
      {
        name: "step-secondary",
        scriptName: "check-secondary.mjs",
        supportsNoBuild: true,
        stepIndex: 1,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 3,
        message: "Step failed with exit code 3.",
      },
    ]);
    let statefulObjectReplacementStepFailureReadCount = 0;
    const statefulObjectReplacementStepFailureEntries = new Proxy(
      [
        {
          name: "step-primary",
          scriptName: "check-step-primary.mjs",
          supportsNoBuild: true,
          stepIndex: 0,
          passed: false,
          skipped: false,
          exitCode: 2,
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementStepFailureReadCount += 1;
            if (statefulObjectReplacementStepFailureReadCount > 1) {
              return {
                name: "step-secondary",
                scriptName: "check-step-secondary.mjs",
                supportsNoBuild: true,
                stepIndex: 1,
                passed: false,
                skipped: false,
                exitCode: 3,
              };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeStepFailureResults(statefulObjectReplacementStepFailureEntries as never)
    ).toEqual([
      {
        name: "step-primary",
        scriptName: "check-step-primary.mjs",
        supportsNoBuild: true,
        stepIndex: 0,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Step failed with exit code 2.",
      },
    ]);
    const cappedSupplementedFailureStepsTarget: Array<
      | number
      | {
          readonly name: string;
          readonly scriptName: string;
          readonly supportsNoBuild: boolean;
          readonly stepIndex: number;
          readonly passed: boolean;
          readonly skipped: boolean;
          readonly exitCode: number;
        }
    > = [];
    cappedSupplementedFailureStepsTarget[0] = {
      name: "step-a",
      scriptName: "step-a.mjs",
      supportsNoBuild: true,
      stepIndex: 0,
      passed: false,
      skipped: false,
      exitCode: 2,
    };
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedFailureStepsTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedFailureStepsTarget[5_000 + index] = {
        name: `step-k${index}`,
        scriptName: `step-k${index}.mjs`,
        supportsNoBuild: true,
        stepIndex: 5_000 + index,
        passed: false,
        skipped: false,
        exitCode: 2,
      };
    }
    const cappedSupplementedFailureStepKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedFailureSteps = new Proxy(
      cappedSupplementedFailureStepsTarget,
      {
        ownKeys() {
          return [...cappedSupplementedFailureStepKeyList, "length"];
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const cappedSupplementedStepFailureSummaries = summarizeStepFailureResults(
      cappedSupplementedFailureSteps as never
    );
    expect(cappedSupplementedStepFailureSummaries).toHaveLength(1_024);
    expect(cappedSupplementedStepFailureSummaries[0]?.name).toBe("step-a");
    expect(
      cappedSupplementedStepFailureSummaries.some(
        (summary) => summary.name === "step-k1022"
      )
    ).toBe(true);
    expect(
      cappedSupplementedStepFailureSummaries.some(
        (summary) => summary.name === "step-k1023"
      )
    ).toBe(false);

    const checkWithTrapPassed = Object.create(null) as {
      readonly name: string;
      readonly passed: boolean;
    };
    Object.defineProperty(checkWithTrapPassed, "name", {
      configurable: true,
      enumerable: true,
      value: "check-trap-passed",
    });
    Object.defineProperty(checkWithTrapPassed, "passed", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("passed trap");
      },
    });

    const checkWithTrapName = Object.create(null) as {
      readonly name: string;
      readonly passed: boolean;
    };
    Object.defineProperty(checkWithTrapName, "name", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("name trap");
      },
    });
    Object.defineProperty(checkWithTrapName, "passed", {
      configurable: true,
      enumerable: true,
      value: false,
    });

    expect(
      summarizeCheckFailureResults([
        checkWithTrapPassed,
        checkWithTrapName,
        {
          name: "check-valid",
          scriptName: "check-valid.mjs",
          supportsNoBuild: true,
          checkIndex: 1,
          passed: false,
          exitCode: 2,
          report: null,
          output: null,
        },
      ])
    ).toEqual([
      {
        name: "check-valid",
        scriptName: "check-valid.mjs",
        supportsNoBuild: true,
        checkIndex: 1,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);

    const iteratorTrapChecks = [
      {
        name: "check-valid",
        scriptName: "check-valid.mjs",
        supportsNoBuild: true,
        checkIndex: 1,
        passed: false,
        exitCode: 2,
      },
    ];
    Object.defineProperty(iteratorTrapChecks, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    expect(summarizeCheckFailureResults(iteratorTrapChecks as never)).toEqual([
      {
        name: "check-valid",
        scriptName: "check-valid.mjs",
        supportsNoBuild: true,
        checkIndex: 1,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    const lengthAndOwnKeysTrapChecks = new Proxy(iteratorTrapChecks, {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      summarizeCheckFailureResults(lengthAndOwnKeysTrapChecks as never)
    ).toEqual([]);
    let statefulNumericPrefixReadCount = 0;
    const statefulNumericPrefixChecks = new Proxy(
      [
        {
          name: "check-valid",
          scriptName: "check-valid.mjs",
          supportsNoBuild: true,
          checkIndex: 1,
          passed: false,
          exitCode: 2,
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulNumericPrefixReadCount += 1;
            if (statefulNumericPrefixReadCount === 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeCheckFailureResults(statefulNumericPrefixChecks as never)
    ).toEqual([
      {
        name: "check-valid",
        scriptName: "check-valid.mjs",
        supportsNoBuild: true,
        checkIndex: 1,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    let equalLengthCheckFailureIndexZeroReadCount = 0;
    let equalLengthCheckFailureIndexOneReadCount = 0;
    const equalLengthReplacementChecks = new Proxy(
      [
        {
          name: "check-preferred",
          scriptName: "check-preferred.mjs",
          supportsNoBuild: true,
          checkIndex: 0,
          passed: false,
          exitCode: 2,
        },
        {
          name: "check-secondary",
          scriptName: "check-secondary.mjs",
          supportsNoBuild: true,
          checkIndex: 1,
          passed: false,
          exitCode: 3,
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            equalLengthCheckFailureIndexZeroReadCount += 1;
            if (equalLengthCheckFailureIndexZeroReadCount === 1) {
              return 1;
            }
          }
          if (propertyKey === "1") {
            equalLengthCheckFailureIndexOneReadCount += 1;
            if (equalLengthCheckFailureIndexOneReadCount > 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeCheckFailureResults(equalLengthReplacementChecks as never)
    ).toEqual([
      {
        name: "check-preferred",
        scriptName: "check-preferred.mjs",
        supportsNoBuild: true,
        checkIndex: 0,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
      {
        name: "check-secondary",
        scriptName: "check-secondary.mjs",
        supportsNoBuild: true,
        checkIndex: 1,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 3,
        message: "Preflight check failed with exit code 3.",
      },
    ]);
    let statefulObjectReplacementCheckFailureReadCount = 0;
    const statefulObjectReplacementCheckFailureEntries = new Proxy(
      [
        {
          name: "check-primary",
          scriptName: "check-primary.mjs",
          supportsNoBuild: true,
          checkIndex: 0,
          passed: false,
          exitCode: 2,
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementCheckFailureReadCount += 1;
            if (statefulObjectReplacementCheckFailureReadCount > 1) {
              return {
                name: "check-secondary",
                scriptName: "check-secondary.mjs",
                supportsNoBuild: true,
                checkIndex: 1,
                passed: false,
                exitCode: 3,
              };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      summarizeCheckFailureResults(statefulObjectReplacementCheckFailureEntries as never)
    ).toEqual([
      {
        name: "check-primary",
        scriptName: "check-primary.mjs",
        supportsNoBuild: true,
        checkIndex: 0,
        checkCommand: "",
        checkArgs: [],
        checkArgCount: 0,
        exitCode: 2,
        message: "Preflight check failed with exit code 2.",
      },
    ]);
    const cappedSupplementedFailureChecksTarget: Array<
      | number
      | {
          readonly name: string;
          readonly scriptName: string;
          readonly supportsNoBuild: boolean;
          readonly checkIndex: number;
          readonly passed: boolean;
          readonly exitCode: number;
        }
    > = [];
    cappedSupplementedFailureChecksTarget[0] = {
      name: "check-a",
      scriptName: "check-a.mjs",
      supportsNoBuild: true,
      checkIndex: 0,
      passed: false,
      exitCode: 2,
    };
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedFailureChecksTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedFailureChecksTarget[5_000 + index] = {
        name: `check-k${index}`,
        scriptName: `check-k${index}.mjs`,
        supportsNoBuild: true,
        checkIndex: 5_000 + index,
        passed: false,
        exitCode: 2,
      };
    }
    const cappedSupplementedFailureCheckKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedFailureChecks = new Proxy(
      cappedSupplementedFailureChecksTarget,
      {
        ownKeys() {
          return [...cappedSupplementedFailureCheckKeyList, "length"];
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const cappedSupplementedFailureSummaries = summarizeCheckFailureResults(
      cappedSupplementedFailureChecks as never
    );
    expect(cappedSupplementedFailureSummaries).toHaveLength(1_024);
    expect(cappedSupplementedFailureSummaries[0]?.name).toBe("check-a");
    expect(
      cappedSupplementedFailureSummaries.some(
        (summary) => summary.name === "check-k1022"
      )
    ).toBe(true);
    expect(
      cappedSupplementedFailureSummaries.some(
        (summary) => summary.name === "check-k1023"
      )
    ).toBe(false);
  });

  it("does not cap disjoint failure summary supplementation when iterator succeeds", () => {
    const uncappedDisjointFailureStepsTarget: Array<
      number | Record<string, boolean | number | string>
    > = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedDisjointFailureStepsTarget[5_000 + index] = {
        name: `step-high${index}`,
        scriptName: `step-high${index}.mjs`,
        supportsNoBuild: true,
        stepIndex: 5_000 + index,
        passed: false,
        skipped: false,
        exitCode: 2,
      };
    }
    Object.defineProperty(uncappedDisjointFailureStepsTarget, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: function* () {
        for (let index = 0; index < 450; index += 1) {
          yield index;
        }
        for (let index = 0; index < 450; index += 1) {
          yield {
            name: `step-iter${index}`,
            scriptName: `step-iter${index}.mjs`,
            supportsNoBuild: true,
            stepIndex: index,
            passed: false,
            skipped: false,
            exitCode: 2,
          };
        }
      },
    });
    const uncappedDisjointStepFailureSummaries = summarizeStepFailureResults(
      uncappedDisjointFailureStepsTarget as never
    );
    expect(uncappedDisjointStepFailureSummaries).toHaveLength(1_350);
    expect(uncappedDisjointStepFailureSummaries[0]?.name).toBe("step-iter0");
    expect(
      uncappedDisjointStepFailureSummaries.some(
        (summary) => summary.name === "step-iter449"
      )
    ).toBe(true);
    expect(
      uncappedDisjointStepFailureSummaries.some(
        (summary) => summary.name === "step-high899"
      )
    ).toBe(true);

    const uncappedDisjointFailureChecksTarget: Array<
      number | Record<string, boolean | number | string>
    > = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedDisjointFailureChecksTarget[5_000 + index] = {
        name: `check-high${index}`,
        scriptName: `check-high${index}.mjs`,
        supportsNoBuild: true,
        checkIndex: 5_000 + index,
        passed: false,
        exitCode: 2,
      };
    }
    Object.defineProperty(uncappedDisjointFailureChecksTarget, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: function* () {
        for (let index = 0; index < 450; index += 1) {
          yield index;
        }
        for (let index = 0; index < 450; index += 1) {
          yield {
            name: `check-iter${index}`,
            scriptName: `check-iter${index}.mjs`,
            supportsNoBuild: true,
            checkIndex: index,
            passed: false,
            exitCode: 2,
          };
        }
      },
    });
    const uncappedDisjointCheckFailureSummaries = summarizeCheckFailureResults(
      uncappedDisjointFailureChecksTarget as never
    );
    expect(uncappedDisjointCheckFailureSummaries).toHaveLength(1_350);
    expect(uncappedDisjointCheckFailureSummaries[0]?.name).toBe("check-iter0");
    expect(
      uncappedDisjointCheckFailureSummaries.some(
        (summary) => summary.name === "check-iter449"
      )
    ).toBe(true);
    expect(
      uncappedDisjointCheckFailureSummaries.some(
        (summary) => summary.name === "check-high899"
      )
    ).toBe(true);
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

  it("summarizes check outcomes with malformed/trap check entries", () => {
    const checkWithTrapName = Object.create(null) as {
      readonly name: string;
      readonly passed: boolean;
    };
    Object.defineProperty(checkWithTrapName, "name", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("name trap");
      },
    });
    Object.defineProperty(checkWithTrapName, "passed", {
      configurable: true,
      enumerable: true,
      value: false,
    });
    const iteratorTrapChecks = [{ name: "devEnvironment", passed: true }];
    Object.defineProperty(iteratorTrapChecks, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    expect(
      summarizeCheckResults([
        { name: "devEnvironment", passed: false },
        checkWithTrapName,
        { name: "client", passed: true },
      ])
    ).toEqual({
      totalChecks: 3,
      passedCheckCount: 1,
      failedCheckCount: 1,
      firstFailedCheck: "devEnvironment",
      passedChecks: ["client"],
      failedChecks: ["devEnvironment"],
    });
    expect(summarizeCheckResults(iteratorTrapChecks as never)).toEqual({
      totalChecks: 1,
      passedCheckCount: 1,
      failedCheckCount: 0,
      firstFailedCheck: null,
      passedChecks: ["devEnvironment"],
      failedChecks: [],
    });
    let statefulUndefinedPrefixReadCount = 0;
    const statefulUndefinedPrefixChecks = new Proxy(
      [
        { name: "devEnvironment", passed: false },
        { name: "client", passed: true },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulUndefinedPrefixReadCount += 1;
            if (statefulUndefinedPrefixReadCount === 1) {
              return undefined;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(statefulUndefinedPrefixChecks as never)).toEqual({
      totalChecks: 2,
      passedCheckCount: 1,
      failedCheckCount: 1,
      firstFailedCheck: "devEnvironment",
      passedChecks: ["client"],
      failedChecks: ["devEnvironment"],
    });
    let statefulNullPrefixReadCount = 0;
    const statefulNullPrefixChecks = new Proxy(
      [
        { name: "devEnvironment", passed: false },
        { name: "client", passed: true },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNullPrefixReadCount += 1;
            if (statefulNullPrefixReadCount === 1) {
              return null;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(statefulNullPrefixChecks as never)).toEqual({
      totalChecks: 2,
      passedCheckCount: 1,
      failedCheckCount: 1,
      firstFailedCheck: "devEnvironment",
      passedChecks: ["client"],
      failedChecks: ["devEnvironment"],
    });
    let statefulNumericPrefixReadCount = 0;
    const statefulNumericPrefixChecks = new Proxy(
      [
        { name: "devEnvironment", passed: false },
        { name: "client", passed: true },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNumericPrefixReadCount += 1;
            if (statefulNumericPrefixReadCount === 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(statefulNumericPrefixChecks as never)).toEqual({
      totalChecks: 2,
      passedCheckCount: 1,
      failedCheckCount: 1,
      firstFailedCheck: "devEnvironment",
      passedChecks: ["client"],
      failedChecks: ["devEnvironment"],
    });
    let equalLengthCheckSummaryIndexZeroReadCount = 0;
    let equalLengthCheckSummaryIndexOneReadCount = 0;
    const equalLengthReplacementChecks = new Proxy(
      [
        { name: "devEnvironment", passed: false },
        { name: "client", passed: true },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            equalLengthCheckSummaryIndexZeroReadCount += 1;
            if (equalLengthCheckSummaryIndexZeroReadCount === 1) {
              return 1;
            }
          }
          if (propertyKey === "1") {
            equalLengthCheckSummaryIndexOneReadCount += 1;
            if (equalLengthCheckSummaryIndexOneReadCount > 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(equalLengthReplacementChecks as never)).toEqual({
      totalChecks: 2,
      passedCheckCount: 1,
      failedCheckCount: 1,
      firstFailedCheck: "devEnvironment",
      passedChecks: ["client"],
      failedChecks: ["devEnvironment"],
    });
    let statefulObjectReplacementReadCount = 0;
    const statefulObjectReplacementChecks = new Proxy(
      [{ name: "devEnvironment", passed: false }],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementReadCount += 1;
            if (statefulObjectReplacementReadCount > 1) {
              return { name: "client", passed: true };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(statefulObjectReplacementChecks as never)).toEqual({
      totalChecks: 1,
      passedCheckCount: 0,
      failedCheckCount: 1,
      firstFailedCheck: "devEnvironment",
      passedChecks: [],
      failedChecks: ["devEnvironment"],
    });
    const cappedSupplementedChecksTarget: Array<
      number | { readonly name: string; readonly passed: boolean }
    > = [];
    cappedSupplementedChecksTarget[0] = {
      name: "check-a",
      passed: true,
    };
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedChecksTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedChecksTarget[5_000 + index] = {
        name: `check-k${index}`,
        passed: true,
      };
    }
    const cappedSupplementedCheckKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedChecks = new Proxy(cappedSupplementedChecksTarget, {
      ownKeys() {
        return [...cappedSupplementedCheckKeyList, "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const cappedSupplementedCheckSummary = summarizeCheckResults(
      cappedSupplementedChecks as never
    );
    expect(cappedSupplementedCheckSummary.totalChecks).toBe(1_024);
    expect(cappedSupplementedCheckSummary.passedCheckCount).toBe(1_024);
    expect(cappedSupplementedCheckSummary.failedCheckCount).toBe(0);
    expect(cappedSupplementedCheckSummary.firstFailedCheck).toBeNull();
    expect(cappedSupplementedCheckSummary.passedChecks[0]).toBe("check-a");
    expect(cappedSupplementedCheckSummary.passedChecks.includes("check-k1022")).toBe(
      true
    );
    expect(cappedSupplementedCheckSummary.passedChecks.includes("check-k1023")).toBe(
      false
    );
    expect(cappedSupplementedCheckSummary.failedChecks).toEqual([]);

    const uncappedSupplementedChecksTarget: Array<
      number | { readonly name: string; readonly passed: boolean }
    > = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedSupplementedChecksTarget[index] = {
        name: `check-low${index}`,
        passed: true,
      };
      uncappedSupplementedChecksTarget[5_000 + index] = {
        name: `check-high${index}`,
        passed: true,
      };
    }
    Object.defineProperty(uncappedSupplementedChecksTarget, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: function* () {
        for (let index = 0; index < 450; index += 1) {
          yield index;
        }
        for (let index = 0; index < 450; index += 1) {
          yield uncappedSupplementedChecksTarget[5_000 + index];
        }
      },
    });
    const uncappedSupplementedCheckSummary = summarizeCheckResults(
      uncappedSupplementedChecksTarget as never
    );
    expect(uncappedSupplementedCheckSummary.totalChecks).toBe(1_024);
    expect(uncappedSupplementedCheckSummary.passedCheckCount).toBe(1_024);
    expect(uncappedSupplementedCheckSummary.failedCheckCount).toBe(0);
    expect(uncappedSupplementedCheckSummary.firstFailedCheck).toBeNull();
    expect(uncappedSupplementedCheckSummary.passedChecks[0]).toBe("check-low0");
    expect(uncappedSupplementedCheckSummary.passedChecks.includes("check-high123")).toBe(
      true
    );
    expect(uncappedSupplementedCheckSummary.failedChecks).toEqual([]);

    const uncappedDisjointSupplementedChecksTarget: Array<
      { readonly name: string; readonly passed: boolean }
    > = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedDisjointSupplementedChecksTarget[5_000 + index] = {
        name: `check-high${index}`,
        passed: true,
      };
    }
    Object.defineProperty(
      uncappedDisjointSupplementedChecksTarget,
      Symbol.iterator,
      {
        configurable: true,
        enumerable: false,
        value: function* () {
          for (let index = 0; index < 450; index += 1) {
            yield index;
          }
          for (let index = 0; index < 450; index += 1) {
            yield {
              name: `check-iter${index}`,
              passed: true,
            };
          }
        },
      }
    );
    const uncappedDisjointSupplementedCheckSummary = summarizeCheckResults(
      uncappedDisjointSupplementedChecksTarget as never
    );
    expect(uncappedDisjointSupplementedCheckSummary.totalChecks).toBe(1_350);
    expect(uncappedDisjointSupplementedCheckSummary.passedCheckCount).toBe(1_350);
    expect(uncappedDisjointSupplementedCheckSummary.failedCheckCount).toBe(0);
    expect(uncappedDisjointSupplementedCheckSummary.firstFailedCheck).toBeNull();
    expect(
      uncappedDisjointSupplementedCheckSummary.passedChecks.includes("check-iter0")
    ).toBe(true);
    expect(
      uncappedDisjointSupplementedCheckSummary.passedChecks.includes("check-high899")
    ).toBe(true);
    expect(uncappedDisjointSupplementedCheckSummary.failedChecks).toEqual([]);

    const ownKeysTrapChecks = new Proxy(
      [{ name: "devEnvironment", passed: true }],
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(ownKeysTrapChecks as never)).toEqual({
      totalChecks: 1,
      passedCheckCount: 1,
      failedCheckCount: 0,
      firstFailedCheck: null,
      passedChecks: ["devEnvironment"],
      failedChecks: [],
    });

    const ownKeysHasTrapChecks = new Proxy(
      [{ name: "devEnvironment", passed: true }],
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
        has(target, property) {
          if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
            throw new Error("has trap");
          }
          return Reflect.has(target, property);
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(ownKeysHasTrapChecks as never)).toEqual({
      totalChecks: 1,
      passedCheckCount: 1,
      failedCheckCount: 0,
      firstFailedCheck: null,
      passedChecks: ["devEnvironment"],
      failedChecks: [],
    });

    const largeLengthOwnKeysTrapChecks = new Proxy(
      [{ name: "devEnvironment", passed: true }],
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(largeLengthOwnKeysTrapChecks as never)).toEqual({
      totalChecks: 1,
      passedCheckCount: 1,
      failedCheckCount: 0,
      firstFailedCheck: null,
      passedChecks: ["devEnvironment"],
      failedChecks: [],
    });

    const lengthAndOwnKeysTrapChecks = new Proxy(
      [{ name: "devEnvironment", passed: true }],
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(summarizeCheckResults(lengthAndOwnKeysTrapChecks as never)).toEqual({
      totalChecks: 0,
      passedCheckCount: 0,
      failedCheckCount: 0,
      firstFailedCheck: null,
      passedChecks: [],
      failedChecks: [],
    });
  });

  it("derives failure messages from nested report structures", () => {
    expect(deriveFailureMessageFromReport(null)).toBeNull();
    expect(deriveFailureMessageFromReport({})).toBeNull();
    expect(
      deriveFailureMessageFromReport({ message: "top-level failure message" })
    ).toBe("top-level failure message");
    expect(
      deriveFailureMessageFromReport({
        message: "   ",
        steps: [
          {
            name: "WASM artifact preflight",
            passed: false,
            skipped: false,
            reason: "artifact missing",
          },
        ],
      })
    ).toBe("WASM artifact preflight: artifact missing");
    expect(
      deriveFailureMessageFromReport({
        message: "  top-level failure message  ",
      })
    ).toBe("top-level failure message");
    expect(
      deriveFailureMessageFromReport({
        message:
          "\u001b]0;preflight\u0007\u001b[31m  top-level failure message  \u001b[0m\nadditional detail",
      })
    ).toBe("top-level failure message");
    expect(
      deriveFailureMessageFromReport({ requiredFailures: 2 })
    ).toBe("2 required check(s) failed.");
    expect(deriveFailureMessageFromReport({ requiredFailures: 0 })).toBeNull();
    expect(
      deriveFailureMessageFromReport({ requiredFailures: Number.NaN })
    ).toBeNull();
    expect(
      deriveFailureMessageFromReport({
        requiredFailures: -1,
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
        requiredFailures: 0,
        steps: [
          {
            name: "Client checks",
            passed: false,
            skipped: false,
            reason: "artifact missing",
          },
        ],
      })
    ).toBe("Client checks: artifact missing");
    expect(
      deriveFailureMessageFromReport({ requiredFailures: 1.5 })
    ).toBeNull();
    expect(
      deriveFailureMessageFromReport({
        requiredFailures: Number.MAX_SAFE_INTEGER + 1,
      })
    ).toBeNull();
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
    expect(
      deriveFailureMessageFromReport({
        steps: [
          {
            name: "  Client checks  ",
            passed: false,
            skipped: false,
            reason: "  artifact missing  ",
          },
        ],
      })
    ).toBe("Client checks: artifact missing");
    expect(
      deriveFailureMessageFromReport({
        steps: [
          {
            name: "Client checks",
            passed: false,
            skipped: false,
            report: {
              message:
                "\u001b]0;report\u0007\u001b[31m  artifact missing  \u001b[0m\nadditional detail",
            },
          },
        ],
      })
    ).toBe("Client checks: artifact missing");
    expect(
      deriveFailureMessageFromReport({
        steps: [
          {
            name: "Client checks",
            passed: false,
            skipped: false,
            reason:
              "\u001b]0;reason\u0007\u001b[33m  artifact missing  \u001b[0m\nadditional detail",
          },
        ],
      })
    ).toBe("Client checks: artifact missing");
    expect(
      deriveFailureMessageFromReport({
        steps: [
          {
            name: "  ",
            passed: false,
            skipped: false,
            reason: "artifact missing",
          },
        ],
      })
    ).toBeNull();
    expect(
      deriveFailureMessageFromReport({
        steps: [
          {
            name: "Client checks",
            passed: false,
            skipped: false,
            report: { message: "   " },
            reason: "   ",
          },
        ],
      })
    ).toBe("Client checks failed.");
    let statefulObjectReplacementReadCount = 0;
    const statefulObjectReplacementSteps = new Proxy(
      [
        {
          name: "Primary check",
          passed: false,
          skipped: false,
          reason: "initial failure",
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementReadCount += 1;
            if (statefulObjectReplacementReadCount > 1) {
              return {
                name: "Secondary check",
                passed: true,
                skipped: false,
                reason: "secondary failure",
              };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      deriveFailureMessageFromReport({
        steps: statefulObjectReplacementSteps,
      })
    ).toBe("Primary check: initial failure");
    const cappedSupplementedFailureMessageStepsTarget: Array<
      number | { readonly name: string; readonly passed: boolean; readonly skipped: boolean; readonly reason: string }
    > = [];
    cappedSupplementedFailureMessageStepsTarget[0] = {
      name: "Precheck",
      passed: true,
      skipped: false,
      reason: "ignored",
    };
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedFailureMessageStepsTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedFailureMessageStepsTarget[5_000 + index] = {
        name: `High step ${index}`,
        passed: false,
        skipped: false,
        reason: "artifact missing",
      };
    }
    const cappedSupplementedFailureMessageStepKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedFailureMessageSteps = new Proxy(
      cappedSupplementedFailureMessageStepsTarget,
      {
        ownKeys() {
          return [...cappedSupplementedFailureMessageStepKeyList, "length"];
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      deriveFailureMessageFromReport({
        steps: cappedSupplementedFailureMessageSteps,
      })
    ).toBe("High step 0: artifact missing");
  });

  it("derives failure messages when malformed getters throw", () => {
    const reportWithThrowingMessage = Object.create(null) as {
      readonly message: string;
      readonly steps: Array<Record<string, string | boolean>>;
    };
    Object.defineProperty(reportWithThrowingMessage, "message", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("message trap");
      },
    });
    Object.defineProperty(reportWithThrowingMessage, "steps", {
      configurable: true,
      enumerable: true,
      value: [
        {
          name: "WASM artifact preflight",
          passed: false,
          skipped: false,
          reason: "artifact missing",
        },
      ],
    });
    const reportWithThrowingSteps = Object.create(null) as {
      readonly steps: Array<Record<string, string | boolean>>;
    };
    Object.defineProperty(reportWithThrowingSteps, "steps", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("steps trap");
      },
    });
    const iteratorTrapSteps = [
      {
        name: "TypeScript typecheck",
        passed: false,
        skipped: false,
        reason: "previous step failed",
      },
    ];
    Object.defineProperty(iteratorTrapSteps, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const largeLengthIteratorTrapSteps = new Proxy(
      [
        {
          name: "WASM artifact preflight",
          passed: false,
          skipped: false,
          reason: "artifact missing",
        },
      ],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );

    expect(deriveFailureMessageFromReport(reportWithThrowingMessage)).toBe(
      "WASM artifact preflight: artifact missing"
    );
    expect(deriveFailureMessageFromReport(reportWithThrowingSteps)).toBeNull();
    expect(
      deriveFailureMessageFromReport({
        steps: iteratorTrapSteps,
      })
    ).toBe("TypeScript typecheck: previous step failed");

    const lengthAndOwnKeysTrapSteps = new Proxy(
      [
        {
          name: "WASM artifact preflight",
          passed: false,
          skipped: false,
          reason: "artifact missing",
        },
      ],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      deriveFailureMessageFromReport({
        steps: lengthAndOwnKeysTrapSteps,
      })
    ).toBeNull();

    expect(
      deriveFailureMessageFromReport({
        steps: largeLengthIteratorTrapSteps,
      })
    ).toBe("WASM artifact preflight: artifact missing");
    let statefulUndefinedPrefixReadCount = 0;
    const statefulUndefinedPrefixFailureSteps = new Proxy(
      [
        {
          name: "WASM artifact preflight",
          passed: false,
          skipped: false,
          reason: "artifact missing",
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulUndefinedPrefixReadCount += 1;
            if (statefulUndefinedPrefixReadCount === 1) {
              return undefined;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      deriveFailureMessageFromReport({
        steps: statefulUndefinedPrefixFailureSteps,
      })
    ).toBe("WASM artifact preflight: artifact missing");
    let statefulNullPrefixReadCount = 0;
    const statefulNullPrefixFailureSteps = new Proxy(
      [
        {
          name: "WASM artifact preflight",
          passed: false,
          skipped: false,
          reason: "artifact missing",
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulNullPrefixReadCount += 1;
            if (statefulNullPrefixReadCount === 1) {
              return null;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      deriveFailureMessageFromReport({
        steps: statefulNullPrefixFailureSteps,
      })
    ).toBe("WASM artifact preflight: artifact missing");
    let statefulNumericPrefixReadCount = 0;
    const statefulNumericPrefixFailureSteps = new Proxy(
      [
        {
          name: "WASM artifact preflight",
          passed: false,
          skipped: false,
          reason: "artifact missing",
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulNumericPrefixReadCount += 1;
            if (statefulNumericPrefixReadCount === 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      deriveFailureMessageFromReport({
        steps: statefulNumericPrefixFailureSteps,
      })
    ).toBe("WASM artifact preflight: artifact missing");
    let equalLengthFailureMessageIndexZeroReadCount = 0;
    let equalLengthFailureMessageIndexOneReadCount = 0;
    const equalLengthReplacementFailureSteps = new Proxy(
      [
        {
          name: "Preferred step",
          passed: false,
          skipped: false,
          reason: "preferred reason",
        },
        {
          name: "Secondary step",
          passed: false,
          skipped: false,
          reason: "secondary reason",
        },
      ],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            equalLengthFailureMessageIndexZeroReadCount += 1;
            if (equalLengthFailureMessageIndexZeroReadCount === 1) {
              return 1;
            }
          }
          if (propertyKey === "1") {
            equalLengthFailureMessageIndexOneReadCount += 1;
            if (equalLengthFailureMessageIndexOneReadCount > 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      deriveFailureMessageFromReport({
        steps: equalLengthReplacementFailureSteps,
      })
    ).toBe("Preferred step: preferred reason");
  });

  it("extracts wasm pack summary fields from nested reports", () => {
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckStatus: "missing",
        wasmPackCheckCommand: "node",
        wasmPackCheckArgs: ["check-wasm-pack.mjs", "--json", "--compact"],
        wasmPackCheckArgCount: 3,
        wasmPackCheckExitCode: 1,
        wasmPackCheckOutputLine: "wasm-pack not found",
      })
    ).toEqual({
      wasmPackCheckStatus: "missing",
      wasmPackCheckCommand: "node",
      wasmPackCheckArgs: ["check-wasm-pack.mjs", "--json", "--compact"],
      wasmPackCheckArgCount: 3,
      wasmPackCheckExitCode: 1,
      wasmPackCheckOutputLine: "wasm-pack not found",
    });
  });

  it("returns null defaults for missing wasm pack summary fields", () => {
    expect(extractWasmPackCheckSummaryFromReport(null)).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(extractWasmPackCheckSummaryFromReport([])).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckStatus: "ok",
        wasmPackCheckCommand: "node",
        wasmPackCheckArgs: ["check-wasm-pack.mjs"],
        wasmPackCheckExitCode: "1",
      })
    ).toEqual({
      wasmPackCheckStatus: "ok",
      wasmPackCheckCommand: "node",
      wasmPackCheckArgs: ["check-wasm-pack.mjs"],
      wasmPackCheckArgCount: 1,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckStatus: "ok",
        wasmPackCheckCommand: "   ",
      })
    ).toEqual({
      wasmPackCheckStatus: "ok",
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckOutputLine: "   wasm-pack not found   ",
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: "wasm-pack not found",
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckOutputLine: "\u001b[31m  wasm-pack not found  \u001b[0m",
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: "wasm-pack not found",
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckOutputLine:
          "\n\n\u001b[31m  wasm-pack not found  \u001b[0m\nadditional detail",
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: "wasm-pack not found",
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckOutputLine:
          "\u001b]0;voxelize preflight\u0007  wasm-pack not found  ",
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: "wasm-pack not found",
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckOutputLine: "   ",
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckStatus: " missing ",
      })
    ).toEqual({
      wasmPackCheckStatus: "missing",
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckStatus: " OK ",
      })
    ).toEqual({
      wasmPackCheckStatus: "ok",
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckStatus: "mystery",
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckStatus: "   ",
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
  });

  it("sanitizes malformed wasm pack summary argument arrays", () => {
    const iteratorTrapArgs = ["check-wasm-pack.mjs", "--json"];
    Object.defineProperty(iteratorTrapArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: ["check-wasm-pack.mjs", 1, null],
        wasmPackCheckArgCount: -1,
        wasmPackCheckExitCode: Number.NaN,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs"],
      wasmPackCheckArgCount: 1,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: ["check-wasm-pack.mjs"],
        wasmPackCheckArgCount: Number.MAX_SAFE_INTEGER + 1,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs"],
      wasmPackCheckArgCount: 1,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: iteratorTrapArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs", "--json"],
      wasmPackCheckArgCount: 2,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    const lengthAndOwnKeysTrapWasmArgs = new Proxy(["check-wasm-pack.mjs"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: lengthAndOwnKeysTrapWasmArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    let statefulSparsePrefixReadCount = 0;
    const statefulSparseWasmArgsTarget: string[] = [];
    statefulSparseWasmArgsTarget[0] = "check-wasm-pack.mjs";
    statefulSparseWasmArgsTarget[5_000] = "--json";
    const statefulSparseWasmArgs = new Proxy(statefulSparseWasmArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          statefulSparsePrefixReadCount += 1;
          if (statefulSparsePrefixReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: statefulSparseWasmArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs", "--json"],
      wasmPackCheckArgCount: 2,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    let statefulUndefinedPrefixReadCount = 0;
    const statefulUndefinedPrefixWasmArgsTarget: string[] = [];
    statefulUndefinedPrefixWasmArgsTarget[0] = "check-wasm-pack.mjs";
    statefulUndefinedPrefixWasmArgsTarget[1] = "--json";
    const statefulUndefinedPrefixWasmArgs = new Proxy(
      statefulUndefinedPrefixWasmArgsTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulUndefinedPrefixReadCount += 1;
            if (statefulUndefinedPrefixReadCount === 1) {
              return undefined;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: statefulUndefinedPrefixWasmArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs", "--json"],
      wasmPackCheckArgCount: 2,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    let statefulNullPrefixReadCount = 0;
    const statefulNullPrefixWasmArgsTarget: string[] = [];
    statefulNullPrefixWasmArgsTarget[0] = "check-wasm-pack.mjs";
    statefulNullPrefixWasmArgsTarget[1] = "--json";
    const statefulNullPrefixWasmArgs = new Proxy(statefulNullPrefixWasmArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 2;
        }
        if (propertyKey === "0") {
          statefulNullPrefixReadCount += 1;
          if (statefulNullPrefixReadCount === 1) {
            return null;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: statefulNullPrefixWasmArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs", "--json"],
      wasmPackCheckArgCount: 2,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    let statefulNumericPrefixReadCount = 0;
    const statefulNumericPrefixWasmArgsTarget: string[] = [];
    statefulNumericPrefixWasmArgsTarget[0] = "check-wasm-pack.mjs";
    statefulNumericPrefixWasmArgsTarget[1] = "--json";
    const statefulNumericPrefixWasmArgs = new Proxy(
      statefulNumericPrefixWasmArgsTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNumericPrefixReadCount += 1;
            if (statefulNumericPrefixReadCount === 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: statefulNumericPrefixWasmArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs", "--json"],
      wasmPackCheckArgCount: 2,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    let statefulObjectReplacementReadCount = 0;
    const statefulObjectReplacementWasmArgs = new Proxy(
      ["check-wasm-pack.mjs"],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementReadCount += 1;
            if (statefulObjectReplacementReadCount > 1) {
              return { malformed: true };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: statefulObjectReplacementWasmArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs"],
      wasmPackCheckArgCount: 1,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    let statefulStringReplacementReadCount = 0;
    const statefulStringReplacementWasmArgs = new Proxy(
      ["check-wasm-pack.mjs"],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulStringReplacementReadCount += 1;
            if (statefulStringReplacementReadCount > 1) {
              return "check-wasm-pack-replaced.mjs";
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: statefulStringReplacementWasmArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs"],
      wasmPackCheckArgCount: 1,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
    const ownKeysHasTrapArgs = new Proxy(
      ["check-wasm-pack.mjs", "--json"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        has(target, property) {
          if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
            throw new Error("has trap");
          }
          return Reflect.has(target, property);
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractWasmPackCheckSummaryFromReport({
        wasmPackCheckArgs: ownKeysHasTrapArgs,
      })
    ).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: ["check-wasm-pack.mjs", "--json"],
      wasmPackCheckArgCount: 2,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
  });

  it("caps merged wasm pack fallback argument recovery", () => {
    const cappedMergedArgsTarget: string[] = [];
    cappedMergedArgsTarget[0] = "check-wasm-pack.mjs";
    for (let index = 0; index < 1_024; index += 1) {
      cappedMergedArgsTarget[5_000 + index] = `--k${index}`;
    }
    const fallbackKeyList = Array.from({ length: 1_024 }, (_, index) => {
      return String(5_000 + index);
    });
    const cappedMergedArgs = new Proxy(cappedMergedArgsTarget, {
      ownKeys() {
        return [...fallbackKeyList, "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const summary = extractWasmPackCheckSummaryFromReport({
      wasmPackCheckArgs: cappedMergedArgs,
    });

    expect(summary.wasmPackCheckStatus).toBeNull();
    expect(summary.wasmPackCheckCommand).toBeNull();
    expect(summary.wasmPackCheckExitCode).toBeNull();
    expect(summary.wasmPackCheckOutputLine).toBeNull();
    expect(summary.wasmPackCheckArgs).not.toBeNull();
    if (summary.wasmPackCheckArgs === null) {
      throw new Error("Expected bounded wasm-pack fallback args.");
    }
    expect(summary.wasmPackCheckArgs).toHaveLength(1_024);
    expect(summary.wasmPackCheckArgs[0]).toBe("check-wasm-pack.mjs");
    expect(summary.wasmPackCheckArgs.includes("--k1022")).toBe(true);
    expect(summary.wasmPackCheckArgs.includes("--k1023")).toBe(false);
    expect(summary.wasmPackCheckArgCount).toBe(1_024);

    const cappedSupplementedArgsTarget: Array<string | number> = [];
    cappedSupplementedArgsTarget[0] = "check-wasm-pack.mjs";
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedArgsTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedArgsTarget[5_000 + index] = `--k${index}`;
    }
    const cappedSupplementedFallbackKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedArgs = new Proxy(cappedSupplementedArgsTarget, {
      ownKeys() {
        return [...cappedSupplementedFallbackKeyList, "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const supplementedSummary = extractWasmPackCheckSummaryFromReport({
      wasmPackCheckArgs: cappedSupplementedArgs,
    });
    expect(supplementedSummary.wasmPackCheckArgs).not.toBeNull();
    if (supplementedSummary.wasmPackCheckArgs === null) {
      throw new Error("Expected bounded supplemented wasm-pack fallback args.");
    }
    expect(supplementedSummary.wasmPackCheckArgs).toHaveLength(1_024);
    expect(supplementedSummary.wasmPackCheckArgs[0]).toBe("check-wasm-pack.mjs");
    expect(supplementedSummary.wasmPackCheckArgs.includes("--k1022")).toBe(true);
    expect(supplementedSummary.wasmPackCheckArgs.includes("--k1023")).toBe(false);
    expect(supplementedSummary.wasmPackCheckArgCount).toBe(1_024);
  });

  it("does not cap disjoint wasm pack supplementation when iterator succeeds", () => {
    const uncappedDisjointWasmArgsTarget: string[] = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedDisjointWasmArgsTarget[5_000 + index] = `--high${index}`;
    }
    Object.defineProperty(uncappedDisjointWasmArgsTarget, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: function* () {
        for (let index = 0; index < 450; index += 1) {
          yield index;
        }
        for (let index = 0; index < 450; index += 1) {
          yield `--iter${index}`;
        }
      },
    });

    const summary = extractWasmPackCheckSummaryFromReport({
      wasmPackCheckArgs: uncappedDisjointWasmArgsTarget,
    });
    expect(summary.wasmPackCheckArgs).not.toBeNull();
    if (summary.wasmPackCheckArgs === null) {
      throw new Error("Expected uncapped disjoint wasm-pack args.");
    }
    expect(summary.wasmPackCheckArgs).toHaveLength(1_350);
    expect(summary.wasmPackCheckArgs[0]).toBe("--iter0");
    expect(summary.wasmPackCheckArgs.includes("--iter449")).toBe(true);
    expect(summary.wasmPackCheckArgs.includes("--high899")).toBe(true);
    expect(summary.wasmPackCheckArgCount).toBe(1_350);
  });

  it("creates prefixed wasm pack summary objects", () => {
    expect(
      createPrefixedWasmPackCheckSummary(
        {
          wasmPackCheckStatus: "ok",
          wasmPackCheckCommand: "node",
          wasmPackCheckArgs: ["check-wasm-pack.mjs"],
          wasmPackCheckArgCount: 1,
          wasmPackCheckExitCode: 0,
          wasmPackCheckOutputLine: "wasm-pack 0.12.1",
        },
        "client"
      )
    ).toEqual({
      clientWasmPackCheckStatus: "ok",
      clientWasmPackCheckCommand: "node",
      clientWasmPackCheckArgs: ["check-wasm-pack.mjs"],
      clientWasmPackCheckArgCount: 1,
      clientWasmPackCheckExitCode: 0,
      clientWasmPackCheckOutputLine: "wasm-pack 0.12.1",
    });
    expect(createPrefixedWasmPackCheckSummary(null)).toEqual({
      wasmPackCheckStatus: null,
      wasmPackCheckCommand: null,
      wasmPackCheckArgs: null,
      wasmPackCheckArgCount: null,
      wasmPackCheckExitCode: null,
      wasmPackCheckOutputLine: null,
    });
  });

  it("normalizes ts-core payload issue lists", () => {
    expect(normalizeTsCorePayloadIssues(null)).toBeNull();
    expect(normalizeTsCorePayloadIssues("voxel.id")).toBeNull();
    expect(
      normalizeTsCorePayloadIssues([
        " voxel.id ",
        "",
        "light.red",
        "light.red",
        9,
        "rotatedAabb.bounds",
      ])
    ).toEqual(["voxel.id", "light.red", "rotatedAabb.bounds"]);
    expect(
      normalizeTsCorePayloadIssues(["light.red", "voxel.id", "light.red"])
    ).toEqual(["light.red", "voxel.id"]);
    const iteratorTrapIssues = ["voxel.id"];
    Object.defineProperty(iteratorTrapIssues, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    expect(normalizeTsCorePayloadIssues(iteratorTrapIssues)).toEqual(["voxel.id"]);
    const ownKeysTrapIssues = new Proxy(["voxel.id"], {
      ownKeys: () => {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(normalizeTsCorePayloadIssues(ownKeysTrapIssues)).toEqual([
      "voxel.id",
    ]);
    const ownKeysHasTrapIssues = new Proxy(["voxel.id"], {
      ownKeys: () => {
        throw new Error("ownKeys trap");
      },
      has(target, property) {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          throw new Error("has trap");
        }
        return Reflect.has(target, property);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(normalizeTsCorePayloadIssues(ownKeysHasTrapIssues)).toEqual([
      "voxel.id",
    ]);
    const lengthAndOwnKeysTrapIssues = new Proxy(["voxel.id"], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(normalizeTsCorePayloadIssues(lengthAndOwnKeysTrapIssues)).toBeNull();
    const inheritedIndexIssues: string[] = [];
    inheritedIndexIssues.length = 1;
    const inheritedIndexIssuesPrototype = Object.create(Array.prototype) as {
      readonly 0: string;
    };
    Object.defineProperty(inheritedIndexIssuesPrototype, 0, {
      configurable: true,
      enumerable: true,
      value: " voxel.id ",
    });
    Object.setPrototypeOf(inheritedIndexIssues, inheritedIndexIssuesPrototype);
    Object.defineProperty(inheritedIndexIssues, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    expect(normalizeTsCorePayloadIssues(inheritedIndexIssues)).toEqual([]);
    Object.setPrototypeOf(inheritedIndexIssues, Array.prototype);
    const sparseHighIndexIssues: string[] = [];
    sparseHighIndexIssues[5_000] = " voxel.id ";
    Object.defineProperty(sparseHighIndexIssues, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    expect(normalizeTsCorePayloadIssues(sparseHighIndexIssues)).toEqual([
      "voxel.id",
    ]);
    const sparseMixedPrefixAndHighIndexIssues: string[] = [];
    sparseMixedPrefixAndHighIndexIssues[0] = "voxel.id";
    sparseMixedPrefixAndHighIndexIssues[5_000] = " light.red ";
    Object.defineProperty(
      sparseMixedPrefixAndHighIndexIssues,
      Symbol.iterator,
      {
        configurable: true,
        enumerable: false,
        get: () => {
          throw new Error("iterator trap");
        },
      }
    );
    expect(
      normalizeTsCorePayloadIssues(sparseMixedPrefixAndHighIndexIssues)
    ).toEqual(["voxel.id", "light.red"]);
    let statefulUndefinedPrefixReadCount = 0;
    const statefulUndefinedPrefixIssuesTarget: string[] = [];
    statefulUndefinedPrefixIssuesTarget[0] = " voxel.id ";
    statefulUndefinedPrefixIssuesTarget[1] = " light.red ";
    const statefulUndefinedPrefixIssues = new Proxy(
      statefulUndefinedPrefixIssuesTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulUndefinedPrefixReadCount += 1;
            if (statefulUndefinedPrefixReadCount === 1) {
              return undefined;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(normalizeTsCorePayloadIssues(statefulUndefinedPrefixIssues)).toEqual([
      "voxel.id",
      "light.red",
    ]);
    let statefulNullPrefixReadCount = 0;
    const statefulNullPrefixIssuesTarget: string[] = [];
    statefulNullPrefixIssuesTarget[0] = " voxel.id ";
    statefulNullPrefixIssuesTarget[1] = " light.red ";
    const statefulNullPrefixIssues = new Proxy(statefulNullPrefixIssuesTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 2;
        }
        if (propertyKey === "0") {
          statefulNullPrefixReadCount += 1;
          if (statefulNullPrefixReadCount === 1) {
            return null;
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(normalizeTsCorePayloadIssues(statefulNullPrefixIssues)).toEqual([
      "voxel.id",
      "light.red",
    ]);
    let statefulNumericPrefixReadCount = 0;
    const statefulNumericPrefixIssuesTarget: string[] = [];
    statefulNumericPrefixIssuesTarget[0] = " voxel.id ";
    statefulNumericPrefixIssuesTarget[1] = " light.red ";
    const statefulNumericPrefixIssues = new Proxy(
      statefulNumericPrefixIssuesTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNumericPrefixReadCount += 1;
            if (statefulNumericPrefixReadCount === 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(normalizeTsCorePayloadIssues(statefulNumericPrefixIssues)).toEqual([
      "voxel.id",
      "light.red",
    ]);
    const sparseHighIndexWithUndefinedPrefixIssues: Array<string | undefined> = [];
    sparseHighIndexWithUndefinedPrefixIssues[0] = undefined;
    sparseHighIndexWithUndefinedPrefixIssues[5_000] = " voxel.id ";
    Object.defineProperty(
      sparseHighIndexWithUndefinedPrefixIssues,
      Symbol.iterator,
      {
        configurable: true,
        enumerable: false,
        get: () => {
          throw new Error("iterator trap");
        },
      }
    );
    expect(
      normalizeTsCorePayloadIssues(sparseHighIndexWithUndefinedPrefixIssues)
    ).toEqual(["voxel.id"]);
    const sparseHighIndexWithNumericPrefixIssues: Array<string | number> = [];
    sparseHighIndexWithNumericPrefixIssues[0] = 1;
    sparseHighIndexWithNumericPrefixIssues[5_000] = " voxel.id ";
    Object.defineProperty(
      sparseHighIndexWithNumericPrefixIssues,
      Symbol.iterator,
      {
        configurable: true,
        enumerable: false,
        get: () => {
          throw new Error("iterator trap");
        },
      }
    );
    expect(
      normalizeTsCorePayloadIssues(sparseHighIndexWithNumericPrefixIssues)
    ).toEqual(["voxel.id"]);
    const denseNonStringPrefixHighIndexIssues: Array<number | string> = [];
    for (let index = 0; index < 1_024; index += 1) {
      denseNonStringPrefixHighIndexIssues[index] = index;
    }
    denseNonStringPrefixHighIndexIssues[5_000] = " voxel.id ";
    Object.defineProperty(denseNonStringPrefixHighIndexIssues, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    expect(
      normalizeTsCorePayloadIssues(denseNonStringPrefixHighIndexIssues)
    ).toEqual(["voxel.id"]);
    let statefulObjectReplacementReadCount = 0;
    const statefulObjectReplacementIssues = new Proxy([" voxel.id "], {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          statefulObjectReplacementReadCount += 1;
          if (statefulObjectReplacementReadCount > 1) {
            return { malformed: true };
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(normalizeTsCorePayloadIssues(statefulObjectReplacementIssues)).toEqual([
      "voxel.id",
    ]);
    let statefulStringReplacementReadCount = 0;
    const statefulStringReplacementIssues = new Proxy([" voxel.id "], {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          statefulStringReplacementReadCount += 1;
          if (statefulStringReplacementReadCount > 1) {
            return " light.red ";
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(normalizeTsCorePayloadIssues(statefulStringReplacementIssues)).toEqual([
      "voxel.id",
    ]);
    const cappedSupplementedIssuesTarget: Array<string | number> = [];
    cappedSupplementedIssuesTarget[0] = " voxel.id ";
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedIssuesTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedIssuesTarget[5_000 + index] = ` issue.k${index} `;
    }
    const cappedSupplementedIssueKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedIssues = new Proxy(cappedSupplementedIssuesTarget, {
      ownKeys() {
        return [...cappedSupplementedIssueKeyList, "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const normalizedCappedSupplementedIssues = normalizeTsCorePayloadIssues(
      cappedSupplementedIssues
    );
    expect(normalizedCappedSupplementedIssues).not.toBeNull();
    if (normalizedCappedSupplementedIssues === null) {
      throw new Error("Expected normalized capped supplemented payload issues.");
    }
    expect(normalizedCappedSupplementedIssues).toHaveLength(1_024);
    expect(normalizedCappedSupplementedIssues[0]).toBe("voxel.id");
    expect(normalizedCappedSupplementedIssues.includes("issue.k1022")).toBe(true);
    expect(normalizedCappedSupplementedIssues.includes("issue.k1023")).toBe(
      false
    );
  });

  it("does not cap disjoint payload issue supplementation when iterator succeeds", () => {
    const uncappedDisjointIssuesTarget: string[] = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedDisjointIssuesTarget[5_000 + index] = ` issue.high${index} `;
    }
    Object.defineProperty(uncappedDisjointIssuesTarget, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: function* () {
        for (let index = 0; index < 450; index += 1) {
          yield index;
        }
        for (let index = 0; index < 450; index += 1) {
          yield ` issue.iter${index} `;
        }
      },
    });
    const normalizedUncappedDisjointIssues = normalizeTsCorePayloadIssues(
      uncappedDisjointIssuesTarget
    );
    expect(normalizedUncappedDisjointIssues).not.toBeNull();
    if (normalizedUncappedDisjointIssues === null) {
      throw new Error("Expected uncapped disjoint normalized payload issues.");
    }
    expect(normalizedUncappedDisjointIssues).toHaveLength(1_350);
    expect(normalizedUncappedDisjointIssues[0]).toBe("issue.iter0");
    expect(normalizedUncappedDisjointIssues.includes("issue.iter449")).toBe(true);
    expect(normalizedUncappedDisjointIssues.includes("issue.high899")).toBe(true);
  });

  it("extracts ts-core example summary fields from reports", () => {
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleCommand: "node",
        exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
        exampleArgCount: 1,
        exampleAttempted: true,
        exampleStatus: "ok",
        exampleRuleMatched: true,
        examplePayloadValid: true,
        examplePayloadIssues: [],
        examplePayloadIssueCount: 0,
        exampleExitCode: 0,
        exampleDurationMs: 125,
        exampleOutputLine: "{\"ruleMatched\":true}",
      })
    ).toEqual({
      exampleCommand: "node",
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "ok",
      exampleRuleMatched: true,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      examplePayloadIssueCount: 0,
      exampleExitCode: 0,
      exampleDurationMs: 125,
      exampleOutputLine: "{\"ruleMatched\":true}",
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleCommand: "   ",
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
        exampleOutputLine: "  ruleMatched=true  ",
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: false,
      exampleStatus: "skipped",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
        exampleOutputLine: "\u001b[32m  ruleMatched=true  \u001b[0m",
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: false,
      exampleStatus: "skipped",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
        exampleOutputLine:
          "\n\n\u001b[32m  ruleMatched=true  \u001b[0m\npayload validation skipped",
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: false,
      exampleStatus: "skipped",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
        exampleOutputLine:
          "\u001b]0;ts-core example\u0007  ruleMatched=true  ",
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: false,
      exampleStatus: "skipped",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
        exampleOutputLine: "   ",
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: false,
      exampleStatus: "skipped",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: true,
        exampleStatus: "mystery",
        exampleRuleMatched: true,
        examplePayloadValid: true,
        exampleExitCode: 0,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: true,
      exampleStatus: "ok",
      exampleRuleMatched: true,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      examplePayloadIssueCount: 0,
      exampleExitCode: 0,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
        exampleStatus: "mystery",
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: false,
      exampleStatus: "skipped",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: true,
        exampleStatus: "   ",
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
        exampleStatus: " ok ",
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: false,
      exampleStatus: "ok",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
        exampleStatus: " FAILED ",
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: false,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
        exampleAttempted: true,
        exampleExitCode: 0,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 0,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
        exampleAttempted: true,
        exampleRuleMatched: true,
        examplePayloadValid: false,
        examplePayloadIssues: ["voxel.rotation"],
        exampleExitCode: 0,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: ["voxel.rotation"],
      examplePayloadIssueCount: 1,
      exampleExitCode: 0,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: true,
        exampleRuleMatched: true,
        examplePayloadValid: false,
        examplePayloadIssues: [" voxel.rotation ", "light.red", "", "light.red", 3],
        examplePayloadIssueCount: 99,
        exampleExitCode: 0,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: ["voxel.rotation", "light.red"],
      examplePayloadIssueCount: 2,
      exampleExitCode: 0,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: true,
        exampleRuleMatched: true,
        examplePayloadValid: true,
        examplePayloadIssues: ["voxel.id"],
        examplePayloadIssueCount: 12,
        exampleExitCode: 0,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: true,
      exampleStatus: "ok",
      exampleRuleMatched: true,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      examplePayloadIssueCount: 0,
      exampleExitCode: 0,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(extractTsCoreExampleSummaryFromReport(null)).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: null,
      exampleStatus: null,
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
  });

  it("sanitizes malformed ts-core example argument arrays", () => {
    const iteratorTrapArgs = ["packages/ts-core/examples/end-to-end.mjs"];
    Object.defineProperty(iteratorTrapArgs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: ["packages/ts-core/examples/end-to-end.mjs", 4, null],
        exampleArgCount: -1,
        exampleAttempted: true,
        exampleExitCode: 1,
        exampleDurationMs: Number.NaN,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
        exampleArgCount: Number.MAX_SAFE_INTEGER + 1,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
        exampleAttempted: true,
        exampleExitCode: 1,
        exampleDurationMs: -1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: iteratorTrapArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    const lengthAndOwnKeysTrapExampleArgs = new Proxy(
      ["packages/ts-core/examples/end-to-end.mjs"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: lengthAndOwnKeysTrapExampleArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    let statefulSparsePrefixReadCount = 0;
    const statefulSparseExampleArgsTarget: string[] = [];
    statefulSparseExampleArgsTarget[0] = "packages/ts-core/examples/end-to-end.mjs";
    statefulSparseExampleArgsTarget[5_000] = "--json";
    const statefulSparseExampleArgs = new Proxy(statefulSparseExampleArgsTarget, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          statefulSparsePrefixReadCount += 1;
          if (statefulSparsePrefixReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: statefulSparseExampleArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs", "--json"],
      exampleArgCount: 2,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    let statefulUndefinedPrefixReadCount = 0;
    const statefulUndefinedPrefixExampleArgsTarget: string[] = [];
    statefulUndefinedPrefixExampleArgsTarget[0] =
      "packages/ts-core/examples/end-to-end.mjs";
    statefulUndefinedPrefixExampleArgsTarget[1] = "--json";
    const statefulUndefinedPrefixExampleArgs = new Proxy(
      statefulUndefinedPrefixExampleArgsTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulUndefinedPrefixReadCount += 1;
            if (statefulUndefinedPrefixReadCount === 1) {
              return undefined;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: statefulUndefinedPrefixExampleArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs", "--json"],
      exampleArgCount: 2,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    let statefulNullPrefixReadCount = 0;
    const statefulNullPrefixExampleArgsTarget: string[] = [];
    statefulNullPrefixExampleArgsTarget[0] =
      "packages/ts-core/examples/end-to-end.mjs";
    statefulNullPrefixExampleArgsTarget[1] = "--json";
    const statefulNullPrefixExampleArgs = new Proxy(
      statefulNullPrefixExampleArgsTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNullPrefixReadCount += 1;
            if (statefulNullPrefixReadCount === 1) {
              return null;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: statefulNullPrefixExampleArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs", "--json"],
      exampleArgCount: 2,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    let statefulNumericPrefixReadCount = 0;
    const statefulNumericPrefixExampleArgsTarget: string[] = [];
    statefulNumericPrefixExampleArgsTarget[0] =
      "packages/ts-core/examples/end-to-end.mjs";
    statefulNumericPrefixExampleArgsTarget[1] = "--json";
    const statefulNumericPrefixExampleArgs = new Proxy(
      statefulNumericPrefixExampleArgsTarget,
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          if (propertyKey === "0") {
            statefulNumericPrefixReadCount += 1;
            if (statefulNumericPrefixReadCount === 1) {
              return 1;
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: statefulNumericPrefixExampleArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs", "--json"],
      exampleArgCount: 2,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    let statefulObjectReplacementReadCount = 0;
    const statefulObjectReplacementExampleArgs = new Proxy(
      ["packages/ts-core/examples/end-to-end.mjs"],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulObjectReplacementReadCount += 1;
            if (statefulObjectReplacementReadCount > 1) {
              return { malformed: true };
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: statefulObjectReplacementExampleArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    let statefulStringReplacementReadCount = 0;
    const statefulStringReplacementExampleArgs = new Proxy(
      ["packages/ts-core/examples/end-to-end.mjs"],
      {
        get(target, property, receiver) {
          const propertyKey =
            typeof property === "number" ? String(property) : property;
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          if (propertyKey === "0") {
            statefulStringReplacementReadCount += 1;
            if (statefulStringReplacementReadCount > 1) {
              return "packages/ts-core/examples/replaced.mjs";
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: statefulStringReplacementExampleArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
    const ownKeysHasTrapArgs = new Proxy(
      ["packages/ts-core/examples/end-to-end.mjs"],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        has(target, property) {
          if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
            throw new Error("has trap");
          }
          return Reflect.has(target, property);
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1_000_000_000;
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleArgs: ownKeysHasTrapArgs,
        exampleAttempted: true,
        exampleExitCode: 1,
      })
    ).toEqual({
      exampleCommand: null,
      exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      exampleArgCount: 1,
      exampleAttempted: true,
      exampleStatus: "failed",
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: 1,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
  });

  it("caps merged ts-core example fallback argument recovery", () => {
    const cappedMergedArgsTarget: string[] = [];
    cappedMergedArgsTarget[0] = "packages/ts-core/examples/end-to-end.mjs";
    for (let index = 0; index < 1_024; index += 1) {
      cappedMergedArgsTarget[5_000 + index] = `--k${index}`;
    }
    const fallbackKeyList = Array.from({ length: 1_024 }, (_, index) => {
      return String(5_000 + index);
    });
    const cappedMergedArgs = new Proxy(cappedMergedArgsTarget, {
      ownKeys() {
        return [...fallbackKeyList, "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const summary = extractTsCoreExampleSummaryFromReport({
      exampleArgs: cappedMergedArgs,
      exampleAttempted: true,
      exampleExitCode: 1,
    });

    expect(summary.exampleCommand).toBeNull();
    expect(summary.exampleStatus).toBe("failed");
    expect(summary.exampleExitCode).toBe(1);
    expect(summary.exampleArgs).not.toBeNull();
    if (summary.exampleArgs === null) {
      throw new Error("Expected bounded example fallback args.");
    }
    expect(summary.exampleArgs).toHaveLength(1_024);
    expect(summary.exampleArgs[0]).toBe("packages/ts-core/examples/end-to-end.mjs");
    expect(summary.exampleArgs.includes("--k1022")).toBe(true);
    expect(summary.exampleArgs.includes("--k1023")).toBe(false);
    expect(summary.exampleArgCount).toBe(1_024);

    const cappedSupplementedArgsTarget: Array<string | number> = [];
    cappedSupplementedArgsTarget[0] = "packages/ts-core/examples/end-to-end.mjs";
    for (let index = 1; index < 1_024; index += 1) {
      cappedSupplementedArgsTarget[index] = index;
    }
    for (let index = 0; index < 1_024; index += 1) {
      cappedSupplementedArgsTarget[5_000 + index] = `--k${index}`;
    }
    const cappedSupplementedFallbackKeyList = Array.from(
      { length: 1_024 },
      (_, index) => {
        return String(5_000 + index);
      }
    );
    const cappedSupplementedArgs = new Proxy(cappedSupplementedArgsTarget, {
      ownKeys() {
        return [...cappedSupplementedFallbackKeyList, "length"];
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const supplementedSummary = extractTsCoreExampleSummaryFromReport({
      exampleArgs: cappedSupplementedArgs,
      exampleAttempted: true,
      exampleExitCode: 1,
    });
    expect(supplementedSummary.exampleArgs).not.toBeNull();
    if (supplementedSummary.exampleArgs === null) {
      throw new Error("Expected bounded supplemented ts-core fallback args.");
    }
    expect(supplementedSummary.exampleArgs).toHaveLength(1_024);
    expect(supplementedSummary.exampleArgs[0]).toBe(
      "packages/ts-core/examples/end-to-end.mjs"
    );
    expect(supplementedSummary.exampleArgs.includes("--k1022")).toBe(true);
    expect(supplementedSummary.exampleArgs.includes("--k1023")).toBe(false);
    expect(supplementedSummary.exampleArgCount).toBe(1_024);
  });

  it("does not cap disjoint ts-core example supplementation when iterator succeeds", () => {
    const uncappedDisjointExampleArgsTarget: string[] = [];
    for (let index = 0; index < 900; index += 1) {
      uncappedDisjointExampleArgsTarget[5_000 + index] = `--high${index}`;
    }
    Object.defineProperty(uncappedDisjointExampleArgsTarget, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: function* () {
        for (let index = 0; index < 450; index += 1) {
          yield index;
        }
        for (let index = 0; index < 450; index += 1) {
          yield `--iter${index}`;
        }
      },
    });

    const summary = extractTsCoreExampleSummaryFromReport({
      exampleArgs: uncappedDisjointExampleArgsTarget,
      exampleAttempted: true,
      exampleExitCode: 1,
    });
    expect(summary.exampleArgs).not.toBeNull();
    if (summary.exampleArgs === null) {
      throw new Error("Expected uncapped disjoint ts-core example args.");
    }
    expect(summary.exampleArgs).toHaveLength(1_350);
    expect(summary.exampleArgs[0]).toBe("--iter0");
    expect(summary.exampleArgs.includes("--iter449")).toBe(true);
    expect(summary.exampleArgs.includes("--high899")).toBe(true);
    expect(summary.exampleArgCount).toBe(1_350);
  });

  it("creates prefixed ts-core example summary objects", () => {
    expect(
      createPrefixedTsCoreExampleSummary(
        {
          exampleCommand: "node",
          exampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
          exampleAttempted: true,
          exampleStatus: "ok",
          exampleRuleMatched: true,
          examplePayloadValid: true,
          examplePayloadIssues: [],
          examplePayloadIssueCount: 0,
          exampleExitCode: 0,
          exampleDurationMs: 125,
          exampleOutputLine: "{\"ruleMatched\":true}",
        },
        "tsCore"
      )
    ).toEqual({
      tsCoreExampleCommand: "node",
      tsCoreExampleArgs: ["packages/ts-core/examples/end-to-end.mjs"],
      tsCoreExampleArgCount: 1,
      tsCoreExampleAttempted: true,
      tsCoreExampleStatus: "ok",
      tsCoreExampleRuleMatched: true,
      tsCoreExamplePayloadValid: true,
      tsCoreExamplePayloadIssues: [],
      tsCoreExamplePayloadIssueCount: 0,
      tsCoreExampleExitCode: 0,
      tsCoreExampleDurationMs: 125,
      tsCoreExampleOutputLine: "{\"ruleMatched\":true}",
    });
    expect(createPrefixedTsCoreExampleSummary(null)).toEqual({
      exampleCommand: null,
      exampleArgs: null,
      exampleArgCount: null,
      exampleAttempted: null,
      exampleStatus: null,
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      examplePayloadIssueCount: null,
      exampleExitCode: null,
      exampleDurationMs: null,
      exampleOutputLine: null,
    });
  });

  it("derives ts-core example status from attempt, rule, and payload flags", () => {
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: true,
        exampleExitCode: 0,
        exampleRuleMatched: true,
        examplePayloadValid: true,
      }).exampleStatus
    ).toBe("ok");
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: true,
        exampleExitCode: 0,
        exampleRuleMatched: false,
        examplePayloadValid: true,
      }).exampleStatus
    ).toBe("failed");
    expect(
      extractTsCoreExampleSummaryFromReport({
        exampleAttempted: false,
      }).exampleStatus
    ).toBe("skipped");
  });

  it("summarizes ts-core example output payloads", () => {
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
          patternMatched: true,
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
          patternMatched: false,
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: ["patternMatched"],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
          patternMatched: "yes",
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: ["patternMatched"],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput('{"ruleMatched":false}')
    ).toEqual({
      exampleRuleMatched: false,
      examplePayloadValid: false,
      examplePayloadIssues: [
        "voxel",
        "light",
        "rotatedAabb",
      ],
      exampleOutputLine: "ruleMatched=false",
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: false,
        })
      )
    ).toEqual({
      exampleRuleMatched: false,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      exampleOutputLine: "ruleMatched=false",
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [2, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: ["rotatedAabb.bounds"],
      exampleOutputLine: "ruleMatched=true",
    });
    const payloadWithoutRuleMatched = JSON.stringify({
      voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
      light: { sunlight: 15, red: 10, green: 5, blue: 3 },
      rotatedAabb: {
        min: [0, 0, 0],
        max: [1, 1, 1],
      },
    });
    expect(summarizeTsCoreExampleOutput(payloadWithoutRuleMatched)).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      exampleOutputLine: payloadWithoutRuleMatched,
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 7 },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: ["voxel.rotation"],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 16, rotation: { value: 0, yRotation: 0 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: ["voxel.stage"],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 6, yRotation: 0 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: ["voxel.rotation.value"],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput(
        `warning: warmup log\n${JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
        })}`
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput(
        `${JSON.stringify({
          voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
          light: { sunlight: 15, red: 10, green: 5, blue: 3 },
          rotatedAabb: {
            min: [0, 0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
        })}\ntrue`
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: true,
      examplePayloadIssues: [],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify({
          voxel: {
            id: -1,
            stage: 16,
            rotation: { value: 7, yRotation: Number.POSITIVE_INFINITY },
          },
          light: { sunlight: 15, red: 16, green: 5, blue: -1 },
          rotatedAabb: {
            min: [0, 0],
            max: [1, 1, 1],
          },
          ruleMatched: true,
        })
      )
    ).toEqual({
      exampleRuleMatched: true,
      examplePayloadValid: false,
      examplePayloadIssues: [
        "voxel.id",
        "voxel.stage",
        "voxel.rotation.value",
        "voxel.rotation.yRotation",
        "light.red",
        "light.blue",
        "rotatedAabb.min",
      ],
      exampleOutputLine: "ruleMatched=true",
    });
    expect(summarizeTsCoreExampleOutput("warning: no json")).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: "warning: no json",
    });
    expect(summarizeTsCoreExampleOutput(null)).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: null,
    });
    expect(
      summarizeTsCoreExampleOutput("\u001b[33mwarning: no json\u001b[39m")
    ).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: "warning: no json",
    });
    expect(
      summarizeTsCoreExampleOutput("\r\uFEFFwarning: no json")
    ).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: "warning: no json",
    });
    expect(summarizeTsCoreExampleOutput("\u001b[33m\u001b[39m")).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: null,
    });
    expect(
      summarizeTsCoreExampleOutput(
        JSON.stringify([
          {
            voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
            light: { sunlight: 15, red: 10, green: 5, blue: 3 },
            rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
            ruleMatched: true,
          },
        ])
      )
    ).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine:
        '[{"voxel":{"id":42,"stage":7,"rotation":{"value":0,"yRotation":2.356}},"light":{"sunlight":15,"red":10,"green":5,"blue":3},"rotatedAabb":{"min":[0,0,0],"max":[1,1,1]},"ruleMatched":true}]',
    });
    expect(
      summarizeTsCoreExampleOutput(
        '{"ruleMatched":true}[{"ruleMatched":false}]'
      )
    ).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: '[{"ruleMatched":false}]',
    });
    expect(summarizeTsCoreExampleOutput("")).toEqual({
      exampleRuleMatched: null,
      examplePayloadValid: null,
      examplePayloadIssues: null,
      exampleOutputLine: null,
    });
  });

  it("extracts wasm pack status from nested summary or check map reports", () => {
    const reportWithThrowingDirectStatus = Object.create(null) as {
      readonly wasmPackCheckStatus: string;
      readonly checkStatusMap: Record<string, string>;
    };
    Object.defineProperty(reportWithThrowingDirectStatus, "wasmPackCheckStatus", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("status trap");
      },
    });
    Object.defineProperty(reportWithThrowingDirectStatus, "checkStatusMap", {
      configurable: true,
      enumerable: true,
      value: {
        "wasm-pack": "ok",
      },
    });
    const reportWithThrowingCheckMap = Object.create(null) as {
      readonly checkStatusMap: Record<string, string>;
    };
    Object.defineProperty(reportWithThrowingCheckMap, "checkStatusMap", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("check map trap");
      },
    });

    expect(
      extractWasmPackStatusFromReport({
        wasmPackCheckStatus: "missing",
      })
    ).toBe("missing");
    expect(
      extractWasmPackStatusFromReport({
        checkStatusMap: {
          "wasm-pack": "ok",
        },
      })
    ).toBe("ok");
    expect(
      extractWasmPackStatusFromReport({
        wasmPackCheckStatus: " ok ",
      })
    ).toBe("ok");
    expect(
      extractWasmPackStatusFromReport({
        checkStatusMap: {
          "wasm-pack": " missing ",
        },
      })
    ).toBe("missing");
    expect(
      extractWasmPackStatusFromReport({
        wasmPackCheckStatus: " UnAvAiLaBlE ",
      })
    ).toBe("unavailable");
    expect(
      extractWasmPackStatusFromReport({
        checkStatusMap: {
          " WASM-PACK ": " OK ",
        },
      })
    ).toBe("ok");
    const reportWithTrimmedWasmPackMapKey = Object.create(null) as {
      readonly checkStatusMap: Record<string, string>;
    };
    Object.defineProperty(reportWithTrimmedWasmPackMapKey, "checkStatusMap", {
      configurable: true,
      enumerable: true,
      value: Object.create(null),
    });
    Object.defineProperty(
      reportWithTrimmedWasmPackMapKey.checkStatusMap,
      " WASM-PACK ",
      {
        configurable: true,
        enumerable: true,
        value: " missing ",
      }
    );
    Object.defineProperty(
      reportWithTrimmedWasmPackMapKey.checkStatusMap,
      " bad-key ",
      {
        configurable: true,
        enumerable: true,
        get: () => {
          throw new Error("status trap");
        },
      }
    );
    expect(extractWasmPackStatusFromReport(reportWithTrimmedWasmPackMapKey)).toBe(
      "missing"
    );
    expect(
      extractWasmPackStatusFromReport({
        wasmPackCheckStatus: "mystery",
      })
    ).toBeNull();
    expect(
      extractWasmPackStatusFromReport({
        wasmPackCheckStatus: "   ",
      })
    ).toBeNull();
    expect(
      extractWasmPackStatusFromReport({
        checkStatusMap: {
          "wasm-pack": "mystery",
        },
      })
    ).toBeNull();
    expect(extractWasmPackStatusFromReport(reportWithThrowingDirectStatus)).toBe("ok");
    expect(extractWasmPackStatusFromReport(reportWithThrowingCheckMap)).toBeNull();
    expect(extractWasmPackStatusFromReport({ checkStatusMap: {} })).toBeNull();
    expect(extractWasmPackStatusFromReport(null)).toBeNull();
  });

  it("derives wasm pack status with report and exit-code fallbacks", () => {
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: null,
        wasmPackCheckReport: null,
      })
    ).toBe("skipped");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: 0,
        wasmPackCheckReport: null,
      })
    ).toBe("ok");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: 1,
        wasmPackCheckReport: null,
      })
    ).toBe("unavailable");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: 1,
        wasmPackCheckReport: {
          checkStatusMap: {
            "wasm-pack": "missing",
          },
        },
      })
    ).toBe("missing");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: 1,
        wasmPackCheckReport: {
          checkStatusMap: {
            " WASM-PACK ": " OK ",
          },
        },
      })
    ).toBe("ok");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: 0,
        wasmPackCheckReport: {
          wasmPackCheckStatus: " missing ",
        },
      })
    ).toBe("missing");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: 1,
        wasmPackCheckReport: {
          checkStatusMap: {
            "wasm-pack": " MiSsInG ",
          },
        },
      })
    ).toBe("missing");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: 0,
        wasmPackCheckReport: {
          wasmPackCheckStatus: "mystery",
        },
      })
    ).toBe("ok");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: Number.NaN,
        wasmPackCheckReport: null,
      })
    ).toBe("skipped");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: -1,
        wasmPackCheckReport: null,
      })
    ).toBe("skipped");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: Number.MAX_SAFE_INTEGER + 1,
        wasmPackCheckReport: null,
      })
    ).toBe("skipped");
    expect(
      deriveWasmPackCheckStatus({
        wasmPackCheckExitCode: "0",
        wasmPackCheckReport: null,
      })
    ).toBe("skipped");
  });
});
