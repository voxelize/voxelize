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
const isNoBuild = cliArgs.includes("--no-build");
const isCompact = cliArgs.includes("--compact");
const jsonFormat = { compact: isCompact };
const { outputPath: resolvedOutputPath, error: outputPathError } =
  resolveOutputPath(cliArgs);
const onlyArgIndex = cliArgs.lastIndexOf("--only");
const buildTimedReport = createTimedReportBuilder();

const availableChecks = [
  {
    name: "devEnvironment",
    scriptName: "check-dev-env.mjs",
    extraArgs: [],
  },
  {
    name: "wasmPack",
    scriptName: "check-wasm-pack.mjs",
    extraArgs: [],
  },
  {
    name: "client",
    scriptName: "check-client.mjs",
    extraArgs: isNoBuild ? ["--no-build"] : [],
  },
];
const availableCheckNames = availableChecks.map((check) => check.name);
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

if (outputPathError !== null || selectedChecksError !== null) {
  const effectiveInvalidChecks = outputPathError === null ? invalidChecks : [];
  const report = buildTimedReport({
    passed: false,
    exitCode: 1,
    noBuild: isNoBuild,
    platform,
    nodeVersion,
    selectedChecks: [],
    requestedChecks,
    requestedCheckResolutions,
    selectionMode,
    specialSelectorsUsed,
    skippedChecks: availableCheckNames,
    ...summarizeCheckResults([]),
    checks: [],
    outputPath: outputPathError === null ? resolvedOutputPath : null,
    message: outputPathError ?? selectedChecksError,
    invalidChecks: effectiveInvalidChecks,
    availableChecks: availableCheckNames,
    availableCheckAliases,
    availableSpecialCheckSelectors,
    availableSpecialCheckAliases,
    availableSpecialSelectorResolvedChecks,
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
const checks = availableChecks
  .filter((check) => selectedCheckSet.has(check.name))
  .map((check) => {
    return runCheck(check.name, check.scriptName, check.extraArgs);
  });

const passed = checks.every((check) => check.passed);
const exitCode = passed ? 0 : 1;
const checkSummary = summarizeCheckResults(checks);
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
  noBuild: isNoBuild,
  platform,
  nodeVersion,
  selectedChecks,
  requestedChecks,
  requestedCheckResolutions,
  selectionMode,
  specialSelectorsUsed,
  skippedChecks,
  ...checkSummary,
  failureSummaries,
  checks,
  outputPath: resolvedOutputPath,
  invalidChecks: [],
  availableChecks: availableCheckNames,
  availableCheckAliases,
  availableSpecialCheckSelectors,
  availableSpecialCheckAliases,
  availableSpecialSelectorResolvedChecks,
});
const { reportJson, writeError } = serializeReportWithOptionalWrite(report, {
  jsonFormat,
  outputPath: resolvedOutputPath,
  buildTimedReport,
});

console.log(reportJson);

process.exit(writeError === null ? exitCode : 1);
