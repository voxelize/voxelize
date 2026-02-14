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
const runtimeLibraries = [
  {
    packageName: "@voxelize/aabb",
    packagePath: "packages/aabb",
    requiredArtifacts: [
      "packages/aabb/dist/index.js",
      "packages/aabb/dist/index.mjs",
      "packages/aabb/dist/index.d.ts",
    ],
  },
  {
    packageName: "@voxelize/raycast",
    packagePath: "packages/raycast",
    requiredArtifacts: [
      "packages/raycast/dist/index.js",
      "packages/raycast/dist/index.mjs",
      "packages/raycast/dist/index.d.ts",
    ],
  },
  {
    packageName: "@voxelize/physics-engine",
    packagePath: "packages/physics-engine",
    requiredArtifacts: [
      "packages/physics-engine/dist/index.cjs",
      "packages/physics-engine/dist/index.js",
      "packages/physics-engine/dist/index.d.ts",
    ],
  },
];
const checkedPackages = runtimeLibraries.map((library) => library.packageName);
const requiredArtifactCount = runtimeLibraries.reduce((count, library) => {
  return count + library.requiredArtifacts.length;
}, 0);
const resolvePackageReport = (library) => {
  const missingArtifacts = library.requiredArtifacts.filter((artifactPath) => {
    const absoluteArtifactPath = path.resolve(repositoryRoot, artifactPath);
    return !fs.existsSync(absoluteArtifactPath);
  });
  const missingArtifactSet = new Set(missingArtifacts);
  const presentArtifacts = library.requiredArtifacts.filter((artifactPath) => {
    return !missingArtifactSet.has(artifactPath);
  });
  const presentArtifactCount = library.requiredArtifacts.length - missingArtifacts.length;
  return {
    packageName: library.packageName,
    packagePath: library.packagePath,
    requiredArtifacts: library.requiredArtifacts,
    requiredArtifactCount: library.requiredArtifacts.length,
    presentArtifacts,
    presentArtifactCount,
    missingArtifacts,
    missingArtifactCount: missingArtifacts.length,
    artifactsPresent: missingArtifacts.length === 0,
  };
};
const resolvePackageReports = () => {
  return runtimeLibraries.map(resolvePackageReport);
};
const summarizePackageReports = (packageReports) => {
  const presentPackageCount = packageReports.filter((packageReport) => {
    return packageReport.artifactsPresent;
  }).length;
  const presentArtifactCount = packageReports.reduce((count, packageReport) => {
    return count + packageReport.presentArtifactCount;
  }, 0);
  const missingPackageCount = packageReports.filter((packageReport) => {
    return packageReport.artifactsPresent === false;
  }).length;
  const missingArtifactCount = packageReports.reduce((count, packageReport) => {
    return count + packageReport.missingArtifactCount;
  }, 0);
  return {
    presentPackageCount,
    presentArtifactCount,
    missingPackageCount,
    missingArtifactCount,
  };
};
const formatMissingArtifactSummary = (packageReports) => {
  const missingSummaries = packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => {
      return `${packageReport.packageName}: ${packageReport.missingArtifacts.join(", ")}`;
    });
  return missingSummaries.join(" | ");
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
const buildCommandArgs = [
  "--dir",
  repositoryRoot,
  "--filter",
  "@voxelize/aabb",
  "--filter",
  "@voxelize/raycast",
  "--filter",
  "@voxelize/physics-engine",
  "run",
  "build",
];
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
  const packageReports = Array.isArray(report.packageReports)
    ? report.packageReports
    : [];
  const {
    presentPackageCount,
    presentArtifactCount,
    missingPackageCount,
    missingArtifactCount,
  } = summarizePackageReports(packageReports);
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
    checkedPackages,
    checkedPackageCount: checkedPackages.length,
    requiredPackageCount: runtimeLibraries.length,
    presentPackageCount,
    packageReportCount: packageReports.length,
    requiredArtifactCount,
    presentArtifactCount,
    missingPackageCount,
    missingArtifactCount,
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
  const packageReports = resolvePackageReports();
  const { missingPackageCount } = summarizePackageReports(packageReports);
  const report = buildTimedReport(
    withBaseReportFields({
      passed: false,
      exitCode: 1,
      outputPath: outputPathError === null ? outputPath : null,
      packagesPresent: missingPackageCount === 0,
      packageReports,
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

const initialPackageReports = resolvePackageReports();
const initialSummary = summarizePackageReports(initialPackageReports);
if (initialSummary.missingPackageCount === 0) {
  finish({
    passed: true,
    exitCode: 0,
    packagesPresent: true,
    packageReports: initialPackageReports,
    attemptedBuild: false,
    buildSkipped: true,
    buildSkippedReason: "artifacts-present",
    buildOutput: null,
    message: "Runtime library build artifacts are available.",
  });
}

if (isNoBuild) {
  finish({
    passed: false,
    exitCode: 1,
    packagesPresent: false,
    packageReports: initialPackageReports,
    attemptedBuild: false,
    buildSkipped: true,
    buildSkippedReason: "no-build",
    buildOutput: null,
    message: `Missing runtime library artifacts: ${formatMissingArtifactSummary(initialPackageReports)}. Build was skipped due to --no-build. Run \`pnpm --filter @voxelize/aabb --filter @voxelize/raycast --filter @voxelize/physics-engine run build\` from the repository root.`,
  });
}

if (!isJson && !isQuiet) {
  console.log(
    "Runtime library artifacts missing. Running package builds for @voxelize/aabb, @voxelize/raycast, and @voxelize/physics-engine..."
  );
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
const packageReportsAfterBuild = resolvePackageReports();
const summaryAfterBuild = summarizePackageReports(packageReportsAfterBuild);
if (buildExitCode === 0 && summaryAfterBuild.missingPackageCount === 0) {
  finish({
    passed: true,
    exitCode: 0,
    packagesPresent: true,
    packageReports: packageReportsAfterBuild,
    attemptedBuild: true,
    buildSkipped: false,
    buildSkippedReason: null,
    buildOutput: isJson ? buildOutput : null,
    buildExitCode,
    buildDurationMs,
    message: "Runtime library build artifacts are available.",
  });
}

finish({
  passed: false,
  exitCode: buildExitCode,
  packagesPresent: false,
  packageReports: packageReportsAfterBuild,
  attemptedBuild: true,
  buildSkipped: false,
  buildSkippedReason: null,
  buildOutput: isJson ? buildOutput : null,
  buildExitCode,
  buildDurationMs,
  message:
    summaryAfterBuild.missingPackageCount === 0
      ? "Failed to build runtime libraries."
      : `Failed to generate required runtime library artifacts: ${formatMissingArtifactSummary(packageReportsAfterBuild)}.`,
});
