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
  checkedPackage: string;
  checkedPackageCount: number;
  checkedPackagePath: string;
  checkedPackagePathCount: number;
  availablePackages: string[];
  availablePackageCount: number;
  availablePackagePaths: string[];
  availablePackagePathCount: number;
  availablePackageIndices: number[];
  availablePackageIndexCount: number;
  availablePackageIndexMap: Record<string, number>;
  availablePackageIndexMapCount: number;
  availablePackagePathMap: Record<string, string>;
  availablePackagePathMapCount: number;
  availablePackageCheckCommandMap: Record<string, string>;
  availablePackageCheckCommandMapCount: number;
  availablePackageCheckArgsMap: Record<string, string[]>;
  availablePackageCheckArgsMapCount: number;
  availablePackageCheckArgCountMap: Record<string, number>;
  availablePackageCheckArgCountMapCount: number;
  availablePackageMetadata: Record<
    string,
    {
      packagePath: string;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
      requiredArtifactCount: number;
    }
  >;
  availablePackageMetadataCount: number;
  checkedPackageIndices: number[];
  checkedPackageIndexCount: number;
  checkedPackageIndexMap: Record<string, number>;
  checkedPackageIndexMapCount: number;
  checkedPackagePathMap: Record<string, string>;
  checkedPackagePathMapCount: number;
  presentPackages: string[];
  missingPackages: string[];
  presentPackageIndices: number[];
  missingPackageIndices: number[];
  presentPackageIndexMap: Record<string, number>;
  missingPackageIndexMap: Record<string, number>;
  presentPackagePaths: string[];
  missingPackagePaths: string[];
  presentPackagePathMap: Record<string, string>;
  missingPackagePathMap: Record<string, string>;
  presentPackageCheckCommandMap: Record<string, string>;
  missingPackageCheckCommandMap: Record<string, string>;
  presentPackageCheckArgsMap: Record<string, string[]>;
  missingPackageCheckArgsMap: Record<string, string[]>;
  presentPackageCheckArgCountMap: Record<string, number>;
  missingPackageCheckArgCountMap: Record<string, number>;
  presentPackageMetadata: Record<
    string,
    {
      packagePath: string;
      packageIndex: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
      presentArtifactCount: number;
      missingArtifactCount: number;
      artifactsPresent: boolean;
    }
  >;
  missingPackageMetadata: Record<
    string,
    {
      packagePath: string;
      packageIndex: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
      presentArtifactCount: number;
      missingArtifactCount: number;
      artifactsPresent: boolean;
    }
  >;
  requiredPackageCount: number;
  presentPackageCount: number;
  missingPackageCount: number;
  presentPackageIndexCount: number;
  missingPackageIndexCount: number;
  presentPackageIndexMapCount: number;
  missingPackageIndexMapCount: number;
  presentPackagePathCount: number;
  missingPackagePathCount: number;
  presentPackagePathMapCount: number;
  missingPackagePathMapCount: number;
  presentPackageCheckCommandMapCount: number;
  missingPackageCheckCommandMapCount: number;
  presentPackageCheckArgsMapCount: number;
  missingPackageCheckArgsMapCount: number;
  presentPackageCheckArgCountMapCount: number;
  missingPackageCheckArgCountMapCount: number;
  presentPackageMetadataCount: number;
  missingPackageMetadataCount: number;
  packageReport: {
    packageName: string;
    packagePath: string;
    packageIndex: number;
    requiredArtifacts: string[];
    requiredArtifactCount: number;
    checkCommand: string;
    checkArgs: string[];
    checkArgCount: number;
    presentArtifacts: string[];
    presentArtifactCount: number;
    missingArtifacts: string[];
    missingArtifactCount: number;
    artifactsPresent: boolean;
  };
  packageReportCount: number;
  packageReportMap: Record<
    string,
    {
      packageName: string;
      packagePath: string;
      packageIndex: number;
      requiredArtifacts: string[];
      requiredArtifactCount: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
      presentArtifacts: string[];
      presentArtifactCount: number;
      missingArtifacts: string[];
      missingArtifactCount: number;
      artifactsPresent: boolean;
    }
  >;
  packageReportMapCount: number;
  packageCheckCommandMap: Record<string, string>;
  packageCheckCommandMapCount: number;
  packageCheckArgsMap: Record<string, string[]>;
  packageCheckArgsMapCount: number;
  packageCheckArgCountMap: Record<string, number>;
  packageCheckArgCountMapCount: number;
  packagePath: string;
  requiredArtifacts: string[];
  requiredArtifactsByPackage: Record<string, string[]>;
  requiredArtifactsByPackageCount: number;
  requiredArtifactCountByPackage: Record<string, number>;
  requiredArtifactCount: number;
  requiredArtifactCountByPackageCount: number;
  packageStatusMap: Record<string, "present" | "missing">;
  packageStatusMapCount: number;
  packageStatusCountMap: {
    present: number;
    missing: number;
  };
  packageStatusCountMapCount: number;
  artifactsPresentByPackage: Record<string, boolean>;
  artifactsPresentByPackageCount: number;
  presentArtifacts: string[];
  presentArtifactsByPackage: Record<string, string[]>;
  presentArtifactsByPackageCount: number;
  presentArtifactCount: number;
  presentArtifactCountByPackage: Record<string, number>;
  presentArtifactCountByPackageCount: number;
  presentPackageArtifactsByPackage: Record<string, string[]>;
  presentPackageArtifactsByPackageCount: number;
  presentPackageArtifactCountByPackage: Record<string, number>;
  presentPackageArtifactCountByPackageCount: number;
  buildCommand: string;
  buildArgs: string[];
  buildExitCode: number | null;
  buildDurationMs: number | null;
  exampleCommand: string;
  exampleArgs: string[];
  exampleArgCount: number;
  exampleAttempted: boolean;
  exampleStatus: "ok" | "failed" | "skipped";
  exampleRuleMatched: boolean | null;
  examplePayloadValid: boolean | null;
  examplePayloadIssues: string[] | null;
  examplePayloadIssueCount: number | null;
  exampleExitCode: number | null;
  exampleDurationMs: number | null;
  exampleOutputLine: string | null;
  artifactsPresent: boolean;
  missingArtifacts: string[];
  missingArtifactsByPackage: Record<string, string[]>;
  missingArtifactsByPackageCount: number;
  missingArtifactCount: number;
  missingArtifactCountByPackage: Record<string, number>;
  missingArtifactCountByPackageCount: number;
  missingPackageArtifactsByPackage: Record<string, string[]>;
  missingPackageArtifactsByPackageCount: number;
  missingPackageArtifactCountByPackage: Record<string, number>;
  missingPackageArtifactCountByPackageCount: number;
  failureSummaries: Array<
    | {
        kind: "artifacts";
        packageName: string;
        packagePath: string;
        packageIndex: number;
        checkCommand: string;
        checkArgs: string[];
        checkArgCount: number;
        missingArtifacts: string[];
        missingArtifactCount: number;
        message: string;
      }
    | {
        kind: "example";
        packageName: string;
        packagePath: string;
        packageIndex: number;
        checkCommand: string;
        checkArgs: string[];
        checkArgCount: number;
        exitCode: number | null;
        ruleMatched: boolean | null;
        payloadValid: boolean | null;
        payloadIssues: string[] | null;
        payloadIssueCount: number | null;
        outputLine: string | null;
        message: string;
      }
  >;
  failureSummaryCount: number;
  missingArtifactSummary: string | null;
  attemptedBuild: boolean;
  buildSkipped: boolean;
  buildSkippedReason: "no-build" | "artifacts-present" | null;
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
const expectedCheckedPackagePathMap = {
  "@voxelize/ts-core": "packages/ts-core",
};
const expectedCheckedPackageIndices = [0];
const expectedCheckedPackageIndexMap = {
  "@voxelize/ts-core": 0,
};
const expectedRequiredArtifactCountByPackage = {
  "@voxelize/ts-core": expectedRequiredArtifacts.length,
};
const expectedPackageCheckCommand = "artifact-exists";
const expectedBuildArgs = [
  "--dir",
  rootDir,
  "--filter",
  "@voxelize/ts-core",
  "run",
  "build",
];
const expectedExampleArgs = [
  path.resolve(rootDir, "packages/ts-core/examples/end-to-end.mjs"),
];
const exampleScriptRelativePath = "packages/ts-core/examples/end-to-end.mjs";
const expectedSuccessMessage =
  "TypeScript core build artifacts are available and the end-to-end example succeeded.";
