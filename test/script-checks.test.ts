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
  availableChecks: string[];
  availableCheckCount: number;
  availableCheckCommandMap: Record<string, string>;
  availableCheckCommandMapCount: number;
  availableCheckArgsMap: Record<string, string[]>;
  availableCheckArgsMapCount: number;
  availableCheckArgCountMap: Record<string, number>;
  availableCheckArgCountMapCount: number;
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
  failedChecks: string[];
  failedCheckCount: number;
  failedCheckIndices: number[];
  failedCheckIndexCount: number;
  failedCheckIndexMap: Record<string, number>;
  failedCheckIndexMapCount: number;
  failureSummaries: Array<{
    name: string;
    checkIndex: number;
    command: string;
    args: string[];
    exitCode: number;
    status: string;
    message: string | null;
  }>;
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

type DevEnvJsonCheck = {
  label: string;
  checkIndex: number;
  command: string;
  args: string[];
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
  availableChecks: string[];
  availableCheckCount: number;
  availableCheckIndexMap: Record<string, number>;
  availableCheckIndexMapCount: number;
  availableCheckCommandMap: Record<string, string>;
  availableCheckCommandMapCount: number;
  availableCheckArgsMap: Record<string, string[]>;
  availableCheckArgsMapCount: number;
  availableCheckArgCountMap: Record<string, number>;
  availableCheckArgCountMapCount: number;
  availableCheckRequiredMap: Record<string, boolean>;
  availableCheckRequiredMapCount: number;
  availableCheckHintMap: Record<string, string>;
  availableCheckHintMapCount: number;
  availableCheckMinimumVersionMap: Record<string, string | null>;
  availableCheckMinimumVersionMapCount: number;
  checks: DevEnvJsonCheck[];
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
  checkStatusMap: Record<string, string>;
  checkStatusMapCount: number;
  checkStatusCountMap: Record<string, number>;
  checkStatusCountMapCount: number;
  checkDetectedVersionMap: Record<string, string | null>;
  checkDetectedVersionMapCount: number;
  checkMinimumVersionMap: Record<string, string | null>;
  checkMinimumVersionMapCount: number;
  requiredCheckLabels: string[];
  requiredCheckCount: number;
  requiredCheckIndices: number[];
  requiredCheckIndexCount: number;
  requiredCheckIndexMap: Record<string, number>;
  requiredCheckIndexMapCount: number;
  optionalCheckLabels: string[];
  optionalCheckCount: number;
  optionalCheckIndices: number[];
  optionalCheckIndexCount: number;
  optionalCheckIndexMap: Record<string, number>;
  optionalCheckIndexMapCount: number;
  passedChecks: string[];
  passedCheckCount: number;
  passedCheckIndices: number[];
  passedCheckIndexCount: number;
  passedCheckIndexMap: Record<string, number>;
  passedCheckIndexMapCount: number;
  failedChecks: string[];
  failedCheckCount: number;
  failedCheckIndices: number[];
  failedCheckIndexCount: number;
  failedCheckIndexMap: Record<string, number>;
  failedCheckIndexMapCount: number;
  requiredFailureLabels: string[];
  requiredFailureCount: number;
  requiredFailureIndices: number[];
  requiredFailureIndexCount: number;
  requiredFailureIndexMap: Record<string, number>;
  requiredFailureIndexMapCount: number;
  optionalFailureLabels: string[];
  optionalFailureCount: number;
  optionalFailureIndices: number[];
  optionalFailureIndexCount: number;
  optionalFailureIndexMap: Record<string, number>;
  optionalFailureIndexMapCount: number;
  failureSummaries: Array<{
    label: string;
    checkIndex: number;
    required: boolean;
    status: string;
    message: string;
    hint: string;
  }>;
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
  scriptName: string;
  supportsNoBuild: boolean;
  stepIndex: number;
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
  availableSteps: string[];
  availableStepCount: number;
  availableStepScripts: string[];
  availableStepScriptCount: number;
  availableStepScriptMap: Record<string, string>;
  availableStepScriptMapCount: number;
  availableStepSupportsNoBuildMap: Record<string, boolean>;
  availableStepSupportsNoBuildMapCount: number;
  availableStepIndices: number[];
  availableStepIndexCount: number;
  availableStepIndexMap: Record<string, number>;
  availableStepIndexMapCount: number;
  availableStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  availableStepMetadataCount: number;
  steps: ClientJsonStep[];
  totalSteps: number;
  passedStepCount: number;
  failedStepCount: number;
  skippedStepCount: number;
  passedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];
  passedStepScripts: string[];
  passedStepScriptCount: number;
  passedStepScriptMap: Record<string, string>;
  passedStepScriptMapCount: number;
  passedStepIndices: number[];
  passedStepIndexCount: number;
  passedStepIndexMap: Record<string, number>;
  passedStepIndexMapCount: number;
  failedStepScripts: string[];
  failedStepScriptCount: number;
  failedStepScriptMap: Record<string, string>;
  failedStepScriptMapCount: number;
  failedStepIndices: number[];
  failedStepIndexCount: number;
  failedStepIndexMap: Record<string, number>;
  failedStepIndexMapCount: number;
  skippedStepScripts: string[];
  skippedStepScriptCount: number;
  skippedStepScriptMap: Record<string, string>;
  skippedStepScriptMapCount: number;
  skippedStepIndices: number[];
  skippedStepIndexCount: number;
  skippedStepIndexMap: Record<string, number>;
  skippedStepIndexMapCount: number;
  failureSummaries: Array<{
    name: string;
    scriptName: string;
    supportsNoBuild: boolean;
    stepIndex: number;
    exitCode: number;
    message: string;
  }>;
  failureSummaryCount: number;
  stepStatusMap: Record<string, "passed" | "failed" | "skipped">;
  stepStatusMapCount: number;
  stepStatusCountMap: {
    passed: number;
    failed: number;
    skipped: number;
  };
  stepStatusCountMapCount: number;
  passedStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  passedStepMetadataCount: number;
  failedStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  failedStepMetadataCount: number;
  skippedStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  skippedStepMetadataCount: number;
  firstFailedStep: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  writeError?: string;
  message?: string;
} & CliOptionCatalogMetadata;

type TsCoreJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  noBuild: boolean;
  checkedPackage: string;
  checkedPackageCount: number;
  checkedPackagePath: string;
  checkedPackagePathCount: number;
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
  artifactsPresent: boolean;
  missingArtifacts: string[];
  missingArtifactsByPackage: Record<string, string[]>;
  missingArtifactsByPackageCount: number;
  missingArtifactCount: number;
  missingArtifactCountByPackage: Record<string, number>;
  missingArtifactCountByPackageCount: number;
  failureSummaries: Array<{
    packageName: string;
    packagePath: string;
    packageIndex: number;
    missingArtifacts: string[];
    missingArtifactCount: number;
    message: string;
  }>;
  failureSummaryCount: number;
  missingArtifactSummary: string | null;
  buildCommand: string;
  buildArgs: string[];
  buildExitCode: number | null;
  buildDurationMs: number | null;
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
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message: string;
  writeError?: string;
};

