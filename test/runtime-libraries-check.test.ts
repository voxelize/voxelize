import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type RuntimePackageReport = {
  packageName: string;
  packagePath: string;
  requiredArtifacts: string[];
  requiredArtifactCount: number;
  presentArtifacts: string[];
  presentArtifactCount: number;
  missingArtifacts: string[];
  missingArtifactCount: number;
  artifactsPresent: boolean;
};

type RuntimeLibrariesCheckReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  optionTerminatorUsed: boolean;
  positionalArgs: string[];
  positionalArgCount: number;
  noBuild: boolean;
  packagesPresent: boolean;
  packageReports: RuntimePackageReport[];
  checkedPackages: string[];
  checkedPackagePaths: string[];
  checkedPackageCount: number;
  checkedPackagePathCount: number;
  presentPackages: string[];
  missingPackages: string[];
  requiredPackageCount: number;
  presentPackageCount: number;
  packageReportCount: number;
  requiredArtifactCount: number;
  presentArtifactCount: number;
  missingPackageCount: number;
  missingArtifactCount: number;
  missingArtifactSummary: string | null;
  attemptedBuild: boolean;
  buildSkipped: boolean;
  buildSkippedReason: "no-build" | "artifacts-present" | null;
  buildOutput: string | null;
  buildCommand: string;
  buildArgs: string[];
  buildExitCode: number | null;
  buildDurationMs: number | null;
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
const checkerScript = path.resolve(rootDir, "check-runtime-libraries.mjs");
const expectedCheckedPackages = [
  "@voxelize/aabb",
  "@voxelize/raycast",
  "@voxelize/physics-engine",
];
const expectedCheckedPackagePaths = [
  "packages/aabb",
  "packages/raycast",
  "packages/physics-engine",
];
const expectedSupportedCliOptions = [
  "--compact",
  "--json",
  "--no-build",
  "--output",
  "--quiet",
  "--verify",
];
const expectedBuildArgs = [
  "--dir",
  rootDir,
  "--filter",
  "@voxelize/aabb",
  "--filter",
  "@voxelize/raycast",
  "--filter",
  "@voxelize/physics-engine",
  "run",
  "build",
];
const expectedArtifactsByPackage = {
  "@voxelize/aabb": [
    "packages/aabb/dist/index.js",
    "packages/aabb/dist/index.mjs",
    "packages/aabb/dist/index.d.ts",
  ],
  "@voxelize/raycast": [
    "packages/raycast/dist/index.js",
    "packages/raycast/dist/index.mjs",
    "packages/raycast/dist/index.d.ts",
  ],
  "@voxelize/physics-engine": [
    "packages/physics-engine/dist/index.cjs",
    "packages/physics-engine/dist/index.js",
    "packages/physics-engine/dist/index.d.ts",
  ],
};
const expectedRequiredArtifactCount = Object.values(
  expectedArtifactsByPackage
).reduce((count, artifacts) => {
  return count + artifacts.length;
}, 0);
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
  const result = spawnSync(process.execPath, [checkerScript, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  };
};
const parseReport = (result: ScriptResult): RuntimeLibrariesCheckReport => {
  const report = JSON.parse(result.output) as RuntimeLibrariesCheckReport;
  expect(report.checkedPackages).toEqual(expectedCheckedPackages);
  expect(report.checkedPackagePaths).toEqual(expectedCheckedPackagePaths);
  expect(report.checkedPackages).toEqual(
    report.packageReports.map((packageReport) => packageReport.packageName)
  );
  expect(report.checkedPackagePaths).toEqual(
    report.packageReports.map((packageReport) => packageReport.packagePath)
  );
  expect(report.checkedPackageCount).toBe(report.checkedPackages.length);
  expect(report.checkedPackagePathCount).toBe(report.checkedPackagePaths.length);
  expect(report.checkedPackagePathCount).toBe(report.requiredPackageCount);
  expect(report.requiredPackageCount).toBe(expectedCheckedPackages.length);
  expect(report.packageReportCount).toBe(report.packageReports.length);
  expect(report.requiredArtifactCount).toBe(expectedRequiredArtifactCount);
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
  expect(report.packageReports).toHaveLength(3);
  const missingPackageCount = report.packageReports.filter((packageReport) => {
    return packageReport.artifactsPresent === false;
  }).length;
  const missingArtifactCount = report.packageReports.reduce((count, packageReport) => {
    return count + packageReport.missingArtifactCount;
  }, 0);
  const presentPackageCount = report.packageReports.length - missingPackageCount;
  const presentPackages = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => packageReport.packageName);
  const missingPackages = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => packageReport.packageName);
  const presentArtifactCount = report.packageReports.reduce((count, packageReport) => {
    return count + packageReport.presentArtifactCount;
  }, 0);
  expect(report.packagesPresent).toBe(missingPackageCount === 0);
  expect(report.requiredPackageCount).toBe(
    report.presentPackageCount + report.missingPackageCount
  );
  expect(report.requiredArtifactCount).toBe(
    report.presentArtifactCount + report.missingArtifactCount
  );
  expect(report.presentPackageCount).toBe(presentPackageCount);
  expect(report.presentPackages).toEqual(presentPackages);
  expect(report.presentPackages.length).toBe(report.presentPackageCount);
  expect(report.missingPackages).toEqual(missingPackages);
  expect(report.missingPackages.length).toBe(report.missingPackageCount);
  expect(report.presentArtifactCount).toBe(presentArtifactCount);
  expect(report.missingPackageCount).toBe(missingPackageCount);
  expect(report.missingArtifactCount).toBe(missingArtifactCount);
  if (report.missingArtifactCount === 0) {
    expect(report.missingArtifactSummary).toBeNull();
  } else {
    expect(report.missingArtifactSummary).not.toBeNull();
    if (report.missingArtifactSummary !== null) {
      expect(report.missingArtifactSummary.length).toBeGreaterThan(0);
      expect(report.missingPackages.some((packageName) => {
        return report.missingArtifactSummary?.includes(packageName) ?? false;
      })).toBe(true);
    }
  }
  for (const packageReport of report.packageReports) {
    expect(packageReport.requiredArtifacts).toEqual(
      expectedArtifactsByPackage[
        packageReport.packageName as keyof typeof expectedArtifactsByPackage
      ]
    );
    expect(packageReport.requiredArtifactCount).toBe(
      packageReport.requiredArtifacts.length
    );
    expect(packageReport.presentArtifactCount).toBe(
      packageReport.presentArtifacts.length
    );
    expect(packageReport.presentArtifactCount).toBe(
      packageReport.requiredArtifactCount - packageReport.missingArtifactCount
    );
    expect(packageReport.missingArtifactCount).toBe(
      packageReport.missingArtifacts.length
    );
    expect([...packageReport.presentArtifacts, ...packageReport.missingArtifacts].sort()).toEqual(
      [...packageReport.requiredArtifacts].sort()
    );
  }
  expect(typeof report.buildCommand).toBe("string");
  expect(report.buildCommand.length).toBeGreaterThan(0);
  expect(report.buildArgs).toEqual(expectedBuildArgs);
  if (report.buildExitCode !== null) {
    expect(Number.isInteger(report.buildExitCode)).toBe(true);
  }
  if (report.attemptedBuild) {
    expect(typeof report.buildDurationMs).toBe("number");
    expect(report.buildDurationMs).toBeGreaterThanOrEqual(0);
  } else {
    expect(report.buildExitCode).toBeNull();
    expect(report.buildDurationMs).toBeNull();
  }
  if (report.buildSkipped) {
    expect(
      report.buildSkippedReason === "no-build" ||
        report.buildSkippedReason === "artifacts-present"
    ).toBe(true);
  } else {
    expect(report.buildSkippedReason).toBeNull();
  }
  if (report.buildSkippedReason === "no-build") {
    expect(report.noBuild).toBe(true);
  }
  if (report.buildSkippedReason === "artifacts-present") {
    expect(report.attemptedBuild).toBe(false);
  }
  return report;
};

