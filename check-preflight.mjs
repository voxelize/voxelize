import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  countRecordEntries,
  createCliDiagnostics,
  createTimedReportBuilder,
  hasCliOption as hasCliOptionInArgs,
  parseJsonOutput,
  resolveLastOptionValue,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
  summarizeCheckFailureResults,
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
const availableCheckIndices = availableChecks.map((_, index) => index);
const availableCheckScriptMap = Object.fromEntries(
  availableChecks.map((check) => {
    return [check.name, check.scriptName];
  })
);
const availableCheckScriptMapCount = countRecordEntries(availableCheckScriptMap);
const availableCheckSupportsNoBuildMap = Object.fromEntries(
  availableChecks.map((check) => {
    return [check.name, check.supportsNoBuild];
  })
);
const availableCheckSupportsNoBuildMapCount = countRecordEntries(
  availableCheckSupportsNoBuildMap
);
const availableCheckIndexMap = Object.fromEntries(
  availableCheckNames.map((checkName, index) => {
    return [checkName, index];
  })
);
const availableCheckIndexMapCount = countRecordEntries(availableCheckIndexMap);
const checkNameToIndex = new Map(
  availableCheckNames.map((checkName, index) => {
    return [checkName, index];
  })
);
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
const availableCheckMetadataCount = countRecordEntries(availableCheckMetadata);
const resolveCheckDetails = (checkName) => {
  const checkMetadata = availableCheckMetadata[checkName];
  const checkIndex = checkNameToIndex.get(checkName);

  if (checkMetadata === undefined || checkIndex === undefined) {
    throw new Error(`Missing check metadata for ${checkName}.`);
  }

  return {
    scriptName: checkMetadata.scriptName,
    supportsNoBuild: checkMetadata.supportsNoBuild,
    checkIndex,
  };
};
const resolveCheckIndices = (checkNames) => {
  return checkNames.map((checkName) => {
    return resolveCheckDetails(checkName).checkIndex;
  });
};
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
const availableCheckAliasGroupCount = countRecordEntries(availableCheckAliases);
const availableCheckAliasTokenCount = Object.values(availableCheckAliases).reduce(
  (count, aliases) => {
    return count + aliases.length;
  },
  0
);
const availableSpecialCheckAliases = {
  all: ["all", "all-checks", "all_checks", "allchecks"],
  libraries: ["libraries", "library", "libs", "lib"],
};
const availableSpecialCheckSelectors = Object.keys(availableSpecialCheckAliases);
const availableSpecialCheckSelectorCount = availableSpecialCheckSelectors.length;
const availableSpecialCheckAliasGroupCount = countRecordEntries(
  availableSpecialCheckAliases
);
const availableSpecialCheckAliasTokenCount = Object.values(
  availableSpecialCheckAliases
).reduce((count, aliases) => {
  return count + aliases.length;
}, 0);
const requestedCheckResolutionKinds = ["check", "specialSelector", "invalid"];
const requestedCheckResolutionKindCount = requestedCheckResolutionKinds.length;
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
const availableSpecialSelectorResolvedChecksCount = countRecordEntries(
  availableSpecialSelectorResolvedChecks
);
const availableSpecialSelectorResolvedCheckCountMap = Object.fromEntries(
  availableSpecialCheckSelectors.map((selector) => {
    const selectorChecks = availableSpecialSelectorResolvedChecks[selector];
    return [selector, Array.isArray(selectorChecks) ? selectorChecks.length : 0];
  })
);
const availableSpecialSelectorResolvedCheckCountMapCount = countRecordEntries(
  availableSpecialSelectorResolvedCheckCountMap
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
const createRequestedCheckResolvedChecks = (resolutions) => {
  const resolvedChecks = [];
  const seenChecks = new Set();

  for (const resolution of resolutions) {
    for (const checkName of resolution.resolvedTo) {
      if (seenChecks.has(checkName)) {
        continue;
      }

      seenChecks.add(checkName);
      resolvedChecks.push(checkName);
    }
  }

  return resolvedChecks;
};
const createRequestedCheckResolvedScripts = (resolvedChecks) => {
  const resolvedScripts = [];
  const seenScripts = new Set();

  for (const checkName of resolvedChecks) {
    const { scriptName } = resolveCheckDetails(checkName);
    if (seenScripts.has(scriptName)) {
      continue;
    }

    seenScripts.add(scriptName);
    resolvedScripts.push(scriptName);
  }

  return resolvedScripts;
};
const requestedCheckResolvedChecks = createRequestedCheckResolvedChecks(
  requestedCheckResolutions
);
const requestedCheckResolvedScripts = createRequestedCheckResolvedScripts(
  requestedCheckResolvedChecks
);
const requestedCheckResolvedScriptMap = Object.fromEntries(
  requestedCheckResolvedChecks.map((checkName) => {
    return [checkName, resolveCheckDetails(checkName).scriptName];
  })
);
const requestedCheckResolvedScriptMapCount = countRecordEntries(
  requestedCheckResolvedScriptMap
);
const requestedCheckResolvedSupportsNoBuildMap = Object.fromEntries(
  requestedCheckResolvedChecks.map((checkName) => {
    return [checkName, resolveCheckDetails(checkName).supportsNoBuild];
  })
);
const requestedCheckResolvedSupportsNoBuildMapCount = countRecordEntries(
  requestedCheckResolvedSupportsNoBuildMap
);
const requestedCheckResolvedIndices = resolveCheckIndices(requestedCheckResolvedChecks);
const requestedCheckResolvedIndexMap = Object.fromEntries(
  requestedCheckResolvedChecks.map((checkName) => {
    return [checkName, resolveCheckDetails(checkName).checkIndex];
  })
);
const requestedCheckResolvedIndexMapCount = countRecordEntries(
  requestedCheckResolvedIndexMap
);
const requestedCheckResolvedMetadata = Object.fromEntries(
  requestedCheckResolvedChecks.map((checkName) => {
    const { scriptName, supportsNoBuild } = resolveCheckDetails(checkName);
    return [checkName, { scriptName, supportsNoBuild }];
  })
);
const requestedCheckResolvedMetadataCount = countRecordEntries(
  requestedCheckResolvedMetadata
);
const buildCheckSelectionMetadata = (checkNames) => {
  const checkMetadata = Object.fromEntries(
    checkNames.map((checkName) => {
      const { scriptName, supportsNoBuild } = resolveCheckDetails(checkName);
      return [checkName, { scriptName, supportsNoBuild }];
    })
  );
  const checkScripts = checkNames.map((checkName) => {
    return resolveCheckDetails(checkName).scriptName;
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
const allCheckMetadataCount = countRecordEntries(allCheckMetadata);

const runCheck = (name, scriptName, supportsNoBuild, extraArgs = []) => {
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
  const checkIndex = checkNameToIndex.get(name);

  return {
    name,
    scriptName,
    supportsNoBuild,
    checkIndex: typeof checkIndex === "number" ? checkIndex : null,
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
    selectedCheckMetadataCount: 0,
    selectedCheckScripts: [],
    selectedCheckScriptCount: 0,
    requestedChecks,
    requestedCheckCount: requestedChecks.length,
    requestedCheckResolutions,
    requestedCheckResolutionCount: requestedCheckResolutions.length,
    requestedCheckResolutionCounts,
    requestedCheckResolvedChecks,
    requestedCheckResolvedCheckCount: requestedCheckResolvedChecks.length,
    requestedCheckResolvedScripts,
    requestedCheckResolvedScriptCount: requestedCheckResolvedScripts.length,
    requestedCheckResolvedScriptMap,
    requestedCheckResolvedScriptMapCount,
    requestedCheckResolvedSupportsNoBuildMap,
    requestedCheckResolvedSupportsNoBuildMapCount,
    requestedCheckResolvedIndices,
    requestedCheckResolvedIndexCount: requestedCheckResolvedIndices.length,
    requestedCheckResolvedIndexMap,
    requestedCheckResolvedIndexMapCount,
    requestedCheckResolvedMetadata,
    requestedCheckResolvedMetadataCount,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks: availableCheckNames,
    skippedCheckCount: availableCheckNames.length,
    skippedCheckIndices: resolveCheckIndices(availableCheckNames),
    skippedCheckIndexCount: availableCheckNames.length,
    skippedCheckMetadata: allCheckMetadata,
    skippedCheckMetadataCount: allCheckMetadataCount,
    skippedCheckScripts: allCheckScripts,
    skippedCheckScriptCount: allCheckScriptCount,
    passedCheckScripts: [],
    passedCheckScriptCount: 0,
    passedCheckMetadata: {},
    passedCheckMetadataCount: 0,
    passedCheckIndices: [],
    passedCheckIndexCount: 0,
    failedCheckScripts: [],
    failedCheckScriptCount: 0,
    failedCheckMetadata: {},
    failedCheckMetadataCount: 0,
    failedCheckIndices: [],
    failedCheckIndexCount: 0,
    ...summarizeCheckResults([]),
    failureSummaries: [],
    failureSummaryCount: 0,
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
    availableCheckScriptMap,
    availableCheckScriptMapCount,
    availableCheckSupportsNoBuildMap,
    availableCheckSupportsNoBuildMapCount,
    availableCheckIndices,
    availableCheckIndexCount: availableCheckIndices.length,
    availableCheckIndexMap,
    availableCheckIndexMapCount,
    availableCheckMetadata,
    availableCheckMetadataCount,
    availableCheckAliases,
    availableCheckAliasGroupCount,
    availableCheckAliasTokenCount,
    availableSpecialCheckSelectors,
    availableSpecialCheckSelectorCount,
    availableSpecialCheckAliases,
    availableSpecialCheckAliasGroupCount,
    availableSpecialCheckAliasTokenCount,
    availableSpecialSelectorResolvedChecks,
    availableSpecialSelectorResolvedChecksCount,
    availableSpecialSelectorResolvedCheckCountMap,
    availableSpecialSelectorResolvedCheckCountMapCount,
    requestedCheckResolutionKinds,
    requestedCheckResolutionKindCount,
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
const selectedCheckMetadataCount = countRecordEntries(selectedCheckMetadata);
const {
  checkMetadata: skippedCheckMetadata,
  checkScripts: skippedCheckScripts,
  checkScriptCount: skippedCheckScriptCount,
} = buildCheckSelectionMetadata(skippedChecks);
const skippedCheckMetadataCount = countRecordEntries(skippedCheckMetadata);

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
    selectedCheckMetadataCount,
    selectedCheckScripts,
    selectedCheckScriptCount,
    requestedChecks,
    requestedCheckCount: requestedChecks.length,
    requestedCheckResolutions,
    requestedCheckResolutionCount: requestedCheckResolutions.length,
    requestedCheckResolutionCounts,
    requestedCheckResolvedChecks,
    requestedCheckResolvedCheckCount: requestedCheckResolvedChecks.length,
    requestedCheckResolvedScripts,
    requestedCheckResolvedScriptCount: requestedCheckResolvedScripts.length,
    requestedCheckResolvedScriptMap,
    requestedCheckResolvedScriptMapCount,
    requestedCheckResolvedSupportsNoBuildMap,
    requestedCheckResolvedSupportsNoBuildMapCount,
    requestedCheckResolvedIndices,
    requestedCheckResolvedIndexCount: requestedCheckResolvedIndices.length,
    requestedCheckResolvedIndexMap,
    requestedCheckResolvedIndexMapCount,
    requestedCheckResolvedMetadata,
    requestedCheckResolvedMetadataCount,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks,
    skippedCheckCount: skippedChecks.length,
    skippedCheckIndices,
    skippedCheckIndexCount: skippedCheckIndices.length,
    skippedCheckMetadata,
    skippedCheckMetadataCount,
    skippedCheckScripts,
    skippedCheckScriptCount,
    passedCheckScripts: [],
    passedCheckScriptCount: 0,
    passedCheckMetadata: {},
    passedCheckMetadataCount: 0,
    passedCheckIndices: [],
    passedCheckIndexCount: 0,
    failedCheckScripts: [],
    failedCheckScriptCount: 0,
    failedCheckMetadata: {},
    failedCheckMetadataCount: 0,
    failedCheckIndices: [],
    failedCheckIndexCount: 0,
    ...summarizeCheckResults([]),
    failureSummaries: [],
    failureSummaryCount: 0,
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
    availableCheckScriptMap,
    availableCheckScriptMapCount,
    availableCheckSupportsNoBuildMap,
    availableCheckSupportsNoBuildMapCount,
    availableCheckIndices,
    availableCheckIndexCount: availableCheckIndices.length,
    availableCheckIndexMap,
    availableCheckIndexMapCount,
    availableCheckMetadata,
    availableCheckMetadataCount,
    availableCheckAliases,
    availableCheckAliasGroupCount,
    availableCheckAliasTokenCount,
    availableSpecialCheckSelectors,
    availableSpecialCheckSelectorCount,
    availableSpecialCheckAliases,
    availableSpecialCheckAliasGroupCount,
    availableSpecialCheckAliasTokenCount,
    availableSpecialSelectorResolvedChecks,
    availableSpecialSelectorResolvedChecksCount,
    availableSpecialSelectorResolvedCheckCountMap,
    availableSpecialSelectorResolvedCheckCountMapCount,
    requestedCheckResolutionKinds,
    requestedCheckResolutionKindCount,
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
    return runCheck(
      check.name,
      check.scriptName,
      check.supportsNoBuild,
      check.extraArgs
    );
  });

const passed = checks.every((check) => check.passed);
const exitCode = passed ? 0 : 1;
const checkSummary = summarizeCheckResults(checks);
const {
  checkMetadata: passedCheckMetadata,
  checkScripts: passedCheckScripts,
  checkScriptCount: passedCheckScriptCount,
} = buildCheckSelectionMetadata(checkSummary.passedChecks);
const passedCheckMetadataCount = countRecordEntries(passedCheckMetadata);
const {
  checkMetadata: failedCheckMetadata,
  checkScripts: failedCheckScripts,
  checkScriptCount: failedCheckScriptCount,
} = buildCheckSelectionMetadata(checkSummary.failedChecks);
const failedCheckMetadataCount = countRecordEntries(failedCheckMetadata);
const passedCheckIndices = resolveCheckIndices(checkSummary.passedChecks);
const failedCheckIndices = resolveCheckIndices(checkSummary.failedChecks);
const invalidCheckCount = 0;
const failureSummaries = summarizeCheckFailureResults(checks);
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
  selectedCheckMetadataCount,
  selectedCheckScripts,
  selectedCheckScriptCount,
  requestedChecks,
  requestedCheckCount: requestedChecks.length,
  requestedCheckResolutions,
  requestedCheckResolutionCount: requestedCheckResolutions.length,
  requestedCheckResolutionCounts,
  requestedCheckResolvedChecks,
  requestedCheckResolvedCheckCount: requestedCheckResolvedChecks.length,
  requestedCheckResolvedScripts,
  requestedCheckResolvedScriptCount: requestedCheckResolvedScripts.length,
  requestedCheckResolvedScriptMap,
  requestedCheckResolvedScriptMapCount,
  requestedCheckResolvedSupportsNoBuildMap,
  requestedCheckResolvedSupportsNoBuildMapCount,
  requestedCheckResolvedIndices,
  requestedCheckResolvedIndexCount: requestedCheckResolvedIndices.length,
  requestedCheckResolvedIndexMap,
  requestedCheckResolvedIndexMapCount,
  requestedCheckResolvedMetadata,
  requestedCheckResolvedMetadataCount,
  selectionMode,
  specialSelectorsUsed,
  skippedChecks,
  skippedCheckCount: skippedChecks.length,
  skippedCheckIndices,
  skippedCheckIndexCount: skippedCheckIndices.length,
  skippedCheckMetadata,
  skippedCheckMetadataCount,
  skippedCheckScripts,
  skippedCheckScriptCount,
  passedCheckScripts,
  passedCheckScriptCount,
  passedCheckMetadata,
  passedCheckMetadataCount,
  passedCheckIndices,
  passedCheckIndexCount: passedCheckIndices.length,
  failedCheckScripts,
  failedCheckScriptCount,
  failedCheckMetadata,
  failedCheckMetadataCount,
  failedCheckIndices,
  failedCheckIndexCount: failedCheckIndices.length,
  ...checkSummary,
  failureSummaries,
  failureSummaryCount: failureSummaries.length,
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
  availableCheckScriptMap,
  availableCheckScriptMapCount,
  availableCheckSupportsNoBuildMap,
  availableCheckSupportsNoBuildMapCount,
  availableCheckIndices,
  availableCheckIndexCount: availableCheckIndices.length,
  availableCheckIndexMap,
  availableCheckIndexMapCount,
  availableCheckMetadata,
  availableCheckMetadataCount,
  availableCheckAliases,
  availableCheckAliasGroupCount,
  availableCheckAliasTokenCount,
  availableSpecialCheckSelectors,
  availableSpecialCheckSelectorCount,
  availableSpecialCheckAliases,
  availableSpecialCheckAliasGroupCount,
  availableSpecialCheckAliasTokenCount,
  availableSpecialSelectorResolvedChecks,
  availableSpecialSelectorResolvedChecksCount,
  availableSpecialSelectorResolvedCheckCountMap,
  availableSpecialSelectorResolvedCheckCountMapCount,
  requestedCheckResolutionKinds,
  requestedCheckResolutionKindCount,
});
const { reportJson, writeError } = serializeReportWithOptionalWrite(report, {
  jsonFormat,
  outputPath: resolvedOutputPath,
  buildTimedReport,
});

console.log(reportJson);

process.exit(writeError === null ? exitCode : 1);