const expectedRuleMismatchWithPayloadIssuesFailureMessage =
  "TypeScript core end-to-end example reported ruleMatched=false and has missing or invalid required payload fields: voxel, light, rotatedAabb.";
const deriveExpectedExampleFailureMessage = (report: {
  exampleExitCode: number | null;
  exampleRuleMatched: boolean | null;
  examplePayloadValid: boolean | null;
  examplePayloadIssues: string[] | null;
  exampleOutputLine: string | null;
}) => {
  if (report.exampleExitCode !== 0) {
    return "TypeScript core end-to-end example failed.";
  }

  if (report.exampleRuleMatched === false) {
    if (
      report.examplePayloadValid === false &&
      report.examplePayloadIssues !== null &&
      report.examplePayloadIssues.length > 0
    ) {
      return `TypeScript core end-to-end example reported ruleMatched=false and has missing or invalid required payload fields: ${report.examplePayloadIssues.join(", ")}.`;
    }

    if (report.examplePayloadValid === false) {
      return "TypeScript core end-to-end example reported ruleMatched=false and has missing or invalid required payload fields.";
    }

    return "TypeScript core end-to-end example reported ruleMatched=false.";
  }

  if (report.exampleRuleMatched !== true) {
    if (report.exampleOutputLine === null) {
      return "TypeScript core end-to-end example produced no parseable JSON output.";
    }

    if (
      report.examplePayloadValid === false &&
      report.examplePayloadIssues !== null &&
      report.examplePayloadIssues.length > 0
    ) {
      return `TypeScript core end-to-end example output was invalid and has missing or invalid required payload fields: ${report.examplePayloadIssues.join(", ")}.`;
    }

    if (report.examplePayloadValid === false) {
      return "TypeScript core end-to-end example output was invalid and has missing or invalid required payload fields.";
    }

    return "TypeScript core end-to-end example output was invalid.";
  }

  if (report.examplePayloadValid === false) {
    if (report.examplePayloadIssues !== null && report.examplePayloadIssues.length > 0) {
      return `TypeScript core end-to-end example output has missing or invalid required payload fields: ${report.examplePayloadIssues.join(", ")}.`;
    }

    return "TypeScript core end-to-end example output has missing or invalid required payload fields.";
  }

  return "TypeScript core end-to-end example output was invalid.";
};
const resolveArtifactPath = (artifactPath: string) => {
  return path.resolve(rootDir, artifactPath);
};

