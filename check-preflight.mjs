import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  countRecordEntries,
  createPrefixedTsCoreExampleSummary,
  createPrefixedWasmPackCheckSummary,
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

const baseAvailableChecks = [
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
const availableChecks = baseAvailableChecks.map((check) => {
  const checkArgs = [
    path.resolve(__dirname, check.scriptName),
    "--json",
    "--compact",
    ...check.extraArgs,
  ];

  return {
    ...check,
    checkCommand: process.execPath,
    checkArgs,
    checkArgCount: checkArgs.length,
  };
});
const availableCheckNames = availableChecks.map((check) => check.name);
const availableCheckScripts = availableChecks.map((check) => check.scriptName);
const availableCheckIndices = availableChecks.map((_, index) => index);
const availableCheckScriptMap = Object.fromEntries(
  availableChecks.map((check) => {
    return [check.name, check.scriptName];
  })
);
const availableCheckScriptMapCount = countRecordEntries(availableCheckScriptMap);
const availableCheckCommandMap = Object.fromEntries(
  availableChecks.map((check) => {
    return [check.name, check.checkCommand];
  })
);
const availableCheckCommandMapCount = countRecordEntries(availableCheckCommandMap);
const availableCheckArgsMap = Object.fromEntries(
  availableChecks.map((check) => {
    return [check.name, check.checkArgs];
  })
);
const availableCheckArgsMapCount = countRecordEntries(availableCheckArgsMap);
const availableCheckArgCountMap = Object.fromEntries(
  availableChecks.map((check) => {
    return [check.name, check.checkArgCount];
  })
);
const availableCheckArgCountMapCount = countRecordEntries(
  availableCheckArgCountMap
);
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
const checkNameToDefinition = new Map(
  availableChecks.map((check) => {
    return [check.name, check];
  })
);
const availableCheckMetadata = Object.fromEntries(
  availableChecks.map((check) => {
    return [
      check.name,
      {
        scriptName: check.scriptName,
        supportsNoBuild: check.supportsNoBuild,
        checkCommand: check.checkCommand,
        checkArgs: check.checkArgs,
        checkArgCount: check.checkArgCount,
      },
    ];
  })
);
const availableCheckMetadataCount = countRecordEntries(availableCheckMetadata);
const resolveCheckDetails = (checkName) => {
  const checkMetadata = availableCheckMetadata[checkName];
  const checkIndex = checkNameToIndex.get(checkName);
  const checkDefinition = checkNameToDefinition.get(checkName);

  if (
    checkMetadata === undefined ||
    checkIndex === undefined ||
    checkDefinition === undefined
  ) {
    throw new Error(`Missing check metadata for ${checkName}.`);
  }

  return {
    scriptName: checkMetadata.scriptName,
    supportsNoBuild: checkMetadata.supportsNoBuild,
    checkCommand: checkDefinition.checkCommand,
    checkArgs: checkDefinition.checkArgs,
    checkArgCount: checkDefinition.checkArgCount,
    checkIndex,
  };
};
const resolveCheckIndices = (checkNames) => {
  return checkNames.map((checkName) => {
    return resolveCheckDetails(checkName).checkIndex;
  });
};
const createCheckIndexMap = (checkNames) => {
  return Object.fromEntries(
    checkNames.map((checkName) => {
      return [checkName, resolveCheckDetails(checkName).checkIndex];
    })
  );
};
const createCheckScriptMap = (checkNames) => {
  return Object.fromEntries(
    checkNames.map((checkName) => {
      return [checkName, resolveCheckDetails(checkName).scriptName];
    })
  );
};
const createCheckCommandMap = (checkNames) => {
  return Object.fromEntries(
    checkNames.map((checkName) => {
      return [checkName, resolveCheckDetails(checkName).checkCommand];
    })
  );
};
const createCheckArgsMap = (checkNames) => {
  return Object.fromEntries(
    checkNames.map((checkName) => {
      return [checkName, resolveCheckDetails(checkName).checkArgs];
    })
  );
};
const createCheckArgCountMap = (checkNames) => {
  return Object.fromEntries(
    checkNames.map((checkName) => {
      return [checkName, resolveCheckDetails(checkName).checkArgCount];
    })
  );
};
const createCheckStatusMap = ({ passedChecks, failedChecks }) => {
  const passedCheckSet = new Set(passedChecks);
  const failedCheckSet = new Set(failedChecks);

  return Object.fromEntries(
    availableCheckNames.map((checkName) => {
      const status = passedCheckSet.has(checkName)
        ? "passed"
        : failedCheckSet.has(checkName)
          ? "failed"
          : "skipped";
      return [checkName, status];
    })
  );
};
const createCheckStatusCountMap = ({
  passedCheckCount,
  failedCheckCount,
  skippedCheckCount,
}) => {
  return {
    passed: passedCheckCount,
    failed: failedCheckCount,
    skipped: skippedCheckCount,
  };
};
const resolveClientWasmPackCheckSummaryFromChecks = (checks) => {
  const clientCheck = checks.find((check) => {
    return check.name === "client";
  });

  if (
    clientCheck === undefined ||
    clientCheck.report === null ||
    typeof clientCheck.report !== "object"
  ) {
    return createPrefixedWasmPackCheckSummary(null, "client");
  }

  return createPrefixedWasmPackCheckSummary(clientCheck.report, "client");
};
const resolveTsCoreExampleSummaryFromChecks = (checks) => {
  const tsCoreCheck = checks.find((check) => {
    return check.name === "tsCore";
  });

  if (
    tsCoreCheck === undefined ||
    tsCoreCheck.report === null ||
    typeof tsCoreCheck.report !== "object"
  ) {
    return createPrefixedTsCoreExampleSummary(null, "tsCore");
  }

  return createPrefixedTsCoreExampleSummary(tsCoreCheck.report, "tsCore");
};
const emptyTsCoreExampleSummary = createPrefixedTsCoreExampleSummary(
  null,
  "tsCore"
);
const emptyClientWasmPackCheckSummary = createPrefixedWasmPackCheckSummary(
  null,
  "client"
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
const availableCheckAliasCountMap = Object.fromEntries(
  Object.entries(availableCheckAliases).map(([checkName, aliases]) => {
    return [checkName, aliases.length];
  })
);
const availableCheckAliasGroupCount = countRecordEntries(availableCheckAliases);
const availableCheckAliasCountMapCount = countRecordEntries(
  availableCheckAliasCountMap
);
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
const availableSpecialCheckAliasCountMap = Object.fromEntries(
  Object.entries(availableSpecialCheckAliases).map(([selector, aliases]) => {
    return [selector, aliases.length];
  })
);
const availableSpecialCheckSelectors = Object.keys(availableSpecialCheckAliases);
const availableSpecialCheckSelectorCount = availableSpecialCheckSelectors.length;
const availableSpecialCheckAliasGroupCount = countRecordEntries(
  availableSpecialCheckAliases
);
const availableSpecialCheckAliasCountMapCount = countRecordEntries(
  availableSpecialCheckAliasCountMap
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
const requestedCheckResolvedCommandMap = createCheckCommandMap(
  requestedCheckResolvedChecks
);
const requestedCheckResolvedCommandMapCount = countRecordEntries(
  requestedCheckResolvedCommandMap
);
const requestedCheckResolvedArgsMap = createCheckArgsMap(requestedCheckResolvedChecks);
const requestedCheckResolvedArgsMapCount = countRecordEntries(
  requestedCheckResolvedArgsMap
);
const requestedCheckResolvedArgCountMap = createCheckArgCountMap(
  requestedCheckResolvedChecks
);
const requestedCheckResolvedArgCountMapCount = countRecordEntries(
  requestedCheckResolvedArgCountMap
);
const requestedCheckResolvedMetadata = Object.fromEntries(
  requestedCheckResolvedChecks.map((checkName) => {
    const {
      scriptName,
      supportsNoBuild,
      checkCommand,
      checkArgs,
      checkArgCount,
    } = resolveCheckDetails(checkName);
    return [
      checkName,
      { scriptName, supportsNoBuild, checkCommand, checkArgs, checkArgCount },
    ];
  })
);
const requestedCheckResolvedMetadataCount = countRecordEntries(
  requestedCheckResolvedMetadata
);
const buildCheckSelectionMetadata = (checkNames) => {
  const checkMetadata = Object.fromEntries(
    checkNames.map((checkName) => {
      const {
        scriptName,
        supportsNoBuild,
        checkCommand,
        checkArgs,
        checkArgCount,
      } = resolveCheckDetails(checkName);
      return [
        checkName,
        { scriptName, supportsNoBuild, checkCommand, checkArgs, checkArgCount },
      ];
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

const runCheck = (name) => {
  const {
    scriptName,
    supportsNoBuild,
    checkCommand,
    checkArgs,
    checkArgCount,
    checkIndex,
  } = resolveCheckDetails(name);
  const checkStartMs = Date.now();
  const result = spawnSync(checkCommand, checkArgs, {
    cwd: __dirname,
    encoding: "utf8",
    shell: false,
  });

  const exitCode = result.status ?? 1;
  const output = `${result.stdout}${result.stderr}`.trim();
  const report = parseJsonOutput(output);

  return {
    name,
    scriptName,
    supportsNoBuild,
    checkCommand,
    checkArgs,
    checkArgCount,
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
  const validationCheckSummary = summarizeCheckResults([]);
  const validationCheckStatusMap = createCheckStatusMap({
    passedChecks: validationCheckSummary.passedChecks,
    failedChecks: validationCheckSummary.failedChecks,
  });
  const validationCheckStatusCountMap = createCheckStatusCountMap({
    passedCheckCount: validationCheckSummary.passedCheckCount,
    failedCheckCount: validationCheckSummary.failedCheckCount,
    skippedCheckCount: availableCheckNames.length,
  });
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
    selectedCheckIndexMap: {},
    selectedCheckIndexMapCount: 0,
    selectedCheckMetadata: {},
    selectedCheckMetadataCount: 0,
    selectedCheckScripts: [],
    selectedCheckScriptCount: 0,
    selectedCheckScriptMap: {},
    selectedCheckScriptMapCount: 0,
    selectedCheckCommandMap: {},
    selectedCheckCommandMapCount: 0,
    selectedCheckArgsMap: {},
    selectedCheckArgsMapCount: 0,
    selectedCheckArgCountMap: {},
    selectedCheckArgCountMapCount: 0,
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
    requestedCheckResolvedCommandMap,
    requestedCheckResolvedCommandMapCount,
    requestedCheckResolvedArgsMap,
    requestedCheckResolvedArgsMapCount,
    requestedCheckResolvedArgCountMap,
    requestedCheckResolvedArgCountMapCount,
    requestedCheckResolvedMetadata,
    requestedCheckResolvedMetadataCount,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks: availableCheckNames,
    skippedCheckCount: availableCheckNames.length,
    skippedCheckIndices: resolveCheckIndices(availableCheckNames),
    skippedCheckIndexCount: availableCheckNames.length,
    skippedCheckIndexMap: availableCheckIndexMap,
    skippedCheckIndexMapCount: availableCheckIndexMapCount,
    skippedCheckMetadata: allCheckMetadata,
    skippedCheckMetadataCount: allCheckMetadataCount,
    skippedCheckScripts: allCheckScripts,
    skippedCheckScriptCount: allCheckScriptCount,
    skippedCheckScriptMap: availableCheckScriptMap,
    skippedCheckScriptMapCount: availableCheckScriptMapCount,
    skippedCheckCommandMap: availableCheckCommandMap,
    skippedCheckCommandMapCount: availableCheckCommandMapCount,
    skippedCheckArgsMap: availableCheckArgsMap,
    skippedCheckArgsMapCount: availableCheckArgsMapCount,
    skippedCheckArgCountMap: availableCheckArgCountMap,
    skippedCheckArgCountMapCount: availableCheckArgCountMapCount,
    passedCheckScripts: [],
    passedCheckScriptCount: 0,
    passedCheckScriptMap: {},
    passedCheckScriptMapCount: 0,
    passedCheckCommandMap: {},
    passedCheckCommandMapCount: 0,
    passedCheckArgsMap: {},
    passedCheckArgsMapCount: 0,
    passedCheckArgCountMap: {},
    passedCheckArgCountMapCount: 0,
    passedCheckMetadata: {},
    passedCheckMetadataCount: 0,
    passedCheckIndices: [],
    passedCheckIndexCount: 0,
    passedCheckIndexMap: {},
    passedCheckIndexMapCount: 0,
    failedCheckScripts: [],
    failedCheckScriptCount: 0,
    failedCheckScriptMap: {},
    failedCheckScriptMapCount: 0,
    failedCheckCommandMap: {},
    failedCheckCommandMapCount: 0,
    failedCheckArgsMap: {},
    failedCheckArgsMapCount: 0,
    failedCheckArgCountMap: {},
    failedCheckArgCountMapCount: 0,
    failedCheckMetadata: {},
    failedCheckMetadataCount: 0,
    failedCheckIndices: [],
    failedCheckIndexCount: 0,
    failedCheckIndexMap: {},
    failedCheckIndexMapCount: 0,
    checkStatusMap: validationCheckStatusMap,
    checkStatusMapCount: countRecordEntries(validationCheckStatusMap),
    checkStatusCountMap: validationCheckStatusCountMap,
    checkStatusCountMapCount: countRecordEntries(validationCheckStatusCountMap),
    ...validationCheckSummary,
    failureSummaries: [],
    failureSummaryCount: 0,
    checks: [],
    checkCommandMap: {},
    checkCommandMapCount: 0,
    checkArgsMap: {},
    checkArgsMapCount: 0,
    checkArgCountMap: {},
    checkArgCountMapCount: 0,
    ...emptyTsCoreExampleSummary,
    ...emptyClientWasmPackCheckSummary,
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
    availableCheckCommandMap,
    availableCheckCommandMapCount,
    availableCheckArgsMap,
    availableCheckArgsMapCount,
    availableCheckArgCountMap,
    availableCheckArgCountMapCount,
    availableCheckSupportsNoBuildMap,
    availableCheckSupportsNoBuildMapCount,
    availableCheckIndices,
    availableCheckIndexCount: availableCheckIndices.length,
    availableCheckIndexMap,
    availableCheckIndexMapCount,
    availableCheckMetadata,
    availableCheckMetadataCount,
    availableCheckAliases,
    availableCheckAliasCountMap,
    availableCheckAliasGroupCount,
    availableCheckAliasCountMapCount,
    availableCheckAliasTokenCount,
    availableSpecialCheckSelectors,
    availableSpecialCheckSelectorCount,
    availableSpecialCheckAliases,
    availableSpecialCheckAliasCountMap,
    availableSpecialCheckAliasGroupCount,
    availableSpecialCheckAliasCountMapCount,
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
const selectedCheckIndexMap = createCheckIndexMap(selectedChecks);
const selectedCheckIndexMapCount = countRecordEntries(selectedCheckIndexMap);
const skippedCheckIndexMap = createCheckIndexMap(skippedChecks);
const skippedCheckIndexMapCount = countRecordEntries(skippedCheckIndexMap);
const selectedCheckScriptMap = createCheckScriptMap(selectedChecks);
const selectedCheckScriptMapCount = countRecordEntries(selectedCheckScriptMap);
const selectedCheckCommandMap = createCheckCommandMap(selectedChecks);
const selectedCheckCommandMapCount = countRecordEntries(selectedCheckCommandMap);
const selectedCheckArgsMap = createCheckArgsMap(selectedChecks);
const selectedCheckArgsMapCount = countRecordEntries(selectedCheckArgsMap);
const selectedCheckArgCountMap = createCheckArgCountMap(selectedChecks);
const selectedCheckArgCountMapCount = countRecordEntries(selectedCheckArgCountMap);
const skippedCheckScriptMap = createCheckScriptMap(skippedChecks);
const skippedCheckScriptMapCount = countRecordEntries(skippedCheckScriptMap);
const skippedCheckCommandMap = createCheckCommandMap(skippedChecks);
const skippedCheckCommandMapCount = countRecordEntries(skippedCheckCommandMap);
const skippedCheckArgsMap = createCheckArgsMap(skippedChecks);
const skippedCheckArgsMapCount = countRecordEntries(skippedCheckArgsMap);
const skippedCheckArgCountMap = createCheckArgCountMap(skippedChecks);
const skippedCheckArgCountMapCount = countRecordEntries(skippedCheckArgCountMap);
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
  const listCheckSummary = summarizeCheckResults([]);
  const listCheckStatusMap = createCheckStatusMap({
    passedChecks: listCheckSummary.passedChecks,
    failedChecks: listCheckSummary.failedChecks,
  });
  const listCheckStatusCountMap = createCheckStatusCountMap({
    passedCheckCount: listCheckSummary.passedCheckCount,
    failedCheckCount: listCheckSummary.failedCheckCount,
    skippedCheckCount: availableCheckNames.length,
  });
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
    selectedCheckIndexMap,
    selectedCheckIndexMapCount,
    selectedCheckMetadata,
    selectedCheckMetadataCount,
    selectedCheckScripts,
    selectedCheckScriptCount,
    selectedCheckScriptMap,
    selectedCheckScriptMapCount,
    selectedCheckCommandMap,
    selectedCheckCommandMapCount,
    selectedCheckArgsMap,
    selectedCheckArgsMapCount,
    selectedCheckArgCountMap,
    selectedCheckArgCountMapCount,
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
    requestedCheckResolvedCommandMap,
    requestedCheckResolvedCommandMapCount,
    requestedCheckResolvedArgsMap,
    requestedCheckResolvedArgsMapCount,
    requestedCheckResolvedArgCountMap,
    requestedCheckResolvedArgCountMapCount,
    requestedCheckResolvedMetadata,
    requestedCheckResolvedMetadataCount,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks,
    skippedCheckCount: skippedChecks.length,
    skippedCheckIndices,
    skippedCheckIndexCount: skippedCheckIndices.length,
    skippedCheckIndexMap,
    skippedCheckIndexMapCount,
    skippedCheckMetadata,
    skippedCheckMetadataCount,
    skippedCheckScripts,
    skippedCheckScriptCount,
    skippedCheckScriptMap,
    skippedCheckScriptMapCount,
    skippedCheckCommandMap,
    skippedCheckCommandMapCount,
    skippedCheckArgsMap,
    skippedCheckArgsMapCount,
    skippedCheckArgCountMap,
    skippedCheckArgCountMapCount,
    passedCheckScripts: [],
    passedCheckScriptCount: 0,
    passedCheckScriptMap: {},
    passedCheckScriptMapCount: 0,
    passedCheckCommandMap: {},
    passedCheckCommandMapCount: 0,
    passedCheckArgsMap: {},
    passedCheckArgsMapCount: 0,
    passedCheckArgCountMap: {},
    passedCheckArgCountMapCount: 0,
    passedCheckMetadata: {},
    passedCheckMetadataCount: 0,
    passedCheckIndices: [],
    passedCheckIndexCount: 0,
    passedCheckIndexMap: {},
    passedCheckIndexMapCount: 0,
    failedCheckScripts: [],
    failedCheckScriptCount: 0,
    failedCheckScriptMap: {},
    failedCheckScriptMapCount: 0,
    failedCheckCommandMap: {},
    failedCheckCommandMapCount: 0,
    failedCheckArgsMap: {},
    failedCheckArgsMapCount: 0,
    failedCheckArgCountMap: {},
    failedCheckArgCountMapCount: 0,
    failedCheckMetadata: {},
    failedCheckMetadataCount: 0,
    failedCheckIndices: [],
    failedCheckIndexCount: 0,
    failedCheckIndexMap: {},
    failedCheckIndexMapCount: 0,
    checkStatusMap: listCheckStatusMap,
    checkStatusMapCount: countRecordEntries(listCheckStatusMap),
    checkStatusCountMap: listCheckStatusCountMap,
    checkStatusCountMapCount: countRecordEntries(listCheckStatusCountMap),
    ...listCheckSummary,
    failureSummaries: [],
    failureSummaryCount: 0,
    checks: [],
    checkCommandMap: {},
    checkCommandMapCount: 0,
    checkArgsMap: {},
    checkArgsMapCount: 0,
    checkArgCountMap: {},
    checkArgCountMapCount: 0,
    ...emptyTsCoreExampleSummary,
    ...emptyClientWasmPackCheckSummary,
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
    availableCheckCommandMap,
    availableCheckCommandMapCount,
    availableCheckArgsMap,
    availableCheckArgsMapCount,
    availableCheckArgCountMap,
    availableCheckArgCountMapCount,
    availableCheckSupportsNoBuildMap,
    availableCheckSupportsNoBuildMapCount,
    availableCheckIndices,
    availableCheckIndexCount: availableCheckIndices.length,
    availableCheckIndexMap,
    availableCheckIndexMapCount,
    availableCheckMetadata,
    availableCheckMetadataCount,
    availableCheckAliases,
    availableCheckAliasCountMap,
    availableCheckAliasGroupCount,
    availableCheckAliasCountMapCount,
    availableCheckAliasTokenCount,
    availableSpecialCheckSelectors,
    availableSpecialCheckSelectorCount,
    availableSpecialCheckAliases,
    availableSpecialCheckAliasCountMap,
    availableSpecialCheckAliasGroupCount,
    availableSpecialCheckAliasCountMapCount,
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
    return runCheck(check.name);
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
const passedCheckIndexMap = createCheckIndexMap(checkSummary.passedChecks);
const failedCheckIndexMap = createCheckIndexMap(checkSummary.failedChecks);
const passedCheckIndexMapCount = countRecordEntries(passedCheckIndexMap);
const failedCheckIndexMapCount = countRecordEntries(failedCheckIndexMap);
const passedCheckScriptMap = createCheckScriptMap(checkSummary.passedChecks);
const failedCheckScriptMap = createCheckScriptMap(checkSummary.failedChecks);
const passedCheckScriptMapCount = countRecordEntries(passedCheckScriptMap);
const failedCheckScriptMapCount = countRecordEntries(failedCheckScriptMap);
const passedCheckCommandMap = createCheckCommandMap(checkSummary.passedChecks);
const passedCheckCommandMapCount = countRecordEntries(passedCheckCommandMap);
const passedCheckArgsMap = createCheckArgsMap(checkSummary.passedChecks);
const passedCheckArgsMapCount = countRecordEntries(passedCheckArgsMap);
const passedCheckArgCountMap = createCheckArgCountMap(checkSummary.passedChecks);
const passedCheckArgCountMapCount = countRecordEntries(passedCheckArgCountMap);
const failedCheckCommandMap = createCheckCommandMap(checkSummary.failedChecks);
const failedCheckCommandMapCount = countRecordEntries(failedCheckCommandMap);
const failedCheckArgsMap = createCheckArgsMap(checkSummary.failedChecks);
const failedCheckArgsMapCount = countRecordEntries(failedCheckArgsMap);
const failedCheckArgCountMap = createCheckArgCountMap(checkSummary.failedChecks);
const failedCheckArgCountMapCount = countRecordEntries(failedCheckArgCountMap);
const checkStatusMap = createCheckStatusMap({
  passedChecks: checkSummary.passedChecks,
  failedChecks: checkSummary.failedChecks,
});
const checkStatusMapCount = countRecordEntries(checkStatusMap);
const checkStatusCountMap = createCheckStatusCountMap({
  passedCheckCount: checkSummary.passedCheckCount,
  failedCheckCount: checkSummary.failedCheckCount,
  skippedCheckCount: skippedChecks.length,
});
const checkStatusCountMapCount = countRecordEntries(checkStatusCountMap);
const checkCommandMap = Object.fromEntries(
  checks.map((check) => {
    return [check.name, check.checkCommand];
  })
);
const checkCommandMapCount = countRecordEntries(checkCommandMap);
const checkArgsMap = Object.fromEntries(
  checks.map((check) => {
    return [check.name, check.checkArgs];
  })
);
const checkArgsMapCount = countRecordEntries(checkArgsMap);
const checkArgCountMap = Object.fromEntries(
  checks.map((check) => {
    return [check.name, check.checkArgCount];
  })
);
const checkArgCountMapCount = countRecordEntries(checkArgCountMap);
const tsCoreExampleSummary = resolveTsCoreExampleSummaryFromChecks(checks);
const clientWasmPackCheckSummary =
  resolveClientWasmPackCheckSummaryFromChecks(checks);
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
  selectedCheckIndexMap,
  selectedCheckIndexMapCount,
  selectedCheckMetadata,
  selectedCheckMetadataCount,
  selectedCheckScripts,
  selectedCheckScriptCount,
  selectedCheckScriptMap,
  selectedCheckScriptMapCount,
  selectedCheckCommandMap,
  selectedCheckCommandMapCount,
  selectedCheckArgsMap,
  selectedCheckArgsMapCount,
  selectedCheckArgCountMap,
  selectedCheckArgCountMapCount,
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
  requestedCheckResolvedCommandMap,
  requestedCheckResolvedCommandMapCount,
  requestedCheckResolvedArgsMap,
  requestedCheckResolvedArgsMapCount,
  requestedCheckResolvedArgCountMap,
  requestedCheckResolvedArgCountMapCount,
  requestedCheckResolvedMetadata,
  requestedCheckResolvedMetadataCount,
  selectionMode,
  specialSelectorsUsed,
  skippedChecks,
  skippedCheckCount: skippedChecks.length,
  skippedCheckIndices,
  skippedCheckIndexCount: skippedCheckIndices.length,
  skippedCheckIndexMap,
  skippedCheckIndexMapCount,
  skippedCheckMetadata,
  skippedCheckMetadataCount,
  skippedCheckScripts,
  skippedCheckScriptCount,
  skippedCheckScriptMap,
  skippedCheckScriptMapCount,
  skippedCheckCommandMap,
  skippedCheckCommandMapCount,
  skippedCheckArgsMap,
  skippedCheckArgsMapCount,
  skippedCheckArgCountMap,
  skippedCheckArgCountMapCount,
  passedCheckScripts,
  passedCheckScriptCount,
  passedCheckScriptMap,
  passedCheckScriptMapCount,
  passedCheckCommandMap,
  passedCheckCommandMapCount,
  passedCheckArgsMap,
  passedCheckArgsMapCount,
  passedCheckArgCountMap,
  passedCheckArgCountMapCount,
  passedCheckMetadata,
  passedCheckMetadataCount,
  passedCheckIndices,
  passedCheckIndexCount: passedCheckIndices.length,
  passedCheckIndexMap,
  passedCheckIndexMapCount,
  failedCheckScripts,
  failedCheckScriptCount,
  failedCheckScriptMap,
  failedCheckScriptMapCount,
  failedCheckCommandMap,
  failedCheckCommandMapCount,
  failedCheckArgsMap,
  failedCheckArgsMapCount,
  failedCheckArgCountMap,
  failedCheckArgCountMapCount,
  failedCheckMetadata,
  failedCheckMetadataCount,
  failedCheckIndices,
  failedCheckIndexCount: failedCheckIndices.length,
  failedCheckIndexMap,
  failedCheckIndexMapCount,
  checkStatusMap,
  checkStatusMapCount,
  checkStatusCountMap,
  checkStatusCountMapCount,
  ...checkSummary,
  failureSummaries,
  failureSummaryCount: failureSummaries.length,
  checks,
  checkCommandMap,
  checkCommandMapCount,
  checkArgsMap,
  checkArgsMapCount,
  checkArgCountMap,
  checkArgCountMapCount,
  ...tsCoreExampleSummary,
  ...clientWasmPackCheckSummary,
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
  availableCheckCommandMap,
  availableCheckCommandMapCount,
  availableCheckArgsMap,
  availableCheckArgsMapCount,
  availableCheckArgCountMap,
  availableCheckArgCountMapCount,
  availableCheckSupportsNoBuildMap,
  availableCheckSupportsNoBuildMapCount,
  availableCheckIndices,
  availableCheckIndexCount: availableCheckIndices.length,
  availableCheckIndexMap,
  availableCheckIndexMapCount,
  availableCheckMetadata,
  availableCheckMetadataCount,
  availableCheckAliases,
  availableCheckAliasCountMap,
  availableCheckAliasGroupCount,
  availableCheckAliasCountMapCount,
  availableCheckAliasTokenCount,
  availableSpecialCheckSelectors,
  availableSpecialCheckSelectorCount,
  availableSpecialCheckAliases,
  availableSpecialCheckAliasCountMap,
  availableSpecialCheckAliasGroupCount,
  availableSpecialCheckAliasCountMapCount,
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
