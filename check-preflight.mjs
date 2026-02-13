import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTimedReportBuilder,
  deriveFailureMessageFromReport,
  parseJsonOutput,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  summarizeCheckResults,
} from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliArgs = process.argv.slice(2);
const availableCliOptionAliases = {
  "--list-checks": ["--list", "-l"],
  "--no-build": ["--verify"],
};
const hasCliOption = (canonicalOption) => {
  if (cliArgs.includes(canonicalOption)) {
    return true;
  }

  const optionAliases = availableCliOptionAliases[canonicalOption] ?? [];
  return optionAliases.some((alias) => cliArgs.includes(alias));
};
const isNoBuild = hasCliOption("--no-build");
const isListChecks = hasCliOption("--list-checks");
const isCompact = cliArgs.includes("--compact");
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
const supportedCliOptionsSet = new Set(supportedCliOptions);
const cliOptionsWithValues = new Set(["--only", "--output"]);
const canonicalCliOptions = [
  "--compact",
  "--json",
  "--list-checks",
  "--no-build",
  "--only",
  "--output",
  "--quiet",
];
const cliOptionCanonicalMap = new Map(
  canonicalCliOptions.map((option) => [option, option])
);
for (const [canonicalOption, aliases] of Object.entries(availableCliOptionAliases)) {
  for (const alias of aliases) {
    cliOptionCanonicalMap.set(alias, canonicalOption);
  }
}
const jsonFormat = { compact: isCompact };
const { outputPath: resolvedOutputPath, error: outputPathError } =
  resolveOutputPath(cliArgs);
const onlyArgIndex = cliArgs.lastIndexOf("--only");
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
    name: "client",
    scriptName: "check-client.mjs",
    supportsNoBuild: true,
    extraArgs: isNoBuild ? ["--no-build"] : [],
  },
];
const availableCheckNames = availableChecks.map((check) => check.name);
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
  client: ["client"],
};
const availableSpecialCheckAliases = {
  all: ["all", "all-checks", "all_checks", "allchecks"],
};
const availableSpecialCheckSelectors = Object.keys(availableSpecialCheckAliases);
const requestedCheckResolutionKinds = ["check", "specialSelector", "invalid"];
const specialSelectorChecks = {
  all: availableCheckNames,
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
  if (onlyArgIndex === -1) {
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

  const onlyValue = cliArgs[onlyArgIndex + 1] ?? null;
  if (onlyValue === null || onlyValue.startsWith("--")) {
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

  const tokenizedChecks = onlyValue
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
const parseUnknownOptions = (args) => {
  const unknownOptions = [];
  const seenUnknownOptions = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-") || arg === "-" || arg === "--") {
      continue;
    }
    const canonicalOption = cliOptionCanonicalMap.get(arg) ?? null;
    if (canonicalOption !== null || supportedCliOptionsSet.has(arg)) {
      const optionName = canonicalOption ?? arg;
      if (cliOptionsWithValues.has(optionName)) {
        const nextArg = args[index + 1] ?? null;
        if (nextArg !== null && !nextArg.startsWith("--")) {
          index += 1;
        }
      }
      continue;
    }
    if (seenUnknownOptions.has(arg)) {
      continue;
    }

    seenUnknownOptions.add(arg);
    unknownOptions.push(arg);
  }

  return unknownOptions;
};
const unknownOptions = parseUnknownOptions(cliArgs);
const parseActiveCliOptions = (args) => {
  const activeCliOptions = new Set();
  for (const arg of args) {
    const canonicalOption = cliOptionCanonicalMap.get(arg);
    if (canonicalOption !== undefined) {
      activeCliOptions.add(canonicalOption);
    }
  }

  return canonicalCliOptions.filter((option) => activeCliOptions.has(option));
};
const activeCliOptions = parseActiveCliOptions(cliArgs);
const activeCliOptionCount = activeCliOptions.length;
const parseActiveCliOptionTokens = (args) => {
  const activeTokens = [];
  const seenActiveTokens = new Set();

  for (const arg of args) {
    const canonicalOption = cliOptionCanonicalMap.get(arg) ?? null;
    if (canonicalOption === null) {
      continue;
    }
    if (seenActiveTokens.has(arg)) {
      continue;
    }

    seenActiveTokens.add(arg);
    activeTokens.push(arg);
  }

  return activeTokens;
};
const activeCliOptionTokens = parseActiveCliOptionTokens(cliArgs);
const activeCliOptionResolutions = activeCliOptionTokens.map((token) => {
  const canonicalOption = cliOptionCanonicalMap.get(token);
  return {
    token,
    canonicalOption: canonicalOption ?? token,
  };
});
const activeCliOptionResolutionCount = activeCliOptionResolutions.length;
const unsupportedOptionsError =
  unknownOptions.length === 0
    ? null
    : `Unsupported option(s): ${unknownOptions.join(", ")}. Supported options: ${supportedCliOptions.join(", ")}.`;
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
  const unknownOptionCount = unknownOptions.length;
  const report = buildTimedReport({
    passed: false,
    exitCode: 1,
    listChecksOnly: isListChecks,
    noBuild: isNoBuild,
    platform,
    nodeVersion,
    selectedChecks: [],
    selectedCheckCount: 0,
    requestedChecks,
    requestedCheckCount: requestedChecks.length,
    requestedCheckResolutions,
    requestedCheckResolutionCounts,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks: availableCheckNames,
    skippedCheckCount: availableCheckNames.length,
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
    activeCliOptions,
    activeCliOptionCount,
    activeCliOptionTokens,
    activeCliOptionResolutions,
    activeCliOptionResolutionCount,
    availableCliOptionAliases,
    availableChecks: availableCheckNames,
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

if (isListChecks) {
  const invalidCheckCount = 0;
  const unknownOptionCount = unknownOptions.length;
  const report = buildTimedReport({
    passed: true,
    exitCode: 0,
    listChecksOnly: true,
    noBuild: isNoBuild,
    platform,
    nodeVersion,
    selectedChecks,
    selectedCheckCount: selectedChecks.length,
    requestedChecks,
    requestedCheckCount: requestedChecks.length,
    requestedCheckResolutions,
    requestedCheckResolutionCounts,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks,
    skippedCheckCount: skippedChecks.length,
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
    activeCliOptions,
    activeCliOptionCount,
    activeCliOptionTokens,
    activeCliOptionResolutions,
    activeCliOptionResolutionCount,
    availableCliOptionAliases,
    availableChecks: availableCheckNames,
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
const invalidCheckCount = 0;
const unknownOptionCount = unknownOptions.length;
const failureSummaries = checks
  .filter((check) => !check.passed)
  .map((check) => {
    const reportMessage = deriveFailureMessageFromReport(check.report);

    return {
      name: check.name,
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
  selectedChecks,
  selectedCheckCount: selectedChecks.length,
  requestedChecks,
  requestedCheckCount: requestedChecks.length,
  requestedCheckResolutions,
  requestedCheckResolutionCounts,
  selectionMode,
  specialSelectorsUsed,
  skippedChecks,
  skippedCheckCount: skippedChecks.length,
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
  activeCliOptions,
  activeCliOptionCount,
  activeCliOptionTokens,
  activeCliOptionResolutions,
  activeCliOptionResolutionCount,
  availableCliOptionAliases,
  availableChecks: availableCheckNames,
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
