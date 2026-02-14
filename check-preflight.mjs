import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCliDiagnostics,
  createTimedReportBuilder,
  deriveFailureMessageFromReport,
  hasCliOption as hasCliOptionInArgs,
  parseJsonOutput,
  resolveLastOptionValue,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
  summarizeCheckResults,
} from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliArgs = process.argv.slice(2);
const { optionArgs: cliOptionArgs, positionalArgs, optionTerminatorUsed } =
  splitCliArgs(cliArgs);
const positionalArgCount = positionalArgs.length;
const availableCliOptionAliases = {
  "--list-checks": ["--list", "-l"],
  "--no-build": ["--verify"],
};
const isNoBuild = hasCliOptionInArgs(
  cliOptionArgs,
  "--no-build",
  availableCliOptionAliases["--no-build"]
);
const isListChecks = hasCliOptionInArgs(
  cliOptionArgs,
  "--list-checks",
  availableCliOptionAliases["--list-checks"]
);
const isCompact = cliOptionArgs.includes("--compact");
const supportedCliOptions = [
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
const cliOptionsWithValues = new Set(["--only", "--output"]);
const jsonFormat = { compact: isCompact };
const { outputPath: resolvedOutputPath, error: outputPathError } =
  resolveOutputPath(cliOptionArgs, process.cwd(), supportedCliOptions);
const {
  hasOption: hasOnlyOption,
  value: onlyOptionValue,
  error: onlyOptionError,
} = resolveLastOptionValue(cliOptionArgs, "--only", supportedCliOptions);
const buildTimedReport = createTimedReportBuilder();

const availableChecks = [
  {
    name: "devEnvironment",
    scriptName: "check-dev-env.mjs",
    supportsNoBuild: false,
    extraArgs: [],
  },
  {
    name: "wasmPack",
    scriptName: "check-wasm-pack.mjs",
    supportsNoBuild: false,
    extraArgs: [],
  },
  {
    name: "tsCore",
    scriptName: "check-ts-core.mjs",
    supportsNoBuild: true,
    extraArgs: isNoBuild ? ["--no-build"] : [],
  },
  {
    name: "runtimeLibraries",
    scriptName: "check-runtime-libraries.mjs",
    supportsNoBuild: true,
    extraArgs: isNoBuild ? ["--no-build"] : [],
  },
  {
    name: "client",
    scriptName: "check-client.mjs",
    supportsNoBuild: true,
    extraArgs: isNoBuild ? ["--no-build"] : [],
  },
];
const availableCheckNames = availableChecks.map((check) => check.name);
const availableCheckScripts = availableChecks.map((check) => check.scriptName);
const checkNameToIndex = new Map(
  availableCheckNames.map((checkName, index) => {
    return [checkName, index];
  })
);
const resolveCheckIndices = (checkNames) => {
  return checkNames
    .map((checkName) => checkNameToIndex.get(checkName))
    .filter((checkIndex) => typeof checkIndex === "number");
};
const availableCheckMetadata = Object.fromEntries(
  availableChecks.map((check) => {
    return [
      check.name,
      {
        scriptName: check.scriptName,
        supportsNoBuild: check.supportsNoBuild,
      },
    ];
  })
);
const availableCheckAliases = {
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
const availableSpecialCheckAliases = {
  all: ["all", "all-checks", "all_checks", "allchecks"],
  libraries: ["libraries", "library", "libs", "lib"],
};
const availableSpecialCheckSelectors = Object.keys(availableSpecialCheckAliases);
const requestedCheckResolutionKinds = ["check", "specialSelector", "invalid"];
const specialSelectorChecks = {
  all: availableCheckNames,
  libraries: ["tsCore", "runtimeLibraries"],
};
const availableSpecialSelectorResolvedChecks = Object.fromEntries(
  availableSpecialCheckSelectors.map((selector) => {
    const selectorChecks = specialSelectorChecks[selector];
    return [selector, selectorChecks === undefined ? [] : selectorChecks];
  })
);
const specialSelectorHintText = availableSpecialCheckSelectors
  .map((selector) => {
    const selectorAliases = availableSpecialCheckAliases[selector].filter((alias) => {
      return alias !== selector;
    });
    if (selectorAliases.length === 0) {
      return selector;
    }
    return `${selector} (${selectorAliases.join(", ")})`;
  })
  .join("; ");
const normalizeCheckToken = (value) => {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
};
const checkAliases = new Map(
  Object.entries(availableCheckAliases).flatMap(([checkName, aliases]) => {
    return aliases.map((alias) => [normalizeCheckToken(alias), checkName]);
  })
);
const specialCheckAliases = new Map(
  Object.entries(availableSpecialCheckAliases).flatMap(([selector, aliases]) => {
    return aliases.map((alias) => [normalizeCheckToken(alias), selector]);
  })
);

const parseSelectedChecks = () => {
  if (!hasOnlyOption) {
    return {
      selectedChecks: availableCheckNames,
      requestedChecks: [],
      requestedCheckResolutions: [],
      selectionMode: "default",
      specialSelectorsUsed: [],
      error: null,
      invalidChecks: [],
    };
  }

  if (onlyOptionError !== null || onlyOptionValue === null) {
    return {
      selectedChecks: [],
      requestedChecks: [],
      requestedCheckResolutions: [],
      selectionMode: "only",
      specialSelectorsUsed: [],
      error: onlyOptionError ?? "Missing value for --only option.",
      invalidChecks: [],
    };
  }

  const tokenizedChecks = onlyOptionValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (tokenizedChecks.length === 0) {
    return {
      selectedChecks: [],
      requestedChecks: [],
      requestedCheckResolutions: [],
      selectionMode: "only",
      specialSelectorsUsed: [],
      error: "Missing value for --only option.",
      invalidChecks: [],
    };
  }

  const invalidChecks = [];
  const resolvedChecks = [];
  const usedSpecialSelectors = new Set();
  const requestedCheckResolutions = [];
  for (const parsedCheck of tokenizedChecks) {
    const normalizedParsedCheck = normalizeCheckToken(parsedCheck);
    const resolvedSpecialSelector = specialCheckAliases.get(normalizedParsedCheck);
    if (resolvedSpecialSelector !== undefined) {
      const resolvedSpecialChecks = specialSelectorChecks[resolvedSpecialSelector];
      if (resolvedSpecialChecks === undefined) {
        invalidChecks.push(parsedCheck);
        requestedCheckResolutions.push({
          token: parsedCheck,
          normalizedToken: normalizedParsedCheck,
          kind: "invalid",
          resolvedTo: [],
        });
        continue;
      }

      resolvedChecks.push(...resolvedSpecialChecks);
      usedSpecialSelectors.add(resolvedSpecialSelector);
      requestedCheckResolutions.push({
        token: parsedCheck,
        normalizedToken: normalizedParsedCheck,
        kind: "specialSelector",
        selector: resolvedSpecialSelector,
        resolvedTo: resolvedSpecialChecks,
      });
      continue;
    }

    const resolvedCheck = checkAliases.get(normalizedParsedCheck) ?? null;
    if (resolvedCheck === null) {
      invalidChecks.push(parsedCheck);
      requestedCheckResolutions.push({
        token: parsedCheck,
        normalizedToken: normalizedParsedCheck,
        kind: "invalid",
        resolvedTo: [],
      });
      continue;
    }

    resolvedChecks.push(resolvedCheck);
    requestedCheckResolutions.push({
      token: parsedCheck,
      normalizedToken: normalizedParsedCheck,
      kind: "check",
      resolvedTo: [resolvedCheck],
    });
  }

  if (invalidChecks.length > 0) {
    const uniqueInvalidChecks = [];
    const seenInvalidChecks = new Set();
    for (const invalidCheck of invalidChecks) {
      const normalizedInvalidCheck = normalizeCheckToken(invalidCheck);
      if (seenInvalidChecks.has(normalizedInvalidCheck)) {
        continue;
      }
      seenInvalidChecks.add(normalizedInvalidCheck);
      uniqueInvalidChecks.push(invalidCheck);
    }

    const availableChecksHint = `Available checks: ${availableCheckNames.join(", ")}.`;
    const availableSpecialSelectorsHint =
      specialSelectorHintText.length === 0
        ? ""
        : ` Special selectors: ${specialSelectorHintText}.`;

    return {
      selectedChecks: [],
      requestedChecks: tokenizedChecks,
      requestedCheckResolutions,
      selectionMode: "only",
      specialSelectorsUsed: Array.from(usedSpecialSelectors),
      error: `Invalid check name(s): ${uniqueInvalidChecks.join(", ")}. ${availableChecksHint}${availableSpecialSelectorsHint}`,
      invalidChecks: uniqueInvalidChecks,
    };
  }

  const parsedCheckSet = new Set(resolvedChecks);
  const normalizedChecks = availableCheckNames.filter((value) => {
    return parsedCheckSet.has(value);
  });

  return {
    selectedChecks: normalizedChecks,
    requestedChecks: tokenizedChecks,
    requestedCheckResolutions,
    selectionMode: "only",
    specialSelectorsUsed: Array.from(usedSpecialSelectors),
    error: null,
    invalidChecks: [],
  };
};
const {
  selectedChecks,
  requestedChecks,
  requestedCheckResolutions,
  selectionMode,
  specialSelectorsUsed,
  error: selectedChecksError,
  invalidChecks,
} = parseSelectedChecks();
const createRequestedCheckResolutionCounts = (resolutions) => {
  const counts = {
    check: 0,
    specialSelector: 0,
    invalid: 0,
  };

  for (const resolution of resolutions) {
    counts[resolution.kind] += 1;
  }

  return counts;
};
const requestedCheckResolutionCounts = createRequestedCheckResolutionCounts(
  requestedCheckResolutions
);
const createRequestedCheckResolvedScripts = (resolutions) => {
  const resolvedScripts = [];
  const seenScripts = new Set();

  for (const resolution of resolutions) {
    for (const checkName of resolution.resolvedTo) {
      const scriptName = availableCheckMetadata[checkName]?.scriptName;
      if (typeof scriptName !== "string" || seenScripts.has(scriptName)) {
        continue;
      }

      seenScripts.add(scriptName);
      resolvedScripts.push(scriptName);
    }
  }

  return resolvedScripts;
};
const requestedCheckResolvedScripts = createRequestedCheckResolvedScripts(
  requestedCheckResolutions
);
const buildCheckSelectionMetadata = (checkNames) => {
  const checkMetadata = Object.fromEntries(
    checkNames.map((checkName) => {
      return [checkName, availableCheckMetadata[checkName]];
    })
  );
  const checkScripts = checkNames.map((checkName) => {
    return availableCheckMetadata[checkName].scriptName;
  });

  return {
    checkMetadata,
    checkScripts,
    checkScriptCount: checkScripts.length,
  };
};
const {
  availableCliOptionCanonicalMap,
  unknownOptions,
  unknownOptionCount,
  unsupportedOptionsError,
  supportedCliOptionCount,
  activeCliOptions,
  activeCliOptionCount,
  activeCliOptionTokens,
  activeCliOptionResolutions,
  activeCliOptionResolutionCount,
  activeCliOptionOccurrences,
  activeCliOptionOccurrenceCount,
} = createCliDiagnostics(cliOptionArgs, {
  canonicalOptions: supportedCliOptions,
  optionAliases: availableCliOptionAliases,
  optionsWithValues: Array.from(cliOptionsWithValues),
  optionsWithStrictValues: ["--only", "--output"],
  outputPathError: null,
});
const deriveValidationErrorCode = ({
  outputPathError,
  selectedChecksError,
  unsupportedOptionsError,
}) => {
  if (outputPathError !== null) {
    return "output_option_missing_value";
  }

  if (selectedChecksError === "Missing value for --only option.") {
    return "only_option_missing_value";
  }

  if (selectedChecksError !== null) {
    return "only_option_invalid_value";
  }

  if (unsupportedOptionsError !== null) {
    return "unsupported_options";
  }

  return null;
};
const validationErrorCode = deriveValidationErrorCode({
  outputPathError,
  selectedChecksError,
  unsupportedOptionsError,
});
const {
  checkMetadata: allCheckMetadata,
  checkScripts: allCheckScripts,
  checkScriptCount: allCheckScriptCount,
} = buildCheckSelectionMetadata(availableCheckNames);

const runCheck = (name, scriptName, extraArgs = []) => {
  const checkStartMs = Date.now();
  const scriptPath = path.resolve(__dirname, scriptName);
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--json", "--compact", ...extraArgs],
    {
      cwd: __dirname,
      encoding: "utf8",
      shell: false,
    }
  );

  const exitCode = result.status ?? 1;
  const output = `${result.stdout}${result.stderr}`.trim();
  const report = parseJsonOutput(output);

  return {
    name,
    passed: exitCode === 0,
    exitCode,
    durationMs: Date.now() - checkStartMs,
    report,
    output: report === null ? output : null,
  };
};

const platform = process.platform;
const nodeVersion = process.version;

if (
  outputPathError !== null ||
  selectedChecksError !== null ||
  unsupportedOptionsError !== null
) {
  const effectiveInvalidChecks = outputPathError === null ? invalidChecks : [];
  const invalidCheckCount = effectiveInvalidChecks.length;
  const report = buildTimedReport({
    passed: false,
    exitCode: 1,
    listChecksOnly: isListChecks,
    noBuild: isNoBuild,
    platform,
    nodeVersion,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    selectedChecks: [],
    selectedCheckCount: 0,
    selectedCheckIndices: [],
    selectedCheckIndexCount: 0,
    selectedCheckMetadata: {},
    selectedCheckScripts: [],
    selectedCheckScriptCount: 0,
    requestedChecks,
    requestedCheckCount: requestedChecks.length,
    requestedCheckResolutions,
    requestedCheckResolutionCounts,
    requestedCheckResolvedScripts,
    requestedCheckResolvedScriptCount: requestedCheckResolvedScripts.length,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks: availableCheckNames,
    skippedCheckCount: availableCheckNames.length,
    skippedCheckIndices: resolveCheckIndices(availableCheckNames),
    skippedCheckIndexCount: availableCheckNames.length,
    skippedCheckMetadata: allCheckMetadata,
    skippedCheckScripts: allCheckScripts,
    skippedCheckScriptCount: allCheckScriptCount,
    passedCheckScripts: [],
    passedCheckScriptCount: 0,
    passedCheckMetadata: {},
    passedCheckIndices: [],
    passedCheckIndexCount: 0,
    failedCheckScripts: [],
    failedCheckScriptCount: 0,
    failedCheckMetadata: {},
    failedCheckIndices: [],
    failedCheckIndexCount: 0,
    ...summarizeCheckResults([]),
    checks: [],
    outputPath: outputPathError === null ? resolvedOutputPath : null,
    validationErrorCode,
    message: outputPathError ?? selectedChecksError ?? unsupportedOptionsError,
    invalidChecks: effectiveInvalidChecks,
    invalidCheckCount,
    unknownOptions,
    unknownOptionCount,
    supportedCliOptions,
    supportedCliOptionCount,
    activeCliOptions,
    activeCliOptionCount,
    activeCliOptionTokens,
    activeCliOptionResolutions,
    activeCliOptionResolutionCount,
    activeCliOptionOccurrences,
    activeCliOptionOccurrenceCount,
    availableCliOptionAliases,
    availableCliOptionCanonicalMap,
    availableChecks: availableCheckNames,
    availableCheckScripts,
    availableCheckScriptCount: availableCheckScripts.length,
    availableCheckMetadata,
    availableCheckAliases,
    availableSpecialCheckSelectors,
    availableSpecialCheckAliases,
    availableSpecialSelectorResolvedChecks,
    requestedCheckResolutionKinds,
  });
  const { reportJson } = serializeReportWithOptionalWrite(report, {
    jsonFormat,
    outputPath: outputPathError === null ? resolvedOutputPath : null,
    buildTimedReport,
  });

  console.log(reportJson);
  process.exit(1);
}

const selectedCheckSet = new Set(selectedChecks);
const skippedChecks = availableCheckNames.filter((checkName) => {
  return !selectedCheckSet.has(checkName);
});
const selectedCheckIndices = resolveCheckIndices(selectedChecks);
const skippedCheckIndices = resolveCheckIndices(skippedChecks);
const {
  checkMetadata: selectedCheckMetadata,
  checkScripts: selectedCheckScripts,
  checkScriptCount: selectedCheckScriptCount,
} = buildCheckSelectionMetadata(selectedChecks);
const {
  checkMetadata: skippedCheckMetadata,
  checkScripts: skippedCheckScripts,
  checkScriptCount: skippedCheckScriptCount,
} = buildCheckSelectionMetadata(skippedChecks);

if (isListChecks) {
  const invalidCheckCount = 0;
  const report = buildTimedReport({
    passed: true,
    exitCode: 0,
    listChecksOnly: true,
    noBuild: isNoBuild,
    platform,
    nodeVersion,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    selectedChecks,
    selectedCheckCount: selectedChecks.length,
    selectedCheckIndices,
    selectedCheckIndexCount: selectedCheckIndices.length,
    selectedCheckMetadata,
    selectedCheckScripts,
    selectedCheckScriptCount,
    requestedChecks,
    requestedCheckCount: requestedChecks.length,
    requestedCheckResolutions,
    requestedCheckResolutionCounts,
    requestedCheckResolvedScripts,
    requestedCheckResolvedScriptCount: requestedCheckResolvedScripts.length,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks,
    skippedCheckCount: skippedChecks.length,
    skippedCheckIndices,
    skippedCheckIndexCount: skippedCheckIndices.length,
    skippedCheckMetadata,
    skippedCheckScripts,
    skippedCheckScriptCount,
    passedCheckScripts: [],
    passedCheckScriptCount: 0,
    passedCheckMetadata: {},
    passedCheckIndices: [],
    passedCheckIndexCount: 0,
    failedCheckScripts: [],
    failedCheckScriptCount: 0,
    failedCheckMetadata: {},
    failedCheckIndices: [],
    failedCheckIndexCount: 0,
    ...summarizeCheckResults([]),
    failureSummaries: [],
    checks: [],
    outputPath: resolvedOutputPath,
    validationErrorCode: null,
    invalidChecks: [],
    invalidCheckCount,
    unknownOptions,
    unknownOptionCount,
    supportedCliOptions,
    supportedCliOptionCount,
    activeCliOptions,
    activeCliOptionCount,
    activeCliOptionTokens,
    activeCliOptionResolutions,
    activeCliOptionResolutionCount,
    activeCliOptionOccurrences,
    activeCliOptionOccurrenceCount,
    availableCliOptionAliases,
    availableCliOptionCanonicalMap,
    availableChecks: availableCheckNames,
    availableCheckScripts,
    availableCheckScriptCount: availableCheckScripts.length,
    availableCheckMetadata,
    availableCheckAliases,
    availableSpecialCheckSelectors,
    availableSpecialCheckAliases,
    availableSpecialSelectorResolvedChecks,
    requestedCheckResolutionKinds,
  });
  const { reportJson, writeError } = serializeReportWithOptionalWrite(report, {
    jsonFormat,
    outputPath: resolvedOutputPath,
    buildTimedReport,
  });

  console.log(reportJson);
  process.exit(writeError === null ? 0 : 1);
}

const checks = availableChecks
  .filter((check) => selectedCheckSet.has(check.name))
  .map((check) => {
    return runCheck(check.name, check.scriptName, check.extraArgs);
  });

const passed = checks.every((check) => check.passed);
const exitCode = passed ? 0 : 1;
const checkSummary = summarizeCheckResults(checks);
const {
  checkMetadata: passedCheckMetadata,
  checkScripts: passedCheckScripts,
  checkScriptCount: passedCheckScriptCount,
} = buildCheckSelectionMetadata(checkSummary.passedChecks);
const {
  checkMetadata: failedCheckMetadata,
  checkScripts: failedCheckScripts,
  checkScriptCount: failedCheckScriptCount,
} = buildCheckSelectionMetadata(checkSummary.failedChecks);
const passedCheckIndices = resolveCheckIndices(checkSummary.passedChecks);
const failedCheckIndices = resolveCheckIndices(checkSummary.failedChecks);
const invalidCheckCount = 0;
const failureSummaries = checks
  .filter((check) => !check.passed)
  .map((check) => {
    const reportMessage = deriveFailureMessageFromReport(check.report);
    const checkIndex = checkNameToIndex.get(check.name);

    return {
      name: check.name,
      scriptName: availableCheckMetadata[check.name].scriptName,
      checkIndex: typeof checkIndex === "number" ? checkIndex : null,
      exitCode: check.exitCode,
      message:
        reportMessage ??
        check.output ??
        `Preflight check failed with exit code ${check.exitCode}.`,
    };
  });
const report = buildTimedReport({
  passed,
  exitCode,
  listChecksOnly: false,
  noBuild: isNoBuild,
  platform,
  nodeVersion,
  optionTerminatorUsed,
  positionalArgs,
  positionalArgCount,
  selectedChecks,
  selectedCheckCount: selectedChecks.length,
  selectedCheckIndices,
  selectedCheckIndexCount: selectedCheckIndices.length,
  selectedCheckMetadata,
  selectedCheckScripts,
  selectedCheckScriptCount,
  requestedChecks,
  requestedCheckCount: requestedChecks.length,
  requestedCheckResolutions,
  requestedCheckResolutionCounts,
  requestedCheckResolvedScripts,
  requestedCheckResolvedScriptCount: requestedCheckResolvedScripts.length,
  selectionMode,
  specialSelectorsUsed,
  skippedChecks,
  skippedCheckCount: skippedChecks.length,
  skippedCheckIndices,
  skippedCheckIndexCount: skippedCheckIndices.length,
  skippedCheckMetadata,
  skippedCheckScripts,
  skippedCheckScriptCount,
  passedCheckScripts,
  passedCheckScriptCount,
  passedCheckMetadata,
  passedCheckIndices,
  passedCheckIndexCount: passedCheckIndices.length,
  failedCheckScripts,
  failedCheckScriptCount,
  failedCheckMetadata,
  failedCheckIndices,
  failedCheckIndexCount: failedCheckIndices.length,
  ...checkSummary,
  failureSummaries,
  checks,
  outputPath: resolvedOutputPath,
  validationErrorCode: null,
  invalidChecks: [],
  invalidCheckCount,
  unknownOptions,
  unknownOptionCount,
  supportedCliOptions,
  supportedCliOptionCount,
  activeCliOptions,
  activeCliOptionCount,
  activeCliOptionTokens,
  activeCliOptionResolutions,
  activeCliOptionResolutionCount,
  activeCliOptionOccurrences,
  activeCliOptionOccurrenceCount,
  availableCliOptionAliases,
  availableCliOptionCanonicalMap,
  availableChecks: availableCheckNames,
  availableCheckScripts,
  availableCheckScriptCount: availableCheckScripts.length,
  availableCheckMetadata,
  availableCheckAliases,
  availableSpecialCheckSelectors,
  availableSpecialCheckAliases,
  availableSpecialSelectorResolvedChecks,
  requestedCheckResolutionKinds,
});
const { reportJson, writeError } = serializeReportWithOptionalWrite(report, {
  jsonFormat,
  outputPath: resolvedOutputPath,
  buildTimedReport,
});

console.log(reportJson);

process.exit(writeError === null ? exitCode : 1);
