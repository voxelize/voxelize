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

type WasmPackJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  passed: boolean;
  exitCode: number;
  command: string;
  version: string | null;
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

    if (report.wasmPackCheckReport !== null) {
      expect(report.wasmPackCheckReport.command).toContain("wasm-pack");
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
