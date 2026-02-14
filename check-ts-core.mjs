import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";
import {
  createCliOptionCatalog,
  createCliDiagnostics,
  createTimedReportBuilder,
  deriveCliValidationFailureMessage,
  hasCliOption,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
} from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = __dirname;
const tsCorePackageName = "@voxelize/ts-core";
const tsCorePackagePath = "packages/ts-core";
const requiredArtifacts = [
  "packages/ts-core/dist/index.js",
  "packages/ts-core/dist/index.mjs",
  "packages/ts-core/dist/index.d.ts",
];
const buildCommandArgs = [
  "--dir",
  repositoryRoot,
  "--filter",
  "@voxelize/ts-core",
  "run",
  "build",
];
const resolveMissingArtifacts = () => {
  return requiredArtifacts.filter((artifactPath) => {
    const absoluteArtifactPath = path.resolve(repositoryRoot, artifactPath);
    return !fs.existsSync(absoluteArtifactPath);
  });
};

const pnpmCommand = resolvePnpmCommand();
const cliArgs = process.argv.slice(2);
const {
  optionArgs: cliOptionArgs,
  positionalArgs,
  optionTerminatorUsed,
} = splitCliArgs(cliArgs);
const positionalArgCount = positionalArgs.length;
const noBuildOptionAliases = ["--verify"];
const optionAliases = {
  "--no-build": noBuildOptionAliases,
};
const canonicalCliOptions = [
  "--compact",
  "--json",
  "--no-build",
  "--output",
  "--quiet",
];
const isQuiet = cliOptionArgs.includes("--quiet");
const isJson = cliOptionArgs.includes("--json");
const isNoBuild = hasCliOption(cliOptionArgs, "--no-build", noBuildOptionAliases);
const isCompact = cliOptionArgs.includes("--compact");
const jsonFormat = { compact: isCompact };
const { supportedCliOptions: supportedCliOptionTokens } = createCliOptionCatalog({
  canonicalOptions: canonicalCliOptions,
  optionAliases,
});
const { outputPath, error: outputPathError } = resolveOutputPath(
  cliOptionArgs,
  process.cwd(),
  supportedCliOptionTokens
);
const {
  availableCliOptionAliases,
  availableCliOptionCanonicalMap,
  supportedCliOptions,
  supportedCliOptionCount,
  unknownOptions,
  unknownOptionCount,
  unsupportedOptionsError,
  validationErrorCode,
  activeCliOptions,
  activeCliOptionCount,
  activeCliOptionTokens,
  activeCliOptionResolutions,
  activeCliOptionResolutionCount,
  activeCliOptionOccurrences,
  activeCliOptionOccurrenceCount,
} = createCliDiagnostics(cliOptionArgs, {
  canonicalOptions: canonicalCliOptions,
  optionAliases,
  optionsWithValues: ["--output"],
  optionsWithStrictValues: ["--output"],
  outputPathError,
});
const buildTimedReport = createTimedReportBuilder();
const validationFailureMessage = deriveCliValidationFailureMessage({
  outputPathError,
  unsupportedOptionsError,
});
const withBaseReportFields = (report) => {
  const hasOutputPath = Object.prototype.hasOwnProperty.call(report, "outputPath");
  const missingArtifacts = Array.isArray(report.missingArtifacts)
    ? report.missingArtifacts
    : [];
  const missingArtifactSet = new Set(missingArtifacts);
  const presentArtifacts = requiredArtifacts.filter((artifactPath) => {
    return !missingArtifactSet.has(artifactPath);
  });
  const presentArtifactCount = requiredArtifacts.length - missingArtifacts.length;
  const buildExitCode =
    typeof report.buildExitCode === "number" ? report.buildExitCode : null;
  const buildDurationMs =
    typeof report.buildDurationMs === "number" ? report.buildDurationMs : null;
  const buildSkippedReason =
    report.buildSkippedReason === "no-build" ||
    report.buildSkippedReason === "artifacts-present"
      ? report.buildSkippedReason
      : null;
  return {
    ...report,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    noBuild: isNoBuild,
    outputPath: hasOutputPath ? report.outputPath : outputPath,
    activeCliOptions,
    activeCliOptionCount,
    activeCliOptionTokens,
    activeCliOptionResolutions,
    activeCliOptionResolutionCount,
    activeCliOptionOccurrences,
    activeCliOptionOccurrenceCount,
    unknownOptions,
    unknownOptionCount,
    supportedCliOptions,
    supportedCliOptionCount,
    availableCliOptionAliases,
    availableCliOptionCanonicalMap,
    checkedPackage: tsCorePackageName,
    checkedPackageCount: 1,
    packagePath: tsCorePackagePath,
    requiredArtifacts,
    requiredArtifactCount: requiredArtifacts.length,
    presentArtifacts,
    presentArtifactCount,
    missingArtifactCount: missingArtifacts.length,
    buildCommand: pnpmCommand,
    buildArgs: buildCommandArgs,
    buildExitCode,
    buildDurationMs,
    buildSkippedReason,
  };
};
const finish = (report) => {
  if (isJson) {
    const finalizedReport = buildTimedReport(
      withBaseReportFields({
        ...report,
        validationErrorCode: null,
      })
    );
    const { reportJson, writeError } = serializeReportWithOptionalWrite(
      finalizedReport,
      {
        jsonFormat,
        outputPath,
        buildTimedReport,
      }
    );

    console.log(reportJson);
    process.exit(writeError === null ? report.exitCode : 1);
  }

  if (!report.passed) {
    console.error(report.message);
  } else if (!isQuiet) {
    console.log(report.message);
  }

  process.exit(report.exitCode);
};

