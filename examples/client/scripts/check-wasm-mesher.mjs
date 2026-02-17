import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "../../../scripts/command-utils.mjs";
import {
  createCliOptionCatalog,
  createCliDiagnostics,
  deriveWasmPackCheckStatus,
  deriveCliValidationFailureMessage,
  createTimedReportBuilder,
  hasCliOption,
  parseJsonOutput,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
} from "../../../scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wasmMesherEntry = path.resolve(
  __dirname,
  "../../../crates/wasm-mesher/pkg/voxelize_wasm_mesher.js"
);
const repositoryRoot = path.resolve(__dirname, "../../..");
const rootWasmCheckScript = path.resolve(repositoryRoot, "check-wasm-pack.mjs");
const wasmPackCheckCommand = process.execPath;
const wasmPackCheckJsonArgs = [rootWasmCheckScript, "--json", "--compact"];
const wasmPackCheckQuietArgs = [rootWasmCheckScript, "--quiet"];
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
const canonicalCliOptions = ["--compact", "--json", "--no-build", "--output"];
const isJson = cliOptionArgs.includes("--json");
const isNoBuild = hasCliOption(cliOptionArgs, "--no-build", noBuildOptionAliases);
const isCompact = cliOptionArgs.includes("--compact");
const resolvedWasmPackCheckArgs = isJson
  ? wasmPackCheckJsonArgs
  : wasmPackCheckQuietArgs;
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

