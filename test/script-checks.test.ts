import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");

type ScriptResult = {
  status: number;
  output: string;
};

type OptionTerminatorMetadata = {
  optionTerminatorUsed: boolean;
  positionalArgs: string[];
  positionalArgCount: number;
};

type CliOptionCatalogMetadata = {
  availableCliOptionAliases: Record<string, string[]>;
  availableCliOptionCanonicalMap: Record<string, string>;
  supportedCliOptionCount: number;
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

type WasmPackJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  command: string;
  version: string | null;
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

type DevEnvJsonCheck = {
  label: string;
  required: boolean;
  status: string;
  message: string;
  hint: string;
  detectedVersion: string | null;
  minimumVersion: string | null;
};

type DevEnvJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  requiredFailures: number;
  checks: DevEnvJsonCheck[];
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
  wasmPackCheckReport: WasmPackJsonReport | null;
  buildOutput: string | null;
  unknownOptions: string[];
  unknownOptionCount: number;
  supportedCliOptions: string[];
  validationErrorCode:
    | "output_option_missing_value"
    | "unsupported_options"
    | null;
  message: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
} & CliOptionCatalogMetadata;

type ClientJsonStep = {
  name: string;
  passed: boolean;
  exitCode: number | null;
  skipped: boolean;
  reason: string | null;
  report: WasmMesherJsonReport | null;
  output: string | null;
};

type ClientJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  noBuild: boolean;
  outputPath: string | null;
  unknownOptions: string[];
  unknownOptionCount: number;
  supportedCliOptions: string[];
  validationErrorCode:
    | "output_option_missing_value"
    | "unsupported_options"
    | null;
  steps: ClientJsonStep[];
  totalSteps: number;
  passedStepCount: number;
  failedStepCount: number;
  skippedStepCount: number;
  firstFailedStep: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  writeError?: string;
  message?: string;
} & CliOptionCatalogMetadata;

type OnboardingJsonStep = {
  name: string;
  passed: boolean;
  exitCode: number | null;
  skipped: boolean;
  reason: string | null;
  report: DevEnvJsonReport | ClientJsonReport | null;
  output: string | null;
};

type OnboardingJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  noBuild: boolean;
  outputPath: string | null;
  unknownOptions: string[];
  unknownOptionCount: number;
  supportedCliOptions: string[];
  validationErrorCode:
    | "output_option_missing_value"
    | "unsupported_options"
    | null;
  steps: OnboardingJsonStep[];
  totalSteps: number;
  passedStepCount: number;
  failedStepCount: number;
  skippedStepCount: number;
  firstFailedStep: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  writeError?: string;
  message?: string;
} & CliOptionCatalogMetadata;

const runScript = (scriptName: string, args: string[] = []): ScriptResult => {
  const scriptPath = path.resolve(rootDir, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  };
};

const expectCompactJsonOutput = (output: string) => {
  expect(output).not.toContain("\n  \"");
};

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

const expectedStandardCliOptions = [
  "--compact",
  "--json",
  "--output",
  "--quiet",
];
const expectedNoBuildCliOptions = [
  "--compact",
  "--json",
  "--no-build",
  "--output",
  "--quiet",
  "--verify",
];
const expectedNoBuildCliOptionAliases = {
  "--no-build": ["--verify"],
};

