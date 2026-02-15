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

type ActiveCliOptionMetadata = {
  activeCliOptions: string[];
  activeCliOptionCount: number;
  activeCliOptionTokens: string[];
  activeCliOptionResolutions: Array<{
    token: string;
    canonicalOption: string;
  }>;
  activeCliOptionResolutionCount: number;
  activeCliOptionOccurrences: Array<{
    token: string;
    canonicalOption: string;
    index: number;
  }>;
  activeCliOptionOccurrenceCount: number;
};

type CliOptionCatalogMetadata = {
  availableCliOptionAliases: Record<string, string[]>;
  availableCliOptionCanonicalMap: Record<string, string>;
  supportedCliOptionCount: number;
};

type WasmPackCheckMetadata = {
  checkIndex: number;
  command: string;
  args: string[];
  argCount: number;
  checkCommand: string;
  checkArgs: string[];
  checkArgCount: number;
};

type WasmPackFailureSummary = {
  name: string;
  checkIndex: number;
  command: string;
  args: string[];
  argCount: number;
  checkCommand: string;
  checkArgs: string[];
  checkArgCount: number;
  exitCode: number;
  status: string;
  message: string | null;
};

type WasmPackJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  command: string;
  version: string | null;
  availableChecks: string[];
  availableCheckCount: number;
  availableCheckIndices: number[];
  availableCheckIndexCount: number;
  availableCheckCommandMap: Record<string, string>;
  availableCheckCommandMapCount: number;
  availableCheckArgsMap: Record<string, string[]>;
  availableCheckArgsMapCount: number;
  availableCheckArgCountMap: Record<string, number>;
  availableCheckArgCountMapCount: number;
  availableCheckMetadata: Record<string, WasmPackCheckMetadata>;
  availableCheckMetadataCount: number;
  availableCheckIndexMap: Record<string, number>;
  availableCheckIndexMapCount: number;
  checkLabels: string[];
  checkCount: number;
  checkIndices: number[];
  checkIndexCount: number;
  checkIndexMap: Record<string, number>;
  checkIndexMapCount: number;
  checkCommandMap: Record<string, string>;
  checkCommandMapCount: number;
  checkArgsMap: Record<string, string[]>;
  checkArgsMapCount: number;
  checkArgCountMap: Record<string, number>;
  checkArgCountMapCount: number;
  checkMetadata: Record<string, WasmPackCheckMetadata>;
  checkMetadataCount: number;
  checkStatusMap: Record<string, string>;
  checkStatusMapCount: number;
  checkStatusCountMap: Record<string, number>;
  checkStatusCountMapCount: number;
  checkVersionMap: Record<string, string | null>;
  checkVersionMapCount: number;
  checkExitCodeMap: Record<string, number>;
  checkExitCodeMapCount: number;
  checkOutputLineMap: Record<string, string | null>;
  checkOutputLineMapCount: number;
  passedChecks: string[];
  passedCheckCount: number;
  passedCheckIndices: number[];
  passedCheckIndexCount: number;
  passedCheckIndexMap: Record<string, number>;
  passedCheckIndexMapCount: number;
  passedCheckCommandMap: Record<string, string>;
  passedCheckCommandMapCount: number;
  passedCheckArgsMap: Record<string, string[]>;
  passedCheckArgsMapCount: number;
  passedCheckArgCountMap: Record<string, number>;
  passedCheckArgCountMapCount: number;
  passedCheckMetadata: Record<string, WasmPackCheckMetadata>;
  passedCheckMetadataCount: number;
  failedChecks: string[];
  failedCheckCount: number;
  failedCheckIndices: number[];
  failedCheckIndexCount: number;
  failedCheckIndexMap: Record<string, number>;
  failedCheckIndexMapCount: number;
  failedCheckCommandMap: Record<string, string>;
  failedCheckCommandMapCount: number;
  failedCheckArgsMap: Record<string, string[]>;
  failedCheckArgsMapCount: number;
  failedCheckArgCountMap: Record<string, number>;
  failedCheckArgCountMapCount: number;
  failedCheckMetadata: Record<string, WasmPackCheckMetadata>;
  failedCheckMetadataCount: number;
  failureSummaries: WasmPackFailureSummary[];
  failureSummaryCount: number;
  outputPath: string | null;
  unknownOptions: string[];
  unknownOptionCount: number;
  supportedCliOptions: string[];
  validationErrorCode:
    | "output_option_missing_value"
    | "unsupported_options"
    | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  writeError?: string;
  message?: string;
} & CliOptionCatalogMetadata;

type WasmMesherJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  artifactPath: string;
  artifactFound: boolean;
  attemptedBuild: boolean;
  buildSkipped: boolean;
  wasmPackAvailable: boolean | null;
  wasmPackCheckCommand: string;
  wasmPackCheckArgs: string[];
  wasmPackCheckArgCount: number;
  wasmPackCheckExitCode: number | null;
  wasmPackCheckOutputLine: string | null;
  wasmPackCheckStatus: "ok" | "missing" | "unavailable" | "skipped";
  wasmPackCheckReport: WasmPackJsonReport | null;
  buildOutput: string | null;
  outputPath: string | null;
  unknownOptions: string[];
  unknownOptionCount: number;
  supportedCliOptions: string[];
  validationErrorCode:
    | "output_option_missing_value"
    | "unsupported_options"
    | null;
  writeError?: string;
  message: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
} & CliOptionCatalogMetadata;

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");
const wasmMesherScript = path.resolve(
  rootDir,
  "examples/client/scripts/check-wasm-mesher.mjs"
);
const wasmPackCheckScript = path.resolve(rootDir, "check-wasm-pack.mjs");

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

  const expectedCanonicalOptionForToken = (token: string) => {
    if (token === "--verify") {
      return "--no-build";
    }

    if (token.startsWith("--output=")) {
      return "--output";
    }

    return token;
  };

  const expectActiveCliOptionMetadata = (
    report: ActiveCliOptionMetadata,
    expectedCanonicalOptions: string[],
    expectedTokens: string[],
    expectedOccurrences: Array<{
      token: string;
      canonicalOption: string;
      index: number;
    }>
  ) => {
    expect(report.activeCliOptions).toEqual(expectedCanonicalOptions);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(expectedTokens);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedTokens.map((token) => {
        return {
          token,
          canonicalOption: expectedCanonicalOptionForToken(token),
        };
      })
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(expectedOccurrences);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
  };

  const createExpectedCliOptionCanonicalMap = (supportedCliOptions: string[]) => {
    return Object.fromEntries(
      supportedCliOptions.map((token) => {
        return [token, expectedCanonicalOptionForToken(token)];
      })
    );
  };

  const expectCliOptionCatalogMetadata = (
    report: CliOptionCatalogMetadata,
    expectedAliases: Record<string, string[]>,
    expectedSupportedCliOptions: string[]
  ) => {
    expect(report.supportedCliOptionCount).toBe(expectedSupportedCliOptions.length);
    expect(report.availableCliOptionAliases).toEqual(expectedAliases);
    expect(report.availableCliOptionCanonicalMap).toEqual(
      createExpectedCliOptionCanonicalMap(expectedSupportedCliOptions)
    );
  };

  const expectedWasmPackCliOptions = [
    "--compact",
    "--json",
    "--output",
    "--quiet",
  ];
  const expectedWasmMesherCliOptions = [
    "--compact",
    "--json",
    "--no-build",
    "--output",
    "--verify",
  ];
  const expectedNoBuildCliOptionAliases = {
    "--no-build": ["--verify"],
  };
  const expectedWasmPackAvailableChecks = ["wasm-pack"];
  const expectedWasmPackCheckArgs = [wasmPackCheckScript, "--json", "--compact"];

  const expectWasmPackCheckInvocationMetadata = (
    report: WasmMesherJsonReport,
    expectedExitCode: number | null
  ) => {
    expect(report.wasmPackCheckCommand).toBe(process.execPath);
    expect(report.wasmPackCheckArgs).toEqual(expectedWasmPackCheckArgs);
    expect(report.wasmPackCheckArgCount).toBe(report.wasmPackCheckArgs.length);
    expect(report.wasmPackCheckArgCount).toBe(expectedWasmPackCheckArgs.length);
    expect(report.wasmPackCheckExitCode).toBe(expectedExitCode);

    if (expectedExitCode === null) {
      expect(report.wasmPackCheckStatus).toBe("skipped");
      expect(report.wasmPackCheckOutputLine).toBeNull();
      expect(report.wasmPackCheckReport).toBeNull();
      return;
    }

    if (report.wasmPackCheckReport !== null) {
      expect(report.wasmPackCheckStatus).toBe(
        report.wasmPackCheckReport.checkStatusMap["wasm-pack"]
      );
    } else {
      expect(report.wasmPackCheckStatus).toBe(
        expectedExitCode === 0 ? "ok" : "unavailable"
      );
    }
    if (report.wasmPackCheckOutputLine !== null) {
      expect(report.wasmPackCheckOutputLine.length).toBeGreaterThan(0);
    }
  };

  const expectWasmPackCheckReportMetadata = (report: WasmPackJsonReport) => {
    const expectedAvailableCheckCommandMap = {
      "wasm-pack": report.command,
    };
    const expectedAvailableCheckArgsMap = {
      "wasm-pack": ["--version"],
    };
    const expectedAvailableCheckArgCountMap = {
      "wasm-pack": 1,
    };
    const expectedAvailableCheckIndexMap = {
      "wasm-pack": 0,
    };
    const expectedAvailableCheckMetadata = {
      "wasm-pack": {
        checkIndex: 0,
        command: report.command,
        args: ["--version"],
        argCount: 1,
        checkCommand: report.command,
        checkArgs: ["--version"],
        checkArgCount: 1,
      },
    };
    const expectedCheckCommandMap = {
      "wasm-pack": report.command,
    };
    const expectedCheckArgsMap = {
      "wasm-pack": ["--version"],
    };
    const expectedCheckArgCountMap = {
      "wasm-pack": 1,
    };
    const expectedCheckIndexMap = {
      "wasm-pack": 0,
    };
    const expectedCheckMetadata = {
      "wasm-pack": {
        checkIndex: 0,
        command: report.command,
        args: ["--version"],
        argCount: 1,
        checkCommand: report.command,
        checkArgs: ["--version"],
        checkArgCount: 1,
      },
    };

    expect(report.schemaVersion).toBe(1);
    expect(report.availableChecks).toEqual(expectedWasmPackAvailableChecks);
    expect(report.availableCheckCount).toBe(report.availableChecks.length);
    expect(report.availableCheckIndices).toEqual([0]);
    expect(report.availableCheckIndexCount).toBe(report.availableCheckIndices.length);
    expect(report.availableCheckCommandMap).toEqual(expectedAvailableCheckCommandMap);
    expect(report.availableCheckCommandMapCount).toBe(
      Object.keys(report.availableCheckCommandMap).length
    );
    expect(report.availableCheckArgsMap).toEqual(expectedAvailableCheckArgsMap);
    expect(report.availableCheckArgsMapCount).toBe(
      Object.keys(report.availableCheckArgsMap).length
    );
    expect(report.availableCheckArgCountMap).toEqual(expectedAvailableCheckArgCountMap);
    expect(report.availableCheckArgCountMapCount).toBe(
      Object.keys(report.availableCheckArgCountMap).length
    );
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableCheckMetadataCount).toBe(
      Object.keys(report.availableCheckMetadata).length
    );
    expect(report.availableCheckIndexMap).toEqual(expectedAvailableCheckIndexMap);
    expect(report.availableCheckIndexMapCount).toBe(
      Object.keys(report.availableCheckIndexMap).length
    );
    expect(report.availableCheckIndexCount).toBe(report.availableCheckIndexMapCount);
    expect(report.outputPath).toBeNull();
    expect(report.checkLabels).toEqual(expectedWasmPackAvailableChecks);
    expect(report.checkCount).toBe(report.checkLabels.length);
    expect(report.checkIndices).toEqual([0]);
    expect(report.checkIndexCount).toBe(report.checkIndices.length);
    expect(report.checkIndexMap).toEqual(expectedCheckIndexMap);
    expect(report.checkIndexMapCount).toBe(Object.keys(report.checkIndexMap).length);
    expect(report.checkCommandMap).toEqual(expectedCheckCommandMap);
    expect(report.checkCommandMapCount).toBe(
      Object.keys(report.checkCommandMap).length
    );
    expect(report.checkArgsMap).toEqual(expectedCheckArgsMap);
    expect(report.checkArgsMapCount).toBe(Object.keys(report.checkArgsMap).length);
    expect(report.checkArgCountMap).toEqual(expectedCheckArgCountMap);
    expect(report.checkArgCountMapCount).toBe(
      Object.keys(report.checkArgCountMap).length
    );
    expect(report.checkMetadata).toEqual(expectedCheckMetadata);
    expect(report.checkMetadataCount).toBe(Object.keys(report.checkMetadata).length);
    expect(report.checkStatusMapCount).toBe(
      Object.keys(report.checkStatusMap).length
    );
    expect(report.checkStatusCountMapCount).toBe(
      Object.keys(report.checkStatusCountMap).length
    );
    expect(report.checkVersionMapCount).toBe(
      Object.keys(report.checkVersionMap).length
    );
    expect(report.checkExitCodeMapCount).toBe(
      Object.keys(report.checkExitCodeMap).length
    );
    expect(report.checkOutputLineMapCount).toBe(
      Object.keys(report.checkOutputLineMap).length
    );

    const checkStatus = report.checkStatusMap["wasm-pack"];
    expect(
      checkStatus === "ok" || checkStatus === "missing" || checkStatus === "unavailable"
    ).toBe(true);
    expect(report.checkStatusMap).toEqual({
      "wasm-pack": checkStatus,
    });
    expect(report.checkStatusCountMap).toEqual({
      [checkStatus]: 1,
    });
    expect(report.checkVersionMap).toEqual({
      "wasm-pack": report.version,
    });
    expect(report.checkExitCodeMap).toEqual({
      "wasm-pack": report.exitCode,
    });
    const outputLine = report.checkOutputLineMap["wasm-pack"];
    if (report.version !== null) {
      expect(outputLine).toBe(report.version);
    } else if (outputLine !== null) {
      expect(outputLine.length).toBeGreaterThan(0);
    }

    if (checkStatus === "ok") {
      expect(report.passedChecks).toEqual(expectedWasmPackAvailableChecks);
      expect(report.passedCheckIndices).toEqual(report.checkIndices);
      expect(report.passedCheckIndexMap).toEqual(report.checkIndexMap);
      expect(report.passedCheckCommandMap).toEqual(report.checkCommandMap);
      expect(report.passedCheckArgsMap).toEqual(report.checkArgsMap);
      expect(report.passedCheckArgCountMap).toEqual(report.checkArgCountMap);
      expect(report.passedCheckMetadata).toEqual(report.checkMetadata);
      expect(report.failedChecks).toEqual([]);
      expect(report.failedCheckIndices).toEqual([]);
      expect(report.failedCheckIndexMap).toEqual({});
      expect(report.failedCheckCommandMap).toEqual({});
      expect(report.failedCheckArgsMap).toEqual({});
      expect(report.failedCheckArgCountMap).toEqual({});
      expect(report.failedCheckMetadata).toEqual({});
      expect(report.failureSummaries).toEqual([]);
    } else {
      expect(report.passedChecks).toEqual([]);
      expect(report.passedCheckIndices).toEqual([]);
      expect(report.passedCheckIndexMap).toEqual({});
      expect(report.passedCheckCommandMap).toEqual({});
      expect(report.passedCheckArgsMap).toEqual({});
      expect(report.passedCheckArgCountMap).toEqual({});
      expect(report.passedCheckMetadata).toEqual({});
      expect(report.failedChecks).toEqual(expectedWasmPackAvailableChecks);
      expect(report.failedCheckIndices).toEqual(report.checkIndices);
      expect(report.failedCheckIndexMap).toEqual(report.checkIndexMap);
      expect(report.failedCheckCommandMap).toEqual(report.checkCommandMap);
      expect(report.failedCheckArgsMap).toEqual(report.checkArgsMap);
      expect(report.failedCheckArgCountMap).toEqual(report.checkArgCountMap);
      expect(report.failedCheckMetadata).toEqual(report.checkMetadata);
      expect(report.failureSummaries).toEqual([
        {
          name: "wasm-pack",
          checkIndex: expectedCheckIndexMap["wasm-pack"],
          command: report.command,
          args: ["--version"],
          argCount: 1,
          checkCommand: report.command,
          checkArgs: ["--version"],
          checkArgCount: 1,
          exitCode: report.exitCode,
          status: checkStatus,
          message: report.message ?? null,
        },
      ]);
    }

    expect(report.passedCheckCount).toBe(report.passedChecks.length);
    expect(report.passedCheckIndexCount).toBe(report.passedCheckIndices.length);
    expect(report.passedCheckIndexMapCount).toBe(
      Object.keys(report.passedCheckIndexMap).length
    );
    expect(report.passedCheckCommandMapCount).toBe(
      Object.keys(report.passedCheckCommandMap).length
    );
    expect(report.passedCheckArgsMapCount).toBe(
      Object.keys(report.passedCheckArgsMap).length
    );
    expect(report.passedCheckArgCountMapCount).toBe(
      Object.keys(report.passedCheckArgCountMap).length
    );
    expect(report.passedCheckMetadataCount).toBe(
      Object.keys(report.passedCheckMetadata).length
    );
    expect(report.failedCheckCount).toBe(report.failedChecks.length);
    expect(report.failedCheckIndexCount).toBe(report.failedCheckIndices.length);
    expect(report.failedCheckIndexMapCount).toBe(
      Object.keys(report.failedCheckIndexMap).length
    );
    expect(report.failedCheckCommandMapCount).toBe(
      Object.keys(report.failedCheckCommandMap).length
    );
    expect(report.failedCheckArgsMapCount).toBe(
      Object.keys(report.failedCheckArgsMap).length
    );
    expect(report.failedCheckArgCountMapCount).toBe(
      Object.keys(report.failedCheckArgCountMap).length
    );
    expect(report.failedCheckMetadataCount).toBe(
      Object.keys(report.failedCheckMetadata).length
    );
    expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
    expect(report.checkCommandMapCount).toBe(
      report.passedCheckCommandMapCount + report.failedCheckCommandMapCount
    );
    expect(report.checkArgsMapCount).toBe(
      report.passedCheckArgsMapCount + report.failedCheckArgsMapCount
    );
    expect(report.checkArgCountMapCount).toBe(
      report.passedCheckArgCountMapCount + report.failedCheckArgCountMapCount
    );
    expect(report.checkMetadataCount).toBe(
      report.passedCheckMetadataCount + report.failedCheckMetadataCount
    );
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBeNull();
    expect(typeof report.message).toBe("string");
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expectActiveCliOptionMetadata(
      report,
      ["--json"],
      ["--json"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
    expectWasmPackCheckInvocationMetadata(
      report,
      report.wasmPackCheckReport?.exitCode ?? null
    );

    if (report.wasmPackCheckReport !== null) {
      expectWasmPackCheckReportMetadata(report.wasmPackCheckReport);
      expect(report.wasmPackCheckReport.supportedCliOptions).toEqual(
        expectedWasmPackCliOptions
      );
      expectCliOptionCatalogMetadata(
        report.wasmPackCheckReport,
        {},
        expectedWasmPackCliOptions
      );
      expect(report.wasmPackCheckReport.unknownOptions).toEqual([]);
      expect(report.wasmPackCheckReport.unknownOptionCount).toBe(0);
      expect(report.wasmPackCheckReport.validationErrorCode).toBeNull();
      expectTimingMetadata(report.wasmPackCheckReport);
      expectOptionTerminatorMetadata(report.wasmPackCheckReport);
      expectActiveCliOptionMetadata(
        report.wasmPackCheckReport,
        ["--compact", "--json"],
        ["--json", "--compact"],
        [
          {
            token: "--json",
            canonicalOption: "--json",
            index: 0,
          },
          {
            token: "--compact",
            canonicalOption: "--compact",
            index: 1,
          },
        ]
      );
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
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--no-build"],
      ["--json", "--no-build"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
        {
          token: "--no-build",
          canonicalOption: "--no-build",
          index: 1,
        },
      ]
    );
    expectWasmPackCheckInvocationMetadata(report, null);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports verify alias for no-build mode in machine-readable output", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--verify"],
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
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--no-build"],
      ["--json", "--verify"],
      [
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
      ]
    );
    expectWasmPackCheckInvocationMetadata(report, null);
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

  it("uses the last output flag when no-build aliases appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-preflight-last-output-strict-no-build-alias-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--json",
        "--output",
        firstOutputPath,
        "--verify",
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
    expect(stdoutReport.buildSkipped).toBe(true);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.validationErrorCode).toBeNull();
    expect(stdoutReport.activeCliOptions).toEqual([
      "--json",
      "--no-build",
      "--output",
    ]);
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
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output"],
      [
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
      ]
    );
    expectWasmPackCheckInvocationMetadata(report, null);
    expect(result.status).toBe(1);
  });

  it("treats inline no-build alias misuse after --output as missing output value", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output", "--verify=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.buildSkipped).toBe(false);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output"],
      [
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
      ]
    );
    expect(result.status).toBe(1);
  });

  it("treats no-build alias after --output as missing output value while keeping alias active", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output", "--verify"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.buildSkipped).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--no-build", "--output"],
      ["--json", "--output", "--verify"],
      [
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
          index: 2,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("treats canonical no-build token after --output as missing output value while keeping no-build active", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output", "--no-build"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.buildSkipped).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--no-build", "--output"],
      ["--json", "--output", "--no-build"],
      [
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
          token: "--no-build",
          canonicalOption: "--no-build",
          index: 2,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("treats inline json flag misuse after --output as missing output value", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output", "--json=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.buildSkipped).toBe(false);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--json=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output"],
      [
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
      ]
    );
    expect(result.status).toBe(1);
  });

  it("fails with structured output when split output value is empty", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output", ""],
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
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output"],
      [
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
      ]
    );
    expect(result.status).toBe(1);
  });

  it("fails with structured output when split output value is whitespace", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output", "   "],
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
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output"],
      [
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
      ]
    );
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
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output="],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
        {
          token: "--output=",
          canonicalOption: "--output",
          index: 1,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("fails with structured output when inline output value is whitespace", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output=   "],
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
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output=   "],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
        {
          token: "--output=   ",
          canonicalOption: "--output",
          index: 1,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("prioritizes output validation while reporting unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--mystery", "--output"],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output"],
      [
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
      ]
    );
    expect(result.status).toBe(1);
  });

  it("prioritizes inline whitespace output validation while reporting unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--mystery", "--output=   "],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--output"],
      ["--json", "--output=   "],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
        {
          token: "--output=   ",
          canonicalOption: "--output",
          index: 2,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("reports unsupported options in structured output", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--mystery"],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expectActiveCliOptionMetadata(
      report,
      ["--json"],
      ["--json"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("keeps alias-active metadata when inline misuse is present in structured output", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--verify", "--no-build=2", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.buildSkipped).toBe(true);
    expect(report.attemptedBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--no-build"],
      ["--json", "--verify"],
      [
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
      ]
    );
    expect(result.status).toBe(1);
  });

  it("redacts inline known-flag misuse tokens in structured output", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--json=1", "--mystery=alpha"],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expectActiveCliOptionMetadata(
      report,
      ["--json"],
      ["--json"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("deduplicates literal redaction placeholders in structured output", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--json=<value>", "--json=secret", "--mystery=alpha"],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain("--json=secret");
    expect(result.status).toBe(1);
  });

  it("redacts inline alias misuse tokens in structured output", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--verify=1", "--no-build=2", "--mystery=alpha"],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expectActiveCliOptionMetadata(
      report,
      ["--json"],
      ["--json"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("deduplicates literal alias placeholders in structured output", () => {
    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--json",
        "--verify=<value>",
        "--verify=1",
        "--no-build=2",
        "--mystery=alpha",
      ],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain("--verify=1");
    expect(`${result.stdout}${result.stderr}`).not.toContain("--no-build=2");
    expect(`${result.stdout}${result.stderr}`).not.toContain("--mystery=alpha");
    expect(result.status).toBe(1);
  });

  it("redacts malformed inline option names in structured output", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--=secret", "--=token", "--=", "-=secret", "-="],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--=<value>", "-=<value>"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expectActiveCliOptionMetadata(
      report,
      ["--json"],
      ["--json"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("normalizes inline unsupported options in structured output", () => {
    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--json",
        "--mystery=alpha",
        "--mystery=beta",
        "-x=1",
      ],
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
    expect(report.supportedCliOptions).toEqual(expectedWasmMesherCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedWasmMesherCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery", "-x"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expectActiveCliOptionMetadata(
      report,
      ["--json"],
      ["--json"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(result.status).toBe(1);
  });

  it("writes unsupported-option validation reports to output files", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-mesher-validation-report-")
    );
    const outputPath = path.resolve(tempDirectory, "validation-report.json");

    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--mystery", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const stdoutReport = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as WasmMesherJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes unsupported-option validation reports to inline output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-mesher-validation-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "inline-validation-report.json");

    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--mystery", `--output=${outputPath}`],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const stdoutReport = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as WasmMesherJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for unsupported-option validation reports", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-mesher-validation-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--json",
        "--mystery",
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
    const stdoutReport = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as WasmMesherJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for unsupported-option validation reports with no-build aliases between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-wasm-mesher-validation-last-output-with-no-build-alias-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--json",
        "--mystery",
        "--output",
        firstOutputPath,
        "--verify",
        "--output",
        secondOutputPath,
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const stdoutReport = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as WasmMesherJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.buildSkipped).toBe(true);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--json",
      "--no-build",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
      "--verify",
    ]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for inline no-build misuse validation reports", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-wasm-mesher-validation-last-output-inline-no-build-misuse-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--json",
        "--output",
        firstOutputPath,
        "--verify=1",
        "--output",
        secondOutputPath,
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const stdoutReport = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as WasmMesherJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.buildSkipped).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.activeCliOptions).toEqual(["--json", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--json", "--output"]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("reports validation output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-mesher-validation-write-failure-")
    );

    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--mystery", "--output", tempDirectory],
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
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("ignores option-like tokens after option terminator", () => {
    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--json",
        "--no-build",
        "--",
        "--output",
        "--json=1",
        "--verify=2",
        "--=secret",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, [
      "--output",
      "--json=1",
      "--verify=2",
      "--=secret",
    ]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.message).not.toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--no-build"],
      ["--json", "--no-build"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
        {
          token: "--no-build",
          canonicalOption: "--no-build",
          index: 1,
        },
      ]
    );
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("does not treat no-build aliases after option terminator as active", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--", "--verify"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.buildSkipped).toBe(false);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--verify"]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.message).not.toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json"],
      ["--json"],
      [
        {
          token: "--json",
          canonicalOption: "--json",
          index: 0,
        },
      ]
    );
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("keeps no-build alias before option terminator active", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--verify", "--", "--verify=1", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const report = JSON.parse(`${result.stdout}${result.stderr}`) as WasmMesherJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.buildSkipped).toBe(true);
    expect(report.attemptedBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--verify=1", "--mystery=alpha"]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.message).not.toBe("Missing value for --output option.");
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--no-build"],
      ["--json", "--verify"],
      [
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
      ]
    );
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("fails when last output flag value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-mesher-last-output-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", "--output", firstOutputPath, "--output"],
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
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("fails when trailing inline output value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-mesher-trailing-inline-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json", `--output=${firstOutputPath}`, "--output="],
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
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
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

  it("fails in non-json mode for unsupported options", () => {
    const result = spawnSync(process.execPath, [wasmMesherScript, "--mystery"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
  });

  it("fails in non-json mode with redacted inline known-flag misuse tokens", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json=1", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expect(output).not.toContain("--json=1");
    expect(output).not.toContain("--mystery=alpha");
  });

  it("fails in non-json mode with deduplicated literal redaction placeholders", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--json=<value>", "--json=secret", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expect(output).not.toContain("--json=secret");
    expect(output).not.toContain("--mystery=alpha");
  });

  it("fails in non-json mode with redacted inline alias misuse tokens", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--verify=1", "--no-build=2", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expect(output).not.toContain("--verify=1");
    expect(output).not.toContain("--no-build=2");
    expect(output).not.toContain("--mystery=alpha");
  });

  it("fails in non-json mode with deduplicated literal alias placeholders", () => {
    const result = spawnSync(
      process.execPath,
      [
        wasmMesherScript,
        "--verify=<value>",
        "--verify=1",
        "--no-build=2",
        "--mystery=alpha",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expect(output).not.toContain("--verify=1");
    expect(output).not.toContain("--no-build=2");
    expect(output).not.toContain("--mystery=alpha");
  });

  it("fails in non-json mode with redacted malformed inline option names", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--=secret", "--=token", "--=", "-=secret", "-="],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expect(output).not.toContain("--=secret");
    expect(output).not.toContain("--=token");
    expect(output).not.toContain("-=secret");
  });

  it("fails in non-json mode with normalized inline unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--mystery=alpha", "--mystery=beta", "-x=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --no-build, --output, --verify."
    );
    expect(output).not.toContain("--mystery=alpha");
    expect(output).not.toContain("--mystery=beta");
    expect(output).not.toContain("-x=1");
  });

  it("fails in non-json mode for missing output values", () => {
    const result = spawnSync(process.execPath, [wasmMesherScript, "--output"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
  });

  it("fails in non-json mode for inline whitespace output values", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--output=   "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
  });

  it("fails in non-json mode for inline empty output values", () => {
    const result = spawnSync(process.execPath, [wasmMesherScript, "--output="], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
  });

  it("prioritizes missing output values over unsupported options in non-json mode", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--mystery", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
    expect(output).not.toContain("Unsupported option(s):");
  });

  it("prioritizes missing output values over inline no-build alias misuse in non-json mode", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--output", "--verify=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
    expect(output).not.toContain("Unsupported option(s):");
    expect(output).not.toContain("--verify=1");
  });

  it("prioritizes missing output values over no-build alias tokens in non-json mode", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--output", "--verify"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
    expect(output).not.toContain("Unsupported option(s):");
  });

  it("prioritizes missing output values over canonical no-build tokens in non-json mode", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--output", "--no-build"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
    expect(output).not.toContain("Unsupported option(s):");
  });

  it("prioritizes missing output values over inline json flag misuse in non-json mode", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--output", "--json=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
    expect(output).not.toContain("Unsupported option(s):");
    expect(output).not.toContain("--json=1");
  });

  it("prioritizes inline whitespace output values over unsupported options in non-json mode", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--mystery", "--output=   "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
    expect(output).not.toContain("Unsupported option(s):");
  });

  it("prioritizes inline empty output values over unsupported options in non-json mode", () => {
    const result = spawnSync(
      process.execPath,
      [wasmMesherScript, "--mystery", "--output="],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Missing value for --output option.");
    expect(output).not.toContain("Unsupported option(s):");
  });
});