describe("check-runtime-libraries script", () => {
  it("prints clear non-json success output", () => {
    const result = runScript();

    expect(result.status).toBe(0);
    expect(result.output).toContain("Runtime library build artifacts are available.");
  });

  it("suppresses non-json success output in quiet mode", () => {
    const result = runScript(["--quiet"]);

    expect(result.status).toBe(0);
    expect(result.output).toBe("");
  });

  it("keeps non-json failures visible in quiet mode", () => {
    const missingArtifactPath = "packages/aabb/dist/index.js";
    runWithTemporarilyMovedArtifact(missingArtifactPath, () => {
      const result = runScript(["--no-build", "--quiet"]);

      expect(result.status).toBe(1);
      expect(result.output).toContain("Build was skipped due to --no-build.");
    });
  });

  it("emits machine-readable json report and auto-builds if needed", () => {
    const result = runScript(["--json"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.validationErrorCode).toBeNull();
    expect(report.packagesPresent).toBe(true);
    expect(report.presentPackages).toEqual(expectedCheckedPackages);
    expect(report.missingPackages).toEqual([]);
    expect(report.presentPackageCount).toBe(report.requiredPackageCount);
    expect(report.presentArtifactCount).toBe(report.requiredArtifactCount);
    expect(report.missingPackageCount).toBe(0);
    expect(report.missingArtifactCount).toBe(0);
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
  });

  it("supports verify mode alias and skips builds when artifacts are present", () => {
    const result = runScript(["--json", "--verify"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(report.noBuild).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.buildSkipped).toBe(true);
    expect(report.buildSkippedReason).toBe("artifacts-present");
    expect(report.attemptedBuild).toBe(false);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--verify"]);
  });

  it("supports compact json output mode", () => {
    const result = runScript(["--json", "--compact"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(result.output).not.toContain("\n  \"");
    expect(report.schemaVersion).toBe(1);
  });

  it("reports strict output validation errors while keeping verify aliases active", () => {
    const result = runScript(["--json", "--output", "--verify"]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.noBuild).toBe(true);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output", "--verify"]);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
  });

  it("reports strict output validation for empty split output values", () => {
    const result = runScript(["--json", "--output", ""]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output"]);
  });

  it("reports strict output validation for whitespace split output values", () => {
    const result = runScript(["--json", "--output", "   "]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output"]);
  });

  it("reports strict output validation for empty inline output values", () => {
    const result = runScript(["--json", "--output="]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output="]);
  });

  it("reports strict output validation for whitespace inline output values", () => {
    const result = runScript(["--json", "--output=   "]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output=   "]);
  });

  it("reports unsupported options with canonical alias normalization", () => {
    const result = runScript(["--json", "--verify=1", "--mystery"]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.message).toContain("Unsupported option(s):");
  });

  it("writes json reports to output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-libraries-check-output-")
    );
    const outputPath = path.join(tempDirectory, "report.json");
    const result = runScript(["--json", "--output", outputPath]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as RuntimeLibrariesCheckReport;

    expect(result.status).toBe(0);
    expect(report.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.checkedPackages).toEqual(expectedCheckedPackages);
    expect(fileReport.requiredArtifactCount).toBe(expectedRequiredArtifactCount);
  });

  it("writes unsupported-option validation reports to trailing output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-libraries-check-validation-output-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const result = runScript([
      "--json",
      "--output",
      firstOutputPath,
      "--verify=1",
      "--output",
      secondOutputPath,
    ]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as RuntimeLibrariesCheckReport;

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.outputPath).toBe(secondOutputPath);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output"]);
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
        index: 4,
      },
    ]);
    expect(fileReport).toEqual(report);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
  });

  it("reports validation output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-libraries-check-validation-write-failure-")
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
  });

  it("keeps trailing output paths when no-build aliases appear between output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "runtime-libraries-check-last-output-strict-no-build-alias-"
      )
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
    ) as RuntimeLibrariesCheckReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBe(secondOutputPath);
    expect(report.validationErrorCode).toBeNull();
    expect(report.noBuild).toBe(true);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
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
    expect(fileReport).toEqual(report);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("resolves trailing inline output values after strict no-build aliases", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "runtime-libraries-check-inline-last-output-strict-alias-"
      )
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
    ) as RuntimeLibrariesCheckReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.validationErrorCode).toBeNull();
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBe(outputPath);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
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
    expect(fileReport).toEqual(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-libraries-check-output-write-failure-")
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
  });

  it("reports missing artifacts in no-build mode", () => {
    const missingArtifactPath = "packages/aabb/dist/index.js";
    runWithTemporarilyMovedArtifact(missingArtifactPath, () => {
      const result = runScript(["--json", "--no-build"]);
      const report = parseReport(result);

      expect(result.status).toBe(1);
      expect(report.passed).toBe(false);
      expect(report.noBuild).toBe(true);
      expect(report.packagesPresent).toBe(false);
      expect(report.presentPackages.length).toBe(report.presentPackageCount);
      expect(report.missingPackages.length).toBe(report.missingPackageCount);
      expect(report.presentPackageCount).toBeLessThan(report.requiredPackageCount);
      expect(report.presentArtifactCount).toBeLessThan(report.requiredArtifactCount);
      expect(report.missingPackageCount).toBeGreaterThanOrEqual(1);
      expect(report.missingArtifactCount).toBeGreaterThanOrEqual(1);
      expect(report.buildSkipped).toBe(true);
      expect(report.buildSkippedReason).toBe("no-build");
      expect(report.attemptedBuild).toBe(false);
      expect(report.message).toContain("Build was skipped due to --no-build.");
    });
  });

  it("rebuilds missing artifacts when no-build mode is disabled", () => {
    const missingArtifactPath = "packages/aabb/dist/index.js";
    runWithTemporarilyMovedArtifact(missingArtifactPath, () => {
      const result = runScript(["--json"]);
      const report = parseReport(result);

      expect(result.status).toBe(0);
      expect(report.passed).toBe(true);
      expect(report.packagesPresent).toBe(true);
      expect(report.presentPackages).toEqual(expectedCheckedPackages);
      expect(report.missingPackages).toEqual([]);
      expect(report.presentPackageCount).toBe(report.requiredPackageCount);
      expect(report.presentArtifactCount).toBe(report.requiredArtifactCount);
      expect(report.missingPackageCount).toBe(0);
      expect(report.missingArtifactCount).toBe(0);
      expect(report.attemptedBuild).toBe(true);
      expect(report.buildSkipped).toBe(false);
      expect(report.buildSkippedReason).toBeNull();
      expect(fs.existsSync(resolveArtifactPath(missingArtifactPath))).toBe(true);
    });
  });

  it("does not activate no-build aliases after option terminator", () => {
    const result = runScript(["--json", "--", "--verify"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual(["--verify"]);
    expect(report.activeCliOptions).toEqual(["--json"]);
  });

  it("keeps json output machine-readable in quiet mode", () => {
    const result = runScript(["--json", "--quiet"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.activeCliOptions).toEqual(["--json", "--quiet"]);
    expect(report.outputPath).toBeNull();
  });

  it("non-json mode prioritizes missing output value over inline json misuse", () => {
    const result = runScript(["--output", "--json=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--json=1");
  });

  it("non-json mode prioritizes whitespace inline output value over unsupported options", () => {
    const result = runScript(["--mystery", "--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("non-json mode prioritizes empty inline output value over unsupported options", () => {
    const result = runScript(["--mystery", "--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });
});
