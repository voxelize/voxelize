import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type TsCoreCheckReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  optionTerminatorUsed: boolean;
  positionalArgs: string[];
  positionalArgCount: number;
  noBuild: boolean;
  packagePath: string;
  requiredArtifacts: string[];
  requiredArtifactCount: number;
  artifactsPresent: boolean;
  missingArtifacts: string[];
  missingArtifactCount: number;
  attemptedBuild: boolean;
  buildSkipped: boolean;
  buildOutput: string | null;
  outputPath: string | null;
  unknownOptions: string[];
  unknownOptionCount: number;
  supportedCliOptions: string[];
  supportedCliOptionCount: number;
  availableCliOptionAliases: {
    "--no-build": string[];
  };
  availableCliOptionCanonicalMap: Record<string, string>;
  validationErrorCode:
    | "output_option_missing_value"
    | "unsupported_options"
    | null;
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
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message: string;
  writeError?: string;
};

type ScriptResult = {
  status: number;
  output: string;
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");
const tsCoreCheckScript = path.resolve(rootDir, "check-ts-core.mjs");
const expectedSupportedCliOptions = [
  "--compact",
  "--json",
  "--no-build",
  "--output",
  "--quiet",
  "--verify",
];
const expectedRequiredArtifacts = [
  "packages/ts-core/dist/index.js",
  "packages/ts-core/dist/index.mjs",
  "packages/ts-core/dist/index.d.ts",
];
const resolveArtifactPath = (artifactPath: string) => {
  return path.resolve(rootDir, artifactPath);
};

const runWithTemporarilyMovedArtifact = (
  artifactPath: string,
  run: () => void
) => {
  const absoluteArtifactPath = resolveArtifactPath(artifactPath);
  if (!fs.existsSync(absoluteArtifactPath)) {
    throw new Error(`Artifact does not exist for test setup: ${artifactPath}`);
  }
  const backupPath = `${absoluteArtifactPath}.backup-${Date.now()}`;
  fs.renameSync(absoluteArtifactPath, backupPath);

  try {
    run();
  } finally {
    const artifactExists = fs.existsSync(absoluteArtifactPath);
    const backupExists = fs.existsSync(backupPath);

    if (artifactExists && backupExists) {
      fs.rmSync(backupPath, { force: true });
      return;
    }

    if (!artifactExists && backupExists) {
      fs.renameSync(backupPath, absoluteArtifactPath);
    }
  }
};

const runScript = (args: string[] = []): ScriptResult => {
  const result = spawnSync(process.execPath, [tsCoreCheckScript, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  };
};

const parseReport = (result: ScriptResult): TsCoreCheckReport => {
  const report = JSON.parse(result.output) as TsCoreCheckReport;
  expect(report.requiredArtifactCount).toBe(report.requiredArtifacts.length);
  expect(report.missingArtifactCount).toBe(report.missingArtifacts.length);
  return report;
};

describe("check-ts-core script", () => {
  it("reports strict output validation while keeping no-build aliases active", () => {
    const result = runScript(["--json", "--output", "--verify"]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.optionTerminatorUsed).toBe(false);
    expect(report.positionalArgs).toEqual([]);
    expect(report.positionalArgCount).toBe(0);
    expect(report.noBuild).toBe(true);
    expect(report.packagePath).toBe("packages/ts-core");
    expect(report.requiredArtifacts).toEqual(expectedRequiredArtifacts);
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(expectedSupportedCliOptions.length);
    expect(report.availableCliOptionAliases).toEqual({
      "--no-build": ["--verify"],
    });
    expect(report.availableCliOptionCanonicalMap).toEqual({
      "--compact": "--compact",
      "--json": "--json",
      "--no-build": "--no-build",
      "--output": "--output",
      "--quiet": "--quiet",
      "--verify": "--no-build",
    });
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output", "--verify"]);
    expect(report.activeCliOptionResolutions).toEqual([
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
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
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
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(typeof report.startedAt).toBe("string");
    expect(typeof report.endedAt).toBe("string");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports missing artifacts in no-build mode when ts-core outputs are absent", () => {
    const missingArtifactPath = expectedRequiredArtifacts[0];
    runWithTemporarilyMovedArtifact(missingArtifactPath, () => {
      const result = runScript(["--json", "--no-build"]);
      const report = parseReport(result);

      expect(result.status).toBe(1);
      expect(report.schemaVersion).toBe(1);
      expect(report.passed).toBe(false);
      expect(report.exitCode).toBe(1);
      expect(report.noBuild).toBe(true);
      expect(report.validationErrorCode).toBeNull();
      expect(report.artifactsPresent).toBe(false);
      expect(report.missingArtifacts).toContain(missingArtifactPath);
      expect(report.attemptedBuild).toBe(false);
      expect(report.buildSkipped).toBe(true);
      expect(report.buildOutput).toBeNull();
      expect(report.message).toContain(
        "Build was skipped due to --no-build."
      );
    });
  });

  it("rebuilds missing artifacts when no-build mode is disabled", () => {
    const missingArtifactPath = expectedRequiredArtifacts[0];
    runWithTemporarilyMovedArtifact(missingArtifactPath, () => {
      const result = runScript(["--json"]);
      const report = parseReport(result);

      expect(result.status).toBe(0);
      expect(report.schemaVersion).toBe(1);
      expect(report.passed).toBe(true);
      expect(report.exitCode).toBe(0);
      expect(report.noBuild).toBe(false);
      expect(report.validationErrorCode).toBeNull();
      expect(report.artifactsPresent).toBe(true);
      expect(report.missingArtifacts).toEqual([]);
      expect(report.attemptedBuild).toBe(true);
      expect(report.buildSkipped).toBe(false);
      expect(report.message).toBe("TypeScript core build artifacts are available.");
      expect(fs.existsSync(resolveArtifactPath(missingArtifactPath))).toBe(true);
    });
  });

  it("writes unsupported-option validation report to trailing output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ts-core-check-output-validation-")
    );
    const outputPath = path.join(tempDirectory, "report.json");
    const result = runScript([
      "--json",
      "--output",
      "--verify=1",
      "--output",
      outputPath,
    ]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as TsCoreCheckReport;

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(report.optionTerminatorUsed).toBe(false);
    expect(report.positionalArgs).toEqual([]);
    expect(report.positionalArgCount).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.packagePath).toBe("packages/ts-core");
    expect(report.requiredArtifacts).toEqual(expectedRequiredArtifacts);
    expect(report.outputPath).toBe(outputPath);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(expectedSupportedCliOptions.length);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
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
        token: "--output",
        canonicalOption: "--output",
        index: 3,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(fileReport).toEqual(report);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes json reports to output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ts-core-check-json-output-")
    );
    const outputPath = path.join(tempDirectory, "report.json");
    const result = runScript(["--json", "--output", outputPath]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as TsCoreCheckReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBe(outputPath);
    expect(report.validationErrorCode).toBeNull();
    expect(typeof report.startedAt).toBe("string");
    expect(typeof report.endedAt).toBe("string");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(fileReport).toEqual(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("reports validation output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ts-core-check-validation-write-failure-")
    );
    const result = runScript([
      "--json",
      "--verify=1",
      "--output",
      tempDirectory,
    ]);
    const report = parseReport(result);
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("keeps trailing output paths when no-build aliases appear between output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ts-core-check-last-output-strict-no-build-alias-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const result = runScript([
      "--json",
      "--output",
      firstOutputPath,
      "--verify",
      "--output",
      secondOutputPath,
    ]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as TsCoreCheckReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBe(secondOutputPath);
    expect(report.validationErrorCode).toBeNull();
    expect(report.noBuild).toBe(true);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
      "--verify",
    ]);
    expect(report.activeCliOptionResolutions).toEqual([
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
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
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
        token: "--output",
        canonicalOption: "--output",
        index: 4,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(fileReport).toEqual(report);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("resolves trailing inline output values after strict no-build aliases", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ts-core-check-inline-last-output-strict-alias-")
    );
    const outputPath = path.join(tempDirectory, "report.json");
    const result = runScript([
      "--json",
      "--output",
      "--verify",
      `--output=${outputPath}`,
    ]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as TsCoreCheckReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.validationErrorCode).toBeNull();
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBe(outputPath);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
      "--verify",
      `--output=${outputPath}`,
    ]);
    expect(report.activeCliOptionResolutions).toEqual([
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
        token: `--output=${outputPath}`,
        canonicalOption: "--output",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
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
      {
        token: `--output=${outputPath}`,
        canonicalOption: "--output",
        index: 3,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(fileReport).toEqual(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ts-core-check-output-write-failure-")
    );
    const result = runScript(["--json", "--output", tempDirectory]);
    const report = parseReport(result);
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBeNull();
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("treats no-build aliases after output as missing output value while keeping no-build active", () => {
    const result = runScript(["--json", "--output", "--verify"]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.optionTerminatorUsed).toBe(false);
    expect(report.positionalArgs).toEqual([]);
    expect(report.positionalArgCount).toBe(0);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output", "--verify"]);
    expect(report.activeCliOptionResolutions).toEqual([
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
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
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
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
  });

  it("treats canonical no-build tokens after output as missing output value while keeping no-build active", () => {
    const result = runScript(["--json", "--output", "--no-build"]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.optionTerminatorUsed).toBe(false);
    expect(report.positionalArgs).toEqual([]);
    expect(report.positionalArgCount).toBe(0);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
      "--no-build",
    ]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--no-build",
        canonicalOption: "--no-build",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
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
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
  });

  it("treats option-terminator tokens as positional args in compact json mode", () => {
    const result = runScript(["--json", "--compact", "--no-build", "--", "--verify=1"]);
    const report = parseReport(result);

    expect(result.output).not.toContain("\n  \"");
    expect(report.schemaVersion).toBe(1);
    expect(report.exitCode).toBe(result.status);
    expect([0, 1]).toContain(result.status);
    expect(report.validationErrorCode).toBeNull();
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual(["--verify=1"]);
    expect(report.positionalArgCount).toBe(report.positionalArgs.length);
    expect(report.noBuild).toBe(true);
    expect(report.packagePath).toBe("packages/ts-core");
    expect(report.requiredArtifacts).toEqual(expectedRequiredArtifacts);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(expectedSupportedCliOptions.length);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--compact", "--json", "--no-build"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--json",
      "--compact",
      "--no-build",
    ]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--compact",
        canonicalOption: "--compact",
      },
      {
        token: "--no-build",
        canonicalOption: "--no-build",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
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
      {
        token: "--no-build",
        canonicalOption: "--no-build",
        index: 2,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.attemptedBuild).toBe(false);
    expect(report.buildSkipped).toBe(true);
    expect(report.buildOutput).toBeNull();
    expect(report.artifactsPresent).toBe(report.missingArtifacts.length === 0);
    if (report.passed) {
      expect(report.missingArtifacts).toEqual([]);
    } else {
      expect(report.missingArtifacts.length).toBeGreaterThan(0);
    }
  });

  it("does not activate no-build aliases after option terminator", () => {
    const result = runScript(["--json", "--", "--verify", "--no-build"]);
    const report = parseReport(result);

    expect(report.schemaVersion).toBe(1);
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual(["--verify", "--no-build"]);
    expect(report.positionalArgCount).toBe(report.positionalArgs.length);
    expect(report.noBuild).toBe(false);
    expect(report.validationErrorCode).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--json"]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("prioritizes strict output validation while surfacing inline misuse in json mode", () => {
    const result = runScript(["--json", "--output", "--json=1", "--verify=1"]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.noBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual(["--json=<value>", "--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
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
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
  });

  it("reports only pre-terminator unsupported options", () => {
    const result = runScript([
      "--json",
      "--mystery",
      "--",
      "--another-mystery",
      "--verify=1",
      "--=secret",
    ]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual([
      "--another-mystery",
      "--verify=1",
      "--=secret",
    ]);
    expect(report.positionalArgCount).toBe(report.positionalArgs.length);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--json"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--json"]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
  });

  it("redacts malformed inline option names in json mode", () => {
    const result = runScript(["--json", "--=secret", "--=alpha", "-=beta", "-="]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.unknownOptions).toEqual(["--=<value>", "-=<value>"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.activeCliOptions).toEqual(["--json"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--json"]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.message).toContain("--=<value>");
    expect(report.message).toContain("-=<value>");
    expect(result.output).not.toContain("--=secret");
    expect(result.output).not.toContain("-=beta");
  });

  it("fails on missing output values in non-json mode", () => {
    const result = runScript(["--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("validates empty split output values in json mode", () => {
    const result = runScript(["--json", "--output", ""]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
  });

  it("validates whitespace split output values in json mode", () => {
    const result = runScript(["--json", "--output", "   "]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
  });

  it("validates empty inline output values in json mode", () => {
    const result = runScript(["--json", "--output="]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
  });

  it("validates whitespace inline output values in json mode", () => {
    const result = runScript(["--json", "--output=   "]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
  });

  it("suppresses success output in quiet non-json mode", () => {
    const result = runScript(["--quiet"]);

    expect(result.status).toBe(0);
    expect(result.output.trim()).toBe("");
  });

  it("does not suppress validation failures in quiet non-json mode", () => {
    const result = runScript(["--quiet", "--output"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("prioritizes missing output values over inline no-build alias misuse in non-json mode", () => {
    const result = runScript(["--output", "--verify=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--verify=1");
  });

  it("fails on empty inline output values in non-json mode", () => {
    const result = runScript(["--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("fails on whitespace inline output values in non-json mode", () => {
    const result = runScript(["--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
  });

  it("prioritizes missing output values over inline misuse in non-json mode", () => {
    const result = runScript(["--output", "--json=1", "--verify=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--json=1");
    expect(result.output).not.toContain("--verify=1");
  });

  it("prioritizes missing output values over canonical no-build tokens in non-json mode", () => {
    const result = runScript(["--output", "--no-build"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("redacts malformed inline option names in non-json mode", () => {
    const result = runScript(["--=secret", "-=beta"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Unsupported option(s): --=<value>, -=<value>.");
    expect(result.output).not.toContain("--=secret");
    expect(result.output).not.toContain("-=beta");
  });

  it("keeps json output machine-readable in quiet mode", () => {
    const result = runScript(["--json", "--quiet", "--compact"]);
    const report = parseReport(result);

    expect(result.output).not.toContain("\n  \"");
    expect(report.schemaVersion).toBe(1);
    expect(report.optionTerminatorUsed).toBe(false);
    expect(report.positionalArgs).toEqual([]);
    expect(report.positionalArgCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--compact", "--json", "--quiet"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--json",
      "--quiet",
      "--compact",
    ]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--quiet",
        canonicalOption: "--quiet",
      },
      {
        token: "--compact",
        canonicalOption: "--compact",
      },
    ]);
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--quiet",
        canonicalOption: "--quiet",
        index: 1,
      },
      {
        token: "--compact",
        canonicalOption: "--compact",
        index: 2,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });
});