const runWithTemporarilyMovedPath = (
  relativePath: string,
  run: () => void
) => {
  const absolutePath = resolveArtifactPath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Path does not exist for test setup: ${relativePath}`);
  }
  const backupPath = `${absolutePath}.backup-${Date.now()}`;
  fs.renameSync(absolutePath, backupPath);

  try {
    run();
  } finally {
    const pathExists = fs.existsSync(absolutePath);
    const backupExists = fs.existsSync(backupPath);

    if (pathExists && backupExists) {
      fs.rmSync(backupPath, { force: true });
      return;
    }

    if (!pathExists && backupExists) {
      fs.renameSync(backupPath, absolutePath);
    }
  }
};
const runWithTemporarilyMovedArtifact = (
  artifactPath: string,
  run: () => void
) => {
  runWithTemporarilyMovedPath(artifactPath, run);
};
const runWithTemporarilyRewrittenPath = (
  relativePath: string,
  replacementContent: string,
  run: () => void
) => {
  const absolutePath = resolveArtifactPath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Path does not exist for test setup: ${relativePath}`);
  }

  const originalContent = fs.readFileSync(absolutePath, "utf8");
  fs.writeFileSync(absolutePath, replacementContent);

  try {
    run();
  } finally {
    fs.writeFileSync(absolutePath, originalContent);
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
  expect(report.checkedPackage).toBe("@voxelize/ts-core");
  expect(report.checkedPackageCount).toBe(1);
  expect(report.checkedPackagePath).toBe("packages/ts-core");
  expect(report.checkedPackagePathCount).toBe(1);
  expect(report.availablePackages).toEqual([report.checkedPackage]);
  expect(report.availablePackageCount).toBe(report.availablePackages.length);
  expect(report.availablePackagePaths).toEqual([report.checkedPackagePath]);
  expect(report.availablePackagePathCount).toBe(report.availablePackagePaths.length);
  expect(report.availablePackageIndices).toEqual(report.checkedPackageIndices);
  expect(report.availablePackageIndexCount).toBe(
    report.availablePackageIndices.length
  );
  expect(report.availablePackageIndexMap).toEqual(report.checkedPackageIndexMap);
  expect(report.availablePackageIndexMapCount).toBe(
    Object.keys(report.availablePackageIndexMap).length
  );
  expect(report.availablePackagePathMap).toEqual(report.checkedPackagePathMap);
  expect(report.availablePackagePathMapCount).toBe(
    Object.keys(report.availablePackagePathMap).length
  );
  expect(report.availablePackageCheckCommandMap).toEqual({
    [report.checkedPackage]: expectedPackageCheckCommand,
  });
  expect(report.availablePackageCheckCommandMapCount).toBe(
    Object.keys(report.availablePackageCheckCommandMap).length
  );
  expect(report.availablePackageCheckArgsMap).toEqual({
    [report.checkedPackage]: report.requiredArtifacts,
  });
  expect(report.availablePackageCheckArgsMapCount).toBe(
    Object.keys(report.availablePackageCheckArgsMap).length
  );
  expect(report.availablePackageCheckArgCountMap).toEqual({
    [report.checkedPackage]: report.requiredArtifactCount,
  });
  expect(report.availablePackageCheckArgCountMapCount).toBe(
    Object.keys(report.availablePackageCheckArgCountMap).length
  );
  expect(report.availablePackageMetadata).toEqual({
    [report.checkedPackage]: {
      packagePath: report.checkedPackagePath,
      checkCommand: expectedPackageCheckCommand,
      checkArgs: report.requiredArtifacts,
      checkArgCount: report.requiredArtifactCount,
      requiredArtifactCount: report.requiredArtifactCount,
    },
  });
  expect(report.availablePackageMetadataCount).toBe(
    Object.keys(report.availablePackageMetadata).length
  );
  expect(report.checkedPackageIndices).toEqual(expectedCheckedPackageIndices);
  expect(report.checkedPackageIndexCount).toBe(report.checkedPackageIndices.length);
  expect(report.checkedPackageIndexMap).toEqual(expectedCheckedPackageIndexMap);
  expect(report.checkedPackageIndexMapCount).toBe(
    Object.keys(report.checkedPackageIndexMap).length
  );
  expect(report.checkedPackagePathMap).toEqual(expectedCheckedPackagePathMap);
  expect(report.checkedPackagePathMapCount).toBe(
    Object.keys(report.checkedPackagePathMap).length
  );
  expect(report.requiredPackageCount).toBe(1);
  expect(report.presentPackageCount + report.missingPackageCount).toBe(
    report.requiredPackageCount
  );
  expect(report.checkedPackageIndexCount).toBe(
    report.presentPackageIndexCount + report.missingPackageIndexCount
  );
  expect(report.checkedPackageIndexMapCount).toBe(
    report.presentPackageIndexMapCount + report.missingPackageIndexMapCount
  );
  expect(report.checkedPackagePathCount).toBe(
    report.presentPackagePathCount + report.missingPackagePathCount
  );
  expect(report.checkedPackagePathMapCount).toBe(
    report.presentPackagePathMapCount + report.missingPackagePathMapCount
  );
  expect(report.checkedPackageCount).toBe(
    report.presentPackageMetadataCount + report.missingPackageMetadataCount
  );
  expect(report.presentArtifactsByPackageCount).toBe(
    report.presentPackageArtifactsByPackageCount +
      report.missingPackageArtifactsByPackageCount
  );
  expect(report.presentArtifactCountByPackageCount).toBe(
    report.presentPackageArtifactCountByPackageCount +
      report.missingPackageArtifactCountByPackageCount
  );
  expect(report.packageCheckCommandMapCount).toBe(
    report.presentPackageCheckCommandMapCount +
      report.missingPackageCheckCommandMapCount
  );
  expect(report.packageCheckArgsMapCount).toBe(
    report.presentPackageCheckArgsMapCount + report.missingPackageCheckArgsMapCount
  );
  expect(report.packageCheckArgCountMapCount).toBe(
    report.presentPackageCheckArgCountMapCount +
      report.missingPackageCheckArgCountMapCount
  );
  expect(report.presentPackageIndices.length).toBe(report.presentPackageIndexCount);
  expect(report.missingPackageIndices.length).toBe(report.missingPackageIndexCount);
  expect(report.presentPackages.length).toBe(report.presentPackageCount);
  expect(report.missingPackages.length).toBe(report.missingPackageCount);
  expect(report.presentPackagePaths.length).toBe(report.presentPackagePathCount);
  expect(report.missingPackagePaths.length).toBe(report.missingPackagePathCount);
  expect([...report.presentPackages, ...report.missingPackages]).toEqual([
    report.checkedPackage,
  ]);
  expect([...report.presentPackageIndices, ...report.missingPackageIndices]).toEqual(
    report.checkedPackageIndices
  );
  expect(report.presentPackageIndexMap).toEqual(
    Object.fromEntries(
      report.presentPackages.map((packageName) => {
        return [packageName, report.checkedPackageIndexMap[packageName]];
      })
    )
  );
  expect(report.presentPackageIndexMapCount).toBe(
    Object.keys(report.presentPackageIndexMap).length
  );
  expect(report.missingPackageIndexMap).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [packageName, report.checkedPackageIndexMap[packageName]];
      })
    )
  );
  expect(report.missingPackageIndexMapCount).toBe(
    Object.keys(report.missingPackageIndexMap).length
  );
  expect([...report.presentPackagePaths, ...report.missingPackagePaths]).toEqual([
    report.checkedPackagePath,
  ]);
  expect(report.presentPackagePathMap).toEqual(
    Object.fromEntries(
      report.presentPackages.map((packageName) => {
        return [packageName, report.checkedPackagePathMap[packageName]];
      })
    )
  );
  expect(report.presentPackagePathMapCount).toBe(
    Object.keys(report.presentPackagePathMap).length
  );
  expect(report.missingPackagePathMap).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [packageName, report.checkedPackagePathMap[packageName]];
      })
    )
  );
  expect(report.missingPackagePathMapCount).toBe(
    Object.keys(report.missingPackagePathMap).length
  );
  expect(report.presentPackageCheckCommandMap).toEqual(
    Object.fromEntries(
      report.presentPackages.map((packageName) => {
        return [packageName, expectedPackageCheckCommand];
      })
    )
  );
  expect(report.presentPackageCheckCommandMapCount).toBe(
    Object.keys(report.presentPackageCheckCommandMap).length
  );
  expect(report.missingPackageCheckCommandMap).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [packageName, expectedPackageCheckCommand];
      })
    )
  );
  expect(report.missingPackageCheckCommandMapCount).toBe(
    Object.keys(report.missingPackageCheckCommandMap).length
  );
  expect(report.presentPackageCheckArgsMap).toEqual(
    Object.fromEntries(
      report.presentPackages.map((packageName) => {
        return [packageName, report.requiredArtifacts];
      })
    )
  );
  expect(report.presentPackageCheckArgsMapCount).toBe(
    Object.keys(report.presentPackageCheckArgsMap).length
  );
  expect(report.missingPackageCheckArgsMap).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [packageName, report.requiredArtifacts];
      })
    )
  );
  expect(report.missingPackageCheckArgsMapCount).toBe(
    Object.keys(report.missingPackageCheckArgsMap).length
  );
  expect(report.presentPackageCheckArgCountMap).toEqual(
    Object.fromEntries(
      report.presentPackages.map((packageName) => {
        return [packageName, report.requiredArtifactCount];
      })
    )
  );
  expect(report.presentPackageCheckArgCountMapCount).toBe(
    Object.keys(report.presentPackageCheckArgCountMap).length
  );
  expect(report.missingPackageCheckArgCountMap).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [packageName, report.requiredArtifactCount];
      })
    )
  );
  expect(report.missingPackageCheckArgCountMapCount).toBe(
    Object.keys(report.missingPackageCheckArgCountMap).length
  );
  expect(report.presentPackageMetadata).toEqual(
    Object.fromEntries(
      report.presentPackages.map((packageName) => {
        return [
          packageName,
          {
            packagePath: report.checkedPackagePathMap[packageName],
            packageIndex: report.checkedPackageIndexMap[packageName],
            checkCommand: expectedPackageCheckCommand,
            checkArgs: report.requiredArtifacts,
            checkArgCount: report.requiredArtifactCount,
            presentArtifactCount: report.presentArtifactCount,
            missingArtifactCount: report.missingArtifactCount,
            artifactsPresent: report.artifactsPresent,
          },
        ];
      })
    )
  );
  expect(report.presentPackageMetadataCount).toBe(
    Object.keys(report.presentPackageMetadata).length
  );
  expect(report.missingPackageMetadata).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [
          packageName,
          {
            packagePath: report.checkedPackagePathMap[packageName],
            packageIndex: report.checkedPackageIndexMap[packageName],
            checkCommand: expectedPackageCheckCommand,
            checkArgs: report.requiredArtifacts,
            checkArgCount: report.requiredArtifactCount,
            presentArtifactCount: report.presentArtifactCount,
            missingArtifactCount: report.missingArtifactCount,
            artifactsPresent: report.artifactsPresent,
          },
        ];
      })
    )
  );
  expect(report.missingPackageMetadataCount).toBe(
    Object.keys(report.missingPackageMetadata).length
  );
  expect(report.checkedPackageIndexMap).toEqual({
    [report.checkedPackage]: report.checkedPackageIndices[0],
  });
  const expectedPackageReport = {
    packageName: report.checkedPackage,
    packagePath: report.checkedPackagePath,
    packageIndex: report.checkedPackageIndices[0],
    requiredArtifacts: report.requiredArtifacts,
    requiredArtifactCount: report.requiredArtifactCount,
    checkCommand: expectedPackageCheckCommand,
    checkArgs: report.requiredArtifacts,
    checkArgCount: report.requiredArtifactCount,
    presentArtifacts: report.presentArtifacts,
    presentArtifactCount: report.presentArtifactCount,
    missingArtifacts: report.missingArtifacts,
    missingArtifactCount: report.missingArtifactCount,
    artifactsPresent: report.artifactsPresent,
  };
  expect(report.packageReport).toEqual(expectedPackageReport);
  expect(report.packageReportCount).toBe(1);
  expect(report.packageReportMap).toEqual({
    [report.checkedPackage]: expectedPackageReport,
  });
  expect(report.packageReportMapCount).toBe(
    Object.keys(report.packageReportMap).length
  );
  expect(report.packageCheckCommandMap).toEqual({
    [report.checkedPackage]: expectedPackageCheckCommand,
  });
  expect(report.packageCheckCommandMapCount).toBe(
    Object.keys(report.packageCheckCommandMap).length
  );
  expect(report.packageCheckArgsMap).toEqual({
    [report.checkedPackage]: report.requiredArtifacts,
  });
  expect(report.packageCheckArgsMapCount).toBe(
    Object.keys(report.packageCheckArgsMap).length
  );
  expect(report.packageCheckArgCountMap).toEqual({
    [report.checkedPackage]: report.requiredArtifactCount,
  });
  expect(report.packageCheckArgCountMapCount).toBe(
    Object.keys(report.packageCheckArgCountMap).length
  );
  expect(report.checkedPackagePathMap).toEqual({
    [report.checkedPackage]: report.checkedPackagePath,
  });
  expect(report.artifactsPresent).toBe(report.missingArtifacts.length === 0);
  expect(report.requiredArtifactsByPackage).toEqual({
    [report.checkedPackage]: report.requiredArtifacts,
  });
  expect(report.requiredArtifactsByPackageCount).toBe(
    Object.keys(report.requiredArtifactsByPackage).length
  );
  expect(report.requiredArtifactCountByPackage).toEqual(
    expectedRequiredArtifactCountByPackage
  );
  expect(report.requiredArtifactCountByPackageCount).toBe(
    Object.keys(report.requiredArtifactCountByPackage).length
  );
  expect(report.packageStatusMap).toEqual({
    [report.checkedPackage]: report.artifactsPresent ? "present" : "missing",
  });
  expect(report.packageStatusMapCount).toBe(
    Object.keys(report.packageStatusMap).length
  );
  expect(report.packageStatusCountMap).toEqual({
    present: report.presentPackageCount,
    missing: report.missingPackageCount,
  });
  expect(report.packageStatusCountMapCount).toBe(
    Object.keys(report.packageStatusCountMap).length
  );
  expect(report.artifactsPresentByPackage).toEqual({
    [report.checkedPackage]: report.artifactsPresent,
  });
  expect(report.artifactsPresentByPackageCount).toBe(
    Object.keys(report.artifactsPresentByPackage).length
  );
  expect(report.requiredArtifactCount).toBe(
    report.presentArtifactCount + report.missingArtifactCount
  );
  expect(report.requiredArtifactCount).toBe(report.requiredArtifacts.length);
  expect(report.presentArtifactCount).toBe(report.presentArtifacts.length);
  expect(report.presentArtifactsByPackage).toEqual({
    [report.checkedPackage]: report.presentArtifacts,
  });
  expect(report.presentArtifactsByPackageCount).toBe(
    Object.keys(report.presentArtifactsByPackage).length
  );
  expect(report.presentArtifactCountByPackage).toEqual({
    [report.checkedPackage]: report.presentArtifactCount,
  });
  expect(report.presentArtifactCountByPackageCount).toBe(
    Object.keys(report.presentArtifactCountByPackage).length
  );
  expect(report.presentPackageArtifactsByPackage).toEqual(
    Object.fromEntries(
      report.presentPackages.map((packageName) => {
        return [packageName, report.presentArtifacts];
      })
    )
  );
  expect(report.presentPackageArtifactsByPackageCount).toBe(
    Object.keys(report.presentPackageArtifactsByPackage).length
  );
  expect(report.presentPackageArtifactCountByPackage).toEqual(
    Object.fromEntries(
      report.presentPackages.map((packageName) => {
        return [packageName, report.presentArtifactCount];
      })
    )
  );
  expect(report.presentPackageArtifactCountByPackageCount).toBe(
    Object.keys(report.presentPackageArtifactCountByPackage).length
  );
  expect([...report.presentArtifacts, ...report.missingArtifacts].sort()).toEqual(
    [...report.requiredArtifacts].sort()
  );
  expect(report.presentArtifactCount).toBe(
    report.requiredArtifactCount - report.missingArtifactCount
  );
  expect(report.missingArtifactCount).toBe(report.missingArtifacts.length);
  expect(report.missingArtifactsByPackage).toEqual({
    [report.checkedPackage]: report.missingArtifacts,
  });
  expect(report.missingArtifactsByPackageCount).toBe(
    Object.keys(report.missingArtifactsByPackage).length
  );
  expect(report.missingArtifactCountByPackage).toEqual({
    [report.checkedPackage]: report.missingArtifactCount,
  });
  expect(report.missingArtifactCountByPackageCount).toBe(
    Object.keys(report.missingArtifactCountByPackage).length
  );
  expect(report.missingPackageArtifactsByPackage).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [packageName, report.missingArtifacts];
      })
    )
  );
  expect(report.missingPackageArtifactsByPackageCount).toBe(
    Object.keys(report.missingPackageArtifactsByPackage).length
  );
  expect(report.missingPackageArtifactCountByPackage).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [packageName, report.missingArtifactCount];
      })
    )
  );
  expect(report.missingPackageArtifactCountByPackageCount).toBe(
    Object.keys(report.missingPackageArtifactCountByPackage).length
  );
  const expectedFailureSummaries: TsCoreCheckReport["failureSummaries"] = [];
  if (report.missingArtifactCount > 0) {
    expectedFailureSummaries.push({
      kind: "artifacts",
      packageName: report.checkedPackage,
      packagePath: report.checkedPackagePath,
      packageIndex: report.checkedPackageIndices[0],
      checkCommand: expectedPackageCheckCommand,
      checkArgs: report.requiredArtifacts,
      checkArgCount: report.requiredArtifactCount,
      missingArtifacts: report.missingArtifacts,
      missingArtifactCount: report.missingArtifactCount,
      message: `Missing artifacts for ${report.checkedPackage}: ${report.missingArtifacts.join(", ")}.`,
    });
  }
  if (report.exampleStatus === "failed") {
    expectedFailureSummaries.push({
      kind: "example",
      packageName: report.checkedPackage,
      packagePath: report.checkedPackagePath,
      packageIndex: report.checkedPackageIndices[0],
      checkCommand: process.execPath,
      checkArgs: expectedExampleArgs,
      checkArgCount: expectedExampleArgs.length,
      exitCode: report.exampleExitCode,
      ruleMatched: report.exampleRuleMatched,
      payloadValid: report.examplePayloadValid,
      payloadIssues: report.examplePayloadIssues,
      payloadIssueCount: report.examplePayloadIssueCount,
      outputLine: report.exampleOutputLine,
      message: deriveExpectedExampleFailureMessage(report),
    });
  }
  expect(report.failureSummaries).toEqual(expectedFailureSummaries);
  expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
  if (report.missingArtifactCount === 0) {
    expect(report.missingArtifactSummary).toBeNull();
  } else {
    expect(report.missingArtifactSummary).not.toBeNull();
    if (report.missingArtifactSummary !== null) {
      expect(report.missingArtifactSummary.length).toBeGreaterThan(0);
    }
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
    expect(report.buildSkippedReason === "no-build" || report.buildSkippedReason === "artifacts-present").toBe(true);
  } else {
    expect(report.buildSkippedReason).toBeNull();
  }
  if (report.buildSkippedReason === "no-build") {
    expect(report.noBuild).toBe(true);
  }
  if (report.buildSkippedReason === "artifacts-present") {
    expect(report.attemptedBuild).toBe(false);
  }
  expect(report.exampleCommand).toBe(process.execPath);
  expect(report.exampleArgs).toEqual(expectedExampleArgs);
  expect(report.exampleArgCount).toBe(report.exampleArgs.length);
  if (report.validationErrorCode === null && report.artifactsPresent) {
    expect(report.exampleAttempted).toBe(true);
  }
  if (report.exampleAttempted) {
    expect(report.exampleStatus === "ok" || report.exampleStatus === "failed").toBe(
      true
    );
    expect(typeof report.exampleExitCode).toBe("number");
    expect(report.exampleExitCode).not.toBeNull();
    expect(typeof report.exampleDurationMs).toBe("number");
    expect(report.exampleDurationMs).not.toBeNull();
    if (report.exampleDurationMs !== null) {
      expect(report.exampleDurationMs).toBeGreaterThanOrEqual(0);
    }
  } else {
    expect(report.exampleStatus).toBe("skipped");
    expect(report.exampleRuleMatched).toBeNull();
    expect(report.examplePayloadValid).toBeNull();
    expect(report.examplePayloadIssues).toBeNull();
    expect(report.examplePayloadIssueCount).toBeNull();
    expect(report.exampleExitCode).toBeNull();
    expect(report.exampleDurationMs).toBeNull();
    expect(report.exampleOutputLine).toBeNull();
  }
  if (report.examplePayloadIssues !== null && report.examplePayloadIssueCount !== null) {
    expect(report.examplePayloadIssueCount).toBe(report.examplePayloadIssues.length);
  }
  if (report.exampleStatus === "ok") {
    expect(report.exampleExitCode).toBe(0);
    expect(report.exampleRuleMatched).toBe(true);
    expect(report.examplePayloadValid).toBe(true);
    expect(report.examplePayloadIssues).toEqual([]);
    expect(report.examplePayloadIssueCount).toBe(0);
  }
  if (report.exampleStatus === "failed") {
    expect(
      (report.exampleExitCode === null || report.exampleExitCode !== 0) ||
        report.exampleRuleMatched !== true ||
        report.examplePayloadValid !== true
    ).toBe(true);
    if (report.examplePayloadValid === false) {
      expect(report.examplePayloadIssues).not.toBeNull();
      expect(report.examplePayloadIssueCount).not.toBeNull();
      if (
        report.examplePayloadIssues !== null &&
        report.examplePayloadIssueCount !== null
      ) {
        expect(report.examplePayloadIssueCount).toBeGreaterThan(0);
        expect(report.examplePayloadIssueCount).toBe(
          report.examplePayloadIssues.length
        );
      }
    }
  }
  if (report.exampleRuleMatched !== null && report.exampleOutputLine !== null) {
    expect(report.exampleOutputLine).toBe(
      `ruleMatched=${report.exampleRuleMatched ? "true" : "false"}`
    );
  }
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
      expect(report.presentArtifactCount).toBeLessThan(report.requiredArtifactCount);
      expect(report.missingArtifacts).toContain(missingArtifactPath);
      expect(report.attemptedBuild).toBe(false);
      expect(report.buildSkipped).toBe(true);
      expect(report.buildOutput).toBeNull();
      expect(report.exampleAttempted).toBe(false);
      expect(report.exampleStatus).toBe("skipped");
      expect(report.exampleExitCode).toBeNull();
      expect(report.exampleDurationMs).toBeNull();
      expect(report.exampleRuleMatched).toBeNull();
      expect(report.examplePayloadValid).toBeNull();
      expect(report.examplePayloadIssues).toBeNull();
      expect(report.examplePayloadIssueCount).toBeNull();
      expect(report.exampleOutputLine).toBeNull();
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
      expect(report.presentArtifactCount).toBe(report.requiredArtifactCount);
      expect(report.missingArtifacts).toEqual([]);
      expect(report.attemptedBuild).toBe(true);
      expect(report.buildSkipped).toBe(false);
      expect(report.message).toBe(expectedSuccessMessage);
      expect(fs.existsSync(resolveArtifactPath(missingArtifactPath))).toBe(true);
    });
  });

  it("uses the latest JSON payload from noisy example output", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log("warming up");
console.log(JSON.stringify({ ruleMatched: false }));
console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(0);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(true);
        expect(report.exitCode).toBe(0);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("ok");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(true);
        expect(report.examplePayloadIssues).toEqual([]);
        expect(report.examplePayloadIssueCount).toBe(0);
        expect(report.exampleOutputLine).toBe("ruleMatched=true");
        expect(report.failureSummaryCount).toBe(0);
        expect(report.failureSummaries).toEqual([]);
        expect(report.message).toBe(expectedSuccessMessage);
      }
    );
  });

  it("parses BOM-prefixed json payload from example output", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `process.stdout.write(
  "\\uFEFF" +
    JSON.stringify({
      voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
      light: { sunlight: 15, red: 10, green: 5, blue: 3 },
      rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
      ruleMatched: true,
    })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(0);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(true);
        expect(report.exitCode).toBe(0);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("ok");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(true);
        expect(report.examplePayloadIssues).toEqual([]);
        expect(report.examplePayloadIssueCount).toBe(0);
        expect(report.exampleOutputLine).toBe("ruleMatched=true");
        expect(report.failureSummaryCount).toBe(0);
        expect(report.failureSummaries).toEqual([]);
        expect(report.message).toBe(expectedSuccessMessage);
      }
    );
  });

  it("parses ANSI-wrapped BOM-prefixed json payload from example output", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `process.stdout.write(
  "\\u001b[33m\\uFEFF" +
    JSON.stringify({
      voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
      light: { sunlight: 15, red: 10, green: 5, blue: 3 },
      rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
      ruleMatched: true,
    }) +
    "\\u001b[39m"
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(0);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(true);
        expect(report.exitCode).toBe(0);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("ok");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(true);
        expect(report.examplePayloadIssues).toEqual([]);
        expect(report.examplePayloadIssueCount).toBe(0);
        expect(report.exampleOutputLine).toBe("ruleMatched=true");
        expect(report.failureSummaryCount).toBe(0);
        expect(report.failureSummaries).toEqual([]);
        expect(report.message).toBe(expectedSuccessMessage);
      }
    );
  });

  it("uses the latest payload from concatenated json object output", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `process.stdout.write(JSON.stringify({ ruleMatched: false }));
process.stdout.write(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(0);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(true);
        expect(report.exitCode).toBe(0);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("ok");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(true);
        expect(report.examplePayloadIssues).toEqual([]);
        expect(report.examplePayloadIssueCount).toBe(0);
        expect(report.exampleOutputLine).toBe("ruleMatched=true");
        expect(report.failureSummaryCount).toBe(0);
        expect(report.failureSummaries).toEqual([]);
        expect(report.message).toBe(expectedSuccessMessage);
      }
    );
  });

  it("ignores trailing primitive json lines after a valid payload", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);
console.log("true");\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(0);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(true);
        expect(report.exitCode).toBe(0);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("ok");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(true);
        expect(report.examplePayloadIssues).toEqual([]);
        expect(report.examplePayloadIssueCount).toBe(0);
        expect(report.exampleOutputLine).toBe("ruleMatched=true");
        expect(report.failureSummaryCount).toBe(0);
        expect(report.failureSummaries).toEqual([]);
        expect(report.message).toBe(expectedSuccessMessage);
      }
    );
  });

  it("fails when latest concatenated payload is array-shaped", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `process.stdout.write(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);
process.stdout.write(
  JSON.stringify([
    {
      voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
      light: { sunlight: 15, red: 10, green: 5, blue: 3 },
      rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
      ruleMatched: true,
    },
  ])
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBeNull();
        expect(report.examplePayloadValid).toBeNull();
        expect(report.examplePayloadIssues).toBeNull();
        expect(report.examplePayloadIssueCount).toBeNull();
        expect(report.exampleOutputLine).toBe(
          '[{"voxel":{"id":42,"stage":7,"rotation":{"value":0,"yRotation":2.356}},"light":{"sunlight":15,"red":10,"green":5,"blue":3},"rotatedAabb":{"min":[0,0,0],"max":[1,1,1]},"ruleMatched":true}]'
        );
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example output was invalid."
        );
      }
    );
  });

  it("fails when ts-core example execution fails after artifact checks pass", () => {
    runWithTemporarilyMovedPath(exampleScriptRelativePath, () => {
      const result = runScript(["--json"]);
      const report = parseReport(result);

      expect(result.status).toBe(1);
      expect(report.schemaVersion).toBe(1);
      expect(report.passed).toBe(false);
      expect(report.exitCode).toBe(1);
      expect(report.validationErrorCode).toBeNull();
      expect(report.artifactsPresent).toBe(true);
      expect(report.missingArtifacts).toEqual([]);
      expect(report.exampleAttempted).toBe(true);
      expect(report.exampleStatus).toBe("failed");
      expect(report.exampleExitCode).not.toBeNull();
      expect(report.exampleExitCode).not.toBe(0);
      expect(report.exampleRuleMatched).toBeNull();
      expect(report.examplePayloadValid).toBeNull();
      expect(report.failureSummaryCount).toBe(1);
      expect(report.failureSummaries).toEqual([
        {
          kind: "example",
          packageName: report.checkedPackage,
          packagePath: report.checkedPackagePath,
          packageIndex: report.checkedPackageIndices[0],
          checkCommand: process.execPath,
          checkArgs: expectedExampleArgs,
          checkArgCount: expectedExampleArgs.length,
          exitCode: report.exampleExitCode,
          ruleMatched: report.exampleRuleMatched,
          payloadValid: report.examplePayloadValid,
          payloadIssues: report.examplePayloadIssues,
          payloadIssueCount: report.examplePayloadIssueCount,
          outputLine: report.exampleOutputLine,
          message: deriveExpectedExampleFailureMessage(report),
        },
      ]);
      expect(report.message).toBe(
        "TypeScript core build artifacts are available, but TypeScript core end-to-end example failed."
      );
    });
  });

  it("prioritizes non-zero example exit codes over otherwise valid payloads", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);