type RuntimeLibrariesJsonPackageReport = {
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

type RuntimeLibrariesJsonReport = OptionTerminatorMetadata &
  ActiveCliOptionMetadata & {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  noBuild: boolean;
  packagesPresent: boolean;
  packageReports: RuntimeLibrariesJsonPackageReport[];
  checkedPackages: string[];
  checkedPackagePaths: string[];
  checkedPackageIndices: number[];
  checkedPackageIndexCount: number;
  checkedPackageIndexMap: Record<string, number>;
  checkedPackageIndexMapCount: number;
  checkedPackagePathMap: Record<string, string>;
  checkedPackageCount: number;
  checkedPackagePathCount: number;
  checkedPackagePathMapCount: number;
  presentPackages: string[];
  presentPackagePaths: string[];
  presentPackagePathMap: Record<string, string>;
  presentPackageIndices: number[];
  presentPackageIndexMap: Record<string, number>;
  presentPackagePathMapCount: number;
  presentPackageIndexCount: number;
  presentPackageIndexMapCount: number;
  missingPackages: string[];
  missingPackagePaths: string[];
  missingPackagePathMap: Record<string, string>;
  missingPackageIndices: number[];
  missingPackageIndexMap: Record<string, number>;
  missingPackagePathMapCount: number;
  missingPackageIndexCount: number;
  missingPackageIndexMapCount: number;
  requiredPackageCount: number;
  presentPackageCount: number;
  presentPackagePathCount: number;
  packageReportCount: number;
  packageReportMap: Record<string, RuntimeLibrariesJsonPackageReport>;
  packageReportMapCount: number;
  requiredArtifactsByPackage: Record<string, string[]>;
  requiredArtifacts: string[];
  requiredArtifactsByPackageCount: number;
  requiredArtifactCountByPackage: Record<string, number>;
  requiredArtifactCount: number;
  requiredArtifactCountByPackageCount: number;
  packageCheckCommandMap: Record<string, string>;
  packageCheckCommandMapCount: number;
  packageCheckArgsMap: Record<string, string[]>;
  packageCheckArgsMapCount: number;
  packageCheckArgCountMap: Record<string, number>;
  packageCheckArgCountMapCount: number;
  packageStatusMap: Record<string, "present" | "missing">;
  packageStatusMapCount: number;
  packageStatusCountMap: {
    present: number;
    missing: number;
  };
  packageStatusCountMapCount: number;
  artifactsPresentByPackage: Record<string, boolean>;
  artifactsPresentByPackageCount: number;
  presentArtifactsByPackage: Record<string, string[]>;
  presentArtifacts: string[];
  presentArtifactCount: number;
  presentArtifactsByPackageCount: number;
  presentArtifactCountByPackage: Record<string, number>;
  presentArtifactCountByPackageCount: number;
  missingPackageCount: number;
  missingPackagePathCount: number;
  missingArtifactsByPackage: Record<string, string[]>;
  missingArtifacts: string[];
  missingArtifactCount: number;
  missingArtifactsByPackageCount: number;
  missingArtifactCountByPackage: Record<string, number>;
  missingArtifactCountByPackageCount: number;
  failureSummaries: Array<{
    packageName: string;
    packagePath: string;
    packageIndex: number;
    missingArtifacts: string[];
    missingArtifactCount: number;
    message: string;
  }>;
  failureSummaryCount: number;
  missingArtifactSummary: string | null;
  buildCommand: string;
  buildArgs: string[];
  buildExitCode: number | null;
  buildDurationMs: number | null;
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
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message: string;
  writeError?: string;
};

type OnboardingJsonStep = {
  name: string;
  scriptName: string;
  supportsNoBuild: boolean;
  stepIndex: number;
  passed: boolean;
  exitCode: number | null;
  skipped: boolean;
  reason: string | null;
  report:
    | DevEnvJsonReport
    | TsCoreJsonReport
    | RuntimeLibrariesJsonReport
    | ClientJsonReport
    | null;
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
  availableSteps: string[];
  availableStepCount: number;
  availableStepScripts: string[];
  availableStepScriptCount: number;
  availableStepScriptMap: Record<string, string>;
  availableStepScriptMapCount: number;
  availableStepSupportsNoBuildMap: Record<string, boolean>;
  availableStepSupportsNoBuildMapCount: number;
  availableStepIndices: number[];
  availableStepIndexCount: number;
  availableStepIndexMap: Record<string, number>;
  availableStepIndexMapCount: number;
  availableStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  availableStepMetadataCount: number;
  steps: OnboardingJsonStep[];
  totalSteps: number;
  passedStepCount: number;
  failedStepCount: number;
  skippedStepCount: number;
  passedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];
  passedStepScripts: string[];
  passedStepScriptCount: number;
  passedStepScriptMap: Record<string, string>;
  passedStepScriptMapCount: number;
  passedStepIndices: number[];
  passedStepIndexCount: number;
  passedStepIndexMap: Record<string, number>;
  passedStepIndexMapCount: number;
  failedStepScripts: string[];
  failedStepScriptCount: number;
  failedStepScriptMap: Record<string, string>;
  failedStepScriptMapCount: number;
  failedStepIndices: number[];
  failedStepIndexCount: number;
  failedStepIndexMap: Record<string, number>;
  failedStepIndexMapCount: number;
  skippedStepScripts: string[];
  skippedStepScriptCount: number;
  skippedStepScriptMap: Record<string, string>;
  skippedStepScriptMapCount: number;
  skippedStepIndices: number[];
  skippedStepIndexCount: number;
  skippedStepIndexMap: Record<string, number>;
  skippedStepIndexMapCount: number;
  failureSummaries: Array<{
    name: string;
    scriptName: string;
    supportsNoBuild: boolean;
    stepIndex: number;
    exitCode: number;
    message: string;
  }>;
  failureSummaryCount: number;
  stepStatusMap: Record<string, "passed" | "failed" | "skipped">;
  stepStatusMapCount: number;
  stepStatusCountMap: {
    passed: number;
    failed: number;
    skipped: number;
  };
  stepStatusCountMapCount: number;
  passedStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  passedStepMetadataCount: number;
  failedStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  failedStepMetadataCount: number;
  skippedStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  skippedStepMetadataCount: number;
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
const expectWasmPackCheckMetadata = (report: WasmPackJsonReport) => {
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
  const expectedCheckIndexMap = {
    "wasm-pack": 0,
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

  expect(report.availableChecks).toEqual(expectedWasmPackAvailableChecks);
  expect(report.availableCheckCount).toBe(report.availableChecks.length);
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
  expect(report.availableCheckIndexMap).toEqual(expectedAvailableCheckIndexMap);
  expect(report.availableCheckIndexMapCount).toBe(
    Object.keys(report.availableCheckIndexMap).length
  );

  if (report.checkCount === 0) {
    expect(report.checkLabels).toEqual([]);
    expect(report.checkIndices).toEqual([]);
    expect(report.checkIndexCount).toBe(0);
    expect(report.checkIndexMap).toEqual({});
    expect(report.checkIndexMapCount).toBe(0);
    expect(report.checkCommandMap).toEqual({});
    expect(report.checkCommandMapCount).toBe(0);
    expect(report.checkArgsMap).toEqual({});
    expect(report.checkArgsMapCount).toBe(0);
    expect(report.checkArgCountMap).toEqual({});
    expect(report.checkArgCountMapCount).toBe(0);
    expect(report.checkStatusMap).toEqual({});
    expect(report.checkStatusMapCount).toBe(0);
    expect(report.checkStatusCountMap).toEqual({});
    expect(report.checkStatusCountMapCount).toBe(0);
    expect(report.checkVersionMap).toEqual({});
    expect(report.checkVersionMapCount).toBe(0);
    expect(report.checkExitCodeMap).toEqual({});
    expect(report.checkExitCodeMapCount).toBe(0);
    expect(report.checkOutputLineMap).toEqual({});
    expect(report.checkOutputLineMapCount).toBe(0);
    expect(report.passedChecks).toEqual([]);
    expect(report.passedCheckCount).toBe(0);
    expect(report.passedCheckIndices).toEqual([]);
    expect(report.passedCheckIndexCount).toBe(0);
    expect(report.passedCheckIndexMap).toEqual({});
    expect(report.passedCheckIndexMapCount).toBe(0);
    expect(report.failedChecks).toEqual([]);
    expect(report.failedCheckCount).toBe(0);
    expect(report.failedCheckIndices).toEqual([]);
    expect(report.failedCheckIndexCount).toBe(0);
    expect(report.failedCheckIndexMap).toEqual({});
    expect(report.failedCheckIndexMapCount).toBe(0);
    expect(report.failureSummaries).toEqual([]);
    expect(report.failureSummaryCount).toBe(0);
    return;
  }

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
  expect(report.checkStatusMapCount).toBe(Object.keys(report.checkStatusMap).length);
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
  expect(checkStatus === "ok" || checkStatus === "missing" || checkStatus === "unavailable").toBe(true);
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
    expect(report.failedChecks).toEqual([]);
    expect(report.failedCheckIndices).toEqual([]);
    expect(report.failedCheckIndexMap).toEqual({});
    expect(report.failureSummaries).toEqual([]);
  } else {
    expect(report.passedChecks).toEqual([]);
    expect(report.passedCheckIndices).toEqual([]);
    expect(report.passedCheckIndexMap).toEqual({});
    expect(report.failedChecks).toEqual(expectedWasmPackAvailableChecks);
    expect(report.failedCheckIndices).toEqual(report.checkIndices);
    expect(report.failedCheckIndexMap).toEqual(report.checkIndexMap);
    expect(report.failureSummaries).toEqual([
      {
        name: "wasm-pack",
        checkIndex: expectedCheckIndexMap["wasm-pack"],
        command: report.command,
        args: ["--version"],
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
  expect(report.failedCheckCount).toBe(report.failedChecks.length);
  expect(report.failedCheckIndexCount).toBe(report.failedCheckIndices.length);
  expect(report.failedCheckIndexMapCount).toBe(
    Object.keys(report.failedCheckIndexMap).length
  );
  expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
};
const expectStepSummaryMetadata = (
  report: {
    availableSteps: string[];
    steps: Array<{
      name: string;
      scriptName: string;
      supportsNoBuild: boolean;
      stepIndex: number;
      passed: boolean;
      skipped: boolean;
    }>;
    totalSteps: number;
    passedStepCount: number;
    failedStepCount: number;
    skippedStepCount: number;
    passedSteps: string[];
    failedSteps: string[];
    skippedSteps: string[];
    passedStepScripts: string[];
    passedStepScriptCount: number;
    passedStepScriptMap: Record<string, string>;
    passedStepScriptMapCount: number;
    passedStepIndices: number[];
    passedStepIndexCount: number;
    passedStepIndexMap: Record<string, number>;
    passedStepIndexMapCount: number;
    failedStepScripts: string[];
    failedStepScriptCount: number;
    failedStepScriptMap: Record<string, string>;
    failedStepScriptMapCount: number;
    failedStepIndices: number[];
    failedStepIndexCount: number;
    failedStepIndexMap: Record<string, number>;
    failedStepIndexMapCount: number;
    skippedStepScripts: string[];
    skippedStepScriptCount: number;
    skippedStepScriptMap: Record<string, string>;
    skippedStepScriptMapCount: number;
    skippedStepIndices: number[];
    skippedStepIndexCount: number;
    skippedStepIndexMap: Record<string, number>;
    skippedStepIndexMapCount: number;
    failureSummaries: Array<{
      name: string;
      scriptName: string;
      supportsNoBuild: boolean;
      stepIndex: number;
      exitCode: number;
      message: string;
    }>;
    failureSummaryCount: number;
    stepStatusMap: Record<string, "passed" | "failed" | "skipped">;
    stepStatusMapCount: number;
    stepStatusCountMap: {
      passed: number;
      failed: number;
      skipped: number;
    };
    stepStatusCountMapCount: number;
    passedStepMetadata: Record<
      string,
      {
        scriptName: string;
        supportsNoBuild: boolean;
      }
    >;
    passedStepMetadataCount: number;
    failedStepMetadata: Record<
      string,
      {
        scriptName: string;
        supportsNoBuild: boolean;
      }
    >;
    failedStepMetadataCount: number;
    skippedStepMetadata: Record<
      string,
      {
        scriptName: string;
        supportsNoBuild: boolean;
      }
    >;
    skippedStepMetadataCount: number;
    firstFailedStep: string | null;
  },
  expectedStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >
) => {
  const passedSteps = report.steps
    .filter((step) => step.passed && step.skipped === false)
    .map((step) => step.name);
  const failedSteps = report.steps
    .filter((step) => !step.passed && step.skipped === false)
    .map((step) => step.name);
  const skippedSteps = report.steps
    .filter((step) => step.skipped === true)
    .map((step) => step.name);
  const passedStepScripts = passedSteps.map((stepName) => {
    return expectedStepMetadata[stepName].scriptName;
  });
  const failedStepScripts = failedSteps.map((stepName) => {
    return expectedStepMetadata[stepName].scriptName;
  });
  const skippedStepScripts = skippedSteps.map((stepName) => {
    return expectedStepMetadata[stepName].scriptName;
  });
  const mapStepNamesToScriptMap = (stepNames: string[]) => {
    return Object.fromEntries(
      stepNames.map((stepName) => {
        return [stepName, expectedStepMetadata[stepName].scriptName];
      })
    );
  };
  const passedStepScriptMap = mapStepNamesToScriptMap(passedSteps);
  const failedStepScriptMap = mapStepNamesToScriptMap(failedSteps);
  const skippedStepScriptMap = mapStepNamesToScriptMap(skippedSteps);
  const stepIndexMap = new Map(
    report.availableSteps.map((stepName, index) => {
      return [stepName, index];
    })
  );
  const expectedStepNames = new Set(Object.keys(expectedStepMetadata));
  for (const step of report.steps) {
    expect(expectedStepNames.has(step.name)).toBe(true);
    expect(step.scriptName).toBe(expectedStepMetadata[step.name].scriptName);
    expect(step.supportsNoBuild).toBe(
      expectedStepMetadata[step.name].supportsNoBuild
    );
    const expectedStepIndex = stepIndexMap.get(step.name);
    if (expectedStepIndex === undefined) {
      throw new Error(`Missing step index metadata for ${step.name}.`);
    }
    expect(step.stepIndex).toBe(expectedStepIndex);
  }
  const mapStepNamesToIndices = (stepNames: string[]) => {
    return stepNames.map((stepName) => {
      const stepIndex = stepIndexMap.get(stepName);
      if (stepIndex === undefined) {
        throw new Error(`Missing step index metadata for ${stepName}.`);
      }
      return stepIndex;
    });
  };
  const passedStepIndices = mapStepNamesToIndices(passedSteps);
  const failedStepIndices = mapStepNamesToIndices(failedSteps);
  const skippedStepIndices = mapStepNamesToIndices(skippedSteps);
  const mapStepNamesToIndexMap = (stepNames: string[]) => {
    return Object.fromEntries(
      stepNames.map((stepName) => {
        const stepIndex = stepIndexMap.get(stepName);
        if (stepIndex === undefined) {
          throw new Error(`Missing step index metadata for ${stepName}.`);
        }
        return [stepName, stepIndex];
      })
    );
  };
  const passedStepIndexMap = mapStepNamesToIndexMap(passedSteps);
  const failedStepIndexMap = mapStepNamesToIndexMap(failedSteps);
  const skippedStepIndexMap = mapStepNamesToIndexMap(skippedSteps);
  const passedStepMetadata = Object.fromEntries(
    passedSteps.map((stepName) => {
      return [stepName, expectedStepMetadata[stepName]];
    })
  );
  const failedStepMetadata = Object.fromEntries(
    failedSteps.map((stepName) => {
      return [stepName, expectedStepMetadata[stepName]];
    })
  );
  const skippedStepMetadata = Object.fromEntries(
    skippedSteps.map((stepName) => {
      return [stepName, expectedStepMetadata[stepName]];
    })
  );
  const expectedStepStatusMap = Object.fromEntries(
    report.steps.map((step) => {
      const status = step.skipped
        ? "skipped"
        : step.passed
          ? "passed"
          : "failed";
      return [step.name, status];
    })
  );
  const expectedStepStatusCountMap = {
    passed: passedSteps.length,
    failed: failedSteps.length,
    skipped: skippedSteps.length,
  };

  expect(report.totalSteps).toBe(report.steps.length);
  expect(report.passedStepCount).toBe(passedSteps.length);
  expect(report.failedStepCount).toBe(failedSteps.length);
  expect(report.skippedStepCount).toBe(skippedSteps.length);
  expect(report.passedSteps).toEqual(passedSteps);
  expect(report.failedSteps).toEqual(failedSteps);
  expect(report.skippedSteps).toEqual(skippedSteps);
  expect(report.passedStepScripts).toEqual(passedStepScripts);
  expect(report.passedStepScriptCount).toBe(report.passedStepScripts.length);
  expect(report.passedStepScriptMap).toEqual(passedStepScriptMap);
  expect(report.passedStepScriptMapCount).toBe(
    Object.keys(report.passedStepScriptMap).length
  );
  expect(report.passedStepIndices).toEqual(passedStepIndices);
  expect(report.passedStepIndexCount).toBe(report.passedStepIndices.length);
  expect(report.passedStepIndexMap).toEqual(passedStepIndexMap);
  expect(report.passedStepIndexMapCount).toBe(
    Object.keys(report.passedStepIndexMap).length
  );
  expect(report.failedStepScripts).toEqual(failedStepScripts);
  expect(report.failedStepScriptCount).toBe(report.failedStepScripts.length);
  expect(report.failedStepScriptMap).toEqual(failedStepScriptMap);
  expect(report.failedStepScriptMapCount).toBe(
    Object.keys(report.failedStepScriptMap).length
  );
  expect(report.failedStepIndices).toEqual(failedStepIndices);
  expect(report.failedStepIndexCount).toBe(report.failedStepIndices.length);
  expect(report.failedStepIndexMap).toEqual(failedStepIndexMap);
  expect(report.failedStepIndexMapCount).toBe(
    Object.keys(report.failedStepIndexMap).length
  );
  expect(report.skippedStepScripts).toEqual(skippedStepScripts);
  expect(report.skippedStepScriptCount).toBe(report.skippedStepScripts.length);
  expect(report.skippedStepScriptMap).toEqual(skippedStepScriptMap);
  expect(report.skippedStepScriptMapCount).toBe(
    Object.keys(report.skippedStepScriptMap).length
  );
  expect(report.skippedStepIndices).toEqual(skippedStepIndices);
  expect(report.skippedStepIndexCount).toBe(report.skippedStepIndices.length);
  expect(report.skippedStepIndexMap).toEqual(skippedStepIndexMap);
  expect(report.skippedStepIndexMapCount).toBe(
    Object.keys(report.skippedStepIndexMap).length
  );
  expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
  expect(report.stepStatusMap).toEqual(expectedStepStatusMap);
  expect(report.stepStatusMapCount).toBe(Object.keys(report.stepStatusMap).length);
  expect(report.stepStatusCountMap).toEqual(expectedStepStatusCountMap);
  expect(report.stepStatusCountMapCount).toBe(
    Object.keys(report.stepStatusCountMap).length
  );
  expect(report.failureSummaries.map((summary) => summary.name)).toEqual(
    failedSteps
  );
  const failedStepEntriesByName = new Map(
    report.steps
      .filter((step) => {
        return step.passed === false && step.skipped === false;
      })
      .map((step) => {
        return [step.name, step];
      })
  );
  for (const [index, summary] of report.failureSummaries.entries()) {
    const stepName = failedSteps[index];
    const failedStepEntry = failedStepEntriesByName.get(stepName);
    expect(failedStepEntry).toBeDefined();
    if (failedStepEntry === undefined) {
      throw new Error(`Missing failed step entry for ${stepName}.`);
    }
    expect(summary.scriptName).toBe(expectedStepMetadata[stepName].scriptName);
    expect(summary.supportsNoBuild).toBe(
      expectedStepMetadata[stepName].supportsNoBuild
    );
    expect(summary.stepIndex).toBe(failedStepIndices[index]);
    expect(summary.scriptName).toBe(failedStepEntry.scriptName);
    expect(summary.supportsNoBuild).toBe(failedStepEntry.supportsNoBuild);
    expect(summary.stepIndex).toBe(failedStepEntry.stepIndex);
    if (typeof failedStepEntry.exitCode !== "number") {
      throw new Error(`Missing exit code for failed step ${stepName}.`);
    }
    expect(summary.exitCode).toBe(failedStepEntry.exitCode);
    expect(summary.message.length).toBeGreaterThan(0);
  }
  if (report.firstFailedStep === null) {
    expect(report.failureSummaries).toEqual([]);
  } else {
    expect(report.failureSummaries[0]?.name).toBe(report.firstFailedStep);
  }
  expect(report.passedStepMetadata).toEqual(passedStepMetadata);
  expect(report.passedStepMetadataCount).toBe(
    Object.keys(report.passedStepMetadata).length
  );
  expect(report.failedStepMetadata).toEqual(failedStepMetadata);
  expect(report.failedStepMetadataCount).toBe(
    Object.keys(report.failedStepMetadata).length
  );
  expect(report.skippedStepMetadata).toEqual(skippedStepMetadata);
  expect(report.skippedStepMetadataCount).toBe(
    Object.keys(report.skippedStepMetadata).length
  );
  expect(report.firstFailedStep).toBe(failedSteps[0] ?? null);
};
const expectAvailableStepMetadata = (
  report: {
    availableSteps: string[];
    availableStepCount: number;
    availableStepScripts: string[];
    availableStepScriptCount: number;
    availableStepScriptMap: Record<string, string>;
    availableStepScriptMapCount: number;
    availableStepSupportsNoBuildMap: Record<string, boolean>;
    availableStepSupportsNoBuildMapCount: number;
    availableStepIndices: number[];
    availableStepIndexCount: number;
    availableStepIndexMap: Record<string, number>;
    availableStepIndexMapCount: number;
    availableStepMetadata: Record<
      string,
      {
        scriptName: string;
        supportsNoBuild: boolean;
      }
    >;
    availableStepMetadataCount: number;
  },
  expectedSteps: string[],
  expectedMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >
) => {
  const expectedScripts = expectedSteps.map((stepName) => {
    return expectedMetadata[stepName].scriptName;
  });
  const expectedScriptMap = Object.fromEntries(
    expectedSteps.map((stepName) => {
      return [stepName, expectedMetadata[stepName].scriptName];
    })
  );
  const expectedSupportsNoBuildMap = Object.fromEntries(
    expectedSteps.map((stepName) => {
      return [stepName, expectedMetadata[stepName].supportsNoBuild];
    })
  );
  const expectedIndices = expectedSteps.map((_, index) => {
    return index;
  });
  const expectedIndexMap = Object.fromEntries(
    expectedSteps.map((stepName, index) => {
      return [stepName, index];
    })
  );

  expect(report.availableSteps).toEqual(expectedSteps);
  expect(report.availableStepCount).toBe(report.availableSteps.length);
  expect(report.availableStepScripts).toEqual(expectedScripts);
  expect(report.availableStepScriptCount).toBe(report.availableStepScripts.length);
  expect(report.availableStepScriptMap).toEqual(expectedScriptMap);
  expect(report.availableStepScriptMapCount).toBe(
    Object.keys(report.availableStepScriptMap).length
  );
  expect(report.availableStepSupportsNoBuildMap).toEqual(
    expectedSupportsNoBuildMap
  );
  expect(report.availableStepSupportsNoBuildMapCount).toBe(
    Object.keys(report.availableStepSupportsNoBuildMap).length
  );
  expect(report.availableStepIndices).toEqual(expectedIndices);
  expect(report.availableStepIndexCount).toBe(report.availableStepIndices.length);
  expect(report.availableStepIndexMap).toEqual(expectedIndexMap);
  expect(report.availableStepIndexMapCount).toBe(
    Object.keys(report.availableStepIndexMap).length
  );
  const metadataFromMaps = Object.fromEntries(
    expectedSteps.map((stepName) => {
      return [
        stepName,
        {
          scriptName: report.availableStepScriptMap[stepName],
          supportsNoBuild: report.availableStepSupportsNoBuildMap[stepName],
        },
      ];
    })
  );
  expect(report.availableStepMetadata).toEqual(metadataFromMaps);
  expect(report.availableStepMetadata).toEqual(expectedMetadata);
  expect(report.availableStepMetadataCount).toBe(
    Object.keys(report.availableStepMetadata).length
  );
};
const expectDevEnvCheckMetadata = (report: DevEnvJsonReport) => {
  const expectedAvailableCheckIndexMap = Object.fromEntries(
    expectedDevEnvAvailableChecks.map((checkLabel, index) => {
      return [checkLabel, index];
    })
  );

  expect(report.availableChecks).toEqual(expectedDevEnvAvailableChecks);
  expect(report.availableCheckCount).toBe(report.availableChecks.length);
  expect(report.availableCheckIndexMap).toEqual(expectedAvailableCheckIndexMap);
  expect(report.availableCheckIndexMapCount).toBe(
    Object.keys(report.availableCheckIndexMap).length
  );
  expect(report.availableCheckCommandMapCount).toBe(
    Object.keys(report.availableCheckCommandMap).length
  );
  expect(report.availableCheckArgsMapCount).toBe(
    Object.keys(report.availableCheckArgsMap).length
  );
  expect(report.availableCheckArgCountMapCount).toBe(
    Object.keys(report.availableCheckArgCountMap).length
  );
  expect(report.availableCheckRequiredMapCount).toBe(
    Object.keys(report.availableCheckRequiredMap).length
  );
  expect(report.availableCheckHintMapCount).toBe(
    Object.keys(report.availableCheckHintMap).length
  );
  expect(report.availableCheckMinimumVersionMapCount).toBe(
    Object.keys(report.availableCheckMinimumVersionMap).length
  );
  for (const checkLabel of report.availableChecks) {
    expect(report.availableCheckCommandMap[checkLabel]?.length).toBeGreaterThan(0);
    const checkArgs = report.availableCheckArgsMap[checkLabel];
    expect(Array.isArray(checkArgs)).toBe(true);
    expect(checkArgs.length).toBe(report.availableCheckArgCountMap[checkLabel]);
    expect(typeof report.availableCheckRequiredMap[checkLabel]).toBe("boolean");
    expect(report.availableCheckHintMap[checkLabel]?.length).toBeGreaterThan(0);
    const minimumVersion = report.availableCheckMinimumVersionMap[checkLabel];
    if (minimumVersion !== null) {
      expect(minimumVersion.length).toBeGreaterThan(0);
    }
  }

  const expectedCheckLabels = report.checks.map((check) => {
    return check.label;
  });
  const expectedCheckIndexMap = Object.fromEntries(
    expectedCheckLabels.map((checkLabel, index) => {
      return [checkLabel, index];
    })
  );
  const mapCheckLabelsToIndices = (checkLabels: string[]) => {
    return checkLabels.map((checkLabel) => {
      const checkIndex = expectedCheckIndexMap[checkLabel];
      if (checkIndex === undefined) {
        throw new Error(`Missing check index metadata for ${checkLabel}.`);
      }
      return checkIndex;
    });
  };
  const mapCheckLabelsToIndexMap = (checkLabels: string[]) => {
    return Object.fromEntries(
      checkLabels.map((checkLabel) => {
        const checkIndex = expectedCheckIndexMap[checkLabel];
        if (checkIndex === undefined) {
          throw new Error(`Missing check index metadata for ${checkLabel}.`);
        }
        return [checkLabel, checkIndex];
      })
    );
  };
  const expectedCheckIndices = mapCheckLabelsToIndices(expectedCheckLabels);
  const expectedCheckCommandMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.label, check.command];
    })
  );
  const expectedCheckArgsMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.label, check.args];
    })
  );
  const expectedCheckArgCountMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.label, check.args.length];
    })
  );
  const expectedCheckStatusMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.label, check.status];
    })
  );
  const expectedCheckStatusCountMap = report.checks.reduce(
    (statusCounts, check) => {
      const currentCount = statusCounts[check.status] ?? 0;
      statusCounts[check.status] = currentCount + 1;
      return statusCounts;
    },
    {} as Record<string, number>
  );
  const expectedCheckDetectedVersionMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.label, check.detectedVersion];
    })
  );
  const expectedCheckMinimumVersionMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.label, check.minimumVersion];
    })
  );
  const expectedRequiredCheckLabels = report.checks
    .filter((check) => {
      return check.required;
    })
    .map((check) => {
      return check.label;
    });
  const expectedRequiredCheckIndices = mapCheckLabelsToIndices(
    expectedRequiredCheckLabels
  );
  const expectedRequiredCheckIndexMap = mapCheckLabelsToIndexMap(
    expectedRequiredCheckLabels
  );
  const expectedOptionalCheckLabels = report.checks
    .filter((check) => {
      return check.required === false;
    })
    .map((check) => {
      return check.label;
    });
  const expectedOptionalCheckIndices = mapCheckLabelsToIndices(
    expectedOptionalCheckLabels
  );
  const expectedOptionalCheckIndexMap = mapCheckLabelsToIndexMap(
    expectedOptionalCheckLabels
  );
  const expectedPassedChecks = report.checks
    .filter((check) => {
      return check.status === "ok";
    })
    .map((check) => {
      return check.label;
    });
  const expectedPassedCheckIndices = mapCheckLabelsToIndices(expectedPassedChecks);
  const expectedPassedCheckIndexMap = mapCheckLabelsToIndexMap(
    expectedPassedChecks
  );
  const expectedFailedChecks = report.checks
    .filter((check) => {
      return check.status !== "ok";
    })
    .map((check) => {
      return check.label;
    });
  const expectedFailedCheckIndices = mapCheckLabelsToIndices(expectedFailedChecks);
  const expectedFailedCheckIndexMap = mapCheckLabelsToIndexMap(
    expectedFailedChecks
  );
  const expectedRequiredFailureLabels = report.checks
    .filter((check) => {
      return check.required && check.status !== "ok";
    })
    .map((check) => {
      return check.label;
    });
  const expectedRequiredFailureIndices = mapCheckLabelsToIndices(
    expectedRequiredFailureLabels
  );
  const expectedRequiredFailureIndexMap = mapCheckLabelsToIndexMap(
    expectedRequiredFailureLabels
  );
  const expectedOptionalFailureLabels = report.checks
    .filter((check) => {
      return check.required === false && check.status !== "ok";
    })
    .map((check) => {
      return check.label;
    });
  const expectedOptionalFailureIndices = mapCheckLabelsToIndices(
    expectedOptionalFailureLabels
  );
  const expectedOptionalFailureIndexMap = mapCheckLabelsToIndexMap(
    expectedOptionalFailureLabels
  );
  const expectedFailureSummaries = report.checks
    .filter((check) => {
      return check.status !== "ok";
    })
    .map((check) => {
      return {
        label: check.label,
        checkIndex: check.checkIndex,
        required: check.required,
        status: check.status,
        message: check.message,
        hint: check.hint,
      };
    });

  expect(report.checkLabels).toEqual(expectedCheckLabels);
  expect(report.checkCount).toBe(report.checkLabels.length);
  expect(report.checkIndices).toEqual(expectedCheckIndices);
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
  expect(report.checkStatusMap).toEqual(expectedCheckStatusMap);
  expect(report.checkStatusMapCount).toBe(
    Object.keys(report.checkStatusMap).length
  );
  expect(report.checkStatusCountMap).toEqual(expectedCheckStatusCountMap);
  expect(report.checkStatusCountMapCount).toBe(
    Object.keys(report.checkStatusCountMap).length
  );
  expect(report.checkDetectedVersionMap).toEqual(expectedCheckDetectedVersionMap);
  expect(report.checkDetectedVersionMapCount).toBe(
    Object.keys(report.checkDetectedVersionMap).length
  );
  expect(report.checkMinimumVersionMap).toEqual(expectedCheckMinimumVersionMap);
  expect(report.checkMinimumVersionMapCount).toBe(
    Object.keys(report.checkMinimumVersionMap).length
  );
  expect(report.requiredCheckLabels).toEqual(expectedRequiredCheckLabels);
  expect(report.requiredCheckCount).toBe(report.requiredCheckLabels.length);
  expect(report.requiredCheckIndices).toEqual(expectedRequiredCheckIndices);
  expect(report.requiredCheckIndexCount).toBe(
    report.requiredCheckIndices.length
  );
  expect(report.requiredCheckIndexMap).toEqual(expectedRequiredCheckIndexMap);
  expect(report.requiredCheckIndexMapCount).toBe(
    Object.keys(report.requiredCheckIndexMap).length
  );
  expect(report.optionalCheckLabels).toEqual(expectedOptionalCheckLabels);
  expect(report.optionalCheckCount).toBe(report.optionalCheckLabels.length);
  expect(report.optionalCheckIndices).toEqual(expectedOptionalCheckIndices);
  expect(report.optionalCheckIndexCount).toBe(
    report.optionalCheckIndices.length
  );
  expect(report.optionalCheckIndexMap).toEqual(expectedOptionalCheckIndexMap);
  expect(report.optionalCheckIndexMapCount).toBe(
    Object.keys(report.optionalCheckIndexMap).length
  );
  expect(report.passedChecks).toEqual(expectedPassedChecks);
  expect(report.passedCheckCount).toBe(report.passedChecks.length);
  expect(report.passedCheckIndices).toEqual(expectedPassedCheckIndices);
  expect(report.passedCheckIndexCount).toBe(report.passedCheckIndices.length);
  expect(report.passedCheckIndexMap).toEqual(expectedPassedCheckIndexMap);
  expect(report.passedCheckIndexMapCount).toBe(
    Object.keys(report.passedCheckIndexMap).length
  );
  expect(report.failedChecks).toEqual(expectedFailedChecks);
  expect(report.failedCheckCount).toBe(report.failedChecks.length);
  expect(report.failedCheckIndices).toEqual(expectedFailedCheckIndices);
  expect(report.failedCheckIndexCount).toBe(report.failedCheckIndices.length);
  expect(report.failedCheckIndexMap).toEqual(expectedFailedCheckIndexMap);
  expect(report.failedCheckIndexMapCount).toBe(
    Object.keys(report.failedCheckIndexMap).length
  );
  expect(report.requiredFailureLabels).toEqual(expectedRequiredFailureLabels);
  expect(report.requiredFailureCount).toBe(report.requiredFailureLabels.length);
  expect(report.requiredFailureIndices).toEqual(expectedRequiredFailureIndices);
  expect(report.requiredFailureIndexCount).toBe(
    report.requiredFailureIndices.length
  );
  expect(report.requiredFailureIndexMap).toEqual(expectedRequiredFailureIndexMap);
  expect(report.requiredFailureIndexMapCount).toBe(
    Object.keys(report.requiredFailureIndexMap).length
  );
  expect(report.optionalFailureLabels).toEqual(expectedOptionalFailureLabels);
  expect(report.optionalFailureCount).toBe(report.optionalFailureLabels.length);
  expect(report.optionalFailureIndices).toEqual(expectedOptionalFailureIndices);
  expect(report.optionalFailureIndexCount).toBe(
    report.optionalFailureIndices.length
  );
  expect(report.optionalFailureIndexMap).toEqual(expectedOptionalFailureIndexMap);
  expect(report.optionalFailureIndexMapCount).toBe(
    Object.keys(report.optionalFailureIndexMap).length
  );
  expect(report.failureSummaries).toEqual(expectedFailureSummaries);
  expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
  expect(report.requiredFailures).toBe(report.requiredFailureCount);
  for (const check of report.checks) {
    expect(check.checkIndex).toBe(expectedCheckIndexMap[check.label]);
    expect(check.command.length).toBeGreaterThan(0);
    expect(check.args.length).toBeGreaterThan(0);
  }
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
const expectedWasmPackAvailableChecks = ["wasm-pack"];
const expectedClientAvailableSteps = [
  "WASM artifact preflight",
  "TypeScript typecheck",
];
const expectedClientAvailableStepMetadata = {
  "WASM artifact preflight": {
    scriptName: "examples/client/scripts/check-wasm-mesher.mjs",
    supportsNoBuild: true,
  },
  "TypeScript typecheck": {
    scriptName: "examples/client:typecheck",
    supportsNoBuild: false,
  },
};
const expectedOnboardingAvailableSteps = [
  "Developer environment preflight",
  "TypeScript core checks",
  "Runtime library checks",
  "Client checks",
];
const expectedOnboardingAvailableStepMetadata = {
  "Developer environment preflight": {
    scriptName: "check-dev-env.mjs",
    supportsNoBuild: false,
  },
  "TypeScript core checks": {
    scriptName: "check-ts-core.mjs",
    supportsNoBuild: true,
  },
  "Runtime library checks": {
    scriptName: "check-runtime-libraries.mjs",
    supportsNoBuild: true,
  },
  "Client checks": {
    scriptName: "check-client.mjs",
    supportsNoBuild: true,
  },
};
const expectedDevEnvAvailableChecks = [
  "node",
  "pnpm",
  "cargo",
  "wasm-pack",
  "protoc",
  "cargo watch",
];
const expectedTsCoreRequiredArtifacts = [
  "packages/ts-core/dist/index.js",
  "packages/ts-core/dist/index.mjs",
  "packages/ts-core/dist/index.d.ts",
];
const expectedTsCoreCheckedPackagePathMap = {
  "@voxelize/ts-core": "packages/ts-core",
};
const expectedTsCoreCheckedPackageIndices = [0];
const expectedTsCoreCheckedPackageIndexMap = {
  "@voxelize/ts-core": 0,
};
const expectedTsCoreRequiredArtifactCountByPackage = {
  "@voxelize/ts-core": expectedTsCoreRequiredArtifacts.length,
};
const expectedTsCorePackageCheckCommand = "artifact-exists";
const expectedTsCoreBuildArgs = [
  "--dir",
  rootDir,
  "--filter",
  "@voxelize/ts-core",
  "run",
  "build",
];
const expectedRuntimeLibrariesCheckedPackages = [
  "@voxelize/aabb",
  "@voxelize/raycast",
  "@voxelize/physics-engine",
];
const expectedRuntimeLibrariesCheckedPackagePaths = [
  "packages/aabb",
  "packages/raycast",
  "packages/physics-engine",
];
const expectedRuntimeLibrariesCheckedPackageIndices =
  expectedRuntimeLibrariesCheckedPackages.map((_, index) => {
    return index;
  });
