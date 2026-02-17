import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";
import {
  countRecordEntries,
  createCliOptionCatalog,
  createCliDiagnostics,
  createTimedReportBuilder,
  deriveCliValidationFailureMessage,
  hasCliOption,
  normalizeTsCorePayloadIssues,
  resolveOutputPath,
  summarizeTsCoreExampleOutput,
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
const exampleCommand = process.execPath;
const exampleArgs = [
  path.resolve(repositoryRoot, "packages/ts-core/examples/end-to-end.mjs"),
];
const resolveMissingArtifacts = () => {
  return requiredArtifacts.filter((artifactPath) => {
    const absoluteArtifactPath = path.resolve(repositoryRoot, artifactPath);
    return !fs.existsSync(absoluteArtifactPath);
  });
};
const isExampleCheckPassing = (exampleCheckResult) => {
  return (
    exampleCheckResult.exampleExitCode === 0 &&
    exampleCheckResult.exampleRuleMatched === true &&
    exampleCheckResult.examplePayloadValid === true
  );
};
const deriveExampleFailureMessage = (exampleCheckResult) => {
  if (exampleCheckResult.exampleExitCode !== 0) {
    return "TypeScript core end-to-end example failed.";
  }

  if (exampleCheckResult.exampleRuleMatched === false) {
    const payloadIssues = normalizeTsCorePayloadIssues(
      exampleCheckResult.examplePayloadIssues
    );
    if (
      exampleCheckResult.examplePayloadValid === false &&
      payloadIssues !== null &&
      payloadIssues.length > 0
    ) {
      return `TypeScript core end-to-end example reported ruleMatched=false and has missing or invalid required payload fields: ${payloadIssues.join(", ")}.`;
    }

    if (exampleCheckResult.examplePayloadValid === false) {
      return "TypeScript core end-to-end example reported ruleMatched=false and has missing or invalid required payload fields.";
    }

    return "TypeScript core end-to-end example reported ruleMatched=false.";
  }

  if (exampleCheckResult.exampleRuleMatched !== true) {
    if (exampleCheckResult.exampleOutputLine === null) {
      return "TypeScript core end-to-end example produced no parseable JSON output.";
    }

    const payloadIssues = normalizeTsCorePayloadIssues(
      exampleCheckResult.examplePayloadIssues
    );
    if (
      exampleCheckResult.examplePayloadValid === false &&
      payloadIssues !== null &&
      payloadIssues.length > 0
    ) {
      return `TypeScript core end-to-end example output was invalid and has missing or invalid required payload fields: ${payloadIssues.join(", ")}.`;
    }

    if (exampleCheckResult.examplePayloadValid === false) {
      return "TypeScript core end-to-end example output was invalid and has missing or invalid required payload fields.";
    }

    return "TypeScript core end-to-end example output was invalid.";
  }

  if (exampleCheckResult.examplePayloadValid === false) {
    const payloadIssues = normalizeTsCorePayloadIssues(
      exampleCheckResult.examplePayloadIssues
    );
    if (payloadIssues !== null && payloadIssues.length > 0) {
      return `TypeScript core end-to-end example output has missing or invalid required payload fields: ${payloadIssues.join(", ")}.`;
    }

    return "TypeScript core end-to-end example output has missing or invalid required payload fields.";
  }

  return "TypeScript core end-to-end example output was invalid.";
};
const runTsCoreExampleCheck = () => {
  const exampleStartedAt = Date.now();
  const exampleResult = spawnSync(exampleCommand, exampleArgs, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  const exampleDurationMs = Date.now() - exampleStartedAt;
  const exampleExitCode = exampleResult.status ?? 1;
  const exampleOutput = `${exampleResult.stdout ?? ""}${exampleResult.stderr ?? ""}`.trim();
  const {
    exampleRuleMatched,
    examplePayloadValid,
    examplePayloadIssues,
    exampleOutputLine,
  } =
    summarizeTsCoreExampleOutput(exampleOutput);

  return {
    exampleExitCode,
    exampleDurationMs,
    exampleRuleMatched,
    examplePayloadValid,
    examplePayloadIssues,
    exampleOutputLine,
  };
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
  const missingArtifactSummary =
    missingArtifacts.length === 0 ? null : missingArtifacts.join(", ");
  const artifactsPresent =
    typeof report.artifactsPresent === "boolean"
      ? report.artifactsPresent
      : missingArtifacts.length === 0;
  const presentPackages = artifactsPresent ? [tsCorePackageName] : [];
  const missingPackages = artifactsPresent ? [] : [tsCorePackageName];
  const checkedPackageIndices = [0];
  const checkedPackageIndexMap = {
    [tsCorePackageName]: 0,
  };
  const availablePackageIndices = [0];
  const availablePackageIndexMap = {
    [tsCorePackageName]: 0,
  };
  const availablePackagePathMap = {
    [tsCorePackageName]: tsCorePackagePath,
  };
  const presentPackagePaths = artifactsPresent ? [tsCorePackagePath] : [];
  const missingPackagePaths = artifactsPresent ? [] : [tsCorePackagePath];
  const presentPackageIndices = artifactsPresent ? [0] : [];
  const missingPackageIndices = artifactsPresent ? [] : [0];
  const presentPackageIndexMap = artifactsPresent
    ? {
        [tsCorePackageName]: 0,
      }
    : {};
  const missingPackageIndexMap = artifactsPresent
    ? {}
    : {
        [tsCorePackageName]: 0,
      };
  const presentPackagePathMap = artifactsPresent
    ? {
        [tsCorePackageName]: tsCorePackagePath,
      }
    : {};
  const missingPackagePathMap = artifactsPresent
    ? {}
    : {
        [tsCorePackageName]: tsCorePackagePath,
      };
  const presentPackagePathCount = presentPackagePaths.length;
  const missingPackagePathCount = missingPackagePaths.length;
  const presentArtifactCount = requiredArtifacts.length - missingArtifacts.length;
  const checkedPackagePathMap = {
    [tsCorePackageName]: tsCorePackagePath,
  };
  const packageCheckCommand = "artifact-exists";
  const packageCheckArgs = requiredArtifacts;
  const packageCheckArgCount = packageCheckArgs.length;
  const requiredArtifactCountByPackage = {
    [tsCorePackageName]: requiredArtifacts.length,
  };
  const packageStatusMap = {
    [tsCorePackageName]: artifactsPresent ? "present" : "missing",
  };
  const packageStatusCountMap = {
    present: presentPackages.length,
    missing: missingPackages.length,
  };
  const requiredArtifactsByPackage = {
    [tsCorePackageName]: requiredArtifacts,
  };
  const artifactsPresentByPackage = {
    [tsCorePackageName]: artifactsPresent,
  };
  const presentArtifactsByPackage = {
    [tsCorePackageName]: presentArtifacts,
  };
  const presentArtifactCountByPackage = {
    [tsCorePackageName]: presentArtifactCount,
  };
  const missingArtifactsByPackage = {
    [tsCorePackageName]: missingArtifacts,
  };
  const missingArtifactCountByPackage = {
    [tsCorePackageName]: missingArtifacts.length,
  };
  const presentPackageArtifactsByPackage = artifactsPresent
    ? {
        [tsCorePackageName]: presentArtifacts,
      }
    : {};
  const missingPackageArtifactsByPackage = artifactsPresent
    ? {}
    : {
        [tsCorePackageName]: missingArtifacts,
      };
  const presentPackageArtifactCountByPackage = artifactsPresent
    ? {
        [tsCorePackageName]: presentArtifactCount,
      }
    : {};
  const missingPackageArtifactCountByPackage = artifactsPresent
    ? {}
    : {
        [tsCorePackageName]: missingArtifacts.length,
      };
  const packageReport = {
    packageName: tsCorePackageName,
    packagePath: tsCorePackagePath,
    packageIndex: 0,
    requiredArtifacts,
    requiredArtifactCount: requiredArtifacts.length,
    checkCommand: packageCheckCommand,
    checkArgs: packageCheckArgs,
    checkArgCount: packageCheckArgCount,
    presentArtifacts,
    presentArtifactCount,
    missingArtifacts,
    missingArtifactCount: missingArtifacts.length,
    artifactsPresent,
  };
  const presentPackageMetadata = artifactsPresent
    ? {
        [tsCorePackageName]: {
          packagePath: tsCorePackagePath,
          packageIndex: 0,
          checkCommand: packageCheckCommand,
          checkArgs: packageCheckArgs,
          checkArgCount: packageCheckArgCount,
          presentArtifactCount,
          missingArtifactCount: missingArtifacts.length,
          artifactsPresent,
        },
      }
    : {};
  const missingPackageMetadata = artifactsPresent
    ? {}
    : {
        [tsCorePackageName]: {
          packagePath: tsCorePackagePath,
          packageIndex: 0,
          checkCommand: packageCheckCommand,
          checkArgs: packageCheckArgs,
          checkArgCount: packageCheckArgCount,
          presentArtifactCount,
          missingArtifactCount: missingArtifacts.length,
          artifactsPresent,
        },
      };
  const packageReportMap = {
    [tsCorePackageName]: packageReport,
  };
  const packageCheckCommandMap = {
    [tsCorePackageName]: packageCheckCommand,
  };
  const packageCheckArgsMap = {
    [tsCorePackageName]: packageCheckArgs,
  };
  const packageCheckArgCountMap = {
    [tsCorePackageName]: packageCheckArgCount,
  };
  const availablePackageCheckCommandMap = {
    [tsCorePackageName]: packageCheckCommand,
  };
  const availablePackageCheckArgsMap = {
    [tsCorePackageName]: packageCheckArgs,
  };
  const availablePackageCheckArgCountMap = {
    [tsCorePackageName]: packageCheckArgCount,
  };
  const presentPackageCheckCommandMap = artifactsPresent
    ? {
        [tsCorePackageName]: packageCheckCommand,
      }
    : {};
  const missingPackageCheckCommandMap = artifactsPresent
    ? {}
    : {
        [tsCorePackageName]: packageCheckCommand,
      };
  const presentPackageCheckArgsMap = artifactsPresent
    ? {
        [tsCorePackageName]: packageCheckArgs,
      }
    : {};
  const missingPackageCheckArgsMap = artifactsPresent
    ? {}
    : {
        [tsCorePackageName]: packageCheckArgs,
      };
  const presentPackageCheckArgCountMap = artifactsPresent
    ? {
        [tsCorePackageName]: packageCheckArgCount,
      }
    : {};
  const missingPackageCheckArgCountMap = artifactsPresent
    ? {}
    : {
        [tsCorePackageName]: packageCheckArgCount,
      };
  const availablePackageMetadata = {
    [tsCorePackageName]: {
      packagePath: tsCorePackagePath,
      checkCommand: packageCheckCommand,
      checkArgs: packageCheckArgs,
      checkArgCount: packageCheckArgCount,
      requiredArtifactCount: requiredArtifacts.length,
    },
  };
  const buildExitCode =
    typeof report.buildExitCode === "number" ? report.buildExitCode : null;
  const buildDurationMs =
    typeof report.buildDurationMs === "number" ? report.buildDurationMs : null;
  const buildSkippedReason =
    report.buildSkippedReason === "no-build" ||
    report.buildSkippedReason === "artifacts-present"
      ? report.buildSkippedReason
      : null;
  const exampleExitCode =
    typeof report.exampleExitCode === "number" ? report.exampleExitCode : null;
  const exampleDurationMs =
    typeof report.exampleDurationMs === "number"
      ? report.exampleDurationMs
      : null;
  const exampleRuleMatched =
    typeof report.exampleRuleMatched === "boolean" ? report.exampleRuleMatched : null;
  const examplePayloadValid =
    typeof report.examplePayloadValid === "boolean"
      ? report.examplePayloadValid
      : null;
  const rawExamplePayloadIssues = normalizeTsCorePayloadIssues(
    report.examplePayloadIssues
  );
  const examplePayloadIssues =
    examplePayloadValid === true ? [] : rawExamplePayloadIssues;
  const examplePayloadIssueCount =
    examplePayloadIssues === null
      ? typeof report.examplePayloadIssueCount === "number"
        ? report.examplePayloadIssueCount
        : null
      : examplePayloadIssues.length;
  const exampleOutputLine =
    typeof report.exampleOutputLine === "string" ? report.exampleOutputLine : null;
  const exampleAttempted =
    typeof report.exampleAttempted === "boolean" ? report.exampleAttempted : false;
  const exampleStatus =
    report.exampleStatus === "ok" ||
    report.exampleStatus === "failed" ||
    report.exampleStatus === "skipped"
      ? report.exampleStatus
      : exampleAttempted
        ? exampleExitCode === 0 &&
          exampleRuleMatched === true &&
          examplePayloadValid === true
          ? "ok"
          : "failed"
        : "skipped";
  const artifactFailureSummaries =
    missingArtifacts.length === 0
      ? []
      : [
          {
            kind: "artifacts",
            packageName: tsCorePackageName,
            packagePath: tsCorePackagePath,
            packageIndex: 0,
            checkCommand: packageCheckCommand,
            checkArgs: packageCheckArgs,
            checkArgCount: packageCheckArgCount,
            missingArtifacts,
            missingArtifactCount: missingArtifacts.length,
            message: `Missing artifacts for ${tsCorePackageName}: ${missingArtifacts.join(", ")}.`,
          },
        ];
  const exampleFailureSummaries =
    exampleStatus !== "failed"
      ? []
      : [
          {
            kind: "example",
            packageName: tsCorePackageName,
            packagePath: tsCorePackagePath,
            packageIndex: 0,
            checkCommand: exampleCommand,
            checkArgs: exampleArgs,
            checkArgCount: exampleArgs.length,
            exitCode: exampleExitCode,
            ruleMatched: exampleRuleMatched,
            payloadValid: examplePayloadValid,
            payloadIssues: examplePayloadIssues,
            payloadIssueCount: examplePayloadIssueCount,
            outputLine: exampleOutputLine,
            message: deriveExampleFailureMessage({
              exampleExitCode,
              exampleRuleMatched,
              examplePayloadValid,
              examplePayloadIssues,
              exampleOutputLine,
            }),
          },
        ];
  const failureSummaries = [
    ...artifactFailureSummaries,
    ...exampleFailureSummaries,
  ];
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
    checkedPackagePath: tsCorePackagePath,
    checkedPackagePathCount: 1,
    availablePackages: [tsCorePackageName],
    availablePackageCount: 1,
    availablePackagePaths: [tsCorePackagePath],
    availablePackagePathCount: 1,
    availablePackageIndices,
    availablePackageIndexCount: availablePackageIndices.length,
    availablePackageIndexMap,
    availablePackageIndexMapCount: countRecordEntries(availablePackageIndexMap),
    availablePackagePathMap,
    availablePackagePathMapCount: countRecordEntries(availablePackagePathMap),
    availablePackageCheckCommandMap,
    availablePackageCheckCommandMapCount: countRecordEntries(
      availablePackageCheckCommandMap
    ),
    availablePackageCheckArgsMap,
    availablePackageCheckArgsMapCount: countRecordEntries(
      availablePackageCheckArgsMap
    ),
    availablePackageCheckArgCountMap,
    availablePackageCheckArgCountMapCount: countRecordEntries(
      availablePackageCheckArgCountMap
    ),
    availablePackageMetadata,
    availablePackageMetadataCount: countRecordEntries(availablePackageMetadata),
    checkedPackageIndices,
    checkedPackageIndexCount: checkedPackageIndices.length,
    checkedPackageIndexMap,
    checkedPackageIndexMapCount: countRecordEntries(checkedPackageIndexMap),
    checkedPackagePathMap,
    checkedPackagePathMapCount: countRecordEntries(checkedPackagePathMap),
    packageStatusMap,
    packageStatusMapCount: countRecordEntries(packageStatusMap),
    packageStatusCountMap,
    packageStatusCountMapCount: countRecordEntries(packageStatusCountMap),
    presentPackages,
    missingPackages,
    presentPackageIndices,
    missingPackageIndices,
    presentPackageIndexMap,
    missingPackageIndexMap,
    presentPackagePaths,
    missingPackagePaths,
    presentPackagePathMap,
    missingPackagePathMap,
    presentPackageCheckCommandMap,
    missingPackageCheckCommandMap,
    presentPackageCheckArgsMap,
    missingPackageCheckArgsMap,
    presentPackageCheckArgCountMap,
    missingPackageCheckArgCountMap,
    presentPackageMetadata,
    missingPackageMetadata,
    requiredPackageCount: 1,
    presentPackageCount: presentPackages.length,
    missingPackageCount: missingPackages.length,
    presentPackageIndexCount: presentPackageIndices.length,
    missingPackageIndexCount: missingPackageIndices.length,
    presentPackageIndexMapCount: countRecordEntries(presentPackageIndexMap),
    missingPackageIndexMapCount: countRecordEntries(missingPackageIndexMap),
    presentPackagePathCount,
    missingPackagePathCount,
    presentPackagePathMapCount: countRecordEntries(presentPackagePathMap),
    missingPackagePathMapCount: countRecordEntries(missingPackagePathMap),
    presentPackageCheckCommandMapCount: countRecordEntries(
      presentPackageCheckCommandMap
    ),
    missingPackageCheckCommandMapCount: countRecordEntries(
      missingPackageCheckCommandMap
    ),
    presentPackageCheckArgsMapCount: countRecordEntries(presentPackageCheckArgsMap),
    missingPackageCheckArgsMapCount: countRecordEntries(missingPackageCheckArgsMap),
    presentPackageCheckArgCountMapCount: countRecordEntries(
      presentPackageCheckArgCountMap
    ),
    missingPackageCheckArgCountMapCount: countRecordEntries(
      missingPackageCheckArgCountMap
    ),
    presentPackageMetadataCount: countRecordEntries(presentPackageMetadata),
    missingPackageMetadataCount: countRecordEntries(missingPackageMetadata),
    packageReport,
    packageReportCount: 1,
    packageReportMap,
    packageReportMapCount: countRecordEntries(packageReportMap),
    packageCheckCommandMap,
    packageCheckCommandMapCount: countRecordEntries(packageCheckCommandMap),
    packageCheckArgsMap,
    packageCheckArgsMapCount: countRecordEntries(packageCheckArgsMap),
    packageCheckArgCountMap,
    packageCheckArgCountMapCount: countRecordEntries(packageCheckArgCountMap),
    packagePath: tsCorePackagePath,
    requiredArtifacts,
    requiredArtifactsByPackage,
    requiredArtifactsByPackageCount: countRecordEntries(requiredArtifactsByPackage),
    requiredArtifactCountByPackage,
    requiredArtifactCount: requiredArtifacts.length,
    requiredArtifactCountByPackageCount: countRecordEntries(
      requiredArtifactCountByPackage
    ),
    artifactsPresentByPackage,
    artifactsPresentByPackageCount: countRecordEntries(artifactsPresentByPackage),
    presentArtifacts,
    presentArtifactsByPackage,
    presentArtifactsByPackageCount: countRecordEntries(presentArtifactsByPackage),
    presentArtifactCount,
    presentArtifactCountByPackage,
    presentArtifactCountByPackageCount: countRecordEntries(
      presentArtifactCountByPackage
    ),
    presentPackageArtifactsByPackage,
    presentPackageArtifactsByPackageCount: countRecordEntries(
      presentPackageArtifactsByPackage
    ),
    presentPackageArtifactCountByPackage,
    presentPackageArtifactCountByPackageCount: countRecordEntries(
      presentPackageArtifactCountByPackage
    ),
    missingArtifactsByPackage,
    missingArtifactsByPackageCount: countRecordEntries(missingArtifactsByPackage),
    missingArtifactCount: missingArtifacts.length,
    missingArtifactCountByPackage,
    missingArtifactCountByPackageCount: countRecordEntries(
      missingArtifactCountByPackage
    ),
    missingPackageArtifactsByPackage,
    missingPackageArtifactsByPackageCount: countRecordEntries(
      missingPackageArtifactsByPackage
    ),
    missingPackageArtifactCountByPackage,
    missingPackageArtifactCountByPackageCount: countRecordEntries(
      missingPackageArtifactCountByPackage
    ),
    failureSummaries,
    failureSummaryCount: failureSummaries.length,
    missingArtifactSummary,
    buildCommand: pnpmCommand,
    buildArgs: buildCommandArgs,
    buildExitCode,
    buildDurationMs,
    buildSkippedReason,
    exampleCommand,
    exampleArgs,
    exampleArgCount: exampleArgs.length,
    exampleAttempted,
    exampleStatus,
    exampleRuleMatched,
    examplePayloadValid,
    examplePayloadIssues,
    examplePayloadIssueCount,
    exampleExitCode,
    exampleDurationMs,
    exampleOutputLine,
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
const finishWithExampleCheck = ({
  attemptedBuild,
  buildSkipped,
  buildSkippedReason,
  buildOutput,
  buildExitCode,
  buildDurationMs,
}) => {
  const exampleCheckResult = runTsCoreExampleCheck();
  if (isExampleCheckPassing(exampleCheckResult)) {
    finish({
      passed: true,
      exitCode: 0,
      artifactsPresent: true,
      missingArtifacts: [],
      attemptedBuild,
      buildSkipped,
      buildSkippedReason,
      buildOutput,
      buildExitCode,
      buildDurationMs,
      exampleAttempted: true,
      ...exampleCheckResult,
      message:
        "TypeScript core build artifacts are available and the end-to-end example succeeded.",
    });
    return;
  }

  const exampleFailureMessage = deriveExampleFailureMessage(exampleCheckResult);
  finish({
    passed: false,
    exitCode:
      exampleCheckResult.exampleExitCode === 0 ? 1 : exampleCheckResult.exampleExitCode,
    artifactsPresent: true,
    missingArtifacts: [],
    attemptedBuild,
    buildSkipped,
    buildSkippedReason,
    buildOutput,
    buildExitCode,
    buildDurationMs,
    exampleAttempted: true,
    ...exampleCheckResult,
    message: `TypeScript core build artifacts are available, but ${exampleFailureMessage}`,
  });
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
  finishWithExampleCheck({
    attemptedBuild: false,
    buildSkipped: true,
    buildSkippedReason: "artifacts-present",
    buildOutput: null,
    buildExitCode: null,
    buildDurationMs: null,
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
  finishWithExampleCheck({
    attemptedBuild: true,
    buildSkipped: false,
    buildSkippedReason: null,
    buildOutput: isJson ? buildOutput : null,
    buildExitCode,
    buildDurationMs,
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