process.exit(2);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(2);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(2);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(2);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(true);
        expect(report.examplePayloadIssues).toEqual([]);
        expect(report.examplePayloadIssueCount).toBe(0);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: "TypeScript core end-to-end example failed.",
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example failed."
        );
      }
    );
  });

  it("reports null outputLine for silent non-zero example exits", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      "process.exit(2);\n",
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(2);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(2);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(2);
        expect(report.exampleRuleMatched).toBeNull();
        expect(report.examplePayloadValid).toBeNull();
        expect(report.examplePayloadIssues).toBeNull();
        expect(report.examplePayloadIssueCount).toBeNull();
        expect(report.exampleOutputLine).toBeNull();
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: "TypeScript core end-to-end example failed.",
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example failed."
        );
      }
    );
  });

  it("fails when ts-core example exits successfully but reports rule mismatch", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      'console.log(JSON.stringify({ ruleMatched: false }));\n',
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(false);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual([
          "voxel",
          "light",
          "rotatedAabb",
        ]);
        expect(report.examplePayloadIssueCount).toBe(3);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: expectedRuleMismatchWithPayloadIssuesFailureMessage,
          },
        ]);
        expect(report.message).toBe(
          `TypeScript core build artifacts are available, but ${expectedRuleMismatchWithPayloadIssuesFailureMessage}`
        );
      }
    );
  });

  it("reports combined rule mismatch diagnostics with specific payload issue paths", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 16, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: false,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(false);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual(["light.red"]);
        expect(report.examplePayloadIssueCount).toBe(1);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message:
              "TypeScript core end-to-end example reported ruleMatched=false and has missing or invalid required payload fields: light.red.",
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example reported ruleMatched=false and has missing or invalid required payload fields: light.red."
        );
      }
    );
  });

  it("reports pure rule mismatch when payload fields are valid", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 5, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: false,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(false);
        expect(report.examplePayloadValid).toBe(true);
        expect(report.examplePayloadIssues).toEqual([]);
        expect(report.examplePayloadIssueCount).toBe(0);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message:
              "TypeScript core end-to-end example reported ruleMatched=false.",
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example reported ruleMatched=false."
        );
      }
    );
  });

  it("fails when ts-core example reports ruleMatched=true without full payload", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      'console.log(JSON.stringify({ ruleMatched: true }));\n',
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual([
          "voxel",
          "light",
          "rotatedAabb",
        ]);
        expect(report.examplePayloadIssueCount).toBe(3);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          `TypeScript core build artifacts are available, but ${deriveExpectedExampleFailureMessage(report)}`
        );
      }
    );
  });

  it("fails with invalid output when ts-core example omits ruleMatched", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBeNull();
        expect(report.examplePayloadValid).toBe(true);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example output was invalid."
        );
      }
    );
  });

  it("reports payload issues when ruleMatched is missing and payload is invalid", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 16, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBeNull();
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual(["light.red"]);
        expect(report.examplePayloadIssueCount).toBe(1);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          `TypeScript core build artifacts are available, but ${deriveExpectedExampleFailureMessage(report)}`
        );
      }
    );
  });

  it("reports payload issues when patternMatched is present but false", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
    patternMatched: false,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual(["patternMatched"]);
        expect(report.examplePayloadIssueCount).toBe(1);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          `TypeScript core build artifacts are available, but ${deriveExpectedExampleFailureMessage(report)}`
        );
      }
    );
  });

  it("reports payload issues when patternMatched is present but non-boolean", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
    patternMatched: "yes",
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual(["patternMatched"]);
        expect(report.examplePayloadIssueCount).toBe(1);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          `TypeScript core build artifacts are available, but ${deriveExpectedExampleFailureMessage(report)}`
        );
      }
    );
  });

  it("fails with invalid output when ts-core example exits without output", () => {
    runWithTemporarilyRewrittenPath(exampleScriptRelativePath, "", () => {
      const result = runScript(["--json"]);
      const report = parseReport(result);

      expect(result.status).toBe(1);
      expect(report.schemaVersion).toBe(1);
      expect(report.passed).toBe(false);
      expect(report.exitCode).toBe(1);
      expect(report.validationErrorCode).toBeNull();
      expect(report.artifactsPresent).toBe(true);
      expect(report.missingArtifacts).toEqual([]);
      expect(report.exampleAttempted).toBe(true);
      expect(report.exampleStatus).toBe("failed");
      expect(report.exampleExitCode).toBe(0);
      expect(report.exampleRuleMatched).toBeNull();
      expect(report.examplePayloadValid).toBeNull();
      expect(report.examplePayloadIssues).toBeNull();
      expect(report.examplePayloadIssueCount).toBeNull();
      expect(report.exampleOutputLine).toBeNull();
      expect(report.failureSummaryCount).toBe(1);
      expect(report.failureSummaries).toEqual([
        {
          kind: "example",
          packageName: report.checkedPackage,
          packagePath: report.checkedPackagePath,
          packageIndex: report.checkedPackageIndices[0],
          checkCommand: process.execPath,
          checkArgs: expectedExampleArgs,
          checkArgCount: expectedExampleArgs.length,
          exitCode: report.exampleExitCode,
          ruleMatched: report.exampleRuleMatched,
          payloadValid: report.examplePayloadValid,
          payloadIssues: report.examplePayloadIssues,
          payloadIssueCount: report.examplePayloadIssueCount,
          outputLine: report.exampleOutputLine,
          message: deriveExpectedExampleFailureMessage(report),
        },
      ]);
      expect(report.message).toBe(
        "TypeScript core build artifacts are available, but TypeScript core end-to-end example produced no parseable JSON output."
      );
    });
  });

  it("fails with no-parseable-output diagnostic when ts-core example emits ansi-only output", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      'process.stdout.write("\\u001b[33m\\u001b[39m");\n',
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBeNull();
        expect(report.examplePayloadValid).toBeNull();
        expect(report.examplePayloadIssues).toBeNull();
        expect(report.examplePayloadIssueCount).toBeNull();
        expect(report.exampleOutputLine).toBeNull();
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example produced no parseable JSON output."
        );
      }
    );
  });

  it("normalizes ansi and BOM escapes in non-json example output lines", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      'process.stdout.write("\\u001b[33m\\uFEFFwarning: no json\\u001b[39m");\n',
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBeNull();
        expect(report.examplePayloadValid).toBeNull();
        expect(report.examplePayloadIssues).toBeNull();
        expect(report.examplePayloadIssueCount).toBeNull();
        expect(report.exampleOutputLine).toBe("warning: no json");
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example output was invalid."
        );
      }
    );
  });

  it("fails with invalid output when ts-core example emits a json array payload", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify([
    {
      voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
      light: { sunlight: 15, red: 10, green: 5, blue: 3 },
      rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
      ruleMatched: true,
    },
  ])
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBeNull();
        expect(report.examplePayloadValid).toBeNull();
        expect(report.examplePayloadIssues).toBeNull();
        expect(report.examplePayloadIssueCount).toBeNull();
        expect(report.exampleOutputLine).toBe(
          '[{"voxel":{"id":42,"stage":7,"rotation":{"value":0,"yRotation":2.356}},"light":{"sunlight":15,"red":10,"green":5,"blue":3},"rotatedAabb":{"min":[0,0,0],"max":[1,1,1]},"ruleMatched":true}]'
        );
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example output was invalid."
        );
      }
    );
  });

  it("fails when ts-core example payload omits voxel rotation", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7 },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual(["voxel.rotation"]);
        expect(report.examplePayloadIssueCount).toBe(1);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
          payloadIssues: report.examplePayloadIssues,
          payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          `TypeScript core build artifacts are available, but ${deriveExpectedExampleFailureMessage(report)}`
        );
      }
    );
  });

  it("fails when ts-core example payload uses out-of-range voxel stage", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 16, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual(["voxel.stage"]);
        expect(report.examplePayloadIssueCount).toBe(1);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
          payloadIssues: report.examplePayloadIssues,
          payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          `TypeScript core build artifacts are available, but ${deriveExpectedExampleFailureMessage(report)}`
        );
      }
    );
  });

  it("reports multiple payload issue paths in failure messaging", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 16, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 16, green: 5, blue: 3 },
    rotatedAabb: { min: [0, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual(["voxel.stage", "light.red"]);
        expect(report.examplePayloadIssueCount).toBe(2);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
            payloadIssues: report.examplePayloadIssues,
            payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message:
              "TypeScript core end-to-end example output has missing or invalid required payload fields: voxel.stage, light.red.",
          },
        ]);
        expect(report.message).toBe(
          "TypeScript core build artifacts are available, but TypeScript core end-to-end example output has missing or invalid required payload fields: voxel.stage, light.red."
        );
      }
    );
  });

  it("fails when ts-core example payload has invalid rotatedAabb bounds", () => {
    runWithTemporarilyRewrittenPath(
      exampleScriptRelativePath,
      `console.log(
  JSON.stringify({
    voxel: { id: 42, stage: 7, rotation: { value: 0, yRotation: 2.356 } },
    light: { sunlight: 15, red: 10, green: 5, blue: 3 },
    rotatedAabb: { min: [2, 0, 0], max: [1, 1, 1] },
    ruleMatched: true,
  })
);\n`,
      () => {
        const result = runScript(["--json"]);
        const report = parseReport(result);

        expect(result.status).toBe(1);
        expect(report.schemaVersion).toBe(1);
        expect(report.passed).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.validationErrorCode).toBeNull();
        expect(report.artifactsPresent).toBe(true);
        expect(report.missingArtifacts).toEqual([]);
        expect(report.exampleAttempted).toBe(true);
        expect(report.exampleStatus).toBe("failed");
        expect(report.exampleExitCode).toBe(0);
        expect(report.exampleRuleMatched).toBe(true);
        expect(report.examplePayloadValid).toBe(false);
        expect(report.examplePayloadIssues).toEqual(["rotatedAabb.bounds"]);
        expect(report.examplePayloadIssueCount).toBe(1);
        expect(report.failureSummaryCount).toBe(1);
        expect(report.failureSummaries).toEqual([
          {
            kind: "example",
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            checkCommand: process.execPath,
            checkArgs: expectedExampleArgs,
            checkArgCount: expectedExampleArgs.length,
            exitCode: report.exampleExitCode,
            ruleMatched: report.exampleRuleMatched,
            payloadValid: report.examplePayloadValid,
          payloadIssues: report.examplePayloadIssues,
          payloadIssueCount: report.examplePayloadIssueCount,
            outputLine: report.exampleOutputLine,
            message: deriveExpectedExampleFailureMessage(report),
          },
        ]);
        expect(report.message).toBe(
          `TypeScript core build artifacts are available, but ${deriveExpectedExampleFailureMessage(report)}`
        );
      }
    );
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
