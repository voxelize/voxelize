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
  startedAt: string;
  endedAt: string;
  durationMs: number;
  selectionMode: "default" | "only";
  specialSelectorsUsed: string[];
  selectedChecks: string[];
  requestedChecks: string[];
  requestedCheckResolutions: RequestedCheckResolution[];
  skippedChecks: string[];
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
  invalidChecks: string[];
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
    expect(report.requestedCheckResolutionKinds).toEqual(
      expectedRequestedCheckResolutionKinds
    );
    expect(report.selectionMode).toBe("default");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.skippedChecks).toEqual([]);
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
    expect(report.selectedChecks).toEqual(["devEnvironment", "client"]);
    expect(report.requestedChecks).toEqual(["devEnvironment", "client"]);
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
    expect(report.skippedChecks).toEqual(["wasmPack"]);
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
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.selectionMode).toBe("default");
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.skippedChecks).toEqual([]);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.checks).toEqual([]);
    expect(report.failureSummaries).toEqual([]);
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
    expect(report.selectionMode).toBe("only");
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
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
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
    expect(report.checks).toEqual([]);
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
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(stdoutReport.passed ? 0 : stdoutReport.exitCode);

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
    expect(report.totalChecks).toBe(0);
    expect(report.passedCheckCount).toBe(0);
    expect(report.failedCheckCount).toBe(0);
    expect(report.firstFailedCheck).toBeNull();
    expect(report.selectionMode).toBe("default");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.message).toBe("Missing value for --output option.");
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

  it("fails when the last output flag value is missing", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--output", "./first.json", "--output"],
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
    expect(result.status).toBe(1);
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
    expect(report.invalidChecks).toEqual(["invalidCheck"]);
    expect(report.requestedChecks).toEqual(["devEnvironment", "invalidCheck"]);
    expect(report.specialSelectorsUsed).toEqual([]);
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
    expect(report.invalidChecks).toEqual(["invalidCheck", "otherInvalid"]);
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.requestedChecks).toEqual([
      "devEnvironment",
      "invalidCheck",
      "INVALID_CHECK",
      "invalid-check",
      "otherInvalid",
    ]);
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
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.message).toBe(stdoutReport.message);
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
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.message).toBe(stdoutReport.message);
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
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
});