if (isJson && validationFailureMessage !== null) {
  const report = buildTimedReport({
    passed: false,
    exitCode: 1,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
    artifactFound: false,
    attemptedBuild: false,
    buildSkipped: isNoBuild,
    wasmPackAvailable: null,
    wasmPackCheckCommand,
    wasmPackCheckArgs: [...resolvedWasmPackCheckArgs],
    wasmPackCheckArgCount: resolvedWasmPackCheckArgs.length,
    wasmPackCheckExitCode: null,
    wasmPackCheckOutputLine: null,
    wasmPackCheckStatus: deriveWasmPackCheckStatus({
      wasmPackCheckExitCode: null,
      wasmPackCheckReport: null,
    }),
    wasmPackCheckReport: null,
    buildOutput: null,
    outputPath: outputPathError === null ? outputPath : null,
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
    validationErrorCode,
    message: validationFailureMessage,
  });
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

const finish = (report) => {
  if (isJson) {
    const finalizedReport = buildTimedReport({
      ...report,
      optionTerminatorUsed,
      positionalArgs,
      positionalArgCount,
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
      validationErrorCode: null,
      outputPath,
    });
    const { reportJson, writeError } = serializeReportWithOptionalWrite(
      finalizedReport,
      {
        jsonFormat,
        outputPath,
        buildTimedReport,
      }
    );

    console.log(reportJson);
    if (writeError !== null) {
      process.exit(1);
    }
  } else if (!report.passed) {
    console.error(report.message);
  }

  process.exit(report.exitCode);
};

if (fs.existsSync(wasmMesherEntry)) {
  finish({
    passed: true,
    exitCode: 0,
    artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
    artifactFound: true,
    attemptedBuild: false,
    buildSkipped: isNoBuild,
    wasmPackAvailable: null,
    wasmPackCheckCommand,
    wasmPackCheckArgs: [...resolvedWasmPackCheckArgs],
    wasmPackCheckArgCount: resolvedWasmPackCheckArgs.length,
    wasmPackCheckExitCode: null,
    wasmPackCheckOutputLine: null,
    wasmPackCheckStatus: deriveWasmPackCheckStatus({
      wasmPackCheckExitCode: null,
      wasmPackCheckReport: null,
    }),
    wasmPackCheckReport: null,
    buildOutput: null,
    message: "WASM mesher artifact already exists.",
  });
}

if (isNoBuild) {
  finish({
    passed: false,
    exitCode: 1,
    artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
    artifactFound: false,
    attemptedBuild: false,
    buildSkipped: true,
    wasmPackAvailable: null,
    wasmPackCheckCommand,
    wasmPackCheckArgs: [...resolvedWasmPackCheckArgs],
    wasmPackCheckArgCount: resolvedWasmPackCheckArgs.length,
    wasmPackCheckExitCode: null,
    wasmPackCheckOutputLine: null,
    wasmPackCheckStatus: deriveWasmPackCheckStatus({
      wasmPackCheckExitCode: null,
      wasmPackCheckReport: null,
    }),
    wasmPackCheckReport: null,
    buildOutput: null,
    message:
      "Missing crates/wasm-mesher/pkg/voxelize_wasm_mesher.js. Build was skipped due to --no-build. Run `pnpm build:wasm:dev` from the repository root.",
  });
}

const wasmPackCheck = isJson
  ? spawnSync(wasmPackCheckCommand, wasmPackCheckJsonArgs, {
      encoding: "utf8",
      shell: false,
    })
  : spawnSync(wasmPackCheckCommand, wasmPackCheckQuietArgs, {
      stdio: "inherit",
      shell: false,
    });
const wasmPackCheckStatus = wasmPackCheck.status ?? 1;
const wasmPackCheckOutput = `${wasmPackCheck.stdout ?? ""}${wasmPackCheck.stderr ?? ""}`.trim();
const wasmPackCheckOutputLine =
  wasmPackCheckOutput
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;
const wasmPackCheckReport = isJson ? parseJsonOutput(wasmPackCheckOutput) : null;

if (wasmPackCheckStatus !== 0) {
  finish({
    passed: false,
    exitCode: wasmPackCheckStatus,
    artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
    artifactFound: false,
    attemptedBuild: false,
    buildSkipped: false,
    wasmPackAvailable: false,
    wasmPackCheckCommand,
    wasmPackCheckArgs: [...resolvedWasmPackCheckArgs],
    wasmPackCheckArgCount: resolvedWasmPackCheckArgs.length,
    wasmPackCheckExitCode: wasmPackCheckStatus,
    wasmPackCheckOutputLine,
    wasmPackCheckStatus: deriveWasmPackCheckStatus({
      wasmPackCheckExitCode: wasmPackCheckStatus,
      wasmPackCheckReport,
    }),
    wasmPackCheckReport,
    buildOutput: null,
    message:
      "Missing crates/wasm-mesher/pkg/voxelize_wasm_mesher.js. Install wasm-pack, then run `pnpm build:wasm:dev` from the repository root.",
  });
}

const buildResult = isJson
  ? spawnSync(pnpmCommand, ["--dir", repositoryRoot, "build:wasm:dev"], {
      encoding: "utf8",
      shell: false,
    })
  : spawnSync(pnpmCommand, ["--dir", repositoryRoot, "build:wasm:dev"], {
      stdio: "inherit",
      shell: false,
    });
const buildStatus = buildResult.status ?? 1;
const buildOutput = `${buildResult.stdout ?? ""}${buildResult.stderr ?? ""}`.trim();

if (buildStatus === 0 && fs.existsSync(wasmMesherEntry)) {
  finish({
    passed: true,
    exitCode: 0,
    artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
    artifactFound: true,
    attemptedBuild: true,
    buildSkipped: false,
    wasmPackAvailable: true,
    wasmPackCheckCommand,
    wasmPackCheckArgs: [...resolvedWasmPackCheckArgs],
    wasmPackCheckArgCount: resolvedWasmPackCheckArgs.length,
    wasmPackCheckExitCode: wasmPackCheckStatus,
    wasmPackCheckOutputLine,
    wasmPackCheckStatus: deriveWasmPackCheckStatus({
      wasmPackCheckExitCode: wasmPackCheckStatus,
      wasmPackCheckReport,
    }),
    wasmPackCheckReport,
    buildOutput: isJson ? buildOutput : null,
    message: "WASM mesher artifact is available.",
  });
}

finish({
  passed: false,
  exitCode: buildStatus,
  artifactPath: "crates/wasm-mesher/pkg/voxelize_wasm_mesher.js",
  artifactFound: fs.existsSync(wasmMesherEntry),
  attemptedBuild: true,
  buildSkipped: false,
  wasmPackAvailable: true,
  wasmPackCheckCommand,
  wasmPackCheckArgs: [...resolvedWasmPackCheckArgs],
  wasmPackCheckArgCount: resolvedWasmPackCheckArgs.length,
  wasmPackCheckExitCode: wasmPackCheckStatus,
  wasmPackCheckOutputLine,
  wasmPackCheckStatus: deriveWasmPackCheckStatus({
    wasmPackCheckExitCode: wasmPackCheckStatus,
    wasmPackCheckReport,
  }),
  wasmPackCheckReport,
  buildOutput: isJson ? buildOutput : null,
  message:
    "Failed to generate crates/wasm-mesher/pkg/voxelize_wasm_mesher.js with `pnpm build:wasm:dev`.",
});