if (isJson && validationFailureMessage !== null) {
  const missingArtifacts = resolveMissingArtifacts();
  const report = buildTimedReport(
    withBaseReportFields({
      passed: false,
      exitCode: 1,
      outputPath: outputPathError === null ? outputPath : null,
      artifactsPresent: missingArtifacts.length === 0,
      missingArtifacts,
      attemptedBuild: false,
      buildSkipped: isNoBuild,
      buildSkippedReason: isNoBuild ? "no-build" : null,
      buildOutput: null,
      validationErrorCode,
      message: validationFailureMessage,
    })
  );
  const { reportJson } = serializeReportWithOptionalWrite(report, {
    jsonFormat,
    outputPath: outputPathError === null ? outputPath : null,
    buildTimedReport,
  });

  console.log(reportJson);
  process.exit(1);
}

if (!isJson && validationFailureMessage !== null) {
  console.error(validationFailureMessage);
  process.exit(1);
}

const initialMissingArtifacts = resolveMissingArtifacts();
if (initialMissingArtifacts.length === 0) {
  finish({
    passed: true,
    exitCode: 0,
    artifactsPresent: true,
    missingArtifacts: [],
    attemptedBuild: false,
    buildSkipped: true,
    buildSkippedReason: "artifacts-present",
    buildOutput: null,
    message: "TypeScript core build artifacts are available.",
  });
}

if (isNoBuild) {
  finish({
    passed: false,
    exitCode: 1,
    artifactsPresent: false,
    missingArtifacts: initialMissingArtifacts,
    attemptedBuild: false,
    buildSkipped: true,
    buildSkippedReason: "no-build",
    buildOutput: null,
    message: `Missing ${initialMissingArtifacts.join(", ")}. Build was skipped due to --no-build. Run \`pnpm --filter @voxelize/ts-core run build\` from the repository root.`,
  });
}

if (!isJson && !isQuiet) {
  console.log("TypeScript core build artifacts missing. Running package build...");
}

const buildStartedAt = Date.now();
const buildResult = isJson
  ? spawnSync(pnpmCommand, buildCommandArgs, {
      encoding: "utf8",
      shell: false,
      cwd: repositoryRoot,
    })
  : spawnSync(pnpmCommand, buildCommandArgs, {
      stdio: "inherit",
      shell: false,
      cwd: repositoryRoot,
    });
const buildDurationMs = Date.now() - buildStartedAt;
const buildExitCode = buildResult.status ?? 1;
const buildOutput = `${buildResult.stdout ?? ""}${buildResult.stderr ?? ""}`.trim();
const missingArtifactsAfterBuild = resolveMissingArtifacts();
if (buildExitCode === 0 && missingArtifactsAfterBuild.length === 0) {
  finish({
    passed: true,
    exitCode: 0,
    artifactsPresent: true,
    missingArtifacts: [],
    attemptedBuild: true,
    buildSkipped: false,
    buildSkippedReason: null,
    buildOutput: isJson ? buildOutput : null,
    buildExitCode,
    buildDurationMs,
    message: "TypeScript core build artifacts are available.",
  });
}

finish({
  passed: false,
  exitCode: buildExitCode,
  artifactsPresent: false,
  missingArtifacts: missingArtifactsAfterBuild,
  attemptedBuild: true,
  buildSkipped: false,
  buildSkippedReason: null,
  buildOutput: isJson ? buildOutput : null,
  buildExitCode,
  buildDurationMs,
  message:
    missingArtifactsAfterBuild.length === 0
      ? "Failed to build @voxelize/ts-core."
      : `Failed to generate required artifacts for @voxelize/ts-core: ${missingArtifactsAfterBuild.join(", ")}.`,
});
