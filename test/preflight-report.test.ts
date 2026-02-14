import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type PreflightCheckResult = {
  name: string;
  scriptName: string;
  supportsNoBuild: boolean;
  checkCommand: string;
  checkArgs: string[];
  checkArgCount: number;
  checkIndex: number | null;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  report: object | null;
  output: string | null;
};
type DevEnvironmentNestedCheck = {
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
type DevEnvironmentNestedReport = {
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
  checks: DevEnvironmentNestedCheck[];
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
  requiredCheckCommandMap: Record<string, string>;
  requiredCheckCommandMapCount: number;
  requiredCheckArgsMap: Record<string, string[]>;
  requiredCheckArgsMapCount: number;
  requiredCheckArgCountMap: Record<string, number>;
  requiredCheckArgCountMapCount: number;
  optionalCheckLabels: string[];
  optionalCheckCount: number;
  optionalCheckIndices: number[];
  optionalCheckIndexCount: number;
  optionalCheckIndexMap: Record<string, number>;
  optionalCheckIndexMapCount: number;
  optionalCheckCommandMap: Record<string, string>;
  optionalCheckCommandMapCount: number;
  optionalCheckArgsMap: Record<string, string[]>;
  optionalCheckArgsMapCount: number;
  optionalCheckArgCountMap: Record<string, number>;
  optionalCheckArgCountMapCount: number;
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
  requiredFailureLabels: string[];
  requiredFailureCount: number;
  requiredFailureIndices: number[];
  requiredFailureIndexCount: number;
  requiredFailureIndexMap: Record<string, number>;
  requiredFailureIndexMapCount: number;
  requiredFailureCommandMap: Record<string, string>;
  requiredFailureCommandMapCount: number;
  requiredFailureArgsMap: Record<string, string[]>;
  requiredFailureArgsMapCount: number;
  requiredFailureArgCountMap: Record<string, number>;
  requiredFailureArgCountMapCount: number;
  optionalFailureLabels: string[];
  optionalFailureCount: number;
  optionalFailureIndices: number[];
  optionalFailureIndexCount: number;
  optionalFailureIndexMap: Record<string, number>;
  optionalFailureIndexMapCount: number;
  optionalFailureCommandMap: Record<string, string>;
  optionalFailureCommandMapCount: number;
  optionalFailureArgsMap: Record<string, string[]>;
  optionalFailureArgsMapCount: number;
  optionalFailureArgCountMap: Record<string, number>;
  optionalFailureArgCountMapCount: number;
  failureSummaries: Array<{
    label: string;
    checkIndex: number;
    checkCommand: string;
    checkArgs: string[];
    checkArgCount: number;
    required: boolean;
    status: string;
    message: string;
    hint: string;
  }>;
  failureSummaryCount: number;
};
type WasmPackNestedReport = {
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
  availableCheckIndexMap: Record<string, number>;
  availableCheckIndexMapCount: number;
  availableCheckMetadata: Record<
    string,
    {
      checkIndex: number;
      command: string;
      args: string[];
      argCount: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
  availableCheckMetadataCount: number;
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
  checkMetadata: Record<
    string,
    {
      checkIndex: number;
      command: string;
      args: string[];
      argCount: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
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
  passedCheckMetadata: Record<
    string,
    {
      checkIndex: number;
      command: string;
      args: string[];
      argCount: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
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
  failedCheckMetadata: Record<
    string,
    {
      checkIndex: number;
      command: string;
      args: string[];
      argCount: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
  failedCheckMetadataCount: number;
  failureSummaries: Array<{
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
  }>;
  failureSummaryCount: number;
  message?: string;
};
type WasmMesherNestedReport = {
  schemaVersion: number;
  artifactPath: string;
  outputPath: string | null;
  wasmPackCheckCommand: string;
  wasmPackCheckArgs: string[];
  wasmPackCheckArgCount: number;
  wasmPackCheckExitCode: number | null;
  wasmPackCheckOutputLine: string | null;
  wasmPackCheckStatus: "ok" | "missing" | "unavailable" | "skipped";
  wasmPackCheckReport: WasmPackNestedReport | null;
};
type ClientNestedStep = {
  name: string;
  scriptName: string;
  supportsNoBuild: boolean;
  checkCommand: string;
  checkArgs: string[];
  checkArgCount: number;
  stepIndex: number;
  passed: boolean;
  exitCode: number | null;
  skipped: boolean;
  reason: string | null;
  report: WasmMesherNestedReport | null;
  output: string | null;
};
type ClientNestedReport = {
  availableSteps: string[];
  availableStepCount: number;
  availableStepScriptMap: Record<string, string>;
  availableStepScriptMapCount: number;
  availableStepCheckCommandMap: Record<string, string>;
  availableStepCheckCommandMapCount: number;
  availableStepCheckArgsMap: Record<string, string[]>;
  availableStepCheckArgsMapCount: number;
  availableStepCheckArgCountMap: Record<string, number>;
  availableStepCheckArgCountMapCount: number;
  availableStepSupportsNoBuildMap: Record<string, boolean>;
  availableStepSupportsNoBuildMapCount: number;
  availableStepIndexMap: Record<string, number>;
  availableStepIndexMapCount: number;
  availableStepMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
  availableStepMetadataCount: number;
  steps: ClientNestedStep[];
  totalSteps: number;
  passedStepCount: number;
  failedStepCount: number;
  skippedStepCount: number;
  passedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];
  passedStepCheckCommandMap: Record<string, string>;
  passedStepCheckCommandMapCount: number;
  passedStepCheckArgsMap: Record<string, string[]>;
  passedStepCheckArgsMapCount: number;
  passedStepCheckArgCountMap: Record<string, number>;
  passedStepCheckArgCountMapCount: number;
  failedStepCheckCommandMap: Record<string, string>;
  failedStepCheckCommandMapCount: number;
  failedStepCheckArgsMap: Record<string, string[]>;
  failedStepCheckArgsMapCount: number;
  failedStepCheckArgCountMap: Record<string, number>;
  failedStepCheckArgCountMapCount: number;
  skippedStepCheckCommandMap: Record<string, string>;
  skippedStepCheckCommandMapCount: number;
  skippedStepCheckArgsMap: Record<string, string[]>;
  skippedStepCheckArgsMapCount: number;
  skippedStepCheckArgCountMap: Record<string, number>;
  skippedStepCheckArgCountMapCount: number;
  stepCheckCommandMap: Record<string, string>;
  stepCheckCommandMapCount: number;
  stepCheckArgsMap: Record<string, string[]>;
  stepCheckArgsMapCount: number;
  stepCheckArgCountMap: Record<string, number>;
  stepCheckArgCountMapCount: number;
  stepStatusMap: Record<string, "passed" | "failed" | "skipped">;
  stepStatusMapCount: number;
  stepStatusCountMap: {
    passed: number;
    failed: number;
    skipped: number;
  };
  stepStatusCountMapCount: number;
  wasmPackCheckStatus: "ok" | "missing" | "unavailable" | "skipped" | null;
  wasmPackCheckCommand: string | null;
  wasmPackCheckArgs: string[] | null;
  wasmPackCheckArgCount: number | null;
  wasmPackCheckExitCode: number | null;
  wasmPackCheckOutputLine: string | null;
};

type TsCoreNestedReport = {
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
  artifactsPresent: boolean;
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
  attemptedBuild: boolean;
  buildSkipped: boolean;
  buildSkippedReason: "no-build" | "artifacts-present" | null;
  noBuild: boolean;
};

type RuntimeLibrariesNestedPackageReport = {
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

type RuntimeLibrariesNestedReport = {
  packagesPresent: boolean;
  checkedPackages: string[];
  checkedPackagePaths: string[];
  checkedPackageIndices: number[];
  checkedPackageIndexCount: number;
  checkedPackageIndexMap: Record<string, number>;
  checkedPackageIndexMapCount: number;
  checkedPackagePathMap: Record<string, string>;
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
      packageIndex: number;
      packagePath: string;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
      requiredArtifactCount: number;
    }
  >;
  availablePackageMetadataCount: number;
  checkedPackageCount: number;
  checkedPackagePathCount: number;
  checkedPackagePathMapCount: number;
  presentPackages: string[];
  presentPackagePaths: string[];
  presentPackagePathMap: Record<string, string>;
  presentPackageIndices: number[];
  presentPackageIndexMap: Record<string, number>;
  presentPackageCheckCommandMap: Record<string, string>;
  presentPackageCheckArgsMap: Record<string, string[]>;
  presentPackageCheckArgCountMap: Record<string, number>;
  presentPackagePathMapCount: number;
  presentPackageIndexCount: number;
  presentPackageIndexMapCount: number;
  presentPackageCheckCommandMapCount: number;
  presentPackageCheckArgsMapCount: number;
  presentPackageCheckArgCountMapCount: number;
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
  presentPackageMetadataCount: number;
  missingPackages: string[];
  missingPackagePaths: string[];
  missingPackagePathMap: Record<string, string>;
  missingPackageIndices: number[];
  missingPackageIndexMap: Record<string, number>;
  missingPackageCheckCommandMap: Record<string, string>;
  missingPackageCheckArgsMap: Record<string, string[]>;
  missingPackageCheckArgCountMap: Record<string, number>;
  missingPackagePathMapCount: number;
  missingPackageIndexCount: number;
  missingPackageIndexMapCount: number;
  missingPackageCheckCommandMapCount: number;
  missingPackageCheckArgsMapCount: number;
  missingPackageCheckArgCountMapCount: number;
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
  missingPackageMetadataCount: number;
  requiredPackageCount: number;
  presentPackageCount: number;
  presentPackagePathCount: number;
  packageReportCount: number;
  packageReportMap: Record<string, RuntimeLibrariesNestedPackageReport>;
  packageReportMapCount: number;
  requiredArtifactsByPackage: Record<string, string[]>;
  requiredArtifacts: string[];
  requiredArtifactsByPackageCount: number;
  requiredArtifactCountByPackage: Record<string, number>;
  packageReports: RuntimeLibrariesNestedPackageReport[];
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
  presentArtifactCountByPackage: Record<string, number>;
  presentArtifactCount: number;
  presentArtifactsByPackageCount: number;
  presentArtifactCountByPackageCount: number;
  presentPackageArtifactsByPackage: Record<string, string[]>;
  presentPackageArtifactsByPackageCount: number;
  presentPackageArtifactCountByPackage: Record<string, number>;
  presentPackageArtifactCountByPackageCount: number;
  missingPackageCount: number;
  missingPackagePathCount: number;
  missingArtifactsByPackage: Record<string, string[]>;
  missingArtifacts: string[];
  missingArtifactCountByPackage: Record<string, number>;
  missingArtifactCount: number;
  missingArtifactsByPackageCount: number;
  missingArtifactCountByPackageCount: number;
  missingPackageArtifactsByPackage: Record<string, string[]>;
  missingPackageArtifactsByPackageCount: number;
  missingPackageArtifactCountByPackage: Record<string, number>;
  missingPackageArtifactCountByPackageCount: number;
  failureSummaries: Array<{
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
  noBuild: boolean;
};

type PreflightFailureSummary = {
  name: string;
  scriptName: string;
  supportsNoBuild: boolean;
  checkIndex: number | null;
  checkCommand: string;
  checkArgs: string[];
  checkArgCount: number;
  exitCode: number;
  message: string;
};

type RequestedCheckResolution = {
  token: string;
  normalizedToken: string;
  kind: "check" | "specialSelector" | "invalid";
  resolvedTo: string[];
  selector?: string;
};

type PreflightReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  listChecksOnly: boolean;
  noBuild: boolean;
  platform: string;
  nodeVersion: string;
  optionTerminatorUsed: boolean;
  positionalArgs: string[];
  positionalArgCount: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  selectionMode: "default" | "only";
  specialSelectorsUsed: string[];
  selectedChecks: string[];
  selectedCheckCount: number;
  selectedCheckIndices: number[];
  selectedCheckIndexCount: number;
  selectedCheckIndexMap: Record<string, number>;
  selectedCheckIndexMapCount: number;
  selectedCheckMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
  selectedCheckMetadataCount: number;
  selectedCheckScripts: string[];
  selectedCheckScriptCount: number;
  selectedCheckScriptMap: Record<string, string>;
  selectedCheckScriptMapCount: number;
  selectedCheckCommandMap: Record<string, string>;
  selectedCheckCommandMapCount: number;
  selectedCheckArgsMap: Record<string, string[]>;
  selectedCheckArgsMapCount: number;
  selectedCheckArgCountMap: Record<string, number>;
  selectedCheckArgCountMapCount: number;
  selectedCheckCommandMap: Record<string, string>;
  selectedCheckCommandMapCount: number;
  selectedCheckArgsMap: Record<string, string[]>;
  selectedCheckArgsMapCount: number;
  selectedCheckArgCountMap: Record<string, number>;
  selectedCheckArgCountMapCount: number;
  skippedCheckMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
  skippedCheckMetadataCount: number;
  skippedCheckScripts: string[];
  skippedCheckScriptCount: number;
  skippedCheckScriptMap: Record<string, string>;
  skippedCheckScriptMapCount: number;
  skippedCheckCommandMap: Record<string, string>;
  skippedCheckCommandMapCount: number;
  skippedCheckArgsMap: Record<string, string[]>;
  skippedCheckArgsMapCount: number;
  skippedCheckArgCountMap: Record<string, number>;
  skippedCheckArgCountMapCount: number;
  skippedCheckCommandMap: Record<string, string>;
  skippedCheckCommandMapCount: number;
  skippedCheckArgsMap: Record<string, string[]>;
  skippedCheckArgsMapCount: number;
  skippedCheckArgCountMap: Record<string, number>;
  skippedCheckArgCountMapCount: number;
  requestedChecks: string[];
  requestedCheckCount: number;
  requestedCheckResolutions: RequestedCheckResolution[];
  requestedCheckResolutionCount: number;
  requestedCheckResolutionCounts: {
    check: number;
    specialSelector: number;
    invalid: number;
  };
  requestedCheckResolvedChecks: string[];
  requestedCheckResolvedCheckCount: number;
  requestedCheckResolvedScripts: string[];
  requestedCheckResolvedScriptCount: number;
  requestedCheckResolvedScriptMap: Record<string, string>;
  requestedCheckResolvedScriptMapCount: number;
  requestedCheckResolvedSupportsNoBuildMap: Record<string, boolean>;
  requestedCheckResolvedSupportsNoBuildMapCount: number;
  requestedCheckResolvedIndices: number[];
  requestedCheckResolvedIndexCount: number;
  requestedCheckResolvedIndexMap: Record<string, number>;
  requestedCheckResolvedIndexMapCount: number;
  requestedCheckResolvedCommandMap: Record<string, string>;
  requestedCheckResolvedCommandMapCount: number;
  requestedCheckResolvedArgsMap: Record<string, string[]>;
  requestedCheckResolvedArgsMapCount: number;
  requestedCheckResolvedArgCountMap: Record<string, number>;
  requestedCheckResolvedArgCountMapCount: number;
  requestedCheckResolvedMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
  requestedCheckResolvedMetadataCount: number;
  skippedChecks: string[];
  skippedCheckCount: number;
  skippedCheckIndices: number[];
  skippedCheckIndexCount: number;
  skippedCheckIndexMap: Record<string, number>;
  skippedCheckIndexMapCount: number;
  totalChecks: number;
  passedCheckCount: number;
  failedCheckCount: number;
  passedCheckScripts: string[];
  passedCheckScriptCount: number;
  passedCheckScriptMap: Record<string, string>;
  passedCheckScriptMapCount: number;
  passedCheckCommandMap: Record<string, string>;
  passedCheckCommandMapCount: number;
  passedCheckArgsMap: Record<string, string[]>;
  passedCheckArgsMapCount: number;
  passedCheckArgCountMap: Record<string, number>;
  passedCheckArgCountMapCount: number;
  passedCheckMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
  passedCheckMetadataCount: number;
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
  failedCheckScripts: string[];
  failedCheckScriptCount: number;
  failedCheckScriptMap: Record<string, string>;
  failedCheckScriptMapCount: number;
  failedCheckCommandMap: Record<string, string>;
  failedCheckCommandMapCount: number;
  failedCheckArgsMap: Record<string, string[]>;
  failedCheckArgsMapCount: number;
  failedCheckArgCountMap: Record<string, number>;
  failedCheckArgCountMapCount: number;
  failedCheckMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    }
  >;
  failedCheckMetadataCount: number;
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
  checkStatusMap: Record<string, "passed" | "failed" | "skipped">;
  checkStatusMapCount: number;
  checkStatusCountMap: {
    passed: number;
    failed: number;
    skipped: number;
  };
  checkStatusCountMapCount: number;
  tsCoreExampleCommand: string | null;
  tsCoreExampleArgs: string[] | null;
  tsCoreExampleArgCount: number | null;
  tsCoreExampleAttempted: boolean | null;
  tsCoreExampleStatus: "ok" | "failed" | "skipped" | null;
  tsCoreExampleRuleMatched: boolean | null;
  tsCoreExamplePayloadValid: boolean | null;
  tsCoreExamplePayloadIssues: string[] | null;
  tsCoreExamplePayloadIssueCount: number | null;
  tsCoreExampleExitCode: number | null;
  tsCoreExampleDurationMs: number | null;
  tsCoreExampleOutputLine: string | null;
  clientWasmPackCheckStatus: "ok" | "missing" | "unavailable" | "skipped" | null;
  clientWasmPackCheckCommand: string | null;
  clientWasmPackCheckArgs: string[] | null;
  clientWasmPackCheckArgCount: number | null;
  clientWasmPackCheckExitCode: number | null;
  clientWasmPackCheckOutputLine: string | null;
  firstFailedCheck: string | null;
  availableChecks: string[];
  availableCheckScripts: string[];
  availableCheckScriptCount: number;
  availableCheckScriptMap: Record<string, string>;
  availableCheckScriptMapCount: number;
  availableCheckCommandMap: Record<string, string>;
  availableCheckCommandMapCount: number;
  availableCheckArgsMap: Record<string, string[]>;
  availableCheckArgsMapCount: number;
  availableCheckArgCountMap: Record<string, number>;
  availableCheckArgCountMapCount: number;
  availableCheckSupportsNoBuildMap: Record<string, boolean>;
  availableCheckSupportsNoBuildMapCount: number;
  availableCheckIndices: number[];
  availableCheckIndexCount: number;
  availableCheckIndexMap: Record<string, number>;
  availableCheckIndexMapCount: number;
  availableCheckMetadata: {
    devEnvironment: {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    };
    wasmPack: {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    };
    tsCore: {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    };
    runtimeLibraries: {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    };
    client: {
      scriptName: string;
      supportsNoBuild: boolean;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
    };
  };
  availableCheckMetadataCount: number;
  availableCheckAliases: {
    devEnvironment: string[];
    wasmPack: string[];
    tsCore: string[];
    runtimeLibraries: string[];
    client: string[];
  };
  availableCheckAliasCountMap: Record<string, number>;
  availableCheckAliasGroupCount: number;
  availableCheckAliasCountMapCount: number;
  availableCheckAliasTokenCount: number;
  availableSpecialCheckSelectors: string[];
  availableSpecialCheckSelectorCount: number;
  availableSpecialCheckAliases: {
    all: string[];
    libraries: string[];
  };
  availableSpecialCheckAliasCountMap: Record<string, number>;
  availableSpecialCheckAliasGroupCount: number;
  availableSpecialCheckAliasCountMapCount: number;
  availableSpecialCheckAliasTokenCount: number;
  availableSpecialSelectorResolvedChecks: {
    all: string[];
    libraries: string[];
  };
  availableSpecialSelectorResolvedChecksCount: number;
  availableSpecialSelectorResolvedCheckCountMap: Record<string, number>;
  availableSpecialSelectorResolvedCheckCountMapCount: number;
  requestedCheckResolutionKinds: Array<
    RequestedCheckResolution["kind"]
  >;
  requestedCheckResolutionKindCount: number;
  passedChecks: string[];
  failedChecks: string[];
  failureSummaries: PreflightFailureSummary[];
  failureSummaryCount: number;
  checks: PreflightCheckResult[];
  checkCommandMap: Record<string, string>;
  checkCommandMapCount: number;
  checkArgsMap: Record<string, string[]>;
  checkArgsMapCount: number;
  checkArgCountMap: Record<string, number>;
  checkArgCountMapCount: number;
  outputPath: string | null;
  validationErrorCode:
    | "output_option_missing_value"
    | "only_option_missing_value"
    | "only_option_invalid_value"
    | "unsupported_options"
    | null;
  invalidChecks: string[];
  invalidCheckCount: number;
  unknownOptions: string[];
  unknownOptionCount: number;
  supportedCliOptions: string[];
  supportedCliOptionCount: number;
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
  availableCliOptionCanonicalMap: Record<string, string>;
  availableCliOptionAliases: {
    "--list-checks": string[];
    "--no-build": string[];
  };
  writeError?: string;
  message?: string;
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");
const preflightScript = path.resolve(rootDir, "check-preflight.mjs");
const rootWasmPackCheckScript = path.resolve(rootDir, "check-wasm-pack.mjs");
const expectedAvailableCheckAliases = {
  devEnvironment: [
    "devEnvironment",
    "dev",
    "dev-env",
    "dev_env",
    "devenv",
    "devenvironment",
  ],
  wasmPack: ["wasmPack", "wasm", "wasm-pack", "wasm_pack", "wasmpack"],
  tsCore: [
    "tsCore",
    "ts",
    "ts-core",
    "ts_core",
    "tscore",
    "typescript",
    "typescript-core",
    "typescript_core",
    "typescriptcore",
  ],
  runtimeLibraries: [
    "runtimeLibraries",
    "runtime",
    "runtime-libraries",
    "runtime_libraries",
    "runtimelibraries",
  ],
  client: ["client"],
};
const expectedAvailableCheckAliasCountMap = Object.fromEntries(
  Object.entries(expectedAvailableCheckAliases).map(([checkName, aliases]) => {
    return [checkName, aliases.length];
  })
);
const expectedAvailableCheckMetadata = {
  devEnvironment: {
    scriptName: "check-dev-env.mjs",
    supportsNoBuild: false,
  },
  wasmPack: {
    scriptName: "check-wasm-pack.mjs",
    supportsNoBuild: false,
  },
  tsCore: {
    scriptName: "check-ts-core.mjs",
    supportsNoBuild: true,
  },
  runtimeLibraries: {
    scriptName: "check-runtime-libraries.mjs",
    supportsNoBuild: true,
  },
  client: {
    scriptName: "check-client.mjs",
    supportsNoBuild: true,
  },
};
const expectedAvailableSpecialCheckAliases = {
  all: ["all", "all-checks", "all_checks", "allchecks"],
  libraries: ["libraries", "library", "libs", "lib"],
};
const expectedAvailableSpecialCheckAliasCountMap = Object.fromEntries(
  Object.entries(expectedAvailableSpecialCheckAliases).map(
    ([selector, aliases]) => {
      return [selector, aliases.length];
    }
  )
);
const expectedAvailableSpecialCheckSelectors = ["all", "libraries"];
const expectedAvailableSpecialSelectorResolvedChecks = {
  all: [
    "devEnvironment",
    "wasmPack",
    "tsCore",
    "runtimeLibraries",
    "client",
  ],
  libraries: ["tsCore", "runtimeLibraries"],
};
const expectedAvailableSpecialSelectorResolvedCheckCountMap = Object.fromEntries(
  Object.entries(expectedAvailableSpecialSelectorResolvedChecks).map(
    ([selector, checks]) => {
      return [selector, checks.length];
    }
  )
);
const expectedAvailableChecks = [
  "devEnvironment",
  "wasmPack",
  "tsCore",
  "runtimeLibraries",
  "client",
];
const expectedDevEnvironmentAvailableChecks = [
  "node",
  "pnpm",
  "cargo",
  "wasm-pack",
  "protoc",
  "cargo watch",
];
const expectedWasmPackAvailableChecks = ["wasm-pack"];
const expectedClientAvailableSteps = [
  "WASM artifact preflight",
  "TypeScript typecheck",
];
const expectedClientAvailableStepMetadata: Record<
  string,
  {
    scriptName: string;
    supportsNoBuild: boolean;
  }
> = {
  "WASM artifact preflight": {
    scriptName: "examples/client/scripts/check-wasm-mesher.mjs",
    supportsNoBuild: true,
  },
  "TypeScript typecheck": {
    scriptName: "examples/client:typecheck",
    supportsNoBuild: false,
  },
};
const expectedAvailableCheckScripts = expectedAvailableChecks.map((checkName) => {
  return expectedAvailableCheckMetadata[
    checkName as keyof typeof expectedAvailableCheckMetadata
  ].scriptName;
});
const expectedAvailableCheckScriptMap = Object.fromEntries(
  expectedAvailableChecks.map((checkName, index) => {
    return [checkName, expectedAvailableCheckScripts[index]];
  })
);
const expectedAvailableCheckSupportsNoBuildMap = Object.fromEntries(
  expectedAvailableChecks.map((checkName) => {
    return [
      checkName,
      expectedAvailableCheckMetadata[
        checkName as keyof typeof expectedAvailableCheckMetadata
      ].supportsNoBuild,
    ];
  })
);
const expectedAvailableCheckIndices = expectedAvailableChecks.map((_, index) => {
  return index;
});
const expectedAvailableCheckIndexMap = Object.fromEntries(
  expectedAvailableChecks.map((checkName, index) => {
    return [checkName, index];
  })
);
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
const expectedTsCoreExampleArgs = [
  path.resolve(rootDir, "packages/ts-core/examples/end-to-end.mjs"),
];
const deriveExpectedTsCoreExampleFailureMessage = (report: {
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
const expectedRequestedCheckResolutionKinds: Array<
  RequestedCheckResolution["kind"]
> = ["check", "specialSelector", "invalid"];
const expectedSupportedCliOptions = [
  "-l",
  "--compact",
  "--json",
  "--list",
  "--list-checks",
  "--no-build",
  "--verify",
  "--only",
  "--output",
  "--quiet",
];
const expectedAvailableCliOptionAliases = {
  "--list-checks": ["--list", "-l"],
  "--no-build": ["--verify"],
};
const recognizedCliOptionTokens = new Set([
  ...expectedSupportedCliOptions,
  ...Object.values(expectedAvailableCliOptionAliases).flat(),
]);
const expectedCanonicalOptionForToken = (token: string) => {
  if (token === "--list" || token === "-l") {
    return "--list-checks";
  }

  if (token === "--verify") {
    return "--no-build";
  }

  if (token.startsWith("--only=")) {
    return "--only";
  }

  if (token.startsWith("--output=")) {
    return "--output";
  }

  return token;
};
const expectedActiveCliOptionResolutions = (tokens: string[]) => {
  return tokens.map((token) => {
    return {
      token,
      canonicalOption: expectedCanonicalOptionForToken(token),
    };
  });
};
const expectedActiveCliOptionOccurrences = (tokens: string[]) => {
  const occurrences: Array<{
    token: string;
    canonicalOption: string;
    index: number;
  }> = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!recognizedCliOptionTokens.has(token)) {
      continue;
    }

    occurrences.push({
      token,
      canonicalOption: expectedCanonicalOptionForToken(token),
      index,
    });
  }

  return occurrences;
};
const expectedAvailableCliOptionCanonicalMap = Object.fromEntries(
  expectedSupportedCliOptions.map((optionToken) => {
    return [optionToken, expectedCanonicalOptionForToken(optionToken)];
  })
);
const expectedUnsupportedOptionsMessage = (options: string[]) => {
  return `Unsupported option(s): ${options.join(", ")}. Supported options: ${expectedSupportedCliOptions.join(", ")}.`;
};
const expectedEmptyRequestedCheckResolutionCounts = {
  check: 0,
  specialSelector: 0,
  invalid: 0,
};
const expectedUsedAllSpecialSelector = ["all"];
const expectedUsedLibrariesSpecialSelector = ["libraries"];
const expectSelectedCheckMetadata = (report: PreflightReport) => {
  const expectedSelectedCoreMetadata = Object.fromEntries(
    report.selectedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ],
      ];
    })
  );
  const expectedSelectedScripts = report.selectedChecks.map((checkName) => {
    return expectedAvailableCheckMetadata[
      checkName as keyof typeof expectedAvailableCheckMetadata
    ].scriptName;
  });
  const expectedSelectedScriptMap = Object.fromEntries(
    report.selectedChecks.map((checkName, index) => {
      return [checkName, expectedSelectedScripts[index]];
    })
  );
  const expectedSelectedIndices = report.selectedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedSelectedIndexMap = Object.fromEntries(
    report.selectedChecks.map((checkName, index) => {
      return [checkName, expectedSelectedIndices[index]];
    })
  );
  const expectedSkippedCoreMetadata = Object.fromEntries(
    report.skippedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ],
      ];
    })
  );
  const expectedSkippedScripts = report.skippedChecks.map((checkName) => {
    return expectedAvailableCheckMetadata[
      checkName as keyof typeof expectedAvailableCheckMetadata
    ].scriptName;
  });
  const expectedSkippedScriptMap = Object.fromEntries(
    report.skippedChecks.map((checkName, index) => {
      return [checkName, expectedSkippedScripts[index]];
    })
  );
  const expectedSkippedIndices = report.skippedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedSkippedIndexMap = Object.fromEntries(
    report.skippedChecks.map((checkName, index) => {
      return [checkName, expectedSkippedIndices[index]];
    })
  );
  const expectedResolvedChecks: string[] = [];
  const seenResolvedChecks = new Set<string>();
  const expectedResolvedScripts: string[] = [];
  const seenResolvedScripts = new Set<string>();
  for (const resolution of report.requestedCheckResolutions) {
    for (const checkName of resolution.resolvedTo) {
      if (!seenResolvedChecks.has(checkName)) {
        seenResolvedChecks.add(checkName);
        expectedResolvedChecks.push(checkName);
      }
      const scriptName =
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ]?.scriptName;
      if (typeof scriptName !== "string" || seenResolvedScripts.has(scriptName)) {
        continue;
      }
      seenResolvedScripts.add(scriptName);
      expectedResolvedScripts.push(scriptName);
    }
  }
  const expectedResolvedIndices = expectedResolvedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedResolvedIndexMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName, index) => {
      return [checkName, expectedResolvedIndices[index]];
    })
  );
  const expectedResolvedScriptMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ].scriptName,
      ];
    })
  );
  const expectedResolvedSupportsNoBuildMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ].supportsNoBuild,
      ];
    })
  );
  const expectedResolvedCommandMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [checkName, report.availableCheckCommandMap[checkName]];
    })
  );
  const expectedResolvedArgsMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [checkName, report.availableCheckArgsMap[checkName]];
    })
  );
  const expectedResolvedArgCountMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [checkName, report.availableCheckArgCountMap[checkName]];
    })
  );
  const expectedResolvedCoreMetadata = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ],
      ];
    })
  );
  const expectedSelectedCheckCommandMap = Object.fromEntries(
    report.selectedChecks.map((checkName) => {
      return [checkName, report.availableCheckCommandMap[checkName]];
    })
  );
  const expectedSelectedCheckArgsMap = Object.fromEntries(
    report.selectedChecks.map((checkName) => {
      return [checkName, report.availableCheckArgsMap[checkName]];
    })
  );
  const expectedSelectedCheckArgCountMap = Object.fromEntries(
    report.selectedChecks.map((checkName) => {
      return [checkName, report.availableCheckArgCountMap[checkName]];
    })
  );
  const expectedSkippedCheckCommandMap = Object.fromEntries(
    report.skippedChecks.map((checkName) => {
      return [checkName, report.availableCheckCommandMap[checkName]];
    })
  );
  const expectedSkippedCheckArgsMap = Object.fromEntries(
    report.skippedChecks.map((checkName) => {
      return [checkName, report.availableCheckArgsMap[checkName]];
    })
  );
  const expectedSkippedCheckArgCountMap = Object.fromEntries(
    report.skippedChecks.map((checkName) => {
      return [checkName, report.availableCheckArgCountMap[checkName]];
    })
  );
  const expectedSelectedMetadata = Object.fromEntries(
    report.selectedChecks.map((checkName) => {
      return [
        checkName,
        {
          ...expectedSelectedCoreMetadata[checkName],
          checkCommand: expectedSelectedCheckCommandMap[checkName],
          checkArgs: expectedSelectedCheckArgsMap[checkName],
          checkArgCount: expectedSelectedCheckArgCountMap[checkName],
        },
      ];
    })
  );
  const expectedSkippedMetadata = Object.fromEntries(
    report.skippedChecks.map((checkName) => {
      return [
        checkName,
        {
          ...expectedSkippedCoreMetadata[checkName],
          checkCommand: expectedSkippedCheckCommandMap[checkName],
          checkArgs: expectedSkippedCheckArgsMap[checkName],
          checkArgCount: expectedSkippedCheckArgCountMap[checkName],
        },
      ];
    })
  );
  const expectedResolvedMetadata = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [
        checkName,
        {
          ...expectedResolvedCoreMetadata[checkName],
          checkCommand: expectedResolvedCommandMap[checkName],
          checkArgs: expectedResolvedArgsMap[checkName],
          checkArgCount: expectedResolvedArgCountMap[checkName],
        },
      ];
    })
  );
  const passedCheckSet = new Set(report.passedChecks);
  const failedCheckSet = new Set(report.failedChecks);
  const expectedCheckStatusMap = Object.fromEntries(
    expectedAvailableChecks.map((checkName) => {
      const status = passedCheckSet.has(checkName)
        ? "passed"
        : failedCheckSet.has(checkName)
          ? "failed"
          : "skipped";
      return [checkName, status];
    })
  );
  const expectedCheckStatusCountMap = {
    passed: report.passedCheckCount,
    failed: report.failedCheckCount,
    skipped: expectedAvailableChecks.length - report.totalChecks,
  };

  expect(report.selectedCheckMetadata).toEqual(expectedSelectedMetadata);
  expect(report.selectedCheckMetadataCount).toBe(
    Object.keys(report.selectedCheckMetadata).length
  );
  expect(report.selectedCheckScripts).toEqual(expectedSelectedScripts);
  expect(report.selectedCheckScriptMap).toEqual(expectedSelectedScriptMap);
  expect(report.selectedCheckCommandMap).toEqual(expectedSelectedCheckCommandMap);
  expect(report.selectedCheckCommandMapCount).toBe(
    Object.keys(report.selectedCheckCommandMap).length
  );
  expect(report.selectedCheckArgsMap).toEqual(expectedSelectedCheckArgsMap);
  expect(report.selectedCheckArgsMapCount).toBe(
    Object.keys(report.selectedCheckArgsMap).length
  );
  expect(report.selectedCheckArgCountMap).toEqual(expectedSelectedCheckArgCountMap);
  expect(report.selectedCheckArgCountMapCount).toBe(
    Object.keys(report.selectedCheckArgCountMap).length
  );
  expect(report.selectedCheckIndices).toEqual(expectedSelectedIndices);
  expect(report.selectedCheckIndexCount).toBe(report.selectedCheckIndices.length);
  expect(report.selectedCheckScriptMapCount).toBe(
    Object.keys(report.selectedCheckScriptMap).length
  );
  expect(report.selectedCheckIndexMap).toEqual(expectedSelectedIndexMap);
  expect(report.selectedCheckIndexMapCount).toBe(
    Object.keys(report.selectedCheckIndexMap).length
  );
  expect(report.selectedCheckScriptCount).toBe(report.selectedCheckScripts.length);
  expect(report.skippedCheckMetadata).toEqual(expectedSkippedMetadata);
  expect(report.skippedCheckMetadataCount).toBe(
    Object.keys(report.skippedCheckMetadata).length
  );
  expect(report.skippedCheckScripts).toEqual(expectedSkippedScripts);
  expect(report.skippedCheckScriptMap).toEqual(expectedSkippedScriptMap);
  expect(report.skippedCheckCommandMap).toEqual(expectedSkippedCheckCommandMap);
  expect(report.skippedCheckCommandMapCount).toBe(
    Object.keys(report.skippedCheckCommandMap).length
  );
  expect(report.skippedCheckArgsMap).toEqual(expectedSkippedCheckArgsMap);
  expect(report.skippedCheckArgsMapCount).toBe(
    Object.keys(report.skippedCheckArgsMap).length
  );
  expect(report.skippedCheckArgCountMap).toEqual(expectedSkippedCheckArgCountMap);
  expect(report.skippedCheckArgCountMapCount).toBe(
    Object.keys(report.skippedCheckArgCountMap).length
  );
  expect(report.availableCheckCommandMapCount).toBe(
    report.selectedCheckCommandMapCount + report.skippedCheckCommandMapCount
  );
  expect(report.availableCheckArgsMapCount).toBe(
    report.selectedCheckArgsMapCount + report.skippedCheckArgsMapCount
  );
  expect(report.availableCheckArgCountMapCount).toBe(
    report.selectedCheckArgCountMapCount + report.skippedCheckArgCountMapCount
  );
  expect(report.skippedCheckIndices).toEqual(expectedSkippedIndices);
  expect(report.skippedCheckIndexCount).toBe(report.skippedCheckIndices.length);
  expect(report.skippedCheckScriptMapCount).toBe(
    Object.keys(report.skippedCheckScriptMap).length
  );
  expect(report.skippedCheckIndexMap).toEqual(expectedSkippedIndexMap);
  expect(report.skippedCheckIndexMapCount).toBe(
    Object.keys(report.skippedCheckIndexMap).length
  );
  expect(report.skippedCheckScriptCount).toBe(report.skippedCheckScripts.length);
  expect(report.requestedCheckResolvedChecks).toEqual(expectedResolvedChecks);
  expect(report.requestedCheckResolvedCheckCount).toBe(
    report.requestedCheckResolvedChecks.length
  );
  expect(report.requestedCheckResolvedScripts).toEqual(expectedResolvedScripts);
  expect(report.requestedCheckResolvedScriptCount).toBe(
    report.requestedCheckResolvedScripts.length
  );
  expect(report.requestedCheckResolvedScriptMap).toEqual(expectedResolvedScriptMap);
  expect(report.requestedCheckResolvedScriptMapCount).toBe(
    Object.keys(report.requestedCheckResolvedScriptMap).length
  );
  expect(report.requestedCheckResolvedCommandMap).toEqual(
    expectedResolvedCommandMap
  );
  expect(report.requestedCheckResolvedCommandMapCount).toBe(
    Object.keys(report.requestedCheckResolvedCommandMap).length
  );
  expect(report.requestedCheckResolvedArgsMap).toEqual(expectedResolvedArgsMap);
  expect(report.requestedCheckResolvedArgsMapCount).toBe(
    Object.keys(report.requestedCheckResolvedArgsMap).length
  );
  expect(report.requestedCheckResolvedArgCountMap).toEqual(
    expectedResolvedArgCountMap
  );
  expect(report.requestedCheckResolvedArgCountMapCount).toBe(
    Object.keys(report.requestedCheckResolvedArgCountMap).length
  );
  expect(report.requestedCheckResolvedSupportsNoBuildMap).toEqual(
    expectedResolvedSupportsNoBuildMap
  );
  expect(report.requestedCheckResolvedSupportsNoBuildMapCount).toBe(
    Object.keys(report.requestedCheckResolvedSupportsNoBuildMap).length
  );
  expect(report.requestedCheckResolvedIndices).toEqual(expectedResolvedIndices);
  expect(report.requestedCheckResolvedIndexCount).toBe(
    report.requestedCheckResolvedIndices.length
  );
  expect(report.requestedCheckResolvedIndexMap).toEqual(expectedResolvedIndexMap);
  expect(report.requestedCheckResolvedIndexMapCount).toBe(
    Object.keys(report.requestedCheckResolvedIndexMap).length
  );
  expect(report.requestedCheckResolvedMetadata).toEqual(expectedResolvedMetadata);
  expect(report.requestedCheckResolvedMetadataCount).toBe(
    Object.keys(report.requestedCheckResolvedMetadata).length
  );
  expect(report.requestedCheckResolvedMetadataCount).toBe(
    report.requestedCheckResolvedCommandMapCount
  );
  expect(report.requestedCheckResolvedMetadataCount).toBe(
    report.requestedCheckResolvedArgsMapCount
  );
  expect(report.requestedCheckResolvedMetadataCount).toBe(
    report.requestedCheckResolvedArgCountMapCount
  );
  expect(report.checkStatusMap).toEqual(expectedCheckStatusMap);
  expect(report.checkStatusMapCount).toBe(Object.keys(report.checkStatusMap).length);
  expect(report.checkStatusCountMap).toEqual(expectedCheckStatusCountMap);
  expect(report.checkStatusCountMapCount).toBe(
    Object.keys(report.checkStatusCountMap).length
  );
};
const expectCheckResultScriptMetadata = (report: PreflightReport) => {
  const expectedPassedScripts = report.passedChecks.map((checkName) => {
    return expectedAvailableCheckMetadata[
      checkName as keyof typeof expectedAvailableCheckMetadata
    ].scriptName;
  });
  const expectedFailedScripts = report.failedChecks.map((checkName) => {
    return expectedAvailableCheckMetadata[
      checkName as keyof typeof expectedAvailableCheckMetadata
    ].scriptName;
  });
  const expectedPassedScriptMap = Object.fromEntries(
    report.passedChecks.map((checkName, index) => {
      return [checkName, expectedPassedScripts[index]];
    })
  );
  const expectedFailedScriptMap = Object.fromEntries(
    report.failedChecks.map((checkName, index) => {
      return [checkName, expectedFailedScripts[index]];
    })
  );
  const expectedPassedIndices = report.passedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedFailedIndices = report.failedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedPassedIndexMap = Object.fromEntries(
    report.passedChecks.map((checkName, index) => {
      return [checkName, expectedPassedIndices[index]];
    })
  );
  const expectedFailedIndexMap = Object.fromEntries(
    report.failedChecks.map((checkName, index) => {
      return [checkName, expectedFailedIndices[index]];
    })
  );
  const expectedPassedCheckCommandMap = Object.fromEntries(
    report.passedChecks.map((checkName) => {
      return [checkName, report.checkCommandMap[checkName]];
    })
  );
  const expectedPassedCheckArgsMap = Object.fromEntries(
    report.passedChecks.map((checkName) => {
      return [checkName, report.checkArgsMap[checkName]];
    })
  );
  const expectedPassedCheckArgCountMap = Object.fromEntries(
    report.passedChecks.map((checkName) => {
      return [checkName, report.checkArgCountMap[checkName]];
    })
  );
  const expectedFailedCheckCommandMap = Object.fromEntries(
    report.failedChecks.map((checkName) => {
      return [checkName, report.checkCommandMap[checkName]];
    })
  );
  const expectedFailedCheckArgsMap = Object.fromEntries(
    report.failedChecks.map((checkName) => {
      return [checkName, report.checkArgsMap[checkName]];
    })
  );
  const expectedFailedCheckArgCountMap = Object.fromEntries(
    report.failedChecks.map((checkName) => {
      return [checkName, report.checkArgCountMap[checkName]];
    })
  );
  const expectedPassedMetadata = Object.fromEntries(
    report.passedChecks.map((checkName) => {
      return [
        checkName,
        {
          ...expectedAvailableCheckMetadata[
            checkName as keyof typeof expectedAvailableCheckMetadata
          ],
          checkCommand: expectedPassedCheckCommandMap[checkName],
          checkArgs: expectedPassedCheckArgsMap[checkName],
          checkArgCount: expectedPassedCheckArgCountMap[checkName],
        },
      ];
    })
  );
  const expectedFailedMetadata = Object.fromEntries(
    report.failedChecks.map((checkName) => {
      return [
        checkName,
        {
          ...expectedAvailableCheckMetadata[
            checkName as keyof typeof expectedAvailableCheckMetadata
          ],
          checkCommand: expectedFailedCheckCommandMap[checkName],
          checkArgs: expectedFailedCheckArgsMap[checkName],
          checkArgCount: expectedFailedCheckArgCountMap[checkName],
        },
      ];
    })
  );
  const expectedCheckCommandMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.name, check.checkCommand];
    })
  );
  const expectedCheckArgsMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.name, check.checkArgs];
    })
  );
  const expectedCheckArgCountMap = Object.fromEntries(
    report.checks.map((check) => {
      return [check.name, check.checkArgCount];
    })
  );
  const passedCheckSet = new Set(report.passedChecks);
  const failedCheckSet = new Set(report.failedChecks);
  const expectedCheckStatusMap = Object.fromEntries(
    expectedAvailableChecks.map((checkName) => {
      const status = passedCheckSet.has(checkName)
        ? "passed"
        : failedCheckSet.has(checkName)
          ? "failed"
          : "skipped";
      return [checkName, status];
    })
  );
  const expectedCheckStatusCountMap = {
    passed: report.passedCheckCount,
    failed: report.failedCheckCount,
    skipped: expectedAvailableChecks.length - report.totalChecks,
  };

  expect(report.passedCheckScripts).toEqual(expectedPassedScripts);
  expect(report.passedCheckScriptCount).toBe(report.passedCheckScripts.length);
  expect(report.passedCheckScriptMap).toEqual(expectedPassedScriptMap);
  expect(report.passedCheckScriptMapCount).toBe(
    Object.keys(report.passedCheckScriptMap).length
  );
  expect(report.passedCheckCommandMap).toEqual(expectedPassedCheckCommandMap);
  expect(report.passedCheckCommandMapCount).toBe(
    Object.keys(report.passedCheckCommandMap).length
  );
  expect(report.passedCheckArgsMap).toEqual(expectedPassedCheckArgsMap);
  expect(report.passedCheckArgsMapCount).toBe(
    Object.keys(report.passedCheckArgsMap).length
  );
  expect(report.passedCheckArgCountMap).toEqual(expectedPassedCheckArgCountMap);
  expect(report.passedCheckArgCountMapCount).toBe(
    Object.keys(report.passedCheckArgCountMap).length
  );
  expect(report.passedCheckMetadata).toEqual(expectedPassedMetadata);
  expect(report.passedCheckMetadataCount).toBe(
    Object.keys(report.passedCheckMetadata).length
  );
  expect(report.passedCheckIndices).toEqual(expectedPassedIndices);
  expect(report.passedCheckIndexCount).toBe(report.passedCheckIndices.length);
  expect(report.passedCheckIndexMap).toEqual(expectedPassedIndexMap);
  expect(report.passedCheckIndexMapCount).toBe(
    Object.keys(report.passedCheckIndexMap).length
  );
  expect(report.failedCheckScripts).toEqual(expectedFailedScripts);
  expect(report.failedCheckScriptCount).toBe(report.failedCheckScripts.length);
  expect(report.failedCheckScriptMap).toEqual(expectedFailedScriptMap);
  expect(report.failedCheckScriptMapCount).toBe(
    Object.keys(report.failedCheckScriptMap).length
  );
  expect(report.failedCheckCommandMap).toEqual(expectedFailedCheckCommandMap);
  expect(report.failedCheckCommandMapCount).toBe(
    Object.keys(report.failedCheckCommandMap).length
  );
  expect(report.failedCheckArgsMap).toEqual(expectedFailedCheckArgsMap);
  expect(report.failedCheckArgsMapCount).toBe(
    Object.keys(report.failedCheckArgsMap).length
  );
  expect(report.failedCheckArgCountMap).toEqual(expectedFailedCheckArgCountMap);
  expect(report.failedCheckArgCountMapCount).toBe(
    Object.keys(report.failedCheckArgCountMap).length
  );
  expect(report.failedCheckMetadata).toEqual(expectedFailedMetadata);
  expect(report.failedCheckMetadataCount).toBe(
    Object.keys(report.failedCheckMetadata).length
  );
  expect(report.failedCheckIndices).toEqual(expectedFailedIndices);
  expect(report.failedCheckIndexCount).toBe(report.failedCheckIndices.length);
  expect(report.failedCheckIndexMap).toEqual(expectedFailedIndexMap);
  expect(report.failedCheckIndexMapCount).toBe(
    Object.keys(report.failedCheckIndexMap).length
  );
  expect(report.checkStatusMap).toEqual(expectedCheckStatusMap);
  expect(report.checkStatusMapCount).toBe(Object.keys(report.checkStatusMap).length);
  expect(report.checkStatusCountMap).toEqual(expectedCheckStatusCountMap);
  expect(report.checkStatusCountMapCount).toBe(
    Object.keys(report.checkStatusCountMap).length
  );
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
  expect(report.checkCommandMapCount).toBe(
    report.passedCheckCommandMapCount + report.failedCheckCommandMapCount
  );
  expect(report.checkArgsMapCount).toBe(
    report.passedCheckArgsMapCount + report.failedCheckArgsMapCount
  );
  expect(report.checkArgCountMapCount).toBe(
    report.passedCheckArgCountMapCount + report.failedCheckArgCountMapCount
  );
  for (const check of report.checks) {
    expect(check.scriptName).toBe(
      expectedAvailableCheckMetadata[
        check.name as keyof typeof expectedAvailableCheckMetadata
      ].scriptName
    );
    expect(check.supportsNoBuild).toBe(
      expectedAvailableCheckMetadata[
        check.name as keyof typeof expectedAvailableCheckMetadata
      ].supportsNoBuild
    );
    expect(check.checkCommand.length).toBeGreaterThan(0);
    expect(check.checkArgCount).toBe(check.checkArgs.length);
    expect(check.checkIndex).toBe(expectedAvailableChecks.indexOf(check.name));
  }
  expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
  expect(report.failureSummaries.map((entry) => entry.name).sort()).toEqual(
    report.failedChecks.slice().sort()
  );
  const failedChecksByName = new Map(
    report.checks
      .filter((check) => {
        return check.passed === false;
      })
      .map((check) => {
        return [check.name, check];
      })
  );
  for (const entry of report.failureSummaries) {
    const failedCheck = failedChecksByName.get(entry.name);
    expect(failedCheck).toBeDefined();
    if (failedCheck === undefined) {
      throw new Error(`Missing failed check entry for ${entry.name}.`);
    }
    expect(entry.scriptName).toBe(
      expectedAvailableCheckMetadata[
        entry.name as keyof typeof expectedAvailableCheckMetadata
      ].scriptName
    );
    expect(entry.supportsNoBuild).toBe(
      expectedAvailableCheckMetadata[
        entry.name as keyof typeof expectedAvailableCheckMetadata
      ].supportsNoBuild
    );
    expect(entry.checkIndex).toBe(expectedAvailableChecks.indexOf(entry.name));
    expect(entry.scriptName).toBe(failedCheck.scriptName);
    expect(entry.supportsNoBuild).toBe(failedCheck.supportsNoBuild);
    expect(entry.checkIndex).toBe(failedCheck.checkIndex);
    expect(entry.checkCommand).toBe(failedCheck.checkCommand);
    expect(entry.checkArgs).toEqual(failedCheck.checkArgs);
    expect(entry.checkArgCount).toBe(failedCheck.checkArgCount);
    expect(entry.exitCode).toBe(failedCheck.exitCode);
    expect(entry.message.length).toBeGreaterThan(0);
  }
  expectPreflightTsCoreExampleSummaryMetadata(report);
  expectPreflightClientWasmSummaryMetadata(report);
};
const expectAvailableCheckMetadataCoreFields = (report: PreflightReport) => {
  expect(
    Object.fromEntries(
      expectedAvailableChecks.map((checkName) => {
        return [
          checkName,
          {
            scriptName: report.availableCheckMetadata[checkName].scriptName,
            supportsNoBuild: report.availableCheckMetadata[checkName].supportsNoBuild,
          },
        ];
      })
    )
  ).toEqual(expectedAvailableCheckMetadata);
  for (const checkName of expectedAvailableChecks) {
    expect(report.availableCheckMetadata[checkName].checkCommand.length).toBeGreaterThan(
      0
    );
    expect(report.availableCheckMetadata[checkName].checkArgCount).toBe(
      report.availableCheckMetadata[checkName].checkArgs.length
    );
  }
};
const expectAvailableCheckInventoryMetadata = (report: PreflightReport) => {
  expect(report.availableChecks).toEqual(expectedAvailableChecks);
  expect(report.availableCheckScripts).toEqual(expectedAvailableCheckScripts);
  expect(report.availableCheckScriptCount).toBe(report.availableCheckScripts.length);
  expect(report.availableCheckScriptMap).toEqual(expectedAvailableCheckScriptMap);
  expect(report.availableCheckScriptMapCount).toBe(
    Object.keys(report.availableCheckScriptMap).length
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
  for (const checkName of report.availableChecks) {
    expect(report.availableCheckCommandMap[checkName]?.length).toBeGreaterThan(0);
    const checkArgs = report.availableCheckArgsMap[checkName];
    expect(Array.isArray(checkArgs)).toBe(true);
    expect(checkArgs.length).toBe(report.availableCheckArgCountMap[checkName]);
  }
  expect(report.availableCheckSupportsNoBuildMap).toEqual(
    expectedAvailableCheckSupportsNoBuildMap
  );
  expect(report.availableCheckSupportsNoBuildMapCount).toBe(
    Object.keys(report.availableCheckSupportsNoBuildMap).length
  );
  expect(report.availableCheckIndices).toEqual(expectedAvailableCheckIndices);
  expect(report.availableCheckIndexCount).toBe(
    report.availableCheckIndices.length
  );
  expect(report.availableCheckIndexMap).toEqual(expectedAvailableCheckIndexMap);
  expect(report.availableCheckIndexMapCount).toBe(
    Object.keys(report.availableCheckIndexMap).length
  );
  const metadataFromMaps = Object.fromEntries(
    expectedAvailableChecks.map((checkName) => {
      return [
        checkName,
        {
          scriptName: report.availableCheckScriptMap[checkName],
          supportsNoBuild: report.availableCheckSupportsNoBuildMap[checkName],
          checkCommand: report.availableCheckCommandMap[checkName],
          checkArgs: report.availableCheckArgsMap[checkName],
          checkArgCount: report.availableCheckArgCountMap[checkName],
        },
      ];
    })
  );
  expect(report.availableCheckMetadata).toEqual(metadataFromMaps);
  expectAvailableCheckMetadataCoreFields(report);
  expect(report.availableCheckMetadataCount).toBe(
    Object.keys(report.availableCheckMetadata).length
  );
};
const expectPreflightTsCoreExampleSummaryMetadata = (report: PreflightReport) => {
  const tsCoreCheck = report.checks.find((check) => {
    return check.name === "tsCore";
  });
  if (
    tsCoreCheck === undefined ||
    tsCoreCheck.report === null ||
    typeof tsCoreCheck.report !== "object"
  ) {
    expect(report.tsCoreExampleCommand).toBeNull();
    expect(report.tsCoreExampleArgs).toBeNull();
    expect(report.tsCoreExampleArgCount).toBeNull();
    expect(report.tsCoreExampleAttempted).toBeNull();
    expect(report.tsCoreExampleStatus).toBeNull();
    expect(report.tsCoreExampleRuleMatched).toBeNull();
    expect(report.tsCoreExamplePayloadValid).toBeNull();
    expect(report.tsCoreExamplePayloadIssues).toBeNull();
    expect(report.tsCoreExamplePayloadIssueCount).toBeNull();
    expect(report.tsCoreExampleExitCode).toBeNull();
    expect(report.tsCoreExampleDurationMs).toBeNull();
    expect(report.tsCoreExampleOutputLine).toBeNull();
    return;
  }

  const tsCoreCheckReport = tsCoreCheck.report as TsCoreNestedReport;
  expect(report.tsCoreExampleCommand).toBe(tsCoreCheckReport.exampleCommand);
  expect(report.tsCoreExampleArgs).toEqual(tsCoreCheckReport.exampleArgs);
  expect(report.tsCoreExampleArgCount).toBe(tsCoreCheckReport.exampleArgCount);
  expect(report.tsCoreExampleAttempted).toBe(tsCoreCheckReport.exampleAttempted);
  expect(report.tsCoreExampleStatus).toBe(tsCoreCheckReport.exampleStatus);
  expect(report.tsCoreExampleRuleMatched).toBe(tsCoreCheckReport.exampleRuleMatched);
  expect(report.tsCoreExamplePayloadValid).toBe(tsCoreCheckReport.examplePayloadValid);
  expect(report.tsCoreExamplePayloadIssues).toEqual(
    tsCoreCheckReport.examplePayloadIssues
  );
  expect(report.tsCoreExamplePayloadIssueCount).toBe(
    tsCoreCheckReport.examplePayloadIssueCount
  );
  expect(report.tsCoreExampleExitCode).toBe(tsCoreCheckReport.exampleExitCode);
  expect(report.tsCoreExampleDurationMs).toBe(tsCoreCheckReport.exampleDurationMs);
  expect(report.tsCoreExampleOutputLine).toBe(tsCoreCheckReport.exampleOutputLine);
  if (report.tsCoreExampleArgs !== null && report.tsCoreExampleArgCount !== null) {
    expect(report.tsCoreExampleArgCount).toBe(report.tsCoreExampleArgs.length);
  }
  if (
    report.tsCoreExamplePayloadIssues !== null &&
    report.tsCoreExamplePayloadIssueCount !== null
  ) {
    expect(report.tsCoreExamplePayloadIssueCount).toBe(
      report.tsCoreExamplePayloadIssues.length
    );
  }
  if (report.tsCoreExamplePayloadValid === true) {
    expect(report.tsCoreExamplePayloadIssues).toEqual([]);
    expect(report.tsCoreExamplePayloadIssueCount).toBe(0);
  }
  if (report.tsCoreExamplePayloadValid === false) {
    expect(report.tsCoreExamplePayloadIssues).not.toBeNull();
    expect(report.tsCoreExamplePayloadIssueCount).not.toBeNull();
    if (
      report.tsCoreExamplePayloadIssues !== null &&
      report.tsCoreExamplePayloadIssueCount !== null
    ) {
      expect(report.tsCoreExamplePayloadIssueCount).toBeGreaterThan(0);
      expect(report.tsCoreExamplePayloadIssueCount).toBe(
        report.tsCoreExamplePayloadIssues.length
      );
    }
  }
  if (
    report.tsCoreExampleAttempted !== null &&
    report.tsCoreExampleAttempted === false
  ) {
    expect(report.tsCoreExampleStatus).toBe("skipped");
    expect(report.tsCoreExampleRuleMatched).toBeNull();
    expect(report.tsCoreExamplePayloadValid).toBeNull();
    expect(report.tsCoreExamplePayloadIssues).toBeNull();
    expect(report.tsCoreExamplePayloadIssueCount).toBeNull();
  }
};
const expectPreflightClientWasmSummaryMetadata = (report: PreflightReport) => {
  const clientCheck = report.checks.find((check) => {
    return check.name === "client";
  });
  if (
    clientCheck === undefined ||
    clientCheck.report === null ||
    typeof clientCheck.report !== "object"
  ) {
    expect(report.clientWasmPackCheckStatus).toBeNull();
    expect(report.clientWasmPackCheckCommand).toBeNull();
    expect(report.clientWasmPackCheckArgs).toBeNull();
    expect(report.clientWasmPackCheckArgCount).toBeNull();
    expect(report.clientWasmPackCheckExitCode).toBeNull();
    expect(report.clientWasmPackCheckOutputLine).toBeNull();
    return;
  }

  const clientCheckReport = clientCheck.report as ClientNestedReport;
  expect(report.clientWasmPackCheckStatus).toBe(clientCheckReport.wasmPackCheckStatus);
  expect(report.clientWasmPackCheckCommand).toBe(
    clientCheckReport.wasmPackCheckCommand
  );
  expect(report.clientWasmPackCheckArgs).toEqual(clientCheckReport.wasmPackCheckArgs);
  expect(report.clientWasmPackCheckArgCount).toBe(
    clientCheckReport.wasmPackCheckArgCount
  );
  expect(report.clientWasmPackCheckExitCode).toBe(
    clientCheckReport.wasmPackCheckExitCode
  );
  expect(report.clientWasmPackCheckOutputLine).toBe(
    clientCheckReport.wasmPackCheckOutputLine
  );
  if (
    report.clientWasmPackCheckArgs !== null &&
    report.clientWasmPackCheckArgCount !== null
  ) {
    expect(report.clientWasmPackCheckArgCount).toBe(
      report.clientWasmPackCheckArgs.length
    );
  }
};
const expectSelectorAndAliasMetadata = (report: PreflightReport) => {
  expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
  expect(report.availableCheckAliasCountMap).toEqual(
    expectedAvailableCheckAliasCountMap
  );
  expect(report.availableCheckAliasGroupCount).toBe(
    Object.keys(report.availableCheckAliases).length
  );
  expect(report.availableCheckAliasCountMapCount).toBe(
    Object.keys(report.availableCheckAliasCountMap).length
  );
  expect(report.availableCheckAliasTokenCount).toBe(
    Object.values(report.availableCheckAliases).reduce((count, aliases) => {
      return count + aliases.length;
    }, 0)
  );
  expect(report.availableSpecialCheckSelectors).toEqual(
    expectedAvailableSpecialCheckSelectors
  );
  expect(report.availableSpecialCheckSelectorCount).toBe(
    report.availableSpecialCheckSelectors.length
  );
  expect(report.availableSpecialCheckAliases).toEqual(
    expectedAvailableSpecialCheckAliases
  );
  expect(report.availableSpecialCheckAliasCountMap).toEqual(
    expectedAvailableSpecialCheckAliasCountMap
  );
  expect(report.availableSpecialCheckAliasGroupCount).toBe(
    Object.keys(report.availableSpecialCheckAliases).length
  );
  expect(report.availableSpecialCheckAliasCountMapCount).toBe(
    Object.keys(report.availableSpecialCheckAliasCountMap).length
  );
  expect(report.availableSpecialCheckAliasTokenCount).toBe(
    Object.values(report.availableSpecialCheckAliases).reduce(
      (count, aliases) => {
        return count + aliases.length;
      },
      0
    )
  );
  expect(report.availableSpecialSelectorResolvedChecks).toEqual(
    expectedAvailableSpecialSelectorResolvedChecks
  );
  expect(report.availableSpecialSelectorResolvedChecksCount).toBe(
    Object.keys(report.availableSpecialSelectorResolvedChecks).length
  );
  expect(report.availableSpecialSelectorResolvedCheckCountMap).toEqual(
    expectedAvailableSpecialSelectorResolvedCheckCountMap
  );
  expect(report.availableSpecialSelectorResolvedCheckCountMapCount).toBe(
    Object.keys(report.availableSpecialSelectorResolvedCheckCountMap).length
  );
  expect(report.requestedCheckResolutionKinds).toEqual(
    expectedRequestedCheckResolutionKinds
  );
  expect(report.requestedCheckResolutionKindCount).toBe(
    report.requestedCheckResolutionKinds.length
  );
  expect(report.requestedCheckResolutionCount).toBe(
    report.requestedCheckResolutions.length
  );
  expect(
    report.requestedCheckResolutionCounts.check +
      report.requestedCheckResolutionCounts.specialSelector +
      report.requestedCheckResolutionCounts.invalid
  ).toBe(report.requestedCheckResolutionCount);
  expectPreflightTsCoreExampleSummaryMetadata(report);
  expectPreflightClientWasmSummaryMetadata(report);
};
const expectDevEnvironmentNestedReport = (checkReport: object | null) => {
  expect(checkReport).not.toBeNull();
  if (checkReport === null) {
    return;
  }

  const report = checkReport as DevEnvironmentNestedReport;
  const expectedAvailableCheckIndexMap = Object.fromEntries(
    expectedDevEnvironmentAvailableChecks.map((checkLabel, index) => {
      return [checkLabel, index];
    })
  );

  expect(report.availableChecks).toEqual(expectedDevEnvironmentAvailableChecks);
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
  const mapCheckLabelsToValueMap = <T>(
    checkLabels: string[],
    checkValueMap: Record<string, T>,
    valueLabel: string
  ) => {
    return Object.fromEntries(
      checkLabels.map((checkLabel) => {
        const checkValue = checkValueMap[checkLabel];
        if (checkValue === undefined) {
          throw new Error(`Missing ${valueLabel} metadata for ${checkLabel}.`);
        }
        return [checkLabel, checkValue];
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
  const expectedRequiredCheckCommandMap = mapCheckLabelsToValueMap(
    expectedRequiredCheckLabels,
    expectedCheckCommandMap,
    "check command"
  );
  const expectedRequiredCheckArgsMap = mapCheckLabelsToValueMap(
    expectedRequiredCheckLabels,
    expectedCheckArgsMap,
    "check args"
  );
  const expectedRequiredCheckArgCountMap = mapCheckLabelsToValueMap(
    expectedRequiredCheckLabels,
    expectedCheckArgCountMap,
    "check argument count"
  );
  const expectedOptionalCheckCommandMap = mapCheckLabelsToValueMap(
    expectedOptionalCheckLabels,
    expectedCheckCommandMap,
    "check command"
  );
  const expectedOptionalCheckArgsMap = mapCheckLabelsToValueMap(
    expectedOptionalCheckLabels,
    expectedCheckArgsMap,
    "check args"
  );
  const expectedOptionalCheckArgCountMap = mapCheckLabelsToValueMap(
    expectedOptionalCheckLabels,
    expectedCheckArgCountMap,
    "check argument count"
  );
  const expectedPassedCheckCommandMap = mapCheckLabelsToValueMap(
    expectedPassedChecks,
    expectedCheckCommandMap,
    "check command"
  );
  const expectedPassedCheckArgsMap = mapCheckLabelsToValueMap(
    expectedPassedChecks,
    expectedCheckArgsMap,
    "check args"
  );
  const expectedPassedCheckArgCountMap = mapCheckLabelsToValueMap(
    expectedPassedChecks,
    expectedCheckArgCountMap,
    "check argument count"
  );
  const expectedFailedCheckCommandMap = mapCheckLabelsToValueMap(
    expectedFailedChecks,
    expectedCheckCommandMap,
    "check command"
  );
  const expectedFailedCheckArgsMap = mapCheckLabelsToValueMap(
    expectedFailedChecks,
    expectedCheckArgsMap,
    "check args"
  );
  const expectedFailedCheckArgCountMap = mapCheckLabelsToValueMap(
    expectedFailedChecks,
    expectedCheckArgCountMap,
    "check argument count"
  );
  const expectedRequiredFailureCommandMap = mapCheckLabelsToValueMap(
    expectedRequiredFailureLabels,
    expectedCheckCommandMap,
    "check command"
  );
  const expectedRequiredFailureArgsMap = mapCheckLabelsToValueMap(
    expectedRequiredFailureLabels,
    expectedCheckArgsMap,
    "check args"
  );
  const expectedRequiredFailureArgCountMap = mapCheckLabelsToValueMap(
    expectedRequiredFailureLabels,
    expectedCheckArgCountMap,
    "check argument count"
  );
  const expectedOptionalFailureCommandMap = mapCheckLabelsToValueMap(
    expectedOptionalFailureLabels,
    expectedCheckCommandMap,
    "check command"
  );
  const expectedOptionalFailureArgsMap = mapCheckLabelsToValueMap(
    expectedOptionalFailureLabels,
    expectedCheckArgsMap,
    "check args"
  );
  const expectedOptionalFailureArgCountMap = mapCheckLabelsToValueMap(
    expectedOptionalFailureLabels,
    expectedCheckArgCountMap,
    "check argument count"
  );
  const expectedFailureSummaries = report.checks
    .filter((check) => {
      return check.status !== "ok";
    })
    .map((check) => {
      return {
        label: check.label,
        checkIndex: check.checkIndex,
        checkCommand: check.command,
        checkArgs: check.args,
        checkArgCount: check.args.length,
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
  expect(report.requiredCheckCommandMap).toEqual(expectedRequiredCheckCommandMap);
  expect(report.requiredCheckCommandMapCount).toBe(
    Object.keys(report.requiredCheckCommandMap).length
  );
  expect(report.requiredCheckArgsMap).toEqual(expectedRequiredCheckArgsMap);
  expect(report.requiredCheckArgsMapCount).toBe(
    Object.keys(report.requiredCheckArgsMap).length
  );
  expect(report.requiredCheckArgCountMap).toEqual(
    expectedRequiredCheckArgCountMap
  );
  expect(report.requiredCheckArgCountMapCount).toBe(
    Object.keys(report.requiredCheckArgCountMap).length
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
  expect(report.optionalCheckCommandMap).toEqual(expectedOptionalCheckCommandMap);
  expect(report.optionalCheckCommandMapCount).toBe(
    Object.keys(report.optionalCheckCommandMap).length
  );
  expect(report.optionalCheckArgsMap).toEqual(expectedOptionalCheckArgsMap);
  expect(report.optionalCheckArgsMapCount).toBe(
    Object.keys(report.optionalCheckArgsMap).length
  );
  expect(report.optionalCheckArgCountMap).toEqual(
    expectedOptionalCheckArgCountMap
  );
  expect(report.optionalCheckArgCountMapCount).toBe(
    Object.keys(report.optionalCheckArgCountMap).length
  );
  expect(report.passedChecks).toEqual(expectedPassedChecks);
  expect(report.passedCheckCount).toBe(report.passedChecks.length);
  expect(report.passedCheckIndices).toEqual(expectedPassedCheckIndices);
  expect(report.passedCheckIndexCount).toBe(report.passedCheckIndices.length);
  expect(report.passedCheckIndexMap).toEqual(expectedPassedCheckIndexMap);
  expect(report.passedCheckIndexMapCount).toBe(
    Object.keys(report.passedCheckIndexMap).length
  );
  expect(report.passedCheckCommandMap).toEqual(expectedPassedCheckCommandMap);
  expect(report.passedCheckCommandMapCount).toBe(
    Object.keys(report.passedCheckCommandMap).length
  );
  expect(report.passedCheckArgsMap).toEqual(expectedPassedCheckArgsMap);
  expect(report.passedCheckArgsMapCount).toBe(
    Object.keys(report.passedCheckArgsMap).length
  );
  expect(report.passedCheckArgCountMap).toEqual(expectedPassedCheckArgCountMap);
  expect(report.passedCheckArgCountMapCount).toBe(
    Object.keys(report.passedCheckArgCountMap).length
  );
  expect(report.failedChecks).toEqual(expectedFailedChecks);
  expect(report.failedCheckCount).toBe(report.failedChecks.length);
  expect(report.failedCheckIndices).toEqual(expectedFailedCheckIndices);
  expect(report.failedCheckIndexCount).toBe(report.failedCheckIndices.length);
  expect(report.failedCheckIndexMap).toEqual(expectedFailedCheckIndexMap);
  expect(report.failedCheckIndexMapCount).toBe(
    Object.keys(report.failedCheckIndexMap).length
  );
  expect(report.failedCheckCommandMap).toEqual(expectedFailedCheckCommandMap);
  expect(report.failedCheckCommandMapCount).toBe(
    Object.keys(report.failedCheckCommandMap).length
  );
  expect(report.failedCheckArgsMap).toEqual(expectedFailedCheckArgsMap);
  expect(report.failedCheckArgsMapCount).toBe(
    Object.keys(report.failedCheckArgsMap).length
  );
  expect(report.failedCheckArgCountMap).toEqual(expectedFailedCheckArgCountMap);
  expect(report.failedCheckArgCountMapCount).toBe(
    Object.keys(report.failedCheckArgCountMap).length
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
  expect(report.requiredFailureCommandMap).toEqual(
    expectedRequiredFailureCommandMap
  );
  expect(report.requiredFailureCommandMapCount).toBe(
    Object.keys(report.requiredFailureCommandMap).length
  );
  expect(report.requiredFailureArgsMap).toEqual(expectedRequiredFailureArgsMap);
  expect(report.requiredFailureArgsMapCount).toBe(
    Object.keys(report.requiredFailureArgsMap).length
  );
  expect(report.requiredFailureArgCountMap).toEqual(
    expectedRequiredFailureArgCountMap
  );
  expect(report.requiredFailureArgCountMapCount).toBe(
    Object.keys(report.requiredFailureArgCountMap).length
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
  expect(report.optionalFailureCommandMap).toEqual(
    expectedOptionalFailureCommandMap
  );
  expect(report.optionalFailureCommandMapCount).toBe(
    Object.keys(report.optionalFailureCommandMap).length
  );
  expect(report.optionalFailureArgsMap).toEqual(expectedOptionalFailureArgsMap);
  expect(report.optionalFailureArgsMapCount).toBe(
    Object.keys(report.optionalFailureArgsMap).length
  );
  expect(report.optionalFailureArgCountMap).toEqual(
    expectedOptionalFailureArgCountMap
  );
  expect(report.optionalFailureArgCountMapCount).toBe(
    Object.keys(report.optionalFailureArgCountMap).length
  );
  expect(report.checkCommandMapCount).toBe(
    report.passedCheckCommandMapCount + report.failedCheckCommandMapCount
  );
  expect(report.checkArgsMapCount).toBe(
    report.passedCheckArgsMapCount + report.failedCheckArgsMapCount
  );
  expect(report.checkArgCountMapCount).toBe(
    report.passedCheckArgCountMapCount + report.failedCheckArgCountMapCount
  );
  expect(report.checkCommandMapCount).toBe(
    report.requiredCheckCommandMapCount + report.optionalCheckCommandMapCount
  );
  expect(report.checkArgsMapCount).toBe(
    report.requiredCheckArgsMapCount + report.optionalCheckArgsMapCount
  );
  expect(report.checkArgCountMapCount).toBe(
    report.requiredCheckArgCountMapCount + report.optionalCheckArgCountMapCount
  );
  expect(report.failedCheckCommandMapCount).toBe(
    report.requiredFailureCommandMapCount + report.optionalFailureCommandMapCount
  );
  expect(report.failedCheckArgsMapCount).toBe(
    report.requiredFailureArgsMapCount + report.optionalFailureArgsMapCount
  );
  expect(report.failedCheckArgCountMapCount).toBe(
    report.requiredFailureArgCountMapCount + report.optionalFailureArgCountMapCount
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
const expectWasmPackNestedReport = (checkReport: object | null) => {
  expect(checkReport).not.toBeNull();
  if (checkReport === null) {
    return;
  }

  const report = checkReport as WasmPackNestedReport;
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
  const expectedAvailableCheckIndices = [0];
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

  expect(report.availableChecks).toEqual(expectedWasmPackAvailableChecks);
  expect(report.availableCheckCount).toBe(report.availableChecks.length);
  expect(report.availableCheckIndices).toEqual(expectedAvailableCheckIndices);
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
  expect(report.availableCheckIndexMap).toEqual(expectedAvailableCheckIndexMap);
  expect(report.availableCheckIndexMapCount).toBe(
    Object.keys(report.availableCheckIndexMap).length
  );
  expect(report.availableCheckIndexCount).toBe(report.availableCheckIndexMapCount);
  expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
  expect(report.availableCheckMetadataCount).toBe(
    Object.keys(report.availableCheckMetadata).length
  );
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
const expectClientNestedReport = (checkReport: object | null) => {
  expect(checkReport).not.toBeNull();
  if (checkReport === null) {
    return;
  }

  const report = checkReport as ClientNestedReport;
  const expectedAvailableStepScriptMap = Object.fromEntries(
    expectedClientAvailableSteps.map((stepName) => {
      return [stepName, expectedClientAvailableStepMetadata[stepName].scriptName];
    })
  );
  const expectedAvailableStepSupportsNoBuildMap = Object.fromEntries(
    expectedClientAvailableSteps.map((stepName) => {
      return [
        stepName,
        expectedClientAvailableStepMetadata[stepName].supportsNoBuild,
      ];
    })
  );
  const expectedAvailableStepCheckCommandMap = Object.fromEntries(
    expectedClientAvailableSteps.map((stepName) => {
      return [stepName, report.availableStepMetadata[stepName].checkCommand];
    })
  );
  const expectedAvailableStepCheckArgsMap = Object.fromEntries(
    expectedClientAvailableSteps.map((stepName) => {
      return [stepName, report.availableStepMetadata[stepName].checkArgs];
    })
  );
  const expectedAvailableStepCheckArgCountMap = Object.fromEntries(
    expectedClientAvailableSteps.map((stepName) => {
      return [stepName, report.availableStepMetadata[stepName].checkArgCount];
    })
  );
  const expectedAvailableStepIndexMap = Object.fromEntries(
    expectedClientAvailableSteps.map((stepName, index) => {
      return [stepName, index];
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

  expect(report.availableSteps).toEqual(expectedClientAvailableSteps);
  expect(report.availableStepCount).toBe(report.availableSteps.length);
  expect(report.availableStepScriptMap).toEqual(expectedAvailableStepScriptMap);
  expect(report.availableStepScriptMapCount).toBe(
    Object.keys(report.availableStepScriptMap).length
  );
  expect(report.availableStepCheckCommandMap).toEqual(
    expectedAvailableStepCheckCommandMap
  );
  expect(report.availableStepCheckCommandMapCount).toBe(
    Object.keys(report.availableStepCheckCommandMap).length
  );
  expect(report.availableStepCheckArgsMap).toEqual(expectedAvailableStepCheckArgsMap);
  expect(report.availableStepCheckArgsMapCount).toBe(
    Object.keys(report.availableStepCheckArgsMap).length
  );
  expect(report.availableStepCheckArgCountMap).toEqual(
    expectedAvailableStepCheckArgCountMap
  );
  expect(report.availableStepCheckArgCountMapCount).toBe(
    Object.keys(report.availableStepCheckArgCountMap).length
  );
  expect(report.availableStepSupportsNoBuildMap).toEqual(
    expectedAvailableStepSupportsNoBuildMap
  );
  expect(report.availableStepSupportsNoBuildMapCount).toBe(
    Object.keys(report.availableStepSupportsNoBuildMap).length
  );
  expect(report.availableStepIndexMap).toEqual(expectedAvailableStepIndexMap);
  expect(report.availableStepIndexMapCount).toBe(
    Object.keys(report.availableStepIndexMap).length
  );
  expect(report.availableStepMetadata).toEqual(
    Object.fromEntries(
      expectedClientAvailableSteps.map((stepName) => {
        return [
          stepName,
          {
            scriptName: report.availableStepScriptMap[stepName],
            supportsNoBuild: report.availableStepSupportsNoBuildMap[stepName],
            checkCommand: report.availableStepCheckCommandMap[stepName],
            checkArgs: report.availableStepCheckArgsMap[stepName],
            checkArgCount: report.availableStepCheckArgCountMap[stepName],
          },
        ];
      })
    )
  );
  expect(
    Object.fromEntries(
      expectedClientAvailableSteps.map((stepName) => {
        return [
          stepName,
          {
            scriptName: report.availableStepMetadata[stepName].scriptName,
            supportsNoBuild: report.availableStepMetadata[stepName].supportsNoBuild,
          },
        ];
      })
    )
  ).toEqual(expectedClientAvailableStepMetadata);
  expect(report.availableStepMetadataCount).toBe(
    Object.keys(report.availableStepMetadata).length
  );
  for (const step of report.steps) {
    expect(step.checkCommand.length).toBeGreaterThan(0);
    expect(step.checkArgCount).toBe(step.checkArgs.length);
  }
  const wasmArtifactStep = report.steps.find((step) => {
    return step.name === "WASM artifact preflight";
  });
  expect(wasmArtifactStep).toBeDefined();
  if (
    wasmArtifactStep === undefined ||
    wasmArtifactStep.report === null ||
    typeof wasmArtifactStep.report !== "object"
  ) {
    expect(report.wasmPackCheckStatus).toBeNull();
    expect(report.wasmPackCheckCommand).toBeNull();
    expect(report.wasmPackCheckArgs).toBeNull();
    expect(report.wasmPackCheckArgCount).toBeNull();
    expect(report.wasmPackCheckExitCode).toBeNull();
    expect(report.wasmPackCheckOutputLine).toBeNull();
  } else {
    expect(report.wasmPackCheckStatus).toBe(wasmArtifactStep.report.wasmPackCheckStatus);
    expect(report.wasmPackCheckCommand).toBe(wasmArtifactStep.report.wasmPackCheckCommand);
    expect(report.wasmPackCheckArgs).toEqual(wasmArtifactStep.report.wasmPackCheckArgs);
    expect(report.wasmPackCheckArgCount).toBe(wasmArtifactStep.report.wasmPackCheckArgCount);
    expect(report.wasmPackCheckExitCode).toBe(wasmArtifactStep.report.wasmPackCheckExitCode);
    expect(report.wasmPackCheckOutputLine).toBe(
      wasmArtifactStep.report.wasmPackCheckOutputLine
    );
    if (report.wasmPackCheckArgs !== null && report.wasmPackCheckArgCount !== null) {
      expect(report.wasmPackCheckArgCount).toBe(report.wasmPackCheckArgs.length);
    }

    expect(wasmArtifactStep.report.schemaVersion).toBe(1);
    expect(wasmArtifactStep.report.artifactPath).toBe(
      "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js"
    );
    expect(wasmArtifactStep.report.outputPath).toBeNull();
    expect(wasmArtifactStep.report.wasmPackCheckCommand).toBe(process.execPath);
    expect(wasmArtifactStep.report.wasmPackCheckArgs).toEqual([
      rootWasmPackCheckScript,
      "--json",
      "--compact",
    ]);
    expect(wasmArtifactStep.report.wasmPackCheckArgCount).toBe(
      wasmArtifactStep.report.wasmPackCheckArgs.length
    );
    expect(wasmArtifactStep.report.wasmPackCheckArgCount).toBe(3);
    if (wasmArtifactStep.report.wasmPackCheckExitCode === null) {
      expect(wasmArtifactStep.report.wasmPackCheckStatus).toBe("skipped");
      expect(wasmArtifactStep.report.wasmPackCheckOutputLine).toBeNull();
      expect(wasmArtifactStep.report.wasmPackCheckReport).toBeNull();
    } else {
      if (wasmArtifactStep.report.wasmPackCheckReport !== null) {
        expect(wasmArtifactStep.report.wasmPackCheckStatus).toBe(
          wasmArtifactStep.report.wasmPackCheckReport.checkStatusMap["wasm-pack"]
        );
      } else {
        expect(wasmArtifactStep.report.wasmPackCheckStatus).toBe(
          wasmArtifactStep.report.wasmPackCheckExitCode === 0 ? "ok" : "unavailable"
        );
      }
      if (wasmArtifactStep.report.wasmPackCheckOutputLine !== null) {
        expect(wasmArtifactStep.report.wasmPackCheckOutputLine.length).toBeGreaterThan(0);
      }
      if (wasmArtifactStep.report.wasmPackCheckReport !== null) {
        expect(wasmArtifactStep.report.wasmPackCheckExitCode).toBe(
          wasmArtifactStep.report.wasmPackCheckReport.exitCode
        );
        expectWasmPackNestedReport(wasmArtifactStep.report.wasmPackCheckReport);
      }
    }
  }
  expect(report.totalSteps).toBe(report.steps.length);
  expect(report.passedSteps.length).toBe(report.passedStepCount);
  expect(report.failedSteps.length).toBe(report.failedStepCount);
  expect(report.skippedSteps.length).toBe(report.skippedStepCount);
  const expectedStepCheckCommandMap = Object.fromEntries(
    report.steps.map((step) => {
      return [step.name, step.checkCommand];
    })
  );
  const expectedStepCheckArgsMap = Object.fromEntries(
    report.steps.map((step) => {
      return [step.name, step.checkArgs];
    })
  );
  const expectedStepCheckArgCountMap = Object.fromEntries(
    report.steps.map((step) => {
      return [step.name, step.checkArgCount];
    })
  );
  const mapStepNamesToCheckCommandMap = (stepNames: string[]) => {
    return Object.fromEntries(
      stepNames.map((stepName) => {
        return [stepName, expectedStepCheckCommandMap[stepName]];
      })
    );
  };
  const mapStepNamesToCheckArgsMap = (stepNames: string[]) => {
    return Object.fromEntries(
      stepNames.map((stepName) => {
        return [stepName, expectedStepCheckArgsMap[stepName]];
      })
    );
  };
  const mapStepNamesToCheckArgCountMap = (stepNames: string[]) => {
    return Object.fromEntries(
      stepNames.map((stepName) => {
        return [stepName, expectedStepCheckArgCountMap[stepName]];
      })
    );
  };
  expect(report.stepCheckCommandMap).toEqual(expectedStepCheckCommandMap);
  expect(report.stepCheckCommandMapCount).toBe(
    Object.keys(report.stepCheckCommandMap).length
  );
  expect(report.stepCheckArgsMap).toEqual(expectedStepCheckArgsMap);
  expect(report.stepCheckArgsMapCount).toBe(
    Object.keys(report.stepCheckArgsMap).length
  );
  expect(report.stepCheckArgCountMap).toEqual(expectedStepCheckArgCountMap);
  expect(report.stepCheckArgCountMapCount).toBe(
    Object.keys(report.stepCheckArgCountMap).length
  );
  expect(report.passedStepCheckCommandMap).toEqual(
    mapStepNamesToCheckCommandMap(report.passedSteps)
  );
  expect(report.failedStepCheckCommandMap).toEqual(
    mapStepNamesToCheckCommandMap(report.failedSteps)
  );
  expect(report.skippedStepCheckCommandMap).toEqual(
    mapStepNamesToCheckCommandMap(report.skippedSteps)
  );
  expect(report.passedStepCheckArgsMap).toEqual(
    mapStepNamesToCheckArgsMap(report.passedSteps)
  );
  expect(report.failedStepCheckArgsMap).toEqual(
    mapStepNamesToCheckArgsMap(report.failedSteps)
  );
  expect(report.skippedStepCheckArgsMap).toEqual(
    mapStepNamesToCheckArgsMap(report.skippedSteps)
  );
  expect(report.passedStepCheckArgCountMap).toEqual(
    mapStepNamesToCheckArgCountMap(report.passedSteps)
  );
  expect(report.failedStepCheckArgCountMap).toEqual(
    mapStepNamesToCheckArgCountMap(report.failedSteps)
  );
  expect(report.skippedStepCheckArgCountMap).toEqual(
    mapStepNamesToCheckArgCountMap(report.skippedSteps)
  );
  expect(report.passedStepCheckCommandMapCount).toBe(
    Object.keys(report.passedStepCheckCommandMap).length
  );
  expect(report.failedStepCheckCommandMapCount).toBe(
    Object.keys(report.failedStepCheckCommandMap).length
  );
  expect(report.skippedStepCheckCommandMapCount).toBe(
    Object.keys(report.skippedStepCheckCommandMap).length
  );
  expect(report.passedStepCheckArgsMapCount).toBe(
    Object.keys(report.passedStepCheckArgsMap).length
  );
  expect(report.failedStepCheckArgsMapCount).toBe(
    Object.keys(report.failedStepCheckArgsMap).length
  );
  expect(report.skippedStepCheckArgsMapCount).toBe(
    Object.keys(report.skippedStepCheckArgsMap).length
  );
  expect(report.passedStepCheckArgCountMapCount).toBe(
    Object.keys(report.passedStepCheckArgCountMap).length
  );
  expect(report.failedStepCheckArgCountMapCount).toBe(
    Object.keys(report.failedStepCheckArgCountMap).length
  );
  expect(report.skippedStepCheckArgCountMapCount).toBe(
    Object.keys(report.skippedStepCheckArgCountMap).length
  );
  expect(report.stepCheckCommandMapCount).toBe(
    report.passedStepCheckCommandMapCount +
      report.failedStepCheckCommandMapCount +
      report.skippedStepCheckCommandMapCount
  );
  expect(report.stepCheckArgsMapCount).toBe(
    report.passedStepCheckArgsMapCount +
      report.failedStepCheckArgsMapCount +
      report.skippedStepCheckArgsMapCount
  );
  expect(report.stepCheckArgCountMapCount).toBe(
    report.passedStepCheckArgCountMapCount +
      report.failedStepCheckArgCountMapCount +
      report.skippedStepCheckArgCountMapCount
  );
  expect(report.stepStatusMap).toEqual(expectedStepStatusMap);
  expect(report.stepStatusMapCount).toBe(Object.keys(report.stepStatusMap).length);
  expect(report.stepStatusCountMap).toEqual({
    passed: report.passedStepCount,
    failed: report.failedStepCount,
    skipped: report.skippedStepCount,
  });
  expect(report.stepStatusCountMapCount).toBe(
    Object.keys(report.stepStatusCountMap).length
  );
};
const expectTsCoreNestedReport = (
  checkReport: object | null,
  expectedNoBuild: boolean
) => {
  expect(checkReport).not.toBeNull();
  if (checkReport === null) {
    return;
  }

  const report = checkReport as TsCoreNestedReport;
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
    [report.checkedPackage]: expectedTsCorePackageCheckCommand,
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
      checkCommand: expectedTsCorePackageCheckCommand,
      checkArgs: report.requiredArtifacts,
      checkArgCount: report.requiredArtifactCount,
      requiredArtifactCount: report.requiredArtifactCount,
    },
  });
  expect(report.availablePackageMetadataCount).toBe(
    Object.keys(report.availablePackageMetadata).length
  );
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
  expect(report.checkedPackageCount).toBe(
    report.presentPackageMetadataCount + report.missingPackageMetadataCount
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
  expect(report.presentArtifactsByPackageCount).toBe(
    report.presentPackageArtifactsByPackageCount +
      report.missingPackageArtifactsByPackageCount
  );
  expect(report.presentArtifactCountByPackageCount).toBe(
    report.presentPackageArtifactCountByPackageCount +
      report.missingPackageArtifactCountByPackageCount
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
        return [packageName, expectedTsCorePackageCheckCommand];
      })
    )
  );
  expect(report.presentPackageCheckCommandMapCount).toBe(
    Object.keys(report.presentPackageCheckCommandMap).length
  );
  expect(report.missingPackageCheckCommandMap).toEqual(
    Object.fromEntries(
      report.missingPackages.map((packageName) => {
        return [packageName, expectedTsCorePackageCheckCommand];
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
            checkCommand: expectedTsCorePackageCheckCommand,
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
            checkCommand: expectedTsCorePackageCheckCommand,
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
  const expectedFailureSummaries: TsCoreNestedReport["failureSummaries"] = [];
  if (report.missingArtifactCount > 0) {
    expectedFailureSummaries.push({
      kind: "artifacts",
      packageName: report.checkedPackage,
      packagePath: report.checkedPackagePath,
      packageIndex: report.checkedPackageIndices[0],
      checkCommand: expectedTsCorePackageCheckCommand,
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
      checkArgs: expectedTsCoreExampleArgs,
      checkArgCount: expectedTsCoreExampleArgs.length,
      exitCode: report.exampleExitCode,
      ruleMatched: report.exampleRuleMatched,
      payloadValid: report.examplePayloadValid,
      payloadIssues: report.examplePayloadIssues,
      payloadIssueCount: report.examplePayloadIssueCount,
      outputLine: report.exampleOutputLine,
      message: deriveExpectedTsCoreExampleFailureMessage(report),
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
  expect(report.buildArgs).toEqual(expectedTsCoreBuildArgs);
  expect(report.noBuild).toBe(expectedNoBuild);
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
  expect(report.exampleArgs).toEqual(expectedTsCoreExampleArgs);
  expect(report.exampleArgCount).toBe(report.exampleArgs.length);
  if (report.artifactsPresent) {
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
};
const expectRuntimeLibrariesNestedReport = (
  checkReport: object | null,
  expectedNoBuild: boolean
) => {
  expect(checkReport).not.toBeNull();
  if (checkReport === null) {
    return;
  }

  const report = checkReport as RuntimeLibrariesNestedReport;
  expect(report.packagesPresent).toBe(report.missingPackageCount === 0);
  expect(report.checkedPackages).toEqual(expectedRuntimeLibrariesCheckedPackages);
  expect(report.checkedPackagePaths).toEqual(
    expectedRuntimeLibrariesCheckedPackagePaths
  );
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
  expect(report.availablePackages).toEqual(report.checkedPackages);
  expect(report.availablePackageCount).toBe(report.availablePackages.length);
  expect(report.availablePackagePaths).toEqual(report.checkedPackagePaths);
  expect(report.availablePackagePathCount).toBe(
    report.availablePackagePaths.length
  );
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
  expect(report.availablePackageCheckCommandMap).toEqual(
    Object.fromEntries(
      report.checkedPackages.map((packageName) => {
        return [packageName, expectedRuntimeLibrariesPackageCheckCommand];
      })
    )
  );
  expect(report.availablePackageCheckCommandMapCount).toBe(
    Object.keys(report.availablePackageCheckCommandMap).length
  );
  expect(report.availablePackageCheckArgsMap).toEqual(
    report.requiredArtifactsByPackage
  );
  expect(report.availablePackageCheckArgsMapCount).toBe(
    Object.keys(report.availablePackageCheckArgsMap).length
  );
  expect(report.availablePackageCheckArgCountMap).toEqual(
    report.requiredArtifactCountByPackage
  );
  expect(report.availablePackageCheckArgCountMapCount).toBe(
    Object.keys(report.availablePackageCheckArgCountMap).length
  );
  expect(report.availablePackageMetadata).toEqual(
    Object.fromEntries(
      report.checkedPackages.map((packageName) => {
        return [
          packageName,
          {
            packageIndex: report.checkedPackageIndexMap[packageName],
            packagePath: report.checkedPackagePathMap[packageName],
            checkCommand: expectedRuntimeLibrariesPackageCheckCommand,
            checkArgs: report.requiredArtifactsByPackage[packageName],
            checkArgCount: report.requiredArtifactCountByPackage[packageName],
            requiredArtifactCount: report.requiredArtifactCountByPackage[packageName],
          },
        ];
      })
    )
  );
  expect(report.availablePackageMetadataCount).toBe(
    Object.keys(report.availablePackageMetadata).length
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
  const presentPackageCheckCommandMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkCommand];
      })
  );
  const presentPackageCheckArgsMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgs];
      })
  );
  const presentPackageCheckArgCountMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgCount];
      })
  );
  const presentPackageMetadata = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [
          packageReport.packageName,
          {
            packagePath: packageReport.packagePath,
            packageIndex: packageReport.packageIndex,
            checkCommand: packageReport.checkCommand,
            checkArgs: packageReport.checkArgs,
            checkArgCount: packageReport.checkArgCount,
            presentArtifactCount: packageReport.presentArtifactCount,
            missingArtifactCount: packageReport.missingArtifactCount,
            artifactsPresent: packageReport.artifactsPresent,
          },
        ];
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
  const missingPackageCheckCommandMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkCommand];
      })
  );
  const missingPackageCheckArgsMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgs];
      })
  );
  const missingPackageCheckArgCountMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgCount];
      })
  );
  const missingPackageMetadata = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [
          packageReport.packageName,
          {
            packagePath: packageReport.packagePath,
            packageIndex: packageReport.packageIndex,
            checkCommand: packageReport.checkCommand,
            checkArgs: packageReport.checkArgs,
            checkArgCount: packageReport.checkArgCount,
            presentArtifactCount: packageReport.presentArtifactCount,
            missingArtifactCount: packageReport.missingArtifactCount,
            artifactsPresent: packageReport.artifactsPresent,
          },
        ];
      })
  );
  expect(report.presentPackages).toEqual(presentPackages);
  expect(report.presentPackagePaths).toEqual(presentPackagePaths);
  expect(report.missingPackages).toEqual(missingPackages);
  expect(report.missingPackagePaths).toEqual(missingPackagePaths);
  expect(report.checkedPackageCount).toBe(report.checkedPackages.length);
  expect(report.checkedPackagePathCount).toBe(report.checkedPackagePaths.length);
  expect(report.checkedPackagePathCount).toBe(report.requiredPackageCount);
  expect(report.checkedPackageIndexCount).toBe(report.checkedPackageIndices.length);
  expect(report.checkedPackageIndexCount).toBe(report.requiredPackageCount);
  expect(report.checkedPackagePathCount).toBe(
    report.presentPackagePathCount + report.missingPackagePathCount
  );
  expect(report.checkedPackageCount).toBe(
    report.presentPackageMetadataCount + report.missingPackageMetadataCount
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
  expect(report.presentArtifactsByPackageCount).toBe(
    report.presentPackageArtifactsByPackageCount +
      report.missingPackageArtifactsByPackageCount
  );
  expect(report.presentArtifactCountByPackageCount).toBe(
    report.presentPackageArtifactCountByPackageCount +
      report.missingPackageArtifactCountByPackageCount
  );
  expect(report.checkedPackagePathMapCount).toBe(
    report.presentPackagePathMapCount + report.missingPackagePathMapCount
  );
  expect(report.checkedPackageIndexCount).toBe(
    report.presentPackageIndexCount + report.missingPackageIndexCount
  );
  expect(report.checkedPackageIndexMapCount).toBe(
    report.presentPackageIndexMapCount + report.missingPackageIndexMapCount
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
  const presentPackageArtifactsByPackage = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.presentArtifacts];
      })
  );
  const missingArtifactCountByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.missingArtifactCount];
    })
  );
  const presentPackageArtifactCountByPackage = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.presentArtifactCount];
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
  const missingPackageArtifactsByPackage = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.missingArtifacts];
      })
  );
  const missingPackageArtifactCountByPackage = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.missingArtifactCount];
      })
  );
  expect(report.requiredPackageCount).toBe(
    report.presentPackageCount + report.missingPackageCount
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
  expect(report.presentPackageCheckCommandMap).toEqual(
    presentPackageCheckCommandMap
  );
  expect(report.presentPackageCheckCommandMapCount).toBe(
    Object.keys(report.presentPackageCheckCommandMap).length
  );
  expect(report.presentPackageCheckArgsMap).toEqual(presentPackageCheckArgsMap);
  expect(report.presentPackageCheckArgsMapCount).toBe(
    Object.keys(report.presentPackageCheckArgsMap).length
  );
  expect(report.presentPackageCheckArgCountMap).toEqual(
    presentPackageCheckArgCountMap
  );
  expect(report.presentPackageCheckArgCountMapCount).toBe(
    Object.keys(report.presentPackageCheckArgCountMap).length
  );
  expect(report.presentPackageMetadata).toEqual(presentPackageMetadata);
  expect(report.presentPackageMetadataCount).toBe(
    Object.keys(report.presentPackageMetadata).length
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
  expect(report.missingPackageCheckCommandMap).toEqual(
    missingPackageCheckCommandMap
  );
  expect(report.missingPackageCheckCommandMapCount).toBe(
    Object.keys(report.missingPackageCheckCommandMap).length
  );
  expect(report.missingPackageCheckArgsMap).toEqual(missingPackageCheckArgsMap);
  expect(report.missingPackageCheckArgsMapCount).toBe(
    Object.keys(report.missingPackageCheckArgsMap).length
  );
  expect(report.missingPackageCheckArgCountMap).toEqual(
    missingPackageCheckArgCountMap
  );
  expect(report.missingPackageCheckArgCountMapCount).toBe(
    Object.keys(report.missingPackageCheckArgCountMap).length
  );
  expect(report.missingPackageMetadata).toEqual(missingPackageMetadata);
  expect(report.missingPackageMetadataCount).toBe(
    Object.keys(report.missingPackageMetadata).length
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
  expect(report.presentPackageArtifactCountByPackage).toEqual(
    presentPackageArtifactCountByPackage
  );
  expect(report.presentPackageArtifactCountByPackageCount).toBe(
    Object.keys(report.presentPackageArtifactCountByPackage).length
  );
  expect(report.presentArtifactsByPackage).toEqual(presentArtifactsByPackage);
  expect(report.presentPackageArtifactsByPackage).toEqual(
    presentPackageArtifactsByPackage
  );
  expect(report.presentPackageArtifactsByPackageCount).toBe(
    Object.keys(report.presentPackageArtifactsByPackage).length
  );
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
  expect(report.missingPackageArtifactCountByPackage).toEqual(
    missingPackageArtifactCountByPackage
  );
  expect(report.missingPackageArtifactCountByPackageCount).toBe(
    Object.keys(report.missingPackageArtifactCountByPackage).length
  );
  expect(report.missingArtifactsByPackage).toEqual(missingArtifactsByPackage);
  expect(report.missingPackageArtifactsByPackage).toEqual(
    missingPackageArtifactsByPackage
  );
  expect(report.missingPackageArtifactsByPackageCount).toBe(
    Object.keys(report.missingPackageArtifactsByPackage).length
  );
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
        kind: "artifacts",
        packageName: packageReport.packageName,
        packagePath: packageReport.packagePath,
        packageIndex: packageReport.packageIndex,
        checkCommand: packageReport.checkCommand,
        checkArgs: packageReport.checkArgs,
        checkArgCount: packageReport.checkArgCount,
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
  expect(report.noBuild).toBe(expectedNoBuild);
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
};

describe("preflight aggregate report", () => {
  it("emits machine-readable aggregate JSON", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--no-build"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(typeof report.passed).toBe("boolean");
    expect(report.noBuild).toBe(true);
    expect(report.platform).toBe(process.platform);
    expect(report.nodeVersion).toBe(process.version);
    expect(report.optionTerminatorUsed).toBe(false);
    expect(report.positionalArgs).toEqual([]);
    expect(report.positionalArgCount).toBe(0);
    expect(report.exitCode).toBeGreaterThanOrEqual(0);
    expect(typeof report.startedAt).toBe("string");
    expect(typeof report.endedAt).toBe("string");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expectAvailableCheckInventoryMetadata(report);
    expectSelectorAndAliasMetadata(report);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.activeCliOptions).toEqual(["--no-build"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.availableCliOptionAliases).toEqual(
      expectedAvailableCliOptionAliases
    );
    expect(report.availableCliOptionCanonicalMap).toEqual(
      expectedAvailableCliOptionCanonicalMap
    );
    expect(report.selectionMode).toBe("default");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.selectedCheckCount).toBe(report.selectedChecks.length);
    expectSelectedCheckMetadata(report);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(report.requestedChecks.length);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.skippedChecks).toEqual([]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.totalChecks).toBe(report.checks.length);
    expect(report.passedCheckCount).toBe(report.passedChecks.length);
    expect(report.failedCheckCount).toBe(report.failedChecks.length);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(
      report.totalChecks
    );
    if (report.failedChecks.length > 0) {
      expect(report.firstFailedCheck).toBe(report.failedChecks[0]);
    } else {
      expect(report.firstFailedCheck).toBeNull();
    }
    expect(Array.isArray(report.passedChecks)).toBe(true);
    expect(Array.isArray(report.failedChecks)).toBe(true);
    expectCheckResultScriptMetadata(report);
    expect(Array.isArray(report.failureSummaries)).toBe(true);
    expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
    expect(report.passedChecks.length + report.failedChecks.length).toBe(
      expectedAvailableChecks.length
    );
    expect(report.failureSummaries.length).toBe(report.failedChecks.length);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual(
      [
        "client",
        "devEnvironment",
        "runtimeLibraries",
        "tsCore",
        "wasmPack",
      ]
    );
    expect(report.failureSummaries.map((entry) => entry.name).sort()).toEqual(
      report.failedChecks.slice().sort()
    );
    for (const entry of report.failureSummaries) {
      expect(entry.scriptName).toBe(
        expectedAvailableCheckMetadata[
          entry.name as keyof typeof expectedAvailableCheckMetadata
        ].scriptName
      );
      expect(entry.supportsNoBuild).toBe(
        expectedAvailableCheckMetadata[
          entry.name as keyof typeof expectedAvailableCheckMetadata
        ].supportsNoBuild
      );
      expect(entry.checkIndex).toBe(expectedAvailableChecks.indexOf(entry.name));
      expect(entry.exitCode).toBeGreaterThanOrEqual(1);
      expect(entry.message.length).toBeGreaterThan(0);
    }
    const devEnvironmentFailure = report.failureSummaries.find(
      (entry) => entry.name === "devEnvironment"
    );
    if (devEnvironmentFailure !== undefined) {
      expect(devEnvironmentFailure.message).toContain("required check(s) failed");
    }
    const clientFailure = report.failureSummaries.find(
      (entry) => entry.name === "client"
    );
    if (clientFailure !== undefined) {
      expect(clientFailure.message).toContain("WASM artifact preflight");
    }
    expect(report.outputPath).toBeNull();
    expect(report.validationErrorCode).toBeNull();
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBe(expectedAvailableChecks.length);
    expect(report.checks.map((check) => check.name)).toEqual(
      expectedAvailableChecks
    );
    const devEnvironmentCheck = report.checks.find((check) => {
      return check.name === "devEnvironment";
    });
    expect(devEnvironmentCheck).toBeDefined();
    if (devEnvironmentCheck !== undefined) {
      expectDevEnvironmentNestedReport(devEnvironmentCheck.report);
    }
    const wasmPackCheck = report.checks.find((check) => {
      return check.name === "wasmPack";
    });
    expect(wasmPackCheck).toBeDefined();
    if (wasmPackCheck !== undefined) {
      expectWasmPackNestedReport(wasmPackCheck.report);
    }
    const tsCoreCheck = report.checks.find((check) => check.name === "tsCore");
    expect(tsCoreCheck).toBeDefined();
    if (tsCoreCheck !== undefined) {
      expectTsCoreNestedReport(tsCoreCheck.report, true);
    }
    const runtimeLibrariesCheck = report.checks.find((check) => {
      return check.name === "runtimeLibraries";
    });
    expect(runtimeLibrariesCheck).toBeDefined();
    if (runtimeLibrariesCheck !== undefined) {
      expectRuntimeLibrariesNestedReport(runtimeLibrariesCheck.report, true);
    }
    const clientCheck = report.checks.find((check) => {
      return check.name === "client";
    });
    expect(clientCheck).toBeDefined();
    if (clientCheck !== undefined) {
      expectClientNestedReport(clientCheck.report);
    }
    for (const check of report.checks) {
      expect(check.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports selecting a subset of checks via --only", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "devEnvironment,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expectSelectedCheckMetadata(report);
    expect(report.requestedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "devEnvironment",
        normalizedToken: "devenvironment",
        kind: "check",
        resolvedTo: ["devEnvironment"],
      },
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 2,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.totalChecks).toBe(2);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports selecting a subset of checks via inline --only values", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only=devEnvironment,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionTokens).toEqual([
      "--no-build",
      "--only=devEnvironment,client",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--no-build",
        "--only=devEnvironment,client",
      ])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.totalChecks).toBe(2);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports verify alias for no-build mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--verify", "--only", "client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--verify", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--verify", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--verify", "--only", "client"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.selectedChecks).toEqual(["client"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["client"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(4);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("normalizes duplicated and spaced check names in --only", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment, client , devEnvironment"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedChecks).toEqual([
      "devEnvironment",
      "client",
      "devEnvironment",
    ]);
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("normalizes selected checks to available check order", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "client,devEnvironment"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedChecks).toEqual(["client", "devEnvironment"]);
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports canonical aliases and case-insensitive check names", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "DEV_ENV,wasm_pack,CLIENT"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.requestedChecks).toEqual(["DEV_ENV", "wasm_pack", "CLIENT"]);
    expect(report.skippedChecks).toEqual(["tsCore", "runtimeLibraries"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator-free alias forms", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "wasmpack,devenvironment"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "wasmPack"]);
    expect(report.requestedChecks).toEqual(["wasmpack", "devenvironment"]);
    expect(report.skippedChecks).toEqual([
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports short alias forms", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "dev,wasm"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "wasmPack"]);
    expect(report.requestedChecks).toEqual(["dev", "wasm"]);
    expect(report.skippedChecks).toEqual([
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports ts-core aliases and verify mode in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--verify", "--only", "ts-core"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["ts-core"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts-core",
        normalizedToken: "tscore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--only",
    ]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--verify",
      "--only",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--verify",
        "--only",
      ])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--verify",
        "--only",
        "ts-core",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports long-form ts-core aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "typescript_core"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["typescript_core"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "typescript_core",
        normalizedToken: "typescriptcore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "typescript_core",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports ts shorthand aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "ts"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["ts"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--list-checks", "--only", "ts"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports typescript aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "typescript"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["typescript"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "typescript",
        normalizedToken: "typescript",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "typescript",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports runtime aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "runtime-libraries"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["runtime-libraries"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "runtime-libraries",
        normalizedToken: "runtimelibraries",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "runtime-libraries",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports case-insensitive runtime aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "RUNTIME_LIBRARIES"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["RUNTIME_LIBRARIES"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "RUNTIME_LIBRARIES",
        normalizedToken: "runtimelibraries",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "RUNTIME_LIBRARIES",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("writes list-mode ts-core reports to trailing output paths with no-build aliases", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-list-ts-core-last-output-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const commandArgs = [
      preflightScript,
      "--list-checks",
      "--only",
      "ts-core",
      "--output",
      firstOutputPath,
      "--verify",
      "--output",
      secondOutputPath,
    ] as const;
    const result = spawnSync(process.execPath, [...commandArgs], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.selectionMode).toBe("only");
    expect(stdoutReport.specialSelectorsUsed).toEqual([]);
    expect(stdoutReport.selectedChecks).toEqual(["tsCore"]);
    expect(stdoutReport.selectedCheckCount).toBe(1);
    expect(stdoutReport.requestedChecks).toEqual(["ts-core"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "ts-core",
        normalizedToken: "tscore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      "--output",
      "--verify",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--only",
        "--output",
        "--verify",
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([...commandArgs.slice(1)])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(stdoutReport.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(stdoutReport.skippedCheckCount).toBe(stdoutReport.skippedChecks.length);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes ts-core validation reports to trailing output paths with inline no-build misuse", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-ts-core-validation-last-output-inline-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const commandArgs = [
      preflightScript,
      "--only",
      "ts-core",
      "--output",
      firstOutputPath,
      "--verify=1",
      "--output",
      secondOutputPath,
    ] as const;
    const result = spawnSync(process.execPath, [...commandArgs], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.listChecksOnly).toBe(false);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>"])
    );
    expect(stdoutReport.selectionMode).toBe("only");
    expect(stdoutReport.specialSelectorsUsed).toEqual([]);
    expect(stdoutReport.selectedChecks).toEqual([]);
    expect(stdoutReport.selectedCheckCount).toBe(0);
    expectSelectedCheckMetadata(stdoutReport);
    expectCheckResultScriptMetadata(stdoutReport);
    expect(stdoutReport.requestedChecks).toEqual(["ts-core"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "ts-core",
        normalizedToken: "tscore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.activeCliOptions).toEqual(["--only", "--output"]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--only", "--output"]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only", "--output"])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([...commandArgs.slice(1)])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(stdoutReport.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(stdoutReport.skippedCheckCount).toBe(stdoutReport.skippedChecks.length);
    expect(fileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("supports ts shorthand aliases in only selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "TS,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["TS", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "TS",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 2,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.checks.map((check) => check.name)).toEqual([
      "tsCore",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports typescript aliases in execution-mode selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "typescript,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["typescript", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "typescript",
        normalizedToken: "typescript",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 2,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.checks.map((check) => check.name)).toEqual([
      "tsCore",
      "client",
    ]);
    expect(report.totalChecks).toBe(2);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports case-insensitive typescript aliases in execution-mode selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "TYPESCRIPT"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["TYPESCRIPT"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "TYPESCRIPT",
        normalizedToken: "typescript",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.checks.map((check) => check.name)).toEqual(["tsCore"]);
    expect(report.totalChecks).toBe(1);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports selecting ts-core checks in execution mode with verify alias", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--verify", "--only", "ts"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["ts"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--verify", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--verify", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--verify", "--only", "ts"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(1);
    expect(report.checks.length).toBe(1);
    expect(report.checks[0].name).toBe("tsCore");
    expectTsCoreNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect([...report.passedChecks, ...report.failedChecks]).toEqual(["tsCore"]);
    if (report.passed) {
      expect(report.exitCode).toBe(0);
    } else {
      expect(report.exitCode).toBeGreaterThanOrEqual(1);
      expect(report.failedChecks).toEqual(["tsCore"]);
      expect(report.failureSummaries.length).toBe(1);
      expect(report.failureSummaryCount).toBe(1);
      expect(report.failureSummaries[0].name).toBe("tsCore");
      expect(report.failureSummaries[0].scriptName).toBe("check-ts-core.mjs");
      expect(report.failureSummaries[0].supportsNoBuild).toBe(true);
      expect(report.failureSummaries[0].checkIndex).toBe(
        expectedAvailableChecks.indexOf("tsCore")
      );
    }
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator-free long-form ts-core aliases in execution mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "typescriptcore"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["typescriptcore"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "typescriptcore",
        normalizedToken: "typescriptcore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--no-build",
        "--only",
        "typescriptcore",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(1);
    expect(report.checks.length).toBe(1);
    expect(report.checks[0].name).toBe("tsCore");
    expectTsCoreNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect([...report.passedChecks, ...report.failedChecks]).toEqual(["tsCore"]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("executes ts-core checks before client when both are selected", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "ts,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["ts", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 2,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build", "--only", "ts,client"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual(["tsCore", "client"]);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
      "client",
      "tsCore",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports runtime shorthand aliases in execution mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "runtime"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["runtime"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "runtime",
        normalizedToken: "runtime",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build", "--only", "runtime"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(1);
    expect(report.checks.length).toBe(1);
    expect(report.checks[0].name).toBe("runtimeLibraries");
    expectRuntimeLibrariesNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect([...report.passedChecks, ...report.failedChecks]).toEqual([
      "runtimeLibraries",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator-free runtime aliases in execution mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "runtimelibraries"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["runtimelibraries"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "runtimelibraries",
        normalizedToken: "runtimelibraries",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--no-build",
        "--only",
        "runtimelibraries",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(1);
    expect(report.checks.length).toBe(1);
    expect(report.checks[0].name).toBe("runtimeLibraries");
    expectRuntimeLibrariesNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect([...report.passedChecks, ...report.failedChecks]).toEqual([
      "runtimeLibraries",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("executes ts-core before runtime when both are selected", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "ts,runtime"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["ts", "runtime"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
      {
        token: "runtime",
        normalizedToken: "runtime",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 2,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build", "--only", "ts,runtime"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "tsCore",
      "runtimeLibraries",
    ]);
    expectTsCoreNestedReport(report.checks[0].report, true);
    expectRuntimeLibrariesNestedReport(report.checks[1].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
      "runtimeLibraries",
      "tsCore",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("executes runtime checks before client when both are selected", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "runtime,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["runtime", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "runtime",
        normalizedToken: "runtime",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 2,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "tsCore"]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--no-build",
        "--only",
        "runtime,client",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "runtimeLibraries",
      "client",
    ]);
    expectRuntimeLibrariesNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
      "client",
      "runtimeLibraries",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports libraries special selector in list mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "libraries"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual(expectedUsedLibrariesSpecialSelector);
    expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(2);
    expectSelectedCheckMetadata(report);
    expect(report.requestedChecks).toEqual(["libraries"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "libraries",
        normalizedToken: "libraries",
        kind: "specialSelector",
        selector: "libraries",
        resolvedTo: ["tsCore", "runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 1,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--list-checks", "--only", "libraries"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expectCheckResultScriptMetadata(report);
    expect(report.checks).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("supports libraries special selector in execution mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "libraries"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual(expectedUsedLibrariesSpecialSelector);
    expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(2);
    expectSelectedCheckMetadata(report);
    expect(report.requestedChecks).toEqual(["libraries"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "libraries",
        normalizedToken: "libraries",
        kind: "specialSelector",
        selector: "libraries",
        resolvedTo: ["tsCore", "runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 1,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build", "--only", "libraries"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "tsCore",
      "runtimeLibraries",
    ]);
    expectCheckResultScriptMetadata(report);
    expectTsCoreNestedReport(report.checks[0].report, true);
    expectRuntimeLibrariesNestedReport(report.checks[1].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
      "runtimeLibraries",
      "tsCore",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports library selector aliases in list mode", () => {
    const selectorTokens = ["library", "libs", "lib", "LIBS"] as const;

    for (const selectorToken of selectorTokens) {
      const result = spawnSync(
        process.execPath,
        [preflightScript, "--list-checks", "--only", selectorToken],
        {
          cwd: rootDir,
          encoding: "utf8",
          shell: false,
        }
      );
      const output = `${result.stdout}${result.stderr}`;
      const report = JSON.parse(output) as PreflightReport;

      expect(report.schemaVersion).toBe(1);
      expect(report.listChecksOnly).toBe(true);
      expect(report.passed).toBe(true);
      expect(report.exitCode).toBe(0);
      expect(report.noBuild).toBe(false);
      expect(report.selectionMode).toBe("only");
      expect(report.specialSelectorsUsed).toEqual(expectedUsedLibrariesSpecialSelector);
      expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
      expect(report.selectedCheckCount).toBe(2);
      expect(report.requestedChecks).toEqual([selectorToken]);
      expect(report.requestedCheckCount).toBe(1);
      expect(report.requestedCheckResolutions).toEqual([
        {
          token: selectorToken,
          normalizedToken: selectorToken.toLowerCase(),
          kind: "specialSelector",
          selector: "libraries",
          resolvedTo: ["tsCore", "runtimeLibraries"],
        },
      ]);
      expect(report.requestedCheckResolutionCounts).toEqual({
        check: 0,
        specialSelector: 1,
        invalid: 0,
      });
      expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
      expect(report.skippedCheckCount).toBe(3);
      expect(report.invalidChecks).toEqual([]);
      expect(report.invalidCheckCount).toBe(0);
      expect(report.unknownOptions).toEqual([]);
      expect(report.unknownOptionCount).toBe(0);
      expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
      expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
      expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
      expect(report.activeCliOptionResolutions).toEqual(
        expectedActiveCliOptionResolutions(["--list-checks", "--only"])
      );
      expect(report.activeCliOptionResolutionCount).toBe(
        report.activeCliOptionResolutions.length
      );
      expect(report.activeCliOptionOccurrences).toEqual(
        expectedActiveCliOptionOccurrences(["--list-checks", "--only", selectorToken])
      );
      expect(report.activeCliOptionOccurrenceCount).toBe(
        report.activeCliOptionOccurrences.length
      );
      expect(report.checks).toEqual([]);
      expect(result.status).toBe(0);
    }
  });

  it("supports library selector aliases in execution mode", () => {
    const selectorTokens = ["library", "libs", "lib", "LIBRARY"] as const;

    for (const selectorToken of selectorTokens) {
      const result = spawnSync(
        process.execPath,
        [preflightScript, "--no-build", "--only", selectorToken],
        {
          cwd: rootDir,
          encoding: "utf8",
          shell: false,
        }
      );
      const output = `${result.stdout}${result.stderr}`;
      const report = JSON.parse(output) as PreflightReport;

      expect(report.schemaVersion).toBe(1);
      expect(report.listChecksOnly).toBe(false);
      expect(report.noBuild).toBe(true);
      expect(report.selectionMode).toBe("only");
      expect(report.specialSelectorsUsed).toEqual(expectedUsedLibrariesSpecialSelector);
      expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
      expect(report.selectedCheckCount).toBe(2);
      expect(report.requestedChecks).toEqual([selectorToken]);
      expect(report.requestedCheckCount).toBe(1);
      expect(report.requestedCheckResolutions).toEqual([
        {
          token: selectorToken,
          normalizedToken: selectorToken.toLowerCase(),
          kind: "specialSelector",
          selector: "libraries",
          resolvedTo: ["tsCore", "runtimeLibraries"],
        },
      ]);
      expect(report.requestedCheckResolutionCounts).toEqual({
        check: 0,
        specialSelector: 1,
        invalid: 0,
      });
      expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
      expect(report.skippedCheckCount).toBe(3);
      expect(report.invalidChecks).toEqual([]);
      expect(report.invalidCheckCount).toBe(0);
      expect(report.unknownOptions).toEqual([]);
      expect(report.unknownOptionCount).toBe(0);
      expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
      expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
      expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
      expect(report.activeCliOptionResolutions).toEqual(
        expectedActiveCliOptionResolutions(["--no-build", "--only"])
      );
      expect(report.activeCliOptionResolutionCount).toBe(
        report.activeCliOptionResolutions.length
      );
      expect(report.activeCliOptionOccurrences).toEqual(
        expectedActiveCliOptionOccurrences(["--no-build", "--only", selectorToken])
      );
      expect(report.activeCliOptionOccurrenceCount).toBe(
        report.activeCliOptionOccurrences.length
      );
      expect(report.totalChecks).toBe(2);
      expect(report.checks.length).toBe(2);
      expect(report.checks.map((check) => check.name)).toEqual([
        "tsCore",
        "runtimeLibraries",
      ]);
      expectTsCoreNestedReport(report.checks[0].report, true);
      expectRuntimeLibrariesNestedReport(report.checks[1].report, true);
      expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
      expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
        "runtimeLibraries",
        "tsCore",
      ]);
      expect(result.status).toBe(report.passed ? 0 : report.exitCode);
    }
  });

  it("supports selecting all checks with the all alias", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "all"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["all"]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "all",
        normalizedToken: "all",
        kind: "specialSelector",
        selector: "all",
        resolvedTo: [
          "devEnvironment",
          "wasmPack",
          "tsCore",
          "runtimeLibraries",
          "client",
        ],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 1,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports case-insensitive all alias selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "ALL"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["ALL"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator variants for all alias selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "all_checks"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["all_checks"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator-free all alias selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "allchecks"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["allchecks"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports mixing the all alias with specific checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "all,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["all", "client"]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "all",
        normalizedToken: "all",
        kind: "specialSelector",
        selector: "all",
        resolvedTo: [
          "devEnvironment",
          "wasmPack",
          "tsCore",
          "runtimeLibraries",
          "client",
        ],
      },
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 1,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("preserves duplicate requested checks while normalizing selected checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "client,client,DEV_ENV,dev_env"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedChecks).toEqual([
      "client",
      "client",
      "DEV_ENV",
      "dev_env",
    ]);
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("deduplicates mixed alias forms to canonical selected checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "devEnvironment,DEV_ENV,dev"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["devEnvironment"]);
    expect(report.requestedChecks).toEqual([
      "devEnvironment",
      "DEV_ENV",
      "dev",
    ]);
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.checks.map((check) => check.name)).toEqual(["devEnvironment"]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("uses the last only flag when multiple are provided", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--no-build",
        "--only",
        "devEnvironment",
        "--only",
        "client",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.selectedChecks).toEqual(["client"]);
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--no-build",
        "--only",
        "devEnvironment",
        "--only",
        "client",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.requestedChecks).toEqual(["client"]);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual(["client"]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("uses the last only flag when inline output tokens appear between only flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-only-inline-output-between-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--only",
        "devEnvironment",
        `--output=${outputPath}`,
        "--only",
        "client",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.selectedChecks).toEqual(["client"]);
    expect(stdoutReport.selectedCheckCount).toBe(1);
    expect(stdoutReport.requestedChecks).toEqual(["client"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      `--output=${outputPath}`,
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--only",
        `--output=${outputPath}`,
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual([
      {
        token: "--list-checks",
        canonicalOption: "--list-checks",
        index: 0,
      },
      {
        token: "--only",
        canonicalOption: "--only",
        index: 1,
      },
      {
        token: `--output=${outputPath}`,
        canonicalOption: "--output",
        index: 3,
      },
      {
        token: "--only",
        canonicalOption: "--only",
        index: 4,
      },
    ]);
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last only flag when no-build aliases appear between only flags", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--only",
        "devEnvironment",
        "--verify",
        "--only",
        "client",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.listChecksOnly).toBe(true);
    expect(report.noBuild).toBe(true);
    expect(report.selectedChecks).toEqual(["client"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["client"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--only",
    ]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      "--verify",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only", "--verify"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "devEnvironment",
        "--verify",
        "--only",
        "client",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("keeps last only parsing when inline no-build misuse appears between only flags", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--only",
        "devEnvironment",
        "--verify=1",
        "--only",
        "client",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.noBuild).toBe(false);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>"])
    );
    expect(report.selectedChecks).toEqual([]);
    expect(report.selectedCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual(["client"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "devEnvironment",
        "--verify=1",
        "--only",
        "client",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("uses the last output path when no-build aliases appear between only and output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-only-alias-output-path-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const commandArgs = [
      preflightScript,
      "--list-checks",
      "--only",
      "devEnvironment",
      "--verify",
      "--only",
      "client",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ] as const;
    const result = spawnSync(process.execPath, [...commandArgs], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.selectedChecks).toEqual(["client"]);
    expect(stdoutReport.selectedCheckCount).toBe(1);
    expect(stdoutReport.requestedChecks).toEqual(["client"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      "--verify",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--only",
        "--verify",
        "--output",
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([...commandArgs.slice(1)])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes unsupported only validation to the last output path when inline no-build misuse appears between only and output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-only-inline-output-path-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const commandArgs = [
      preflightScript,
      "--list-checks",
      "--only",
      "devEnvironment",
      "--verify=1",
      "--only",
      "client",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ] as const;
    const result = spawnSync(process.execPath, [...commandArgs], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>"])
    );
    expect(stdoutReport.selectedChecks).toEqual([]);
    expect(stdoutReport.selectedCheckCount).toBe(0);
    expect(stdoutReport.requestedChecks).toEqual(["client"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--only",
        "--output",
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([...commandArgs.slice(1)])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("fails when the last only flag is missing a value", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment", "--only"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.selectedChecks).toEqual([]);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(result.status).toBe(1);
  });

  it("fails when the last only flag is missing after no-build aliases between only flags", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment", "--verify", "--only"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(report.selectedChecks).toEqual([]);
    expect(report.selectedCheckCount).toBe(0);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only", "--verify"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only", "--verify"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--only",
        "devEnvironment",
        "--verify",
        "--only",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("fails when the last only flag is missing after inline no-build misuse between only flags", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment", "--verify=1", "--only"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(report.selectedChecks).toEqual([]);
    expect(report.selectedCheckCount).toBe(0);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--only",
        "devEnvironment",
        "--verify=1",
        "--only",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("fails when inline only flag value is empty", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--only="], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.selectionMode).toBe("only");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--only="]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only="])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("fails when inline only flag value is whitespace", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--only=   "], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.selectionMode).toBe("only");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--only=   "]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only=   "])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("prioritizes inline whitespace only validation while still reporting unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--only=   "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.selectionMode).toBe("only");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--only=   "]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only=   "])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(result.status).toBe(1);
  });

  it("fails when split only flag value is empty", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--only", ""], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.selectionMode).toBe("only");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("fails when split only flag value is whitespace", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "   "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.selectionMode).toBe("only");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("fails when the last only flag contains invalid checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment", "--only", "invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "invalidCheck",
        normalizedToken: "invalidcheck",
        kind: "invalid",
        resolvedTo: [],
      },
    ]);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(result.status).toBe(1);
  });

  it("supports compact json output formatting", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--compact"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`.trim();
    const report = JSON.parse(output) as PreflightReport;

    expect(output).not.toContain("\n  \"");
    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports listing checks without executing them", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--list-checks"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.validationErrorCode).toBeNull();
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks"]);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.selectionMode).toBe("default");
    expect(report.selectedCheckCount).toBe(expectedAvailableChecks.length);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.skippedCheckCount).toBe(0);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.skippedChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.checks).toEqual([]);
    expect(report.failureSummaries).toEqual([]);
    expect(report.failureSummaryCount).toBe(0);
    expect(result.status).toBe(0);
  });

  it("ignores option-like tokens after the option terminator", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--",
        "--mystery",
        "--only",
        "client",
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
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual([
      "--mystery",
      "--only",
      "client",
      "--json=1",
      "--verify=2",
      "--=secret",
    ]);
    expect(report.positionalArgCount).toBe(report.positionalArgs.length);
    expect(report.selectionMode).toBe("default");
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.requestedChecks).toEqual([]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks"]);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks"]);
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--list-checks"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("does not treat no-build aliases after option terminator as active", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--", "--verify"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual(["--verify"]);
    expect(report.positionalArgCount).toBe(report.positionalArgs.length);
    expect(report.selectionMode).toBe("default");
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.requestedChecks).toEqual([]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--list-checks"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("keeps no-build alias before option terminator active", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--verify", "--", "--verify=1", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.noBuild).toBe(true);
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual(["--verify=1", "--mystery=alpha"]);
    expect(report.positionalArgCount).toBe(report.positionalArgs.length);
    expect(report.selectionMode).toBe("default");
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.requestedChecks).toEqual([]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--no-build"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--verify"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--verify"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--verify",
        "--verify=1",
        "--mystery=alpha",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("reports only pre-terminator unknown options when terminator is used", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--mystery", "--", "--another-mystery", "--json=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual(["--another-mystery", "--json=1"]);
    expect(report.positionalArgCount).toBe(report.positionalArgs.length);
    expect(report.selectionMode).toBe("default");
    expect(report.selectedChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--list-checks"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--list-checks", "--mystery"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(expectedUnsupportedOptionsMessage(["--mystery"]));
    expect(result.status).toBe(1);
  });

  it("supports list alias for listing checks", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--list"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.validationErrorCode).toBeNull();
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.availableCliOptionAliases).toEqual(
      expectedAvailableCliOptionAliases
    );
    expect(report.availableCliOptionCanonicalMap).toEqual(
      expectedAvailableCliOptionCanonicalMap
    );
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.activeCliOptions).toEqual(["--list-checks"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.checks).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("supports short list alias for listing checks", () => {
    const result = spawnSync(process.execPath, [preflightScript, "-l"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.availableCliOptionAliases).toEqual(
      expectedAvailableCliOptionAliases
    );
    expect(report.availableCliOptionCanonicalMap).toEqual(
      expectedAvailableCliOptionCanonicalMap
    );
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.activeCliOptions).toEqual(["--list-checks"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["-l"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["-l"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.checks).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("supports listing resolved filters for explicit only values", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "all,client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.selectionMode).toBe("only");
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.selectedCheckCount).toBe(expectedAvailableChecks.length);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.skippedCheckCount).toBe(0);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.requestedChecks).toEqual(["all", "client"]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "all",
        normalizedToken: "all",
        kind: "specialSelector",
        selector: "all",
        resolvedTo: [
          "devEnvironment",
          "wasmPack",
          "tsCore",
          "runtimeLibraries",
          "client",
        ],
      },
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 1,
      invalid: 0,
    });
    expect(report.totalChecks).toBe(0);
    expect(report.checks).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("reports invalid only filters in list mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.validationErrorCode).toBe("only_option_invalid_value");
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.invalidCheckCount).toBe(1);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.requestedChecks).toEqual(["invalidCheck"]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "invalidCheck",
        normalizedToken: "invalidcheck",
        kind: "invalid",
        resolvedTo: [],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 0,
      invalid: 1,
    });
    expect(report.checks).toEqual([]);
    expect(result.status).toBe(1);
  });

  it("fails with structured output for unsupported options", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--mystery"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.availableCliOptionAliases).toEqual(
      expectedAvailableCliOptionAliases
    );
    expect(report.availableCliOptionCanonicalMap).toEqual(
      expectedAvailableCliOptionCanonicalMap
    );
    expect(report.activeCliOptions).toEqual([]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([]);
    expect(report.activeCliOptionResolutions).toEqual([]);
    expect(report.activeCliOptionResolutionCount).toBe(0);
    expect(report.activeCliOptionOccurrences).toEqual([]);
    expect(report.activeCliOptionOccurrenceCount).toBe(0);
    expect(report.selectionMode).toBe("default");
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.message).toBe(expectedUnsupportedOptionsMessage(["--mystery"]));
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(report.checks).toEqual([]);
    expect(result.status).toBe(1);
  });

  it("redacts inline known-flag misuse tokens in unsupported-option output", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--json=1", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.activeCliOptions).toEqual([]);
    expect(report.activeCliOptionCount).toBe(0);
    expect(report.activeCliOptionTokens).toEqual([]);
    expect(report.activeCliOptionResolutions).toEqual([]);
    expect(report.activeCliOptionResolutionCount).toBe(0);
    expect(report.activeCliOptionOccurrences).toEqual([]);
    expect(report.activeCliOptionOccurrenceCount).toBe(0);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage(["--json=<value>", "--mystery"])
    );
    expect(result.status).toBe(1);
  });

  it("deduplicates literal redaction placeholders in unsupported-option output", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--json=<value>", "--json=secret", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.activeCliOptions).toEqual([]);
    expect(report.activeCliOptionCount).toBe(0);
    expect(report.activeCliOptionTokens).toEqual([]);
    expect(report.activeCliOptionResolutions).toEqual([]);
    expect(report.activeCliOptionResolutionCount).toBe(0);
    expect(report.activeCliOptionOccurrences).toEqual([]);
    expect(report.activeCliOptionOccurrenceCount).toBe(0);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.unknownOptions).toEqual(["--json=<value>", "--mystery"]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage(["--json=<value>", "--mystery"])
    );
    expect(output).not.toContain("--json=secret");
    expect(result.status).toBe(1);
  });

  it("keeps active metadata focused on recognized options with inline misuse present", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--json",
        "--list-checks",
        "--json=1",
        "--verify=2",
        "--list=3",
        "--mystery=alpha",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.activeCliOptions).toEqual(["--list-checks", "--json"]);
    expect(report.activeCliOptionCount).toBe(2);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--list-checks"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--json", "--list-checks"])
    );
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
        token: "--list-checks",
        canonicalOption: "--list-checks",
        index: 1,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.unknownOptionCount).toBe(4);
    expect(report.unknownOptions).toEqual([
      "--json=<value>",
      "--no-build=<value>",
      "--list-checks=<value>",
      "--mystery",
    ]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage([
        "--json=<value>",
        "--no-build=<value>",
        "--list-checks=<value>",
        "--mystery",
      ])
    );
    expect(result.status).toBe(1);
  });

  it("keeps recognized no-build alias active while redacting inline alias misuse", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--verify",
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
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.activeCliOptions).toEqual(["--list-checks", "--no-build"]);
    expect(report.activeCliOptionCount).toBe(2);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--verify"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--verify"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--verify",
        "--verify=1",
        "--no-build=2",
        "--mystery=alpha",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.unknownOptionCount).toBe(2);
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>", "--mystery"])
    );
    expect(output).not.toContain("--verify=1");
    expect(output).not.toContain("--no-build=2");
    expect(output).not.toContain("--mystery=alpha");
    expect(result.status).toBe(1);
  });

  it("keeps no-build enabled in unsupported output when verify alias is recognized", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--verify", "--verify=1", "--mystery=alpha"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.activeCliOptions).toEqual(["--no-build"]);
    expect(report.activeCliOptionCount).toBe(1);
    expect(report.activeCliOptionTokens).toEqual(["--verify"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--verify"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--verify", "--verify=1", "--mystery=alpha"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.unknownOptionCount).toBe(2);
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>", "--mystery"])
    );
    expect(output).not.toContain("--verify=1");
    expect(output).not.toContain("--mystery=alpha");
    expect(result.status).toBe(1);
  });

  it("redacts inline alias misuse tokens in unsupported-option output", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--verify=1",
        "--no-build=2",
        "-l=1",
        "--list=2",
        "--list-checks=3",
        "--mystery=alpha",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.activeCliOptions).toEqual([]);
    expect(report.activeCliOptionCount).toBe(0);
    expect(report.activeCliOptionTokens).toEqual([]);
    expect(report.activeCliOptionResolutions).toEqual([]);
    expect(report.activeCliOptionResolutionCount).toBe(0);
    expect(report.activeCliOptionOccurrences).toEqual([]);
    expect(report.activeCliOptionOccurrenceCount).toBe(0);
    expect(report.unknownOptionCount).toBe(3);
    expect(report.unknownOptions).toEqual([
      "--no-build=<value>",
      "--list-checks=<value>",
      "--mystery",
    ]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage([
        "--no-build=<value>",
        "--list-checks=<value>",
        "--mystery",
      ])
    );
    expect(result.status).toBe(1);
  });

  it("deduplicates literal alias placeholders in unsupported-option output", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--verify=<value>",
        "--verify=1",
        "--no-build=2",
        "-l=<value>",
        "-l=1",
        "--list=2",
        "--list-checks=3",
        "--mystery=alpha",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.activeCliOptions).toEqual([]);
    expect(report.activeCliOptionCount).toBe(0);
    expect(report.activeCliOptionTokens).toEqual([]);
    expect(report.activeCliOptionResolutions).toEqual([]);
    expect(report.activeCliOptionResolutionCount).toBe(0);
    expect(report.activeCliOptionOccurrences).toEqual([]);
    expect(report.activeCliOptionOccurrenceCount).toBe(0);
    expect(report.unknownOptionCount).toBe(3);
    expect(report.unknownOptions).toEqual([
      "--no-build=<value>",
      "--list-checks=<value>",
      "--mystery",
    ]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage([
        "--no-build=<value>",
        "--list-checks=<value>",
        "--mystery",
      ])
    );
    expect(output).not.toContain("--verify=1");
    expect(output).not.toContain("--no-build=2");
    expect(output).not.toContain("-l=1");
    expect(output).not.toContain("--list=2");
    expect(output).not.toContain("--list-checks=3");
    expect(output).not.toContain("--mystery=alpha");
    expect(result.status).toBe(1);
  });

  it("redacts malformed inline option names in unsupported-option output", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--=secret", "--=token", "--=", "-=secret", "-="],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.activeCliOptions).toEqual([]);
    expect(report.activeCliOptionCount).toBe(0);
    expect(report.activeCliOptionTokens).toEqual([]);
    expect(report.activeCliOptionResolutions).toEqual([]);
    expect(report.activeCliOptionResolutionCount).toBe(0);
    expect(report.activeCliOptionOccurrences).toEqual([]);
    expect(report.activeCliOptionOccurrenceCount).toBe(0);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.unknownOptions).toEqual(["--=<value>", "-=<value>"]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage(["--=<value>", "-=<value>"])
    );
    expect(result.status).toBe(1);
  });

  it("deduplicates repeated unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--mystery", "--another-mystery"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.availableCliOptionAliases).toEqual(
      expectedAvailableCliOptionAliases
    );
    expect(report.availableCliOptionCanonicalMap).toEqual(
      expectedAvailableCliOptionCanonicalMap
    );
    expect(report.activeCliOptions).toEqual([]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([]);
    expect(report.activeCliOptionResolutions).toEqual([]);
    expect(report.activeCliOptionResolutionCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--mystery", "--another-mystery"]);
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage(["--mystery", "--another-mystery"])
    );
    expect(result.status).toBe(1);
  });

  it("normalizes inline unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery=alpha", "--mystery=beta", "-x=1", "-x=2"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.unknownOptions).toEqual(["--mystery", "-x"]);
    expect(report.message).toBe(expectedUnsupportedOptionsMessage(["--mystery", "-x"]));
    expect(result.status).toBe(1);
  });

  it("deduplicates mixed bare and inline unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery=alpha", "--mystery"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.message).toBe(expectedUnsupportedOptionsMessage(["--mystery"]));
    expect(result.status).toBe(1);
  });

  it("reports unsupported short options", () => {
    const result = spawnSync(process.execPath, [preflightScript, "-x"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.unknownOptions).toEqual(["-x"]);
    expect(report.message).toBe(expectedUnsupportedOptionsMessage(["-x"]));
    expect(result.status).toBe(1);
  });

  it("does not treat hyphen-prefixed output values as unsupported options", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-hyphen-output-value-")
    );
    const outputPath = path.resolve(tempDirectory, "-report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.listChecksOnly).toBe(true);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.outputPath).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("does not treat hyphen-prefixed only values as unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "-invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_invalid_value");
    expect(report.invalidChecks).toEqual(["-invalidCheck"]);
    expect(report.invalidCheckCount).toBe(1);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("treats hyphen-only alias tokens after --only as missing values", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--only", "-l"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only", "-l"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only", "-l"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--only",
        canonicalOption: "--only",
        index: 0,
      },
      {
        token: "-l",
        canonicalOption: "--list-checks",
        index: 1,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("treats inline alias misuse after --only as missing values", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "-l=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--list-checks=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--only", "-l=1"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("treats no-build alias tokens after --only as missing values while keeping no-build active", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "--verify"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only", "--verify"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only", "--verify"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--only", "--verify"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("treats canonical no-build tokens after --only as missing values while keeping no-build active", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "--no-build"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(true);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only", "--no-build"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only", "--no-build"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--only", "--no-build"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("does not activate no-build for inline no-build misuse after --only", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "--verify=1", "--no-build=2"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--only",
        "--verify=1",
        "--no-build=2",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("prioritizes output validation while still reporting unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.activeCliOptions).toEqual(["--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--output"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--output"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(result.status).toBe(1);
  });

  it("prioritizes output validation over invalid only-selection values", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "invalidCheck", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual(["invalidCheck"]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "invalidCheck",
        normalizedToken: "invalidcheck",
        kind: "invalid",
        resolvedTo: [],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 0,
      invalid: 1,
    });
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("prioritizes output validation over invalid only-selection and unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--only", "invalidCheck", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual(["invalidCheck"]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "invalidCheck",
        normalizedToken: "invalidcheck",
        kind: "invalid",
        resolvedTo: [],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 0,
      invalid: 1,
    });
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(result.status).toBe(1);
  });

  it("captures unsupported options following missing output values", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "--mystery"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.activeCliOptions).toEqual(["--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--output"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--output"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(result.status).toBe(1);
  });

  it("treats recognized short aliases after --output as missing values", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--output", "-l"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "-l",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--output", "-l"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--list-checks", "--output", "-l"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("reports inline alias misuse after --output as unsupported while value is missing", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--output", "-l=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--list-checks=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--output"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--output"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--output",
        "-l=1",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("reports inline known-flag misuse after --output while value is missing", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "--json=1", "--verify=1"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.noBuild).toBe(false);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([
      "--json=<value>",
      "--no-build=<value>",
    ]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.activeCliOptions).toEqual(["--output"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--output"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--output"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--output", "--json=1", "--verify=1"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("treats no-build alias after --output as missing output while keeping alias active", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--output", "--verify"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.noBuild).toBe(true);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--output",
    ]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "--verify",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--output",
        "--verify",
      ])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--output",
        "--verify",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("treats canonical no-build token after --output as missing output while keeping no-build active", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--output", "--no-build"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.noBuild).toBe(true);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--output",
    ]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "--no-build",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--output",
        "--no-build",
      ])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--output",
        "--no-build",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("prioritizes output validation while preserving inline only selection parsing", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--output", "--only=client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.selectedChecks).toEqual([]);
    expect(report.selectedCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual(["client"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual([
      "--list-checks",
      "--only",
      "--output",
    ]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "--only=client",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--output",
        "--only=client",
      ])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--list-checks",
        canonicalOption: "--list-checks",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 1,
      },
      {
        token: "--only=client",
        canonicalOption: "--only",
        index: 2,
      },
    ]);
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("prioritizes only-selection validation while still reporting unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--only", "invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_invalid_value");
    expect(report.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.invalidCheckCount).toBe(1);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(result.status).toBe(1);
  });

  it("captures unsupported options following missing only values", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "--mystery"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.activeCliOptions).toEqual(["--only"]);
    expect(report.activeCliOptionTokens).toEqual(["--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(result.status).toBe(1);
  });

  it("writes list-mode report to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-list-report-")
    );
    const outputPath = path.resolve(tempDirectory, "list-report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "client", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(fileReport.listChecksOnly).toBe(true);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(stdoutReport.selectedChecks).toEqual(["client"]);
    expect(fileReport.selectedChecks).toEqual(["client"]);
    expect(stdoutReport.checks).toEqual([]);
    expect(fileReport.checks).toEqual([]);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("marks output validation errors as list mode when listing checks", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.checks).toEqual([]);
    expect(result.status).toBe(1);
  });

  it("writes aggregate report to output path when requested", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-report-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(fileReport.schemaVersion).toBe(1);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.exitCode).toBe(stdoutReport.exitCode);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("creates output directory when writing aggregate report", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-output-dir-")
    );
    const outputPath = path.resolve(
      tempDirectory,
      "nested",
      "preflight",
      "report.json"
    );

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(fileReport.schemaVersion).toBe(1);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag when multiple are provided", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
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
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--no-build",
        "--output",
        firstOutputPath,
        "--output",
        secondOutputPath,
      ])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag when strict aliases appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-output-strict-alias-")
    );
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--output",
        "-l",
        "--output",
        secondOutputPath,
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.validationErrorCode).toBeNull();
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "-l",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--output", "-l"])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--output",
        "-l",
        "--output",
        secondOutputPath,
      ])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag when no-build aliases appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-output-strict-no-build-alias-")
    );
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--output",
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
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.validationErrorCode).toBeNull();
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "--verify",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--output",
        "--verify",
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--output",
        "--verify",
        "--output",
        secondOutputPath,
      ])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("supports inline output option values", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "inline-report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", `--output=${outputPath}`],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.listChecksOnly).toBe(true);
    expect(report.outputPath).toBe(outputPath);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      `--output=${outputPath}`,
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        `--output=${outputPath}`,
      ])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("fails with structured output when output value is missing", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--output"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.platform).toBe(process.platform);
    expect(report.nodeVersion).toBe(process.version);
    expectAvailableCheckMetadataCoreFields(report);
    expectSelectorAndAliasMetadata(report);
    expect(typeof report.endedAt).toBe("string");
    expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
    expect(report.supportedCliOptionCount).toBe(
      report.supportedCliOptions.length
    );
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.selectionMode).toBe("default");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(result.status).toBe(1);
  });

  it("fails when split output flag value is empty", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--output", ""], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.activeCliOptions).toEqual(["--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--output"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--output"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("fails when split output flag value is whitespace", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "   "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.activeCliOptions).toEqual(["--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--output"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--output"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("fails when inline output flag value is empty", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--output="], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.activeCliOptions).toEqual(["--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--output="]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--output="])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("fails when inline output flag value is whitespace", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output=   "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.activeCliOptions).toEqual(["--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--output=   "]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--output=   "])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(result.status).toBe(1);
  });

  it("prioritizes inline whitespace output validation while reporting unsupported options", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--output=   "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.activeCliOptions).toEqual(["--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--output=   "]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--output=   "])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(result.status).toBe(1);
  });

  it("fails when the last output flag value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-output-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", firstOutputPath, "--output"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.selectionMode).toBe("default");
    expect(report.specialSelectorsUsed).toEqual([]);
    expectAvailableCheckMetadataCoreFields(report);
    expectSelectorAndAliasMetadata(report);
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("fails when trailing inline output value is missing", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-trailing-inline-missing-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, `--output=${firstOutputPath}`, "--output="],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("prioritizes output validation errors over only-selection errors", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "--only", "invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual(["invalidCheck"]);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "invalidCheck",
        normalizedToken: "invalidcheck",
        kind: "invalid",
        resolvedTo: [],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 0,
      invalid: 1,
    });
    expectAvailableCheckMetadataCoreFields(report);
    expectSelectorAndAliasMetadata(report);
    expect(result.status).toBe(1);
  });

  it("keeps parsed requested checks when output value is missing", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "--only", "client"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBeNull();
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual(["client"]);
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expectAvailableCheckMetadataCoreFields(report);
    expectSelectorAndAliasMetadata(report);
    expect(result.status).toBe(1);
  });

  it("fails with structured output when only value is missing", () => {
    const result = spawnSync(process.execPath, [preflightScript, "--only"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(typeof report.endedAt).toBe("string");
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expectAvailableCheckInventoryMetadata(report);
    expectSelectorAndAliasMetadata(report);
    expect(result.status).toBe(1);
  });

  it("fails with structured output when only value is blank", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", " ,  , "],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expectAvailableCheckMetadataCoreFields(report);
    expectSelectorAndAliasMetadata(report);
    expect(result.status).toBe(1);
  });

  it("fails with structured output for invalid check names", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment,invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(typeof report.endedAt).toBe("string");
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
    expect(report.invalidCheckCount).toBe(1);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.requestedChecks).toEqual(["devEnvironment", "invalidCheck"]);
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 1,
    });
    expect(report.availableChecks).toEqual(expectedAvailableChecks);
    expectAvailableCheckMetadataCoreFields(report);
    expectSelectorAndAliasMetadata(report);
    expect(result.status).toBe(1);
  });

  it("tracks used special selectors when invalid checks are present", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "all,invalidCheck"],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["all", "invalidCheck"]);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "all",
        normalizedToken: "all",
        kind: "specialSelector",
        selector: "all",
        resolvedTo: [
          "devEnvironment",
          "wasmPack",
          "tsCore",
          "runtimeLibraries",
          "client",
        ],
      },
      {
        token: "invalidCheck",
        normalizedToken: "invalidcheck",
        kind: "invalid",
        resolvedTo: [],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 1,
      invalid: 1,
    });
    expect(report.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
    expect(result.status).toBe(1);
  });

  it("deduplicates repeated invalid check names in error output", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--only",
        "devEnvironment,invalidCheck,INVALID_CHECK,invalid-check,otherInvalid",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.message).toBe(
      "Invalid check name(s): invalidCheck, otherInvalid. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
    expect(report.invalidCheckCount).toBe(2);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.invalidChecks).toEqual(["invalidCheck", "otherInvalid"]);
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.requestedChecks).toEqual([
      "devEnvironment",
      "invalidCheck",
      "INVALID_CHECK",
      "invalid-check",
      "otherInvalid",
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 4,
    });
    expect(result.status).toBe(1);
  });

  it("writes structured validation errors to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-invalid-only-output-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "invalidCheck", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
    expect(stdoutReport.invalidChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.specialSelectorsUsed).toEqual([]);
    expect(stdoutReport.requestedChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "invalidCheck",
        normalizedToken: "invalidcheck",
        kind: "invalid",
        resolvedTo: [],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 0,
      invalid: 1,
    });
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.message).toBe(stdoutReport.message);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes structured validation errors to inline output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-invalid-only-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "invalidCheck", `--output=${outputPath}`],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.validationErrorCode).toBe("only_option_invalid_value");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.invalidChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.specialSelectorsUsed).toEqual([]);
    expect(stdoutReport.requestedChecks).toEqual(["invalidCheck"]);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for only-selection validation errors", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-invalid-only-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--only",
        "invalidCheck",
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
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.validationErrorCode).toBe("only_option_invalid_value");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.invalidChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.requestedChecks).toEqual(["invalidCheck"]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes missing only-value errors to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-missing-only-output-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.message).toBe("Missing value for --only option.");
    expect(stdoutReport.invalidChecks).toEqual([]);
    expect(stdoutReport.specialSelectorsUsed).toEqual([]);
    expect(stdoutReport.requestedChecks).toEqual([]);
    expect(stdoutReport.requestedCheckResolutions).toEqual([]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.message).toBe(stdoutReport.message);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes unsupported-option validation errors to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-unsupported-output-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.message).toBe(expectedUnsupportedOptionsMessage(["--mystery"]));
    expect(stdoutReport.invalidChecks).toEqual([]);
    expect(stdoutReport.requestedChecks).toEqual([]);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes unsupported-option validation errors to inline output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-unsupported-inline-output-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", `--output=${outputPath}`],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.message).toBe(expectedUnsupportedOptionsMessage(["--mystery"]));
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for unsupported-option validation errors", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-unsupported-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
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
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.message).toBe(expectedUnsupportedOptionsMessage(["--mystery"]));
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for unsupported-option validation errors with no-build aliases between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-preflight-unsupported-last-output-with-no-build-alias-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
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
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.message).toBe(expectedUnsupportedOptionsMessage(["--mystery"]));
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "--verify",
    ]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for inline no-build misuse validation errors", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-preflight-unsupported-last-output-inline-no-build-misuse-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
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
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>"])
    );
    expect(stdoutReport.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
    ]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes only-selection validation errors with unsupported options to output path", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-only-unsupported-output-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--only", "invalidCheck", "--output", outputPath],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.validationErrorCode).toBe("only_option_invalid_value");
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.invalidChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.invalidCheckCount).toBe(1);
    expect(stdoutReport.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for only-selection validation errors with unsupported options", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-only-unsupported-last-output-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--mystery",
        "--only",
        "invalidCheck",
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
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.validationErrorCode).toBe("only_option_invalid_value");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.invalidChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.invalidCheckCount).toBe(1);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for only-selection validation errors with inline no-build misuse", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-preflight-only-unsupported-inline-no-build-last-output-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--only",
        "invalidCheck",
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
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const secondFileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("only_option_invalid_value");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.invalidChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.invalidCheckCount).toBe(1);
    expect(stdoutReport.requestedChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "invalidCheck",
        normalizedToken: "invalidcheck",
        kind: "invalid",
        resolvedTo: [],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 0,
      invalid: 1,
    });
    expect(stdoutReport.activeCliOptions).toEqual(["--only", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--only", "--output"]);
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--only",
        "invalidCheck",
        "--output",
        firstOutputPath,
        "--verify=1",
        "--output",
        secondOutputPath,
      ])
    );
    expect(stdoutReport.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns structured write failures for validation-error output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-invalid-output-path-")
    );

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "invalidCheck", "--output", tempDirectory],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.writeError).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(report.message).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.requestedChecks).toEqual(["invalidCheck"]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 0,
      invalid: 1,
    });
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns structured write failures for unsupported-option output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-unsupported-invalid-path-")
    );

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--output", tempDirectory],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.writeError).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(report.message).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns structured write failures for only-selection validation with unsupported options", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-only-unsupported-invalid-path-")
    );

    const result = spawnSync(
      process.execPath,
      [preflightScript, "--mystery", "--only", "invalidCheck", "--output", tempDirectory],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_invalid_value");
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.invalidCheckCount).toBe(1);
    expect(report.writeError).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(report.message).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns write failures for only-selection validation with unsupported options when the last output path is invalid", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-only-unsupported-last-invalid-")
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--mystery",
        "--only",
        "invalidCheck",
        "--output",
        firstOutputPath,
        "--output",
        tempDirectory,
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        shell: false,
      }
    );
    const output = `${result.stdout}${result.stderr}`;
    const report = JSON.parse(output) as PreflightReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("only_option_invalid_value");
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.unknownOptions).toEqual(["--mystery"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.invalidCheckCount).toBe(1);
    expect(report.writeError).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(report.message).toContain(`Failed to write report to ${tempDirectory}.`);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
});
