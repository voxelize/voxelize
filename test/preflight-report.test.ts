import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type PreflightCheckResult = {
  name: string;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  report: object | null;
  output: string | null;
};

type PreflightFailureSummary = {
  name: string;
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
  requestedChecks: string[];
  requestedCheckCount: number;
  requestedCheckResolutions: RequestedCheckResolution[];
  requestedCheckResolutionCounts: {
    check: number;
    specialSelector: number;
    invalid: number;
  };
  skippedChecks: string[];
  skippedCheckCount: number;
  totalChecks: number;
  passedCheckCount: number;
  failedCheckCount: number;
  firstFailedCheck: string | null;
  availableChecks: string[];
  availableCheckMetadata: {
    devEnvironment: {
      scriptName: string;
      supportsNoBuild: boolean;
    };
    wasmPack: {
      scriptName: string;
      supportsNoBuild: boolean;
    };
    client: {
      scriptName: string;
      supportsNoBuild: boolean;
    };
  };
  availableCheckAliases: {
    devEnvironment: string[];
    wasmPack: string[];
    client: string[];
  };
  availableSpecialCheckSelectors: string[];
  availableSpecialCheckAliases: {
    all: string[];
  };
  availableSpecialSelectorResolvedChecks: {
    all: string[];
  };
  requestedCheckResolutionKinds: Array<
    RequestedCheckResolution["kind"]
  >;
  passedChecks: string[];
  failedChecks: string[];
  failureSummaries: PreflightFailureSummary[];
  checks: PreflightCheckResult[];
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
  client: ["client"],
};
const expectedAvailableCheckMetadata = {
  devEnvironment: {
    scriptName: "check-dev-env.mjs",
    supportsNoBuild: false,
  },
  wasmPack: {
    scriptName: "check-wasm-pack.mjs",
    supportsNoBuild: false,
  },
  client: {
    scriptName: "check-client.mjs",
    supportsNoBuild: true,
  },
};
const expectedAvailableSpecialCheckAliases = {
  all: ["all", "all-checks", "all_checks", "allchecks"],
};
const expectedAvailableSpecialCheckSelectors = ["all"];
const expectedAvailableSpecialSelectorResolvedChecks = {
  all: ["devEnvironment", "wasmPack", "client"],
};
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
    expect(report.availableChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(report.availableSpecialCheckSelectors).toEqual(
      expectedAvailableSpecialCheckSelectors
    );
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
    expect(report.availableSpecialSelectorResolvedChecks).toEqual(
      expectedAvailableSpecialSelectorResolvedChecks
    );
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
    expect(report.requestedCheckResolutionKinds).toEqual(
      expectedRequestedCheckResolutionKinds
    );
    expect(report.selectionMode).toBe("default");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.selectedCheckCount).toBe(report.selectedChecks.length);
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
    expect(Array.isArray(report.failureSummaries)).toBe(true);
    expect(report.passedChecks.length + report.failedChecks.length).toBe(3);
    expect(report.failureSummaries.length).toBe(report.failedChecks.length);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual(
      ["client", "devEnvironment", "wasmPack"]
    );
    expect(report.failureSummaries.map((entry) => entry.name).sort()).toEqual(
      report.failedChecks.slice().sort()
    );
    for (const entry of report.failureSummaries) {
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
    expect(report.checks.length).toBe(3);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
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
    expect(report.skippedChecks).toEqual(["wasmPack"]);
    expect(report.skippedCheckCount).toBe(1);
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
    expect(report.skippedChecks).toEqual(["wasmPack"]);
    expect(report.skippedCheckCount).toBe(1);
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
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack"]);
    expect(report.skippedCheckCount).toBe(2);
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
    expect(report.skippedChecks).toEqual(["wasmPack"]);
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
    expect(report.skippedChecks).toEqual(["wasmPack"]);
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
    expect(report.skippedChecks).toEqual([]);
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
    expect(report.skippedChecks).toEqual(["client"]);
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
    expect(report.skippedChecks).toEqual(["client"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
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
        resolvedTo: ["devEnvironment", "wasmPack", "client"],
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
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["ALL"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
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
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["all_checks"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
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
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["allchecks"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
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
        resolvedTo: ["devEnvironment", "wasmPack", "client"],
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
    expect(report.skippedChecks).toEqual(["wasmPack"]);
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
    expect(report.skippedChecks).toEqual(["wasmPack", "client"]);
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
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack"]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual(["client"]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
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
      "client",
    ]);
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all (all-checks, all_checks, allchecks)."
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
    expect(report.selectedCheckCount).toBe(3);
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
    expect(report.selectedCheckCount).toBe(3);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.skippedCheckCount).toBe(0);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
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
        resolvedTo: ["devEnvironment", "wasmPack", "client"],
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all (all-checks, all_checks, allchecks)."
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
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
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
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
    expect(report.availableSpecialSelectorResolvedChecks).toEqual(
      expectedAvailableSpecialSelectorResolvedChecks
    );
    expect(report.requestedCheckResolutionKinds).toEqual(
      expectedRequestedCheckResolutionKinds
    );
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
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(report.availableSpecialCheckSelectors).toEqual(
      expectedAvailableSpecialCheckSelectors
    );
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
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
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(report.availableSpecialCheckSelectors).toEqual(
      expectedAvailableSpecialCheckSelectors
    );
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
    expect(report.availableSpecialSelectorResolvedChecks).toEqual(
      expectedAvailableSpecialSelectorResolvedChecks
    );
    expect(report.requestedCheckResolutionKinds).toEqual(
      expectedRequestedCheckResolutionKinds
    );
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
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
    expect(report.availableSpecialSelectorResolvedChecks).toEqual(
      expectedAvailableSpecialSelectorResolvedChecks
    );
    expect(report.requestedCheckResolutionKinds).toEqual(
      expectedRequestedCheckResolutionKinds
    );
    expect(report.availableSpecialCheckSelectors).toEqual(
      expectedAvailableSpecialCheckSelectors
    );
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
    expect(report.availableChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
    expect(report.availableSpecialSelectorResolvedChecks).toEqual(
      expectedAvailableSpecialSelectorResolvedChecks
    );
    expect(report.requestedCheckResolutionKinds).toEqual(
      expectedRequestedCheckResolutionKinds
    );
    expect(report.availableSpecialCheckSelectors).toEqual(
      expectedAvailableSpecialCheckSelectors
    );
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
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all (all-checks, all_checks, allchecks)."
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
    expect(report.availableChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "client",
    ]);
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
    expect(report.availableSpecialCheckAliases).toEqual(
      expectedAvailableSpecialCheckAliases
    );
    expect(report.availableSpecialSelectorResolvedChecks).toEqual(
      expectedAvailableSpecialSelectorResolvedChecks
    );
    expect(report.requestedCheckResolutionKinds).toEqual(
      expectedRequestedCheckResolutionKinds
    );
    expect(report.availableSpecialCheckSelectors).toEqual(
      expectedAvailableSpecialCheckSelectors
    );
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
        resolvedTo: ["devEnvironment", "wasmPack", "client"],
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all (all-checks, all_checks, allchecks)."
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
      "Invalid check name(s): invalidCheck, otherInvalid. Available checks: devEnvironment, wasmPack, client. Special selectors: all (all-checks, all_checks, allchecks)."
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all (all-checks, all_checks, allchecks)."
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, client. Special selectors: all (all-checks, all_checks, allchecks)."
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