describe("root preflight scripts", () => {
  it("check-wasm-pack returns clear status output", () => {
    const result = runScript("check-wasm-pack.mjs");

    if (result.status === 0) {
      expect(result.output).toBe("");
      return;
    }

    expect(result.output).toContain("wasm-pack is required for wasm build commands");
    expect(result.output).toContain(
      "https://rustwasm.github.io/wasm-pack/installer/"
    );
  });

  it("check-wasm-pack quiet mode suppresses messages", () => {
    const result = runScript("check-wasm-pack.mjs", ["--quiet"]);

    expect(result.output).toBe("");
  });

  it("check-wasm-pack json mode emits machine-readable report", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json"]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(typeof report.passed).toBe("boolean");
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.command).toContain("wasm-pack");
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBeNull();
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

    if (report.passed) {
      expect(report.version).not.toBeNull();
      return;
    }

    expect(report.message).toContain("wasm-pack is required for wasm build commands");
  });

  it("check-wasm-pack supports compact json mode", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--compact"]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expectCompactJsonOutput(result.output.trim());
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("check-wasm-pack json mode writes report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-json-")
    );
    const outputPath = path.resolve(tempDirectory, "wasm-pack-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as WasmPackJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json mode supports inline output values", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-json-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "inline-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      `--output=${outputPath}`,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as WasmPackJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json mode uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-json-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as WasmPackJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json mode validates missing output value", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--output"]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
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

  it("check-wasm-pack json mode validates empty split output values", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--output", ""]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
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

  it("check-wasm-pack json mode validates whitespace split output values", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--output", "   "]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
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

  it("check-wasm-pack json mode validates empty inline output values", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--output="]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
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

  it("check-wasm-pack json mode validates whitespace inline output values", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--output=   "]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
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

  it("check-wasm-pack json mode fails when trailing inline output value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-trailing-inline-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      `--output=${firstOutputPath}`,
      "--output=",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack prioritizes output validation while reporting unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--mystery",
      "--output",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
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

  it("check-wasm-pack prioritizes inline whitespace output validation while reporting unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--mystery",
      "--output=   ",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
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

  it("check-wasm-pack json mode reports unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--mystery"]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --output, --quiet."
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

  it("check-wasm-pack json mode preserves inline known-flag misuse tokens", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--json=1",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--json=1", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=1, --mystery. Supported options: --compact, --json, --output, --quiet."
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

  it("check-wasm-pack json mode normalizes inline unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--mystery=alpha",
      "--mystery=beta",
      "-x=1",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--mystery", "-x"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --output, --quiet."
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

  it("check-wasm-pack json mode writes unsupported-option validation reports to output files", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-validation-report-")
    );
    const outputPath = path.resolve(tempDirectory, "validation-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--mystery",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as WasmPackJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json mode writes unsupported-option validation reports to inline output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-validation-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "inline-validation-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--mystery",
      `--output=${outputPath}`,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as WasmPackJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json validation output uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-validation-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--mystery",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as WasmPackJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json mode reports validation output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-validation-write-failure-")
    );

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--mystery",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;
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

  it("check-wasm-pack ignores option-like tokens after option terminator", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json", "--", "--output"]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.message).not.toBe("Missing value for --output option.");
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report, true, ["--output"]);
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

  it("check-wasm-pack non-json mode fails on unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", ["--mystery"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --output, --quiet."
    );
  });

  it("check-wasm-pack non-json mode normalizes inline unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--mystery=alpha",
      "--mystery=beta",
      "-x=1",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--mystery=alpha");
    expect(result.output).not.toContain("--mystery=beta");
    expect(result.output).not.toContain("-x=1");
  });

  it("check-wasm-pack non-json mode fails on missing output value", () => {
    const result = runScript("check-wasm-pack.mjs", ["--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-wasm-pack non-json mode fails on inline whitespace output value", () => {
    const result = runScript("check-wasm-pack.mjs", ["--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-wasm-pack non-json mode fails on inline empty output value", () => {
    const result = runScript("check-wasm-pack.mjs", ["--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-wasm-pack non-json mode prioritizes missing output value over unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", ["--mystery", "--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-wasm-pack non-json mode prioritizes inline whitespace output value over unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--mystery",
      "--output=   ",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-wasm-pack non-json mode prioritizes inline empty output value over unsupported options", () => {
    const result = runScript("check-wasm-pack.mjs", ["--mystery", "--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-wasm-pack json mode fails when last output flag value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-last-output-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--output",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-wasm-pack json mode reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-output-write-failure-")
    );

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env returns pass or fail summary", () => {
    const result = runScript("check-dev-env.mjs");
    expect(result.output).toContain("node:");
    expect(result.output).toContain("cargo watch:");

    if (result.status === 0) {
      expect(result.output).toContain("Environment check passed.");
      return;
    }

    expect(result.output).toContain("Environment check failed:");
  });

  it("check-dev-env quiet mode suppresses success lines", () => {
    const result = runScript("check-dev-env.mjs", ["--quiet"]);

    expect(result.output).not.toContain("✓ ");
  });

  it("check-dev-env json mode emits machine-readable report", () => {
    const result = runScript("check-dev-env.mjs", ["--json"]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.requiredFailures).toBeGreaterThanOrEqual(0);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBeNull();
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
    expect(typeof report.passed).toBe("boolean");
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.map((check) => check.label)).toContain("node");
    expect(report.checks.map((check) => check.label)).toContain("pnpm");
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Environment check failed:");
  });

  it("check-dev-env supports compact json mode", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--compact"]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expectCompactJsonOutput(result.output.trim());
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("check-dev-env json mode writes report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-json-")
    );
    const outputPath = path.resolve(tempDirectory, "dev-env-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as DevEnvJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode supports inline output values", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-json-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "dev-env-inline-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      `--output=${outputPath}`,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as DevEnvJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-json-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as DevEnvJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode validates missing output value", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--output"]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
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

  it("check-dev-env json mode validates empty split output value", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--output", ""]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
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

  it("check-dev-env json mode validates whitespace split output value", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--output", "   "]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
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

  it("check-dev-env json mode validates empty inline output value", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--output="]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
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

  it("check-dev-env json mode validates whitespace inline output value", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--output=   "]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
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

  it("check-dev-env prioritizes output validation while reporting unsupported options", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--mystery",
      "--output",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
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

  it("check-dev-env prioritizes inline whitespace output validation while reporting unsupported options", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--mystery",
      "--output=   ",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
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

  it("check-dev-env json mode reports unsupported options", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--mystery"]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --output, --quiet."
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

  it("check-dev-env json mode normalizes inline unsupported options", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--mystery=alpha",
      "--mystery=beta",
      "-x=1",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--mystery", "-x"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --output, --quiet."
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

  it("check-dev-env json mode writes unsupported-option validation reports to output files", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-validation-report-")
    );
    const outputPath = path.resolve(tempDirectory, "validation-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--mystery",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as DevEnvJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode writes unsupported-option validation reports to inline output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-validation-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "inline-validation-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--mystery",
      `--output=${outputPath}`,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as DevEnvJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json validation output uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-validation-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--mystery",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as DevEnvJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode reports validation output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-validation-write-failure-")
    );

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--mystery",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;
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

  it("check-dev-env ignores option-like tokens after option terminator", () => {
    const result = runScript("check-dev-env.mjs", ["--json", "--", "--output"]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--output"]);
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

  it("check-dev-env non-json mode fails on unsupported options", () => {
    const result = runScript("check-dev-env.mjs", ["--mystery"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --output, --quiet."
    );
  });

  it("check-dev-env non-json mode normalizes inline unsupported options", () => {
    const result = runScript("check-dev-env.mjs", [
      "--mystery=alpha",
      "--mystery=beta",
      "-x=1",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--mystery=alpha");
    expect(result.output).not.toContain("--mystery=beta");
    expect(result.output).not.toContain("-x=1");
  });

  it("check-dev-env non-json mode fails on missing output value", () => {
    const result = runScript("check-dev-env.mjs", ["--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-dev-env non-json mode fails on inline whitespace output value", () => {
    const result = runScript("check-dev-env.mjs", ["--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-dev-env non-json mode fails on inline empty output value", () => {
    const result = runScript("check-dev-env.mjs", ["--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-dev-env non-json mode prioritizes missing output value over unsupported options", () => {
    const result = runScript("check-dev-env.mjs", ["--mystery", "--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-dev-env non-json mode prioritizes inline whitespace output value over unsupported options", () => {
    const result = runScript("check-dev-env.mjs", ["--mystery", "--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-dev-env non-json mode prioritizes inline empty output value over unsupported options", () => {
    const result = runScript("check-dev-env.mjs", ["--mystery", "--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-dev-env json mode fails when last output flag value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-last-output-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--output",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode fails when trailing inline output value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-trailing-inline-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      `--output=${firstOutputPath}`,
      "--output=",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-dev-env json mode reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-output-write-failure-")
    );

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client returns pass or fail summary", () => {
    const result = runScript("check-client.mjs");
    expect(result.output).toContain(
      "Running client check step: WASM artifact preflight"
    );

    if (result.status === 0) {
      expect(result.output).toContain("Client checks passed.");
      return;
    }

    expect(result.output).toContain("Client check failed:");
  });

  it("check-client quiet mode suppresses step logs", () => {
    const result = runScript("check-client.mjs", ["--quiet"]);

    expect(result.output).not.toContain("Running client check step:");
  });

  it("check-client json mode emits machine-readable report", () => {
    const result = runScript("check-client.mjs", ["--json"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(typeof report.passed).toBe("boolean");
    expect(report.noBuild).toBe(false);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBeNull();
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
    expect(Array.isArray(report.steps)).toBe(true);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps[0].name).toBe("WASM artifact preflight");
    expect(typeof report.steps[0].skipped).toBe("boolean");
    expect(report.steps.some((step) => step.name === "TypeScript typecheck")).toBe(
      true
    );
    expect(report.steps[0].report).not.toBeNull();
    if (report.steps[0].report !== null) {
      expect(report.steps[0].report.schemaVersion).toBe(1);
      expect(report.steps[0].report.artifactPath).toBe(
        "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js"
      );
      expect(typeof report.steps[0].report.passed).toBe("boolean");
      expect(report.steps[0].report.buildSkipped).toBe(false);
      expectTimingMetadata(report.steps[0].report);
      expectOptionTerminatorMetadata(report.steps[0].report);
    }
    if (report.failedStepCount > 0) {
      expect(report.firstFailedStep).toBe(
        report.steps.find((step) => !step.passed && step.skipped === false)?.name
      );
    } else {
      expect(report.firstFailedStep).toBeNull();
    }
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Running client check step:");
    expect(result.output).not.toContain("Client check failed:");
  });

  it("check-client supports compact json mode", () => {
    const result = runScript("check-client.mjs", ["--json", "--compact"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expectCompactJsonOutput(result.output.trim());
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("check-client json mode writes report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-json-")
    );
    const outputPath = path.resolve(tempDirectory, "client-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode supports inline output values", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-json-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "client-inline-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--no-build",
      `--output=${outputPath}`,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-json-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--no-build",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode validates missing output value", () => {
    const result = runScript("check-client.mjs", ["--json", "--output"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-client json mode validates empty split output value", () => {
    const result = runScript("check-client.mjs", ["--json", "--output", ""]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
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

  it("check-client json mode validates whitespace split output value", () => {
    const result = runScript("check-client.mjs", ["--json", "--output", "   "]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
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

  it("check-client json mode validates empty inline output value", () => {
    const result = runScript("check-client.mjs", ["--json", "--output="]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-client json mode validates whitespace inline output value", () => {
    const result = runScript("check-client.mjs", ["--json", "--output=   "]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-client prioritizes output validation while reporting unsupported options", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--mystery",
      "--output",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-client prioritizes inline whitespace output validation while reporting unsupported options", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--mystery",
      "--output=   ",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-client ignores option-like tokens after option terminator", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--no-build",
      "--",
      "--output",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--output"]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.totalSteps).toBeGreaterThan(0);
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

  it("check-client json mode reports unsupported options", () => {
    const result = runScript("check-client.mjs", ["--json", "--mystery"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-client json mode normalizes inline unsupported options", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--mystery=alpha",
      "--mystery=beta",
      "-x=1",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery", "-x"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-client json mode writes unsupported-option validation reports to output files", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-validation-report-")
    );
    const outputPath = path.resolve(tempDirectory, "validation-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--mystery",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as ClientJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.totalSteps).toBe(0);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode writes unsupported-option validation reports to inline output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-validation-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "inline-validation-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--mystery",
      `--output=${outputPath}`,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as ClientJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.totalSteps).toBe(0);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json validation output uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-validation-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--mystery",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.totalSteps).toBe(0);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode reports validation output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-validation-write-failure-")
    );

    const result = runScript("check-client.mjs", [
      "--json",
      "--mystery",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.totalSteps).toBe(0);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode fails when last output flag value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-last-output-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--no-build",
      "--output",
      firstOutputPath,
      "--output",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode fails when trailing inline output value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-trailing-inline-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--no-build",
      `--output=${firstOutputPath}`,
      "--output=",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client json mode reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-output-write-failure-")
    );

    const result = runScript("check-client.mjs", [
      "--json",
      "--no-build",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-client non-json mode fails on unsupported options", () => {
    const result = runScript("check-client.mjs", ["--mystery"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
  });

  it("check-client non-json mode normalizes inline unsupported options", () => {
    const result = runScript("check-client.mjs", [
      "--mystery=alpha",
      "--mystery=beta",
      "-x=1",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--mystery=alpha");
    expect(result.output).not.toContain("--mystery=beta");
    expect(result.output).not.toContain("-x=1");
  });

  it("check-client non-json mode fails on missing output value", () => {
    const result = runScript("check-client.mjs", ["--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-client non-json mode fails on inline whitespace output value", () => {
    const result = runScript("check-client.mjs", ["--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-client non-json mode fails on inline empty output value", () => {
    const result = runScript("check-client.mjs", ["--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-client non-json mode prioritizes missing output value over unsupported options", () => {
    const result = runScript("check-client.mjs", ["--mystery", "--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-client non-json mode prioritizes inline whitespace output value over unsupported options", () => {
    const result = runScript("check-client.mjs", ["--mystery", "--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-client non-json mode prioritizes inline empty output value over unsupported options", () => {
    const result = runScript("check-client.mjs", ["--mystery", "--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-client json no-build mode reports skipped build intent", () => {
    const result = runScript("check-client.mjs", ["--json", "--no-build"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps[0].name).toBe("WASM artifact preflight");
    const typecheckStep = report.steps.find(
      (step) => step.name === "TypeScript typecheck"
    );
    expect(typecheckStep).toBeDefined();
    if (report.steps[0].report !== null) {
      expect(report.steps[0].report.buildSkipped).toBe(true);
      expect(report.steps[0].report.attemptedBuild).toBe(false);
      expectTimingMetadata(report.steps[0].report);
    }
    if (typecheckStep !== undefined && report.steps[0].passed === false) {
      expect(typecheckStep.skipped).toBe(true);
      expect(typecheckStep.exitCode).toBeNull();
      expect(typecheckStep.reason).toBe("WASM artifact preflight failed");
    }
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
  });

  it("check-client json verify mode aliases no-build behavior", () => {
    const result = runScript("check-client.mjs", ["--json", "--verify"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps[0].name).toBe("WASM artifact preflight");
    if (report.steps[0].report !== null) {
      expect(report.steps[0].report.buildSkipped).toBe(true);
      expect(report.steps[0].report.attemptedBuild).toBe(false);
      expectTimingMetadata(report.steps[0].report);
    }
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
  });

  it("check-onboarding returns pass or fail summary", () => {
    const result = runScript("check-onboarding.mjs");
    expect(result.output).toContain(
      "Running onboarding step: Developer environment preflight"
    );

    if (result.status === 0) {
      expect(result.output).toContain("Onboarding checks passed.");
      return;
    }

    expect(result.output).toContain("Onboarding check failed:");
  });

  it("check-onboarding quiet mode suppresses step logs", () => {
    const result = runScript("check-onboarding.mjs", ["--quiet"]);

    expect(result.output).not.toContain("Running onboarding step:");
    expect(result.output).not.toContain("✓ node:");
  });

  it("check-onboarding json mode emits machine-readable report", () => {
    const result = runScript("check-onboarding.mjs", ["--json"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(typeof report.passed).toBe("boolean");
    expect(report.noBuild).toBe(false);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBeNull();
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
    expect(Array.isArray(report.steps)).toBe(true);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps[0].name).toBe("Developer environment preflight");
    expect(
      report.steps.some((step) => step.name === "Client checks")
    ).toBe(true);
    expect(report.steps[0].report).not.toBeNull();
    if (report.steps[0].report !== null) {
      expect(report.steps[0].report.schemaVersion).toBe(1);
      expect(typeof report.steps[0].report.passed).toBe("boolean");
      expectTimingMetadata(report.steps[0].report);
      expectOptionTerminatorMetadata(report.steps[0].report);
    }
    if (report.failedStepCount > 0) {
      expect(report.firstFailedStep).toBe(
        report.steps.find((step) => !step.passed && step.skipped === false)?.name
      );
    } else {
      expect(report.firstFailedStep).toBeNull();
    }
    expect(result.status).toBe(report.passed ? 0 : 1);
    expect(result.output).not.toContain("Running onboarding step:");
    expect(result.output).not.toContain("Onboarding check failed:");
  });

  it("check-onboarding supports compact json mode", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--compact"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expectCompactJsonOutput(result.output.trim());
    expect(report.schemaVersion).toBe(1);
    expectTimingMetadata(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("check-onboarding json mode writes report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-json-")
    );
    const outputPath = path.resolve(tempDirectory, "onboarding-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expectTimingMetadata(stdoutReport);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode supports inline output values", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-json-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "onboarding-inline-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--no-build",
      `--output=${outputPath}`,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-json-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--no-build",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode validates missing output value", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--output"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-onboarding json mode validates empty split output value", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--output", ""]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
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

  it("check-onboarding json mode validates whitespace split output value", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      "   ",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
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

  it("check-onboarding json mode validates empty inline output value", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--output="]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-onboarding json mode validates whitespace inline output value", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--output=   "]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-onboarding prioritizes output validation while reporting unsupported options", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--mystery",
      "--output",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-onboarding prioritizes inline whitespace output validation while reporting unsupported options", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--mystery",
      "--output=   ",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
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

  it("check-onboarding ignores option-like tokens after option terminator", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--no-build",
      "--",
      "--output",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--output"]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.totalSteps).toBeGreaterThan(0);
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

  it("check-onboarding json mode reports unsupported options", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--mystery"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-onboarding json mode normalizes inline unsupported options", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--mystery=alpha",
      "--mystery=beta",
      "-x=1",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--mystery", "-x"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-onboarding json mode writes unsupported-option validation reports to output files", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-validation-report-")
    );
    const outputPath = path.resolve(tempDirectory, "validation-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--mystery",
      "--output",
      outputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as OnboardingJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.totalSteps).toBe(0);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode writes unsupported-option validation reports to inline output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-validation-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "inline-validation-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--mystery",
      `--output=${outputPath}`,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as OnboardingJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.totalSteps).toBe(0);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json validation output uses the last output flag", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-validation-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--mystery",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.totalSteps).toBe(0);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode reports validation output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-validation-write-failure-")
    );

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--mystery",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.totalSteps).toBe(0);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode fails when last output flag value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-last-output-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--no-build",
      "--output",
      firstOutputPath,
      "--output",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode fails when trailing inline output value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-trailing-inline-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--no-build",
      `--output=${firstOutputPath}`,
      "--output=",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.totalSteps).toBe(0);
    expect(report.passedStepCount).toBe(0);
    expect(report.failedStepCount).toBe(0);
    expect(report.skippedStepCount).toBe(0);
    expect(report.firstFailedStep).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding json mode reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-onboarding-output-write-failure-")
    );

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--no-build",
      "--output",
      tempDirectory,
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("check-onboarding non-json mode fails on unsupported options", () => {
    const result = runScript("check-onboarding.mjs", ["--mystery"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
  });

  it("check-onboarding non-json mode normalizes inline unsupported options", () => {
    const result = runScript("check-onboarding.mjs", [
      "--mystery=alpha",
      "--mystery=beta",
      "-x=1",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --mystery, -x. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--mystery=alpha");
    expect(result.output).not.toContain("--mystery=beta");
    expect(result.output).not.toContain("-x=1");
  });

  it("check-onboarding non-json mode fails on missing output value", () => {
    const result = runScript("check-onboarding.mjs", ["--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-onboarding non-json mode fails on inline whitespace output value", () => {
    const result = runScript("check-onboarding.mjs", ["--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-onboarding non-json mode fails on inline empty output value", () => {
    const result = runScript("check-onboarding.mjs", ["--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("check-onboarding non-json mode prioritizes missing output value over unsupported options", () => {
    const result = runScript("check-onboarding.mjs", ["--mystery", "--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-onboarding non-json mode prioritizes inline whitespace output value over unsupported options", () => {
    const result = runScript("check-onboarding.mjs", ["--mystery", "--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-onboarding non-json mode prioritizes inline empty output value over unsupported options", () => {
    const result = runScript("check-onboarding.mjs", ["--mystery", "--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-onboarding json no-build mode propagates option", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--no-build"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps[0].name).toBe("Developer environment preflight");
    const clientStep = report.steps.find((step) => step.name === "Client checks");
    expect(clientStep).toBeDefined();
    if (clientStep !== undefined && report.steps[0].passed === false) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe(
        "Developer environment preflight failed"
      );
    }
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
  });

  it("check-onboarding json verify mode aliases no-build behavior", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--verify"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expect(report.totalSteps).toBe(report.steps.length);
    expect(report.passedStepCount + report.failedStepCount + report.skippedStepCount).toBe(
      report.totalSteps
    );
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.steps[0].name).toBe("Developer environment preflight");
    const clientStep = report.steps.find((step) => step.name === "Client checks");
    expect(clientStep).toBeDefined();
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
  });
});