const expectedRuntimeLibrariesCheckedPackageIndexMap = Object.fromEntries(
  expectedRuntimeLibrariesCheckedPackages.map((packageName, index) => {
    return [packageName, index];
  })
);
const expectedRuntimeLibrariesCheckedPackagePathMap = Object.fromEntries(
  expectedRuntimeLibrariesCheckedPackages.map((packageName, index) => {
    return [packageName, expectedRuntimeLibrariesCheckedPackagePaths[index]];
  })
);
const expectedRuntimeLibrariesArtifactsByPackage = {
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
const expectedRuntimeLibrariesRequiredArtifactCount = Object.values(
  expectedRuntimeLibrariesArtifactsByPackage
).reduce((count, artifacts) => {
  return count + artifacts.length;
}, 0);
const expectedRuntimeLibrariesRequiredArtifacts = Object.values(
  expectedRuntimeLibrariesArtifactsByPackage
).reduce((artifacts, packageArtifacts) => {
  return [...artifacts, ...packageArtifacts];
}, [] as string[]);
const expectedRuntimeLibrariesRequiredArtifactCountByPackage = Object.fromEntries(
  Object.entries(expectedRuntimeLibrariesArtifactsByPackage).map(
    ([packageName, artifacts]) => {
      return [packageName, artifacts.length];
    }
  )
);
const expectedRuntimeLibrariesPackageCheckCommand = "artifact-exists";
const expectedRuntimeLibrariesBuildArgs = [
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
const expectTsCoreReportMetadata = (report: TsCoreJsonReport) => {
  expect(report.checkedPackage).toBe("@voxelize/ts-core");
  expect(report.checkedPackageCount).toBe(1);
  expect(report.checkedPackagePath).toBe("packages/ts-core");
  expect(report.checkedPackagePathCount).toBe(1);
  expect(report.checkedPackageIndices).toEqual(expectedTsCoreCheckedPackageIndices);
  expect(report.checkedPackageIndexCount).toBe(report.checkedPackageIndices.length);
  expect(report.checkedPackageIndexMap).toEqual(expectedTsCoreCheckedPackageIndexMap);
  expect(report.checkedPackageIndexMapCount).toBe(
    Object.keys(report.checkedPackageIndexMap).length
  );
  expect(report.checkedPackagePathMap).toEqual(expectedTsCoreCheckedPackagePathMap);
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
  expect(report.checkedPackageIndexMap).toEqual({
    [report.checkedPackage]: report.checkedPackageIndices[0],
  });
  const expectedPackageReport = {
    packageName: report.checkedPackage,
    packagePath: report.checkedPackagePath,
    packageIndex: report.checkedPackageIndices[0],
    requiredArtifacts: report.requiredArtifacts,
    requiredArtifactCount: report.requiredArtifactCount,
    checkCommand: expectedTsCorePackageCheckCommand,
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
    [report.checkedPackage]: expectedTsCorePackageCheckCommand,
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
  expect(report.packagePath).toBe("packages/ts-core");
  expect(report.requiredArtifacts).toEqual(expectedTsCoreRequiredArtifacts);
  expect(report.requiredArtifactsByPackage).toEqual({
    [report.checkedPackage]: report.requiredArtifacts,
  });
  expect(report.requiredArtifactsByPackageCount).toBe(
    Object.keys(report.requiredArtifactsByPackage).length
  );
  expect(report.requiredArtifactCountByPackage).toEqual(
    expectedTsCoreRequiredArtifactCountByPackage
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
  expect(report.artifactsPresent).toBe(report.missingArtifacts.length === 0);
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
  const expectedFailureSummaries =
    report.missingArtifactCount === 0
      ? []
      : [
          {
            packageName: report.checkedPackage,
            packagePath: report.checkedPackagePath,
            packageIndex: report.checkedPackageIndices[0],
            missingArtifacts: report.missingArtifacts,
            missingArtifactCount: report.missingArtifactCount,
            message: `Missing artifacts for ${report.checkedPackage}: ${report.missingArtifacts.join(", ")}.`,
          },
        ];
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
  expect(report.buildArgs).toEqual(expectedTsCoreBuildArgs);
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
  expectTimingMetadata(report);
  expectOptionTerminatorMetadata(report);
  expectCliOptionCatalogMetadata(
    report,
    expectedNoBuildCliOptionAliases,
    expectedNoBuildCliOptions
  );
};
const expectRuntimeLibrariesReportMetadata = (
  report: RuntimeLibrariesJsonReport
) => {
  expect(report.packagesPresent).toBe(report.missingPackageCount === 0);
  expect(report.checkedPackages).toEqual(expectedRuntimeLibrariesCheckedPackages);
  expect(report.checkedPackagePaths).toEqual(expectedRuntimeLibrariesCheckedPackagePaths);
  expect(report.checkedPackageIndices).toEqual(
    expectedRuntimeLibrariesCheckedPackageIndices
  );
  expect(report.checkedPackageIndexCount).toBe(report.checkedPackageIndices.length);
  expect(report.checkedPackageIndexMap).toEqual(
    expectedRuntimeLibrariesCheckedPackageIndexMap
  );
  expect(report.checkedPackageIndexMapCount).toBe(
    Object.keys(report.checkedPackageIndexMap).length
  );
  expect(report.checkedPackagePathMap).toEqual(
    expectedRuntimeLibrariesCheckedPackagePathMap
  );
  expect(report.checkedPackagePathMapCount).toBe(
    Object.keys(report.checkedPackagePathMap).length
  );
  expect(report.checkedPackages).toEqual(
    report.packageReports.map((packageReport) => packageReport.packageName)
  );
  expect(report.checkedPackagePaths).toEqual(
    report.packageReports.map((packageReport) => packageReport.packagePath)
  );
  expect(report.checkedPackageIndices).toEqual(
    report.packageReports.map((_, index) => {
      return index;
    })
  );
  expect(report.checkedPackageIndexMap).toEqual(
    Object.fromEntries(
      report.packageReports.map((packageReport, index) => {
        return [packageReport.packageName, index];
      })
    )
  );
  expect(report.checkedPackagePathMap).toEqual(
    Object.fromEntries(
      report.packageReports.map((packageReport) => {
        return [packageReport.packageName, packageReport.packagePath];
      })
    )
  );
  const presentPackages = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => packageReport.packageName);
  const presentPackagePaths = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => packageReport.packagePath);
  const presentPackagePathMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.packagePath];
      })
  );
  const presentPackageIndices = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => {
      return report.checkedPackageIndexMap[packageReport.packageName];
    });
  const presentPackageIndexMap = Object.fromEntries(
    presentPackages.map((packageName) => {
      return [packageName, report.checkedPackageIndexMap[packageName]];
    })
  );
  const missingPackages = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => packageReport.packageName);
  const missingPackagePaths = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => packageReport.packagePath);
  const missingPackagePathMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.packagePath];
      })
  );
  const missingPackageIndices = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => {
      return report.checkedPackageIndexMap[packageReport.packageName];
    });
  const missingPackageIndexMap = Object.fromEntries(
    missingPackages.map((packageName) => {
      return [packageName, report.checkedPackageIndexMap[packageName]];
    })
  );
  expect(report.presentPackages).toEqual(presentPackages);
  expect(report.presentPackagePaths).toEqual(presentPackagePaths);
  expect(report.missingPackages).toEqual(missingPackages);
  expect(report.missingPackagePaths).toEqual(missingPackagePaths);
  expect(report.checkedPackageCount).toBe(report.checkedPackages.length);
  expect(report.checkedPackagePathCount).toBe(report.checkedPackagePaths.length);
  expect(report.checkedPackagePathCount).toBe(report.requiredPackageCount);
  expect(report.checkedPackagePathCount).toBe(
    report.presentPackagePathCount + report.missingPackagePathCount
  );
  expect(report.checkedPackagePathMapCount).toBe(
    report.presentPackagePathMapCount + report.missingPackagePathMapCount
  );
  expect(report.requiredPackageCount).toBe(
    expectedRuntimeLibrariesCheckedPackages.length
  );
  expect(report.packageReportCount).toBe(report.packageReports.length);
  expect(report.packageReportMap).toEqual(
    Object.fromEntries(
      report.packageReports.map((packageReport) => {
        return [packageReport.packageName, packageReport];
      })
    )
  );
  expect(report.packageReportMapCount).toBe(
    Object.keys(report.packageReportMap).length
  );
  expect(report.requiredArtifactsByPackage).toEqual(
    expectedRuntimeLibrariesArtifactsByPackage
  );
  expect(report.requiredArtifactsByPackageCount).toBe(
    Object.keys(report.requiredArtifactsByPackage).length
  );
  expect(report.requiredArtifacts).toEqual(expectedRuntimeLibrariesRequiredArtifacts);
  expect(report.requiredArtifacts.length).toBe(report.requiredArtifactCount);
  expect(report.requiredArtifactCountByPackage).toEqual(
    expectedRuntimeLibrariesRequiredArtifactCountByPackage
  );
  expect(report.requiredArtifactCountByPackageCount).toBe(
    Object.keys(report.requiredArtifactCountByPackage).length
  );
  expect(report.requiredArtifactCount).toBe(
    expectedRuntimeLibrariesRequiredArtifactCount
  );
  const missingPackageCount = report.packageReports.filter((packageReport) => {
    return packageReport.artifactsPresent === false;
  }).length;
  const missingArtifactCount = report.packageReports.reduce(
    (count, packageReport) => {
      return count + packageReport.missingArtifactCount;
    },
    0
  );
  const presentArtifactCount = report.packageReports.reduce(
    (count, packageReport) => {
      return count + packageReport.presentArtifactCount;
    },
    0
  );
  const presentArtifactCountByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.presentArtifactCount];
    })
  );
  const artifactsPresentByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.artifactsPresent];
    })
  );
  const packageStatusMap = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [
        packageReport.packageName,
        packageReport.artifactsPresent ? "present" : "missing",
      ];
    })
  );
  const packageCheckCommandMap = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkCommand];
    })
  );
  const packageCheckArgsMap = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkArgs];
    })
  );
  const packageCheckArgCountMap = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkArgCount];
    })
  );
  const presentArtifacts = report.packageReports.reduce((artifacts, packageReport) => {
    return [...artifacts, ...packageReport.presentArtifacts];
  }, [] as string[]);
  const presentArtifactsByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.presentArtifacts];
    })
  );
  const missingArtifactCountByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.missingArtifactCount];
    })
  );
  const missingArtifacts = report.packageReports.reduce((artifacts, packageReport) => {
    return [...artifacts, ...packageReport.missingArtifacts];
  }, [] as string[]);
  const missingArtifactsByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.missingArtifacts];
    })
  );
  expect(report.packagesPresent).toBe(missingPackageCount === 0);
  expect(report.requiredPackageCount).toBe(
    report.presentPackageCount + report.missingPackageCount
  );
  expect(report.checkedPackageIndexCount).toBe(
    report.presentPackageIndexCount + report.missingPackageIndexCount
  );
  expect(report.checkedPackageIndexMapCount).toBe(
    report.presentPackageIndexMapCount + report.missingPackageIndexMapCount
  );
  expect(report.requiredArtifactCount).toBe(
    report.presentArtifactCount + report.missingArtifactCount
  );
  const presentPackageCount = report.packageReports.length - missingPackageCount;
  expect(report.presentPackageCount).toBe(presentPackageCount);
  expect(report.presentPackages.length).toBe(report.presentPackageCount);
  expect(report.presentPackagePaths.length).toBe(report.presentPackagePathCount);
  expect(report.presentPackagePathMap).toEqual(presentPackagePathMap);
  expect(report.presentPackagePathMapCount).toBe(
    Object.keys(report.presentPackagePathMap).length
  );
  expect(report.presentPackageIndices).toEqual(presentPackageIndices);
  expect(report.presentPackageIndices.length).toBe(report.presentPackageIndexCount);
  expect(report.presentPackageIndexMap).toEqual(presentPackageIndexMap);
  expect(report.presentPackageIndexMapCount).toBe(
    Object.keys(report.presentPackageIndexMap).length
  );
  expect(report.missingPackages.length).toBe(report.missingPackageCount);
  expect(report.missingPackagePaths.length).toBe(report.missingPackagePathCount);
  expect(report.missingPackagePathMap).toEqual(missingPackagePathMap);
  expect(report.missingPackagePathMapCount).toBe(
    Object.keys(report.missingPackagePathMap).length
  );
  expect(report.missingPackageIndices).toEqual(missingPackageIndices);
  expect(report.missingPackageIndices.length).toBe(report.missingPackageIndexCount);
  expect(report.missingPackageIndexMap).toEqual(missingPackageIndexMap);
  expect(report.missingPackageIndexMapCount).toBe(
    Object.keys(report.missingPackageIndexMap).length
  );
  expect({
    ...report.presentPackageIndexMap,
    ...report.missingPackageIndexMap,
  }).toEqual(report.checkedPackageIndexMap);
  expect(report.presentArtifactCount).toBe(presentArtifactCount);
  expect(report.packageCheckCommandMap).toEqual(packageCheckCommandMap);
  expect(report.packageCheckCommandMapCount).toBe(
    Object.keys(report.packageCheckCommandMap).length
  );
  expect(report.packageCheckArgsMap).toEqual(packageCheckArgsMap);
  expect(report.packageCheckArgsMapCount).toBe(
    Object.keys(report.packageCheckArgsMap).length
  );
  expect(report.packageCheckArgCountMap).toEqual(packageCheckArgCountMap);
  expect(report.packageCheckArgCountMapCount).toBe(
    Object.keys(report.packageCheckArgCountMap).length
  );
  expect(report.packageStatusMap).toEqual(packageStatusMap);
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
  expect(report.artifactsPresentByPackage).toEqual(artifactsPresentByPackage);
  expect(report.artifactsPresentByPackageCount).toBe(
    Object.keys(report.artifactsPresentByPackage).length
  );
  expect(report.presentArtifactCountByPackage).toEqual(
    presentArtifactCountByPackage
  );
  expect(report.presentArtifactsByPackage).toEqual(presentArtifactsByPackage);
  expect(report.presentArtifactsByPackageCount).toBe(
    Object.keys(report.presentArtifactsByPackage).length
  );
  expect(report.presentArtifactCountByPackageCount).toBe(
    Object.keys(report.presentArtifactCountByPackage).length
  );
  expect(report.presentArtifacts).toEqual(presentArtifacts);
  expect(report.presentArtifacts.length).toBe(report.presentArtifactCount);
  expect(report.missingPackageCount).toBe(missingPackageCount);
  expect(report.missingArtifactCount).toBe(missingArtifactCount);
  expect(report.missingArtifactCountByPackage).toEqual(
    missingArtifactCountByPackage
  );
  expect(report.missingArtifactsByPackage).toEqual(missingArtifactsByPackage);
  expect(report.missingArtifactsByPackageCount).toBe(
    Object.keys(report.missingArtifactsByPackage).length
  );
  expect(report.missingArtifactCountByPackageCount).toBe(
    Object.keys(report.missingArtifactCountByPackage).length
  );
  const expectedFailureSummaries = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => {
      return {
        packageName: packageReport.packageName,
        packagePath: packageReport.packagePath,
        packageIndex: packageReport.packageIndex,
        missingArtifacts: packageReport.missingArtifacts,
        missingArtifactCount: packageReport.missingArtifactCount,
        message: `Missing artifacts for ${packageReport.packageName}: ${packageReport.missingArtifacts.join(", ")}.`,
      };
    });
  expect(report.failureSummaries).toEqual(expectedFailureSummaries);
  expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
  expect(report.missingArtifacts).toEqual(missingArtifacts);
  expect(report.missingArtifacts.length).toBe(report.missingArtifactCount);
  expect([...report.presentArtifacts, ...report.missingArtifacts].sort()).toEqual(
    [...report.requiredArtifacts].sort()
  );
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
    expect(packageReport.packageIndex).toBe(
      report.checkedPackageIndexMap[packageReport.packageName]
    );
    expect(packageReport.checkCommand).toBe(
      expectedRuntimeLibrariesPackageCheckCommand
    );
    expect(packageReport.checkArgs).toEqual(packageReport.requiredArtifacts);
    expect(packageReport.checkArgCount).toBe(packageReport.checkArgs.length);
    expect(packageReport.requiredArtifacts).toEqual(
      expectedRuntimeLibrariesArtifactsByPackage[
        packageReport.packageName as keyof typeof expectedRuntimeLibrariesArtifactsByPackage
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
  expect(report.buildArgs).toEqual(expectedRuntimeLibrariesBuildArgs);
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
  expectTimingMetadata(report);
  expectOptionTerminatorMetadata(report);
  expectCliOptionCatalogMetadata(
    report,
    expectedNoBuildCliOptionAliases,
    expectedNoBuildCliOptions
  );
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
    expectWasmPackCheckMetadata(report);
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

  it("check-wasm-pack json mode keeps trailing output when strict flags appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-json-last-output-strict-flag-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--quiet",
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as WasmPackJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as WasmPackJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.validationErrorCode).toBeNull();
    expect(stdoutReport.activeCliOptions).toEqual(["--json", "--output", "--quiet"]);
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
    expectWasmPackCheckMetadata(report);
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

  it("check-wasm-pack treats inline known-flag misuse after --output as missing output value", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      "--json=1",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
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

  it("check-wasm-pack json mode keeps active metadata when inline misuse is present", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--quiet",
      "--json=1",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
    );
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--quiet"],
      ["--json", "--quiet"],
      [
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
      ]
    );
    expect(result.status).toBe(1);
  });

  it("check-wasm-pack json mode redacts inline known-flag misuse tokens", () => {
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
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
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

  it("check-wasm-pack json mode deduplicates literal redaction placeholders", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--json=<value>",
      "--json=secret",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--json=secret");
    expect(result.status).toBe(1);
  });

  it("check-wasm-pack json mode redacts malformed inline option names", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--=secret",
      "--=token",
      "--=",
      "-=secret",
      "-=",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--=<value>", "-=<value>"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --output, --quiet."
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

  it("check-wasm-pack json validation keeps trailing output after inline known-flag misuse", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-wasm-pack-validation-last-output-inline-misuse-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--json=1",
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
    expect(stdoutReport.unknownOptions).toEqual(["--json=<value>"]);
    expect(stdoutReport.activeCliOptions).toEqual(["--json", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--json", "--output"]);
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
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--",
      "--output",
      "--json=1",
      "--verify=2",
      "--=secret",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.message).not.toBe("Missing value for --output option.");
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report, true, [
      "--output",
      "--json=1",
      "--verify=2",
      "--=secret",
    ]);
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

  it("check-wasm-pack reports only pre-terminator unknown options", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json",
      "--mystery",
      "--",
      "--another-mystery",
      "--json=1",
    ]);
    const report = JSON.parse(result.output) as WasmPackJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--another-mystery", "--json=1"]);
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

  it("check-wasm-pack non-json mode redacts inline known-flag misuse tokens", () => {
    const result = runScript("check-wasm-pack.mjs", ["--json=1", "--mystery=alpha"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--json=1");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-wasm-pack non-json mode deduplicates literal redaction placeholders", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--json=<value>",
      "--json=secret",
      "--mystery=alpha",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--json=secret");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-wasm-pack non-json mode redacts malformed inline option names", () => {
    const result = runScript("check-wasm-pack.mjs", [
      "--=secret",
      "--=token",
      "--=",
      "-=secret",
      "-=",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--=secret");
    expect(result.output).not.toContain("--=token");
    expect(result.output).not.toContain("-=secret");
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

  it("check-wasm-pack non-json mode prioritizes missing output value over inline known-flag misuse", () => {
    const result = runScript("check-wasm-pack.mjs", ["--output", "--json=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--json=1");
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
    expectDevEnvCheckMetadata(report);
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

  it("check-dev-env json mode keeps trailing output when strict flags appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-json-last-output-strict-flag-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--quiet",
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as DevEnvJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as DevEnvJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.validationErrorCode).toBeNull();
    expect(stdoutReport.activeCliOptions).toEqual(["--json", "--output", "--quiet"]);
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
    expectDevEnvCheckMetadata(report);
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

  it("check-dev-env treats inline known-flag misuse after --output as missing output value", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      "--json=1",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--json=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.requiredFailures).toBe(0);
    expect(report.checks).toEqual([]);
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

  it("check-dev-env json mode keeps active metadata when inline misuse is present", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--quiet",
      "--json=1",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
    );
    expectActiveCliOptionMetadata(
      report,
      ["--json", "--quiet"],
      ["--json", "--quiet"],
      [
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

  it("check-dev-env json mode redacts inline known-flag misuse tokens", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--json=1",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
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

  it("check-dev-env json mode deduplicates literal redaction placeholders", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--json=<value>",
      "--json=secret",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--json=secret");
    expect(result.status).toBe(1);
  });

  it("check-dev-env json mode redacts malformed inline option names", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--=secret",
      "--=token",
      "--=",
      "-=secret",
      "-=",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedStandardCliOptions);
    expectCliOptionCatalogMetadata(report, {}, expectedStandardCliOptions);
    expect(report.unknownOptions).toEqual(["--=<value>", "-=<value>"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --output, --quiet."
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

  it("check-dev-env json validation keeps trailing output after inline known-flag misuse", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-validation-last-output-inline-misuse-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--json=1",
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
    expect(stdoutReport.unknownOptions).toEqual(["--json=<value>"]);
    expect(stdoutReport.activeCliOptions).toEqual(["--json", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--json", "--output"]);
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
    const result = runScript("check-dev-env.mjs", [
      "--json",
      "--",
      "--output",
      "--json=1",
      "--verify=2",
      "--=secret",
    ]);
    const report = JSON.parse(result.output) as DevEnvJsonReport;

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

  it("check-dev-env non-json mode redacts inline known-flag misuse tokens", () => {
    const result = runScript("check-dev-env.mjs", ["--json=1", "--mystery=alpha"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--json=1");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-dev-env non-json mode deduplicates literal redaction placeholders", () => {
    const result = runScript("check-dev-env.mjs", [
      "--json=<value>",
      "--json=secret",
      "--mystery=alpha",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--json=secret");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-dev-env non-json mode redacts malformed inline option names", () => {
    const result = runScript("check-dev-env.mjs", [
      "--=secret",
      "--=token",
      "--=",
      "-=secret",
      "-=",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --output, --quiet."
    );
    expect(result.output).not.toContain("--=secret");
    expect(result.output).not.toContain("--=token");
    expect(result.output).not.toContain("-=secret");
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

  it("check-dev-env non-json mode prioritizes missing output value over inline known-flag misuse", () => {
    const result = runScript("check-dev-env.mjs", ["--output", "--json=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--json=1");
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
    expectStepSummaryMetadata(report, expectedClientAvailableStepMetadata);
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

  it("check-client json mode keeps trailing output when no-build aliases appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-client-json-last-output-strict-no-build-alias-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--verify",
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.noBuild).toBe(true);
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
    expectAvailableStepMetadata(
      report,
      expectedClientAvailableSteps,
      expectedClientAvailableStepMetadata
    );
    expectStepSummaryMetadata(report, expectedClientAvailableStepMetadata);
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

  it("check-client treats inline no-build alias misuse after --output as missing output value", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--output",
      "--verify=1",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
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

  it("check-client treats no-build alias after --output as missing output value while keeping alias active", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--output",
      "--verify",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expectAvailableStepMetadata(
      report,
      expectedClientAvailableSteps,
      expectedClientAvailableStepMetadata
    );
    expectStepSummaryMetadata(report, expectedClientAvailableStepMetadata);
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

  it("check-client treats canonical no-build token after --output as missing output value while keeping no-build active", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--output",
      "--no-build",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expectAvailableStepMetadata(
      report,
      expectedClientAvailableSteps,
      expectedClientAvailableStepMetadata
    );
    expectStepSummaryMetadata(report, expectedClientAvailableStepMetadata);
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

  it("check-client treats inline json flag misuse after --output as missing output value", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--output",
      "--json=1",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--json=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
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
    expectAvailableStepMetadata(
      report,
      expectedClientAvailableSteps,
      expectedClientAvailableStepMetadata
    );
    expectStepSummaryMetadata(report, expectedClientAvailableStepMetadata);
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
    expectAvailableStepMetadata(
      report,
      expectedClientAvailableSteps,
      expectedClientAvailableStepMetadata
    );
    expectStepSummaryMetadata(report, expectedClientAvailableStepMetadata);
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
    expectAvailableStepMetadata(
      report,
      expectedClientAvailableSteps,
      expectedClientAvailableStepMetadata
    );
    expectStepSummaryMetadata(report, expectedClientAvailableStepMetadata);
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
    expectAvailableStepMetadata(
      report,
      expectedClientAvailableSteps,
      expectedClientAvailableStepMetadata
    );
    expectStepSummaryMetadata(report, expectedClientAvailableStepMetadata);
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
    expect(report.noBuild).toBe(false);
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
    expect(report.noBuild).toBe(false);
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
      "--json=1",
      "--verify=2",
      "--=secret",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

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

  it("check-client does not treat no-build aliases after option terminator as active", () => {
    const result = runScript("check-client.mjs", ["--json", "--", "--verify"]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--verify"]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.totalSteps).toBeGreaterThan(0);
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

  it("check-client keeps no-build alias before option terminator active", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--verify",
      "--",
      "--verify=1",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--verify=1", "--mystery=alpha"]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.totalSteps).toBeGreaterThan(0);
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

  it("check-client json mode keeps alias-active metadata when inline misuse is present", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--verify",
      "--no-build=2",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as ClientJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-client json mode redacts inline known-flag misuse tokens", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--json=1",
      "--mystery=alpha",
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
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-client json mode deduplicates literal redaction placeholders", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--json=<value>",
      "--json=secret",
      "--mystery=alpha",
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
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--json=secret");
    expect(result.status).toBe(1);
  });

  it("check-client json mode redacts inline alias misuse tokens", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--verify=1",
      "--no-build=2",
      "--mystery=alpha",
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
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-client json mode deduplicates literal alias placeholders", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--verify=<value>",
      "--verify=1",
      "--no-build=2",
      "--mystery=alpha",
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
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--verify=1");
    expect(result.output).not.toContain("--no-build=2");
    expect(result.output).not.toContain("--mystery=alpha");
    expect(result.status).toBe(1);
  });

  it("check-client json mode redacts malformed inline option names", () => {
    const result = runScript("check-client.mjs", [
      "--json",
      "--=secret",
      "--=token",
      "--=",
      "-=secret",
      "-=",
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
    expect(report.unknownOptions).toEqual(["--=<value>", "-=<value>"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-client json validation output keeps no-build aliases active between output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-client-validation-last-output-with-no-build-alias-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--mystery",
      "--output",
      firstOutputPath,
      "--verify",
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.totalSteps).toBe(0);
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

  it("check-client json validation keeps trailing output after inline no-build misuse", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-client-validation-last-output-inline-misuse-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-client.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--verify=1",
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as ClientJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as ClientJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.totalSteps).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual(["--json", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--json", "--output"]);
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

  it("check-client non-json mode redacts inline known-flag misuse tokens", () => {
    const result = runScript("check-client.mjs", ["--json=1", "--mystery=alpha"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--json=1");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-client non-json mode deduplicates literal redaction placeholders", () => {
    const result = runScript("check-client.mjs", [
      "--json=<value>",
      "--json=secret",
      "--mystery=alpha",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--json=secret");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-client non-json mode redacts inline alias misuse tokens", () => {
    const result = runScript("check-client.mjs", [
      "--verify=1",
      "--no-build=2",
      "--mystery=alpha",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--verify=1");
    expect(result.output).not.toContain("--no-build=2");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-client non-json mode deduplicates literal alias placeholders", () => {
    const result = runScript("check-client.mjs", [
      "--verify=<value>",
      "--verify=1",
      "--no-build=2",
      "--mystery=alpha",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--verify=1");
    expect(result.output).not.toContain("--no-build=2");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-client non-json mode redacts malformed inline option names", () => {
    const result = runScript("check-client.mjs", [
      "--=secret",
      "--=token",
      "--=",
      "-=secret",
      "-=",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--=secret");
    expect(result.output).not.toContain("--=token");
    expect(result.output).not.toContain("-=secret");
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

  it("check-client non-json mode prioritizes missing output value over inline no-build alias misuse", () => {
    const result = runScript("check-client.mjs", ["--output", "--verify=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--verify=1");
  });

  it("check-client non-json mode prioritizes missing output value over no-build alias tokens", () => {
    const result = runScript("check-client.mjs", ["--output", "--verify"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-client non-json mode prioritizes missing output value over canonical no-build tokens", () => {
    const result = runScript("check-client.mjs", ["--output", "--no-build"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-client non-json mode prioritizes missing output value over inline json flag misuse", () => {
    const result = runScript("check-client.mjs", ["--output", "--json=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--json=1");
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
    expectAvailableStepMetadata(
      report,
      expectedOnboardingAvailableSteps,
      expectedOnboardingAvailableStepMetadata
    );
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
    expectStepSummaryMetadata(report, expectedOnboardingAvailableStepMetadata);
    expect(report.steps[0].name).toBe("Developer environment preflight");
    const tsCoreStep = report.steps.find(
      (step) => step.name === "TypeScript core checks"
    );
    expect(tsCoreStep).toBeDefined();
    const runtimeLibrariesStep = report.steps.find(
      (step) => step.name === "Runtime library checks"
    );
    expect(runtimeLibrariesStep).toBeDefined();
    expect(
      report.steps.some((step) => step.name === "Client checks")
    ).toBe(true);
    const clientStep = report.steps.find((step) => step.name === "Client checks");
    expect(clientStep).toBeDefined();
    const tsCoreStepIndex = report.steps.findIndex((step) => {
      return step.name === "TypeScript core checks";
    });
    const runtimeLibrariesStepIndex = report.steps.findIndex((step) => {
      return step.name === "Runtime library checks";
    });
    const clientStepIndex = report.steps.findIndex((step) => {
      return step.name === "Client checks";
    });
    expect(tsCoreStepIndex).toBeGreaterThan(-1);
    expect(runtimeLibrariesStepIndex).toBeGreaterThan(-1);
    expect(clientStepIndex).toBeGreaterThan(-1);
    expect(tsCoreStepIndex).toBeLessThan(runtimeLibrariesStepIndex);
    expect(runtimeLibrariesStepIndex).toBeLessThan(clientStepIndex);
    expect(tsCoreStepIndex).toBeLessThan(clientStepIndex);
    expect(report.steps[0].report).not.toBeNull();
    if (report.steps[0].report !== null) {
      expect(report.steps[0].report.schemaVersion).toBe(1);
      expect(typeof report.steps[0].report.passed).toBe("boolean");
      expectTimingMetadata(report.steps[0].report);
      expectOptionTerminatorMetadata(report.steps[0].report);
    }
    if (tsCoreStep !== undefined && report.steps[0].passed === false) {
      expect(tsCoreStep.skipped).toBe(true);
      expect(tsCoreStep.exitCode).toBeNull();
      expect(tsCoreStep.reason).toBe("Developer environment preflight failed");
    }
    if (
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed === false
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(true);
      expect(runtimeLibrariesStep.exitCode).toBeNull();
      expect(runtimeLibrariesStep.reason).toBe(
        "Developer environment preflight failed"
      );
    }
    if (
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.report !== null
    ) {
      expect(tsCoreStep.skipped).toBe(false);
      expectTsCoreReportMetadata(tsCoreStep.report);
    }
    if (
      runtimeLibrariesStep !== undefined &&
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed &&
      runtimeLibrariesStep.report !== null
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(false);
      expectRuntimeLibrariesReportMetadata(runtimeLibrariesStep.report);
    }
    if (
      runtimeLibrariesStep !== undefined &&
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed === false
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(true);
      expect(runtimeLibrariesStep.exitCode).toBeNull();
      expect(runtimeLibrariesStep.reason).toBe("TypeScript core checks failed");
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe("Developer environment preflight failed");
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe("TypeScript core checks failed");
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed &&
      runtimeLibrariesStep.skipped === false &&
      runtimeLibrariesStep.passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe("Runtime library checks failed");
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

  it("check-onboarding json mode keeps trailing output when no-build aliases appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-onboarding-json-last-output-strict-no-build-alias-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--verify",
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.noBuild).toBe(true);
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

  it("check-onboarding treats inline no-build alias misuse after --output as missing output value", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      "--verify=1",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
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

  it("check-onboarding treats no-build alias after --output as missing output value while keeping alias active", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      "--verify",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
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

  it("check-onboarding treats canonical no-build token after --output as missing output value while keeping no-build active", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      "--no-build",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
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

  it("check-onboarding treats inline json flag misuse after --output as missing output value", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      "--json=1",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expectTimingMetadata(report);
    expectOptionTerminatorMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--json=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
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
    expect(report.noBuild).toBe(false);
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
    expect(report.noBuild).toBe(false);
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
      "--json=1",
      "--verify=2",
      "--=secret",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

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

  it("check-onboarding does not treat no-build aliases after option terminator as active", () => {
    const result = runScript("check-onboarding.mjs", ["--json", "--", "--verify"]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--verify"]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.totalSteps).toBeGreaterThan(0);
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

  it("check-onboarding keeps no-build alias before option terminator active", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--verify",
      "--",
      "--verify=1",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expectOptionTerminatorMetadata(report, true, ["--verify=1", "--mystery=alpha"]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.totalSteps).toBeGreaterThan(0);
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

  it("check-onboarding json mode keeps alias-active metadata when inline misuse is present", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--verify",
      "--no-build=2",
      "--mystery=alpha",
    ]);
    const report = JSON.parse(result.output) as OnboardingJsonReport;

    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBeNull();
    expect(report.supportedCliOptions).toEqual(expectedNoBuildCliOptions);
    expectCliOptionCatalogMetadata(
      report,
      expectedNoBuildCliOptionAliases,
      expectedNoBuildCliOptions
    );
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-onboarding json mode redacts inline known-flag misuse tokens", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--json=1",
      "--mystery=alpha",
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
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-onboarding json mode deduplicates literal redaction placeholders", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--json=<value>",
      "--json=secret",
      "--mystery=alpha",
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
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--json=secret");
    expect(result.status).toBe(1);
  });

  it("check-onboarding json mode redacts inline alias misuse tokens", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--verify=1",
      "--no-build=2",
      "--mystery=alpha",
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
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-onboarding json mode deduplicates literal alias placeholders", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--verify=<value>",
      "--verify=1",
      "--no-build=2",
      "--mystery=alpha",
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
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--verify=1");
    expect(result.output).not.toContain("--no-build=2");
    expect(result.output).not.toContain("--mystery=alpha");
    expect(result.status).toBe(1);
  });

  it("check-onboarding json mode redacts malformed inline option names", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--=secret",
      "--=token",
      "--=",
      "-=secret",
      "-=",
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
    expect(report.unknownOptions).toEqual(["--=<value>", "-=<value>"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
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

  it("check-onboarding json validation output keeps no-build aliases active between output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-onboarding-validation-last-output-with-no-build-alias-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--mystery",
      "--output",
      firstOutputPath,
      "--verify",
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.totalSteps).toBe(0);
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

  it("check-onboarding json validation keeps trailing output after inline no-build misuse", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-onboarding-validation-last-output-inline-misuse-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = runScript("check-onboarding.mjs", [
      "--json",
      "--output",
      firstOutputPath,
      "--verify=1",
      "--output",
      secondOutputPath,
    ]);
    const stdoutReport = JSON.parse(result.output) as OnboardingJsonReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as OnboardingJsonReport;

    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.totalSteps).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual(["--json", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--json", "--output"]);
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

  it("check-onboarding non-json mode redacts inline known-flag misuse tokens", () => {
    const result = runScript("check-onboarding.mjs", ["--json=1", "--mystery=alpha"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--json=1");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-onboarding non-json mode deduplicates literal redaction placeholders", () => {
    const result = runScript("check-onboarding.mjs", [
      "--json=<value>",
      "--json=secret",
      "--mystery=alpha",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --json=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--json=secret");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-onboarding non-json mode redacts inline alias misuse tokens", () => {
    const result = runScript("check-onboarding.mjs", [
      "--verify=1",
      "--no-build=2",
      "--mystery=alpha",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--verify=1");
    expect(result.output).not.toContain("--no-build=2");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-onboarding non-json mode deduplicates literal alias placeholders", () => {
    const result = runScript("check-onboarding.mjs", [
      "--verify=<value>",
      "--verify=1",
      "--no-build=2",
      "--mystery=alpha",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --no-build=<value>, --mystery. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--verify=1");
    expect(result.output).not.toContain("--no-build=2");
    expect(result.output).not.toContain("--mystery=alpha");
  });

  it("check-onboarding non-json mode redacts malformed inline option names", () => {
    const result = runScript("check-onboarding.mjs", [
      "--=secret",
      "--=token",
      "--=",
      "-=secret",
      "-=",
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Unsupported option(s): --=<value>, -=<value>. Supported options: --compact, --json, --no-build, --output, --quiet, --verify."
    );
    expect(result.output).not.toContain("--=secret");
    expect(result.output).not.toContain("--=token");
    expect(result.output).not.toContain("-=secret");
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

  it("check-onboarding non-json mode prioritizes missing output value over inline no-build alias misuse", () => {
    const result = runScript("check-onboarding.mjs", ["--output", "--verify=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--verify=1");
  });

  it("check-onboarding non-json mode prioritizes missing output value over no-build alias tokens", () => {
    const result = runScript("check-onboarding.mjs", ["--output", "--verify"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-onboarding non-json mode prioritizes missing output value over canonical no-build tokens", () => {
    const result = runScript("check-onboarding.mjs", ["--output", "--no-build"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("check-onboarding non-json mode prioritizes missing output value over inline json flag misuse", () => {
    const result = runScript("check-onboarding.mjs", ["--output", "--json=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--json=1");
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
    const tsCoreStep = report.steps.find(
      (step) => step.name === "TypeScript core checks"
    );
    expect(tsCoreStep).toBeDefined();
    const runtimeLibrariesStep = report.steps.find(
      (step) => step.name === "Runtime library checks"
    );
    expect(runtimeLibrariesStep).toBeDefined();
    const clientStep = report.steps.find((step) => step.name === "Client checks");
    expect(clientStep).toBeDefined();
    const tsCoreStepIndex = report.steps.findIndex((step) => {
      return step.name === "TypeScript core checks";
    });
    const runtimeLibrariesStepIndex = report.steps.findIndex((step) => {
      return step.name === "Runtime library checks";
    });
    const clientStepIndex = report.steps.findIndex((step) => {
      return step.name === "Client checks";
    });
    expect(tsCoreStepIndex).toBeGreaterThan(-1);
    expect(runtimeLibrariesStepIndex).toBeGreaterThan(-1);
    expect(clientStepIndex).toBeGreaterThan(-1);
    expect(tsCoreStepIndex).toBeLessThan(runtimeLibrariesStepIndex);
    expect(runtimeLibrariesStepIndex).toBeLessThan(clientStepIndex);
    expect(tsCoreStepIndex).toBeLessThan(clientStepIndex);
    if (tsCoreStep !== undefined && report.steps[0].passed === false) {
      expect(tsCoreStep.skipped).toBe(true);
      expect(tsCoreStep.exitCode).toBeNull();
      expect(tsCoreStep.reason).toBe("Developer environment preflight failed");
    }
    if (
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed === false
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(true);
      expect(runtimeLibrariesStep.exitCode).toBeNull();
      expect(runtimeLibrariesStep.reason).toBe(
        "Developer environment preflight failed"
      );
    }
    if (
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.report !== null
    ) {
      expect(tsCoreStep.skipped).toBe(false);
      expectTsCoreReportMetadata(tsCoreStep.report);
      expect(tsCoreStep.report.noBuild).toBe(true);
      expect(tsCoreStep.report.buildSkipped).toBe(true);
    }
    if (
      runtimeLibrariesStep !== undefined &&
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed &&
      runtimeLibrariesStep.report !== null
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(false);
      expectRuntimeLibrariesReportMetadata(runtimeLibrariesStep.report);
      expect(runtimeLibrariesStep.report.noBuild).toBe(true);
      expect(runtimeLibrariesStep.report.buildSkipped).toBe(true);
    }
    if (
      runtimeLibrariesStep !== undefined &&
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed === false
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(true);
      expect(runtimeLibrariesStep.exitCode).toBeNull();
      expect(runtimeLibrariesStep.reason).toBe("TypeScript core checks failed");
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe(
        "Developer environment preflight failed"
      );
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe("TypeScript core checks failed");
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed &&
      runtimeLibrariesStep.skipped === false &&
      runtimeLibrariesStep.passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe("Runtime library checks failed");
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
    const tsCoreStep = report.steps.find(
      (step) => step.name === "TypeScript core checks"
    );
    expect(tsCoreStep).toBeDefined();
    const runtimeLibrariesStep = report.steps.find(
      (step) => step.name === "Runtime library checks"
    );
    expect(runtimeLibrariesStep).toBeDefined();
    const clientStep = report.steps.find((step) => step.name === "Client checks");
    expect(clientStep).toBeDefined();
    const tsCoreStepIndex = report.steps.findIndex((step) => {
      return step.name === "TypeScript core checks";
    });
    const runtimeLibrariesStepIndex = report.steps.findIndex((step) => {
      return step.name === "Runtime library checks";
    });
    const clientStepIndex = report.steps.findIndex((step) => {
      return step.name === "Client checks";
    });
    expect(tsCoreStepIndex).toBeGreaterThan(-1);
    expect(runtimeLibrariesStepIndex).toBeGreaterThan(-1);
    expect(clientStepIndex).toBeGreaterThan(-1);
    expect(tsCoreStepIndex).toBeLessThan(runtimeLibrariesStepIndex);
    expect(runtimeLibrariesStepIndex).toBeLessThan(clientStepIndex);
    expect(tsCoreStepIndex).toBeLessThan(clientStepIndex);
    if (tsCoreStep !== undefined && report.steps[0].passed === false) {
      expect(tsCoreStep.skipped).toBe(true);
      expect(tsCoreStep.exitCode).toBeNull();
      expect(tsCoreStep.reason).toBe("Developer environment preflight failed");
    }
    if (
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed === false
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(true);
      expect(runtimeLibrariesStep.exitCode).toBeNull();
      expect(runtimeLibrariesStep.reason).toBe(
        "Developer environment preflight failed"
      );
    }
    if (
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.report !== null
    ) {
      expect(tsCoreStep.skipped).toBe(false);
      expectTsCoreReportMetadata(tsCoreStep.report);
      expect(tsCoreStep.report.noBuild).toBe(true);
      expect(tsCoreStep.report.buildSkipped).toBe(true);
    }
    if (
      runtimeLibrariesStep !== undefined &&
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed &&
      runtimeLibrariesStep.report !== null
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(false);
      expectRuntimeLibrariesReportMetadata(runtimeLibrariesStep.report);
      expect(runtimeLibrariesStep.report.noBuild).toBe(true);
      expect(runtimeLibrariesStep.report.buildSkipped).toBe(true);
    }
    if (
      runtimeLibrariesStep !== undefined &&
      tsCoreStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed === false
    ) {
      expect(runtimeLibrariesStep.skipped).toBe(true);
      expect(runtimeLibrariesStep.exitCode).toBeNull();
      expect(runtimeLibrariesStep.reason).toBe("TypeScript core checks failed");
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe("Developer environment preflight failed");
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe("TypeScript core checks failed");
    }
    if (
      clientStep !== undefined &&
      tsCoreStep !== undefined &&
      runtimeLibrariesStep !== undefined &&
      report.steps[0].passed &&
      tsCoreStep.skipped === false &&
      tsCoreStep.passed &&
      runtimeLibrariesStep.skipped === false &&
      runtimeLibrariesStep.passed === false
    ) {
      expect(clientStep.skipped).toBe(true);
      expect(clientStep.exitCode).toBeNull();
      expect(clientStep.reason).toBe("Runtime library checks failed");
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
});
