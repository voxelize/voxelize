import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type PreflightCheckResult = {
  name: string;
  scriptName: string;
  supportsNoBuild: boolean;
  checkIndex: number | null;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  report: object | null;
  output: string | null;
};

type TsCoreNestedReport = {
  checkedPackage: string;
  checkedPackageCount: number;
  checkedPackagePath: string;
  checkedPackagePathCount: number;
  presentPackages: string[];
  missingPackages: string[];
  presentPackagePaths: string[];
  missingPackagePaths: string[];
  requiredPackageCount: number;
  presentPackageCount: number;
  missingPackageCount: number;
  packagePath: string;
  requiredArtifacts: string[];
  requiredArtifactCount: number;
  presentArtifacts: string[];
  presentArtifactCount: number;
  missingArtifacts: string[];
  missingArtifactCount: number;
  missingArtifactSummary: string | null;
  artifactsPresent: boolean;
  buildCommand: string;
  buildArgs: string[];
  buildExitCode: number | null;
  buildDurationMs: number | null;
  attemptedBuild: boolean;
  buildSkipped: boolean;
  buildSkippedReason: "no-build" | "artifacts-present" | null;
  noBuild: boolean;
};

type RuntimeLibrariesNestedPackageReport = {
  packageName: string;
  packagePath: string;
  requiredArtifacts: string[];
  requiredArtifactCount: number;
  presentArtifacts: string[];
  presentArtifactCount: number;
  missingArtifacts: string[];
  missingArtifactCount: number;
  artifactsPresent: boolean;
};

type RuntimeLibrariesNestedReport = {
  packagesPresent: boolean;
  checkedPackages: string[];
  checkedPackagePaths: string[];
  checkedPackageCount: number;
  checkedPackagePathCount: number;
  presentPackages: string[];
  missingPackages: string[];
  requiredPackageCount: number;
  presentPackageCount: number;
  packageReportCount: number;
  packageReports: RuntimeLibrariesNestedPackageReport[];
  requiredArtifactCount: number;
  presentArtifactCount: number;
  missingPackageCount: number;
  missingArtifactCount: number;
  missingArtifactSummary: string | null;
  buildCommand: string;
  buildArgs: string[];
  buildExitCode: number | null;
  buildDurationMs: number | null;
  attemptedBuild: boolean;
  buildSkipped: boolean;
  buildSkippedReason: "no-build" | "artifacts-present" | null;
  noBuild: boolean;
};

type PreflightFailureSummary = {
  name: string;
  scriptName: string;
  supportsNoBuild: boolean;
  checkIndex: number | null;
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
  selectedCheckIndices: number[];
  selectedCheckIndexCount: number;
  selectedCheckMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  selectedCheckMetadataCount: number;
  selectedCheckScripts: string[];
  selectedCheckScriptCount: number;
  skippedCheckMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  skippedCheckMetadataCount: number;
  skippedCheckScripts: string[];
  skippedCheckScriptCount: number;
  requestedChecks: string[];
  requestedCheckCount: number;
  requestedCheckResolutions: RequestedCheckResolution[];
  requestedCheckResolutionCounts: {
    check: number;
    specialSelector: number;
    invalid: number;
  };
  requestedCheckResolvedChecks: string[];
  requestedCheckResolvedCheckCount: number;
  requestedCheckResolvedScripts: string[];
  requestedCheckResolvedScriptCount: number;
  requestedCheckResolvedScriptMap: Record<string, string>;
  requestedCheckResolvedScriptMapCount: number;
  requestedCheckResolvedSupportsNoBuildMap: Record<string, boolean>;
  requestedCheckResolvedSupportsNoBuildMapCount: number;
  requestedCheckResolvedIndices: number[];
  requestedCheckResolvedIndexCount: number;
  requestedCheckResolvedIndexMap: Record<string, number>;
  requestedCheckResolvedIndexMapCount: number;
  requestedCheckResolvedMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  requestedCheckResolvedMetadataCount: number;
  skippedChecks: string[];
  skippedCheckCount: number;
  skippedCheckIndices: number[];
  skippedCheckIndexCount: number;
  totalChecks: number;
  passedCheckCount: number;
  failedCheckCount: number;
  passedCheckScripts: string[];
  passedCheckScriptCount: number;
  passedCheckMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  passedCheckMetadataCount: number;
  passedCheckIndices: number[];
  passedCheckIndexCount: number;
  failedCheckScripts: string[];
  failedCheckScriptCount: number;
  failedCheckMetadata: Record<
    string,
    {
      scriptName: string;
      supportsNoBuild: boolean;
    }
  >;
  failedCheckMetadataCount: number;
  failedCheckIndices: number[];
  failedCheckIndexCount: number;
  firstFailedCheck: string | null;
  availableChecks: string[];
  availableCheckScripts: string[];
  availableCheckScriptCount: number;
  availableCheckScriptMap: Record<string, string>;
  availableCheckScriptMapCount: number;
  availableCheckSupportsNoBuildMap: Record<string, boolean>;
  availableCheckSupportsNoBuildMapCount: number;
  availableCheckIndices: number[];
  availableCheckIndexCount: number;
  availableCheckIndexMap: Record<string, number>;
  availableCheckIndexMapCount: number;
  availableCheckMetadata: {
    devEnvironment: {
      scriptName: string;
      supportsNoBuild: boolean;
    };
    wasmPack: {
      scriptName: string;
      supportsNoBuild: boolean;
    };
    tsCore: {
      scriptName: string;
      supportsNoBuild: boolean;
    };
    runtimeLibraries: {
      scriptName: string;
      supportsNoBuild: boolean;
    };
    client: {
      scriptName: string;
      supportsNoBuild: boolean;
    };
  };
  availableCheckMetadataCount: number;
  availableCheckAliases: {
    devEnvironment: string[];
    wasmPack: string[];
    tsCore: string[];
    runtimeLibraries: string[];
    client: string[];
  };
  availableCheckAliasGroupCount: number;
  availableCheckAliasTokenCount: number;
  availableSpecialCheckSelectors: string[];
  availableSpecialCheckSelectorCount: number;
  availableSpecialCheckAliases: {
    all: string[];
    libraries: string[];
  };
  availableSpecialCheckAliasGroupCount: number;
  availableSpecialCheckAliasTokenCount: number;
  availableSpecialSelectorResolvedChecks: {
    all: string[];
    libraries: string[];
  };
  availableSpecialSelectorResolvedChecksCount: number;
  requestedCheckResolutionKinds: Array<
    RequestedCheckResolution["kind"]
  >;
  requestedCheckResolutionKindCount: number;
  passedChecks: string[];
  failedChecks: string[];
  failureSummaries: PreflightFailureSummary[];
  failureSummaryCount: number;
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
const expectedAvailableCheckMetadata = {
  devEnvironment: {
    scriptName: "check-dev-env.mjs",
    supportsNoBuild: false,
  },
  wasmPack: {
    scriptName: "check-wasm-pack.mjs",
    supportsNoBuild: false,
  },
  tsCore: {
    scriptName: "check-ts-core.mjs",
    supportsNoBuild: true,
  },
  runtimeLibraries: {
    scriptName: "check-runtime-libraries.mjs",
    supportsNoBuild: true,
  },
  client: {
    scriptName: "check-client.mjs",
    supportsNoBuild: true,
  },
};
const expectedAvailableSpecialCheckAliases = {
  all: ["all", "all-checks", "all_checks", "allchecks"],
  libraries: ["libraries", "library", "libs", "lib"],
};
const expectedAvailableSpecialCheckSelectors = ["all", "libraries"];
const expectedAvailableSpecialSelectorResolvedChecks = {
  all: [
    "devEnvironment",
    "wasmPack",
    "tsCore",
    "runtimeLibraries",
    "client",
  ],
  libraries: ["tsCore", "runtimeLibraries"],
};
const expectedAvailableChecks = [
  "devEnvironment",
  "wasmPack",
  "tsCore",
  "runtimeLibraries",
  "client",
];
const expectedAvailableCheckScripts = expectedAvailableChecks.map((checkName) => {
  return expectedAvailableCheckMetadata[
    checkName as keyof typeof expectedAvailableCheckMetadata
  ].scriptName;
});
const expectedAvailableCheckScriptMap = Object.fromEntries(
  expectedAvailableChecks.map((checkName, index) => {
    return [checkName, expectedAvailableCheckScripts[index]];
  })
);
const expectedAvailableCheckSupportsNoBuildMap = Object.fromEntries(
  expectedAvailableChecks.map((checkName) => {
    return [
      checkName,
      expectedAvailableCheckMetadata[
        checkName as keyof typeof expectedAvailableCheckMetadata
      ].supportsNoBuild,
    ];
  })
);
const expectedAvailableCheckIndices = expectedAvailableChecks.map((_, index) => {
  return index;
});
const expectedAvailableCheckIndexMap = Object.fromEntries(
  expectedAvailableChecks.map((checkName, index) => {
    return [checkName, index];
  })
);
const expectedTsCoreRequiredArtifacts = [
  "packages/ts-core/dist/index.js",
  "packages/ts-core/dist/index.mjs",
  "packages/ts-core/dist/index.d.ts",
];
const expectedTsCoreBuildArgs = [
  "--dir",
  rootDir,
  "--filter",
  "@voxelize/ts-core",
  "run",
  "build",
];
const expectedRuntimeLibrariesCheckedPackages = [
  "@voxelize/aabb",
  "@voxelize/raycast",
  "@voxelize/physics-engine",
];
const expectedRuntimeLibrariesCheckedPackagePaths = [
  "packages/aabb",
  "packages/raycast",
  "packages/physics-engine",
];
const expectedRuntimeLibrariesArtifactsByPackage = {
  "@voxelize/aabb": [
    "packages/aabb/dist/index.js",
    "packages/aabb/dist/index.mjs",
    "packages/aabb/dist/index.d.ts",
  ],
  "@voxelize/raycast": [
    "packages/raycast/dist/index.js",
    "packages/raycast/dist/index.mjs",
    "packages/raycast/dist/index.d.ts",
  ],
  "@voxelize/physics-engine": [
    "packages/physics-engine/dist/index.cjs",
    "packages/physics-engine/dist/index.js",
    "packages/physics-engine/dist/index.d.ts",
  ],
};
const expectedRuntimeLibrariesRequiredArtifactCount = Object.values(
  expectedRuntimeLibrariesArtifactsByPackage
).reduce((count, artifacts) => {
  return count + artifacts.length;
}, 0);
const expectedRuntimeLibrariesBuildArgs = [
  "--dir",
  rootDir,
  "--filter",
  "@voxelize/aabb",
  "--filter",
  "@voxelize/raycast",
  "--filter",
  "@voxelize/physics-engine",
  "run",
  "build",
];
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
const expectedUsedLibrariesSpecialSelector = ["libraries"];
const expectSelectedCheckMetadata = (report: PreflightReport) => {
  const expectedSelectedMetadata = Object.fromEntries(
    report.selectedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ],
      ];
    })
  );
  const expectedSelectedScripts = report.selectedChecks.map((checkName) => {
    return expectedAvailableCheckMetadata[
      checkName as keyof typeof expectedAvailableCheckMetadata
    ].scriptName;
  });
  const expectedSelectedIndices = report.selectedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedSkippedMetadata = Object.fromEntries(
    report.skippedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ],
      ];
    })
  );
  const expectedSkippedScripts = report.skippedChecks.map((checkName) => {
    return expectedAvailableCheckMetadata[
      checkName as keyof typeof expectedAvailableCheckMetadata
    ].scriptName;
  });
  const expectedSkippedIndices = report.skippedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedResolvedChecks: string[] = [];
  const seenResolvedChecks = new Set<string>();
  const expectedResolvedScripts: string[] = [];
  const seenResolvedScripts = new Set<string>();
  for (const resolution of report.requestedCheckResolutions) {
    for (const checkName of resolution.resolvedTo) {
      if (!seenResolvedChecks.has(checkName)) {
        seenResolvedChecks.add(checkName);
        expectedResolvedChecks.push(checkName);
      }
      const scriptName =
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ]?.scriptName;
      if (typeof scriptName !== "string" || seenResolvedScripts.has(scriptName)) {
        continue;
      }
      seenResolvedScripts.add(scriptName);
      expectedResolvedScripts.push(scriptName);
    }
  }
  const expectedResolvedIndices = expectedResolvedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedResolvedIndexMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName, index) => {
      return [checkName, expectedResolvedIndices[index]];
    })
  );
  const expectedResolvedScriptMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ].scriptName,
      ];
    })
  );
  const expectedResolvedSupportsNoBuildMap = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ].supportsNoBuild,
      ];
    })
  );
  const expectedResolvedMetadata = Object.fromEntries(
    expectedResolvedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ],
      ];
    })
  );

  expect(report.selectedCheckMetadata).toEqual(expectedSelectedMetadata);
  expect(report.selectedCheckMetadataCount).toBe(
    Object.keys(report.selectedCheckMetadata).length
  );
  expect(report.selectedCheckScripts).toEqual(expectedSelectedScripts);
  expect(report.selectedCheckIndices).toEqual(expectedSelectedIndices);
  expect(report.selectedCheckIndexCount).toBe(report.selectedCheckIndices.length);
  expect(report.selectedCheckScriptCount).toBe(report.selectedCheckScripts.length);
  expect(report.skippedCheckMetadata).toEqual(expectedSkippedMetadata);
  expect(report.skippedCheckMetadataCount).toBe(
    Object.keys(report.skippedCheckMetadata).length
  );
  expect(report.skippedCheckScripts).toEqual(expectedSkippedScripts);
  expect(report.skippedCheckIndices).toEqual(expectedSkippedIndices);
  expect(report.skippedCheckIndexCount).toBe(report.skippedCheckIndices.length);
  expect(report.skippedCheckScriptCount).toBe(report.skippedCheckScripts.length);
  expect(report.requestedCheckResolvedChecks).toEqual(expectedResolvedChecks);
  expect(report.requestedCheckResolvedCheckCount).toBe(
    report.requestedCheckResolvedChecks.length
  );
  expect(report.requestedCheckResolvedScripts).toEqual(expectedResolvedScripts);
  expect(report.requestedCheckResolvedScriptCount).toBe(
    report.requestedCheckResolvedScripts.length
  );
  expect(report.requestedCheckResolvedScriptMap).toEqual(expectedResolvedScriptMap);
  expect(report.requestedCheckResolvedScriptMapCount).toBe(
    Object.keys(report.requestedCheckResolvedScriptMap).length
  );
  expect(report.requestedCheckResolvedSupportsNoBuildMap).toEqual(
    expectedResolvedSupportsNoBuildMap
  );
  expect(report.requestedCheckResolvedSupportsNoBuildMapCount).toBe(
    Object.keys(report.requestedCheckResolvedSupportsNoBuildMap).length
  );
  expect(report.requestedCheckResolvedIndices).toEqual(expectedResolvedIndices);
  expect(report.requestedCheckResolvedIndexCount).toBe(
    report.requestedCheckResolvedIndices.length
  );
  expect(report.requestedCheckResolvedIndexMap).toEqual(expectedResolvedIndexMap);
  expect(report.requestedCheckResolvedIndexMapCount).toBe(
    Object.keys(report.requestedCheckResolvedIndexMap).length
  );
  expect(report.requestedCheckResolvedMetadata).toEqual(expectedResolvedMetadata);
  expect(report.requestedCheckResolvedMetadataCount).toBe(
    Object.keys(report.requestedCheckResolvedMetadata).length
  );
};
const expectCheckResultScriptMetadata = (report: PreflightReport) => {
  const expectedPassedScripts = report.passedChecks.map((checkName) => {
    return expectedAvailableCheckMetadata[
      checkName as keyof typeof expectedAvailableCheckMetadata
    ].scriptName;
  });
  const expectedFailedScripts = report.failedChecks.map((checkName) => {
    return expectedAvailableCheckMetadata[
      checkName as keyof typeof expectedAvailableCheckMetadata
    ].scriptName;
  });
  const expectedPassedMetadata = Object.fromEntries(
    report.passedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ],
      ];
    })
  );
  const expectedFailedMetadata = Object.fromEntries(
    report.failedChecks.map((checkName) => {
      return [
        checkName,
        expectedAvailableCheckMetadata[
          checkName as keyof typeof expectedAvailableCheckMetadata
        ],
      ];
    })
  );
  const expectedPassedIndices = report.passedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });
  const expectedFailedIndices = report.failedChecks.map((checkName) => {
    return expectedAvailableChecks.indexOf(checkName);
  });

  expect(report.passedCheckScripts).toEqual(expectedPassedScripts);
  expect(report.passedCheckScriptCount).toBe(report.passedCheckScripts.length);
  expect(report.passedCheckMetadata).toEqual(expectedPassedMetadata);
  expect(report.passedCheckMetadataCount).toBe(
    Object.keys(report.passedCheckMetadata).length
  );
  expect(report.passedCheckIndices).toEqual(expectedPassedIndices);
  expect(report.passedCheckIndexCount).toBe(report.passedCheckIndices.length);
  expect(report.failedCheckScripts).toEqual(expectedFailedScripts);
  expect(report.failedCheckScriptCount).toBe(report.failedCheckScripts.length);
  expect(report.failedCheckMetadata).toEqual(expectedFailedMetadata);
  expect(report.failedCheckMetadataCount).toBe(
    Object.keys(report.failedCheckMetadata).length
  );
  expect(report.failedCheckIndices).toEqual(expectedFailedIndices);
  expect(report.failedCheckIndexCount).toBe(report.failedCheckIndices.length);
  for (const check of report.checks) {
    expect(check.scriptName).toBe(
      expectedAvailableCheckMetadata[
        check.name as keyof typeof expectedAvailableCheckMetadata
      ].scriptName
    );
    expect(check.supportsNoBuild).toBe(
      expectedAvailableCheckMetadata[
        check.name as keyof typeof expectedAvailableCheckMetadata
      ].supportsNoBuild
    );
    expect(check.checkIndex).toBe(expectedAvailableChecks.indexOf(check.name));
  }
  expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
  expect(report.failureSummaries.map((entry) => entry.name).sort()).toEqual(
    report.failedChecks.slice().sort()
  );
  const failedChecksByName = new Map(
    report.checks
      .filter((check) => {
        return check.passed === false;
      })
      .map((check) => {
        return [check.name, check];
      })
  );
  for (const entry of report.failureSummaries) {
    const failedCheck = failedChecksByName.get(entry.name);
    expect(failedCheck).toBeDefined();
    if (failedCheck === undefined) {
      throw new Error(`Missing failed check entry for ${entry.name}.`);
    }
    expect(entry.scriptName).toBe(
      expectedAvailableCheckMetadata[
        entry.name as keyof typeof expectedAvailableCheckMetadata
      ].scriptName
    );
    expect(entry.supportsNoBuild).toBe(
      expectedAvailableCheckMetadata[
        entry.name as keyof typeof expectedAvailableCheckMetadata
      ].supportsNoBuild
    );
    expect(entry.checkIndex).toBe(expectedAvailableChecks.indexOf(entry.name));
    expect(entry.scriptName).toBe(failedCheck.scriptName);
    expect(entry.supportsNoBuild).toBe(failedCheck.supportsNoBuild);
    expect(entry.checkIndex).toBe(failedCheck.checkIndex);
    expect(entry.exitCode).toBe(failedCheck.exitCode);
    expect(entry.message.length).toBeGreaterThan(0);
  }
};
const expectAvailableCheckInventoryMetadata = (report: PreflightReport) => {
  expect(report.availableChecks).toEqual(expectedAvailableChecks);
  expect(report.availableCheckScripts).toEqual(expectedAvailableCheckScripts);
  expect(report.availableCheckScriptCount).toBe(report.availableCheckScripts.length);
  expect(report.availableCheckScriptMap).toEqual(expectedAvailableCheckScriptMap);
  expect(report.availableCheckScriptMapCount).toBe(
    Object.keys(report.availableCheckScriptMap).length
  );
  expect(report.availableCheckSupportsNoBuildMap).toEqual(
    expectedAvailableCheckSupportsNoBuildMap
  );
  expect(report.availableCheckSupportsNoBuildMapCount).toBe(
    Object.keys(report.availableCheckSupportsNoBuildMap).length
  );
  expect(report.availableCheckIndices).toEqual(expectedAvailableCheckIndices);
  expect(report.availableCheckIndexCount).toBe(
    report.availableCheckIndices.length
  );
  expect(report.availableCheckIndexMap).toEqual(expectedAvailableCheckIndexMap);
  expect(report.availableCheckIndexMapCount).toBe(
    Object.keys(report.availableCheckIndexMap).length
  );
  const metadataFromMaps = Object.fromEntries(
    expectedAvailableChecks.map((checkName) => {
      return [
        checkName,
        {
          scriptName: report.availableCheckScriptMap[checkName],
          supportsNoBuild: report.availableCheckSupportsNoBuildMap[checkName],
        },
      ];
    })
  );
  expect(report.availableCheckMetadata).toEqual(metadataFromMaps);
  expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
  expect(report.availableCheckMetadataCount).toBe(
    Object.keys(report.availableCheckMetadata).length
  );
};
const expectSelectorAndAliasMetadata = (report: PreflightReport) => {
  expect(report.availableCheckAliases).toEqual(expectedAvailableCheckAliases);
  expect(report.availableCheckAliasGroupCount).toBe(
    Object.keys(report.availableCheckAliases).length
  );
  expect(report.availableCheckAliasTokenCount).toBe(
    Object.values(report.availableCheckAliases).reduce((count, aliases) => {
      return count + aliases.length;
    }, 0)
  );
  expect(report.availableSpecialCheckSelectors).toEqual(
    expectedAvailableSpecialCheckSelectors
  );
  expect(report.availableSpecialCheckSelectorCount).toBe(
    report.availableSpecialCheckSelectors.length
  );
  expect(report.availableSpecialCheckAliases).toEqual(
    expectedAvailableSpecialCheckAliases
  );
  expect(report.availableSpecialCheckAliasGroupCount).toBe(
    Object.keys(report.availableSpecialCheckAliases).length
  );
  expect(report.availableSpecialCheckAliasTokenCount).toBe(
    Object.values(report.availableSpecialCheckAliases).reduce(
      (count, aliases) => {
        return count + aliases.length;
      },
      0
    )
  );
  expect(report.availableSpecialSelectorResolvedChecks).toEqual(
    expectedAvailableSpecialSelectorResolvedChecks
  );
  expect(report.availableSpecialSelectorResolvedChecksCount).toBe(
    Object.keys(report.availableSpecialSelectorResolvedChecks).length
  );
  expect(report.requestedCheckResolutionKinds).toEqual(
    expectedRequestedCheckResolutionKinds
  );
  expect(report.requestedCheckResolutionKindCount).toBe(
    report.requestedCheckResolutionKinds.length
  );
};
const expectTsCoreNestedReport = (
  checkReport: object | null,
  expectedNoBuild: boolean
) => {
  expect(checkReport).not.toBeNull();
  if (checkReport === null) {
    return;
  }

  const report = checkReport as TsCoreNestedReport;
  expect(report.checkedPackage).toBe("@voxelize/ts-core");
  expect(report.checkedPackageCount).toBe(1);
  expect(report.checkedPackagePath).toBe("packages/ts-core");
  expect(report.checkedPackagePathCount).toBe(1);
  expect(report.requiredPackageCount).toBe(1);
  expect(report.presentPackageCount + report.missingPackageCount).toBe(
    report.requiredPackageCount
  );
  expect(report.presentPackages.length).toBe(report.presentPackageCount);
  expect(report.missingPackages.length).toBe(report.missingPackageCount);
  expect(report.presentPackagePaths.length).toBe(report.presentPackageCount);
  expect(report.missingPackagePaths.length).toBe(report.missingPackageCount);
  expect([...report.presentPackages, ...report.missingPackages]).toEqual([
    report.checkedPackage,
  ]);
  expect([...report.presentPackagePaths, ...report.missingPackagePaths]).toEqual([
    report.checkedPackagePath,
  ]);
  expect(report.packagePath).toBe("packages/ts-core");
  expect(report.requiredArtifacts).toEqual(expectedTsCoreRequiredArtifacts);
  expect(report.artifactsPresent).toBe(report.missingArtifacts.length === 0);
  expect(report.requiredArtifactCount).toBe(
    report.presentArtifactCount + report.missingArtifactCount
  );
  expect(report.requiredArtifactCount).toBe(report.requiredArtifacts.length);
  expect(report.presentArtifactCount).toBe(report.presentArtifacts.length);
  expect([...report.presentArtifacts, ...report.missingArtifacts].sort()).toEqual(
    [...report.requiredArtifacts].sort()
  );
  expect(report.presentArtifactCount).toBe(
    report.requiredArtifactCount - report.missingArtifactCount
  );
  expect(report.missingArtifactCount).toBe(report.missingArtifacts.length);
  if (report.missingArtifactCount === 0) {
    expect(report.missingArtifactSummary).toBeNull();
  } else {
    expect(report.missingArtifactSummary).not.toBeNull();
    if (report.missingArtifactSummary !== null) {
      expect(report.missingArtifactSummary.length).toBeGreaterThan(0);
    }
  }
  expect(typeof report.buildCommand).toBe("string");
  expect(report.buildCommand.length).toBeGreaterThan(0);
  expect(report.buildArgs).toEqual(expectedTsCoreBuildArgs);
  expect(report.noBuild).toBe(expectedNoBuild);
  if (report.buildExitCode !== null) {
    expect(Number.isInteger(report.buildExitCode)).toBe(true);
  }
  if (report.attemptedBuild) {
    expect(typeof report.buildDurationMs).toBe("number");
    expect(report.buildDurationMs).toBeGreaterThanOrEqual(0);
  } else {
    expect(report.buildExitCode).toBeNull();
    expect(report.buildDurationMs).toBeNull();
  }
  if (report.buildSkipped) {
    expect(report.buildSkippedReason === "no-build" || report.buildSkippedReason === "artifacts-present").toBe(true);
  } else {
    expect(report.buildSkippedReason).toBeNull();
  }
  if (report.buildSkippedReason === "no-build") {
    expect(report.noBuild).toBe(true);
  }
  if (report.buildSkippedReason === "artifacts-present") {
    expect(report.attemptedBuild).toBe(false);
  }
};
const expectRuntimeLibrariesNestedReport = (
  checkReport: object | null,
  expectedNoBuild: boolean
) => {
  expect(checkReport).not.toBeNull();
  if (checkReport === null) {
    return;
  }

  const report = checkReport as RuntimeLibrariesNestedReport;
  expect(report.packagesPresent).toBe(report.missingPackageCount === 0);
  expect(report.checkedPackages).toEqual(expectedRuntimeLibrariesCheckedPackages);
  expect(report.checkedPackagePaths).toEqual(
    expectedRuntimeLibrariesCheckedPackagePaths
  );
  expect(report.checkedPackages).toEqual(
    report.packageReports.map((packageReport) => packageReport.packageName)
  );
  expect(report.checkedPackagePaths).toEqual(
    report.packageReports.map((packageReport) => packageReport.packagePath)
  );
  const presentPackages = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => packageReport.packageName);
  const missingPackages = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => packageReport.packageName);
  expect(report.presentPackages).toEqual(presentPackages);
  expect(report.missingPackages).toEqual(missingPackages);
  expect(report.checkedPackageCount).toBe(report.checkedPackages.length);
  expect(report.checkedPackagePathCount).toBe(report.checkedPackagePaths.length);
  expect(report.checkedPackagePathCount).toBe(report.requiredPackageCount);
  expect(report.requiredPackageCount).toBe(
    expectedRuntimeLibrariesCheckedPackages.length
  );
  expect(report.packageReportCount).toBe(report.packageReports.length);
  expect(report.requiredArtifactCount).toBe(
    expectedRuntimeLibrariesRequiredArtifactCount
  );
  const missingPackageCount = report.packageReports.filter((packageReport) => {
    return packageReport.artifactsPresent === false;
  }).length;
  const missingArtifactCount = report.packageReports.reduce(
    (count, packageReport) => {
      return count + packageReport.missingArtifactCount;
    },
    0
  );
  const presentArtifactCount = report.packageReports.reduce(
    (count, packageReport) => {
      return count + packageReport.presentArtifactCount;
    },
    0
  );
  expect(report.requiredPackageCount).toBe(
    report.presentPackageCount + report.missingPackageCount
  );
  expect(report.requiredArtifactCount).toBe(
    report.presentArtifactCount + report.missingArtifactCount
  );
  const presentPackageCount = report.packageReports.length - missingPackageCount;
  expect(report.presentPackageCount).toBe(presentPackageCount);
  expect(report.presentPackages.length).toBe(report.presentPackageCount);
  expect(report.missingPackages.length).toBe(report.missingPackageCount);
  expect(report.presentArtifactCount).toBe(presentArtifactCount);
  expect(report.missingPackageCount).toBe(missingPackageCount);
  expect(report.missingArtifactCount).toBe(missingArtifactCount);
  if (report.missingArtifactCount === 0) {
    expect(report.missingArtifactSummary).toBeNull();
  } else {
    expect(report.missingArtifactSummary).not.toBeNull();
    if (report.missingArtifactSummary !== null) {
      expect(report.missingArtifactSummary.length).toBeGreaterThan(0);
      expect(report.missingPackages.some((packageName) => {
        return report.missingArtifactSummary?.includes(packageName) ?? false;
      })).toBe(true);
    }
  }
  for (const packageReport of report.packageReports) {
    expect(packageReport.requiredArtifacts).toEqual(
      expectedRuntimeLibrariesArtifactsByPackage[
        packageReport.packageName as keyof typeof expectedRuntimeLibrariesArtifactsByPackage
      ]
    );
    expect(packageReport.requiredArtifactCount).toBe(
      packageReport.requiredArtifacts.length
    );
    expect(packageReport.presentArtifactCount).toBe(
      packageReport.presentArtifacts.length
    );
    expect(packageReport.presentArtifactCount).toBe(
      packageReport.requiredArtifactCount - packageReport.missingArtifactCount
    );
    expect(packageReport.missingArtifactCount).toBe(
      packageReport.missingArtifacts.length
    );
    expect([...packageReport.presentArtifacts, ...packageReport.missingArtifacts].sort()).toEqual(
      [...packageReport.requiredArtifacts].sort()
    );
  }
  expect(typeof report.buildCommand).toBe("string");
  expect(report.buildCommand.length).toBeGreaterThan(0);
  expect(report.buildArgs).toEqual(expectedRuntimeLibrariesBuildArgs);
  expect(report.noBuild).toBe(expectedNoBuild);
  if (report.buildExitCode !== null) {
    expect(Number.isInteger(report.buildExitCode)).toBe(true);
  }
  if (report.attemptedBuild) {
    expect(typeof report.buildDurationMs).toBe("number");
    expect(report.buildDurationMs).toBeGreaterThanOrEqual(0);
  } else {
    expect(report.buildExitCode).toBeNull();
    expect(report.buildDurationMs).toBeNull();
  }
  if (report.buildSkipped) {
    expect(
      report.buildSkippedReason === "no-build" ||
        report.buildSkippedReason === "artifacts-present"
    ).toBe(true);
  } else {
    expect(report.buildSkippedReason).toBeNull();
  }
  if (report.buildSkippedReason === "no-build") {
    expect(report.noBuild).toBe(true);
  }
  if (report.buildSkippedReason === "artifacts-present") {
    expect(report.attemptedBuild).toBe(false);
  }
};

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
    expectAvailableCheckInventoryMetadata(report);
    expectSelectorAndAliasMetadata(report);
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
    expect(report.selectionMode).toBe("default");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(report.availableChecks);
    expect(report.selectedCheckCount).toBe(report.selectedChecks.length);
    expectSelectedCheckMetadata(report);
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
    expectCheckResultScriptMetadata(report);
    expect(Array.isArray(report.failureSummaries)).toBe(true);
    expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
    expect(report.passedChecks.length + report.failedChecks.length).toBe(
      expectedAvailableChecks.length
    );
    expect(report.failureSummaries.length).toBe(report.failedChecks.length);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual(
      [
        "client",
        "devEnvironment",
        "runtimeLibraries",
        "tsCore",
        "wasmPack",
      ]
    );
    expect(report.failureSummaries.map((entry) => entry.name).sort()).toEqual(
      report.failedChecks.slice().sort()
    );
    for (const entry of report.failureSummaries) {
      expect(entry.scriptName).toBe(
        expectedAvailableCheckMetadata[
          entry.name as keyof typeof expectedAvailableCheckMetadata
        ].scriptName
      );
      expect(entry.supportsNoBuild).toBe(
        expectedAvailableCheckMetadata[
          entry.name as keyof typeof expectedAvailableCheckMetadata
        ].supportsNoBuild
      );
      expect(entry.checkIndex).toBe(expectedAvailableChecks.indexOf(entry.name));
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
    expect(report.checks.length).toBe(expectedAvailableChecks.length);
    expect(report.checks.map((check) => check.name)).toEqual(
      expectedAvailableChecks
    );
    const tsCoreCheck = report.checks.find((check) => check.name === "tsCore");
    expect(tsCoreCheck).toBeDefined();
    if (tsCoreCheck !== undefined) {
      expectTsCoreNestedReport(tsCoreCheck.report, true);
    }
    const runtimeLibrariesCheck = report.checks.find((check) => {
      return check.name === "runtimeLibraries";
    });
    expect(runtimeLibrariesCheck).toBeDefined();
    if (runtimeLibrariesCheck !== undefined) {
      expectRuntimeLibrariesNestedReport(runtimeLibrariesCheck.report, true);
    }
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
    expectSelectedCheckMetadata(report);
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
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
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
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
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
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(4);
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
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
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
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
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
    expect(report.skippedChecks).toEqual(["tsCore", "runtimeLibraries"]);
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
    expect(report.skippedChecks).toEqual([
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
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
    expect(report.skippedChecks).toEqual([
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports ts-core aliases and verify mode in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--verify", "--only", "ts-core"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["ts-core"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts-core",
        normalizedToken: "tscore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--only",
    ]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--verify",
      "--only",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--verify",
        "--only",
      ])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--verify",
        "--only",
        "ts-core",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports long-form ts-core aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "typescript_core"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["typescript_core"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "typescript_core",
        normalizedToken: "typescriptcore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "typescript_core",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports ts shorthand aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "ts"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["ts"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--list-checks", "--only", "ts"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports typescript aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "typescript"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["typescript"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "typescript",
        normalizedToken: "typescript",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "typescript",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports runtime aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "runtime-libraries"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["runtime-libraries"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "runtime-libraries",
        normalizedToken: "runtimelibraries",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "runtime-libraries",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("supports case-insensitive runtime aliases in list selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "RUNTIME_LIBRARIES"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["RUNTIME_LIBRARIES"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "RUNTIME_LIBRARIES",
        normalizedToken: "runtimelibraries",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "RUNTIME_LIBRARIES",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("writes list-mode ts-core reports to trailing output paths with no-build aliases", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-list-ts-core-last-output-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const commandArgs = [
      preflightScript,
      "--list-checks",
      "--only",
      "ts-core",
      "--output",
      firstOutputPath,
      "--verify",
      "--output",
      secondOutputPath,
    ] as const;
    const result = spawnSync(process.execPath, [...commandArgs], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.selectionMode).toBe("only");
    expect(stdoutReport.specialSelectorsUsed).toEqual([]);
    expect(stdoutReport.selectedChecks).toEqual(["tsCore"]);
    expect(stdoutReport.selectedCheckCount).toBe(1);
    expect(stdoutReport.requestedChecks).toEqual(["ts-core"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "ts-core",
        normalizedToken: "tscore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      "--output",
      "--verify",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--only",
        "--output",
        "--verify",
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([...commandArgs.slice(1)])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(stdoutReport.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(stdoutReport.skippedCheckCount).toBe(stdoutReport.skippedChecks.length);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes ts-core validation reports to trailing output paths with inline no-build misuse", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-ts-core-validation-last-output-inline-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const commandArgs = [
      preflightScript,
      "--only",
      "ts-core",
      "--output",
      firstOutputPath,
      "--verify=1",
      "--output",
      secondOutputPath,
    ] as const;
    const result = spawnSync(process.execPath, [...commandArgs], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.listChecksOnly).toBe(false);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>"])
    );
    expect(stdoutReport.selectionMode).toBe("only");
    expect(stdoutReport.specialSelectorsUsed).toEqual([]);
    expect(stdoutReport.selectedChecks).toEqual([]);
    expect(stdoutReport.selectedCheckCount).toBe(0);
    expectSelectedCheckMetadata(stdoutReport);
    expectCheckResultScriptMetadata(stdoutReport);
    expect(stdoutReport.requestedChecks).toEqual(["ts-core"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "ts-core",
        normalizedToken: "tscore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.activeCliOptions).toEqual(["--only", "--output"]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--only", "--output"]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--only", "--output"])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([...commandArgs.slice(1)])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(stdoutReport.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(stdoutReport.skippedCheckCount).toBe(stdoutReport.skippedChecks.length);
    expect(fileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("supports ts shorthand aliases in only selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "TS,client"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["TS", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "TS",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
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
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.checks.map((check) => check.name)).toEqual([
      "tsCore",
      "client",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports typescript aliases in execution-mode selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "typescript,client"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["typescript", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "typescript",
        normalizedToken: "typescript",
        kind: "check",
        resolvedTo: ["tsCore"],
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
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.checks.map((check) => check.name)).toEqual([
      "tsCore",
      "client",
    ]);
    expect(report.totalChecks).toBe(2);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports case-insensitive typescript aliases in execution-mode selection", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "TYPESCRIPT"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["TYPESCRIPT"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "TYPESCRIPT",
        normalizedToken: "typescript",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.checks.map((check) => check.name)).toEqual(["tsCore"]);
    expect(report.totalChecks).toBe(1);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports selecting ts-core checks in execution mode with verify alias", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--verify", "--only", "ts"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["ts"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--verify", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--verify", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--verify", "--only", "ts"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(1);
    expect(report.checks.length).toBe(1);
    expect(report.checks[0].name).toBe("tsCore");
    expectTsCoreNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect([...report.passedChecks, ...report.failedChecks]).toEqual(["tsCore"]);
    if (report.passed) {
      expect(report.exitCode).toBe(0);
    } else {
      expect(report.exitCode).toBeGreaterThanOrEqual(1);
      expect(report.failedChecks).toEqual(["tsCore"]);
      expect(report.failureSummaries.length).toBe(1);
      expect(report.failureSummaryCount).toBe(1);
      expect(report.failureSummaries[0].name).toBe("tsCore");
      expect(report.failureSummaries[0].scriptName).toBe("check-ts-core.mjs");
      expect(report.failureSummaries[0].supportsNoBuild).toBe(true);
      expect(report.failureSummaries[0].checkIndex).toBe(
        expectedAvailableChecks.indexOf("tsCore")
      );
    }
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator-free long-form ts-core aliases in execution mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "typescriptcore"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["typescriptcore"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "typescriptcore",
        normalizedToken: "typescriptcore",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--no-build",
        "--only",
        "typescriptcore",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(1);
    expect(report.checks.length).toBe(1);
    expect(report.checks[0].name).toBe("tsCore");
    expectTsCoreNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect([...report.passedChecks, ...report.failedChecks]).toEqual(["tsCore"]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("executes ts-core checks before client when both are selected", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "ts,client"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["ts", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
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
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "runtimeLibraries",
    ]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build", "--only", "ts,client"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual(["tsCore", "client"]);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
      "client",
      "tsCore",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports runtime shorthand aliases in execution mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "runtime"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["runtime"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "runtime",
        normalizedToken: "runtime",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build", "--only", "runtime"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(1);
    expect(report.checks.length).toBe(1);
    expect(report.checks[0].name).toBe("runtimeLibraries");
    expectRuntimeLibrariesNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect([...report.passedChecks, ...report.failedChecks]).toEqual([
      "runtimeLibraries",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports separator-free runtime aliases in execution mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "runtimelibraries"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(1);
    expect(report.requestedChecks).toEqual(["runtimelibraries"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "runtimelibraries",
        normalizedToken: "runtimelibraries",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "client",
    ]);
    expect(report.skippedCheckCount).toBe(report.skippedChecks.length);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--no-build",
        "--only",
        "runtimelibraries",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(1);
    expect(report.checks.length).toBe(1);
    expect(report.checks[0].name).toBe("runtimeLibraries");
    expectRuntimeLibrariesNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(1);
    expect([...report.passedChecks, ...report.failedChecks]).toEqual([
      "runtimeLibraries",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("executes ts-core before runtime when both are selected", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "ts,runtime"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["ts", "runtime"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "ts",
        normalizedToken: "ts",
        kind: "check",
        resolvedTo: ["tsCore"],
      },
      {
        token: "runtime",
        normalizedToken: "runtime",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 2,
      specialSelector: 0,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build", "--only", "ts,runtime"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "tsCore",
      "runtimeLibraries",
    ]);
    expectTsCoreNestedReport(report.checks[0].report, true);
    expectRuntimeLibrariesNestedReport(report.checks[1].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
      "runtimeLibraries",
      "tsCore",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("executes runtime checks before client when both are selected", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "runtime,client"],
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
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.selectedChecks).toEqual(["runtimeLibraries", "client"]);
    expect(report.selectedCheckCount).toBe(2);
    expect(report.requestedChecks).toEqual(["runtime", "client"]);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "runtime",
        normalizedToken: "runtime",
        kind: "check",
        resolvedTo: ["runtimeLibraries"],
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
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "tsCore"]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--no-build",
        "--only",
        "runtime,client",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "runtimeLibraries",
      "client",
    ]);
    expectRuntimeLibrariesNestedReport(report.checks[0].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
      "client",
      "runtimeLibraries",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports libraries special selector in list mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--list-checks", "--only", "libraries"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual(expectedUsedLibrariesSpecialSelector);
    expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(2);
    expectSelectedCheckMetadata(report);
    expect(report.requestedChecks).toEqual(["libraries"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "libraries",
        normalizedToken: "libraries",
        kind: "specialSelector",
        selector: "libraries",
        resolvedTo: ["tsCore", "runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 1,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--list-checks", "--only", "libraries"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expectCheckResultScriptMetadata(report);
    expect(report.checks).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("supports libraries special selector in execution mode", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--no-build", "--only", "libraries"],
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
    expect(report.specialSelectorsUsed).toEqual(expectedUsedLibrariesSpecialSelector);
    expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
    expect(report.selectedCheckCount).toBe(2);
    expectSelectedCheckMetadata(report);
    expect(report.requestedChecks).toEqual(["libraries"]);
    expect(report.requestedCheckCount).toBe(1);
    expect(report.requestedCheckResolutions).toEqual([
      {
        token: "libraries",
        normalizedToken: "libraries",
        kind: "specialSelector",
        selector: "libraries",
        resolvedTo: ["tsCore", "runtimeLibraries"],
      },
    ]);
    expect(report.requestedCheckResolutionCounts).toEqual({
      check: 0,
      specialSelector: 1,
      invalid: 0,
    });
    expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
    expect(report.skippedCheckCount).toBe(3);
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--no-build", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences(["--no-build", "--only", "libraries"])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(report.totalChecks).toBe(2);
    expect(report.checks.length).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "tsCore",
      "runtimeLibraries",
    ]);
    expectCheckResultScriptMetadata(report);
    expectTsCoreNestedReport(report.checks[0].report, true);
    expectRuntimeLibrariesNestedReport(report.checks[1].report, true);
    expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
    expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
      "runtimeLibraries",
      "tsCore",
    ]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("supports library selector aliases in list mode", () => {
    const selectorTokens = ["library", "libs", "lib", "LIBS"] as const;

    for (const selectorToken of selectorTokens) {
      const result = spawnSync(
        process.execPath,
        [preflightScript, "--list-checks", "--only", selectorToken],
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
      expect(report.selectionMode).toBe("only");
      expect(report.specialSelectorsUsed).toEqual(expectedUsedLibrariesSpecialSelector);
      expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
      expect(report.selectedCheckCount).toBe(2);
      expect(report.requestedChecks).toEqual([selectorToken]);
      expect(report.requestedCheckCount).toBe(1);
      expect(report.requestedCheckResolutions).toEqual([
        {
          token: selectorToken,
          normalizedToken: selectorToken.toLowerCase(),
          kind: "specialSelector",
          selector: "libraries",
          resolvedTo: ["tsCore", "runtimeLibraries"],
        },
      ]);
      expect(report.requestedCheckResolutionCounts).toEqual({
        check: 0,
        specialSelector: 1,
        invalid: 0,
      });
      expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
      expect(report.skippedCheckCount).toBe(3);
      expect(report.invalidChecks).toEqual([]);
      expect(report.invalidCheckCount).toBe(0);
      expect(report.unknownOptions).toEqual([]);
      expect(report.unknownOptionCount).toBe(0);
      expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
      expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
      expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
      expect(report.activeCliOptionResolutions).toEqual(
        expectedActiveCliOptionResolutions(["--list-checks", "--only"])
      );
      expect(report.activeCliOptionResolutionCount).toBe(
        report.activeCliOptionResolutions.length
      );
      expect(report.activeCliOptionOccurrences).toEqual(
        expectedActiveCliOptionOccurrences(["--list-checks", "--only", selectorToken])
      );
      expect(report.activeCliOptionOccurrenceCount).toBe(
        report.activeCliOptionOccurrences.length
      );
      expect(report.checks).toEqual([]);
      expect(result.status).toBe(0);
    }
  });

  it("supports library selector aliases in execution mode", () => {
    const selectorTokens = ["library", "libs", "lib", "LIBRARY"] as const;

    for (const selectorToken of selectorTokens) {
      const result = spawnSync(
        process.execPath,
        [preflightScript, "--no-build", "--only", selectorToken],
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
      expect(report.specialSelectorsUsed).toEqual(expectedUsedLibrariesSpecialSelector);
      expect(report.selectedChecks).toEqual(["tsCore", "runtimeLibraries"]);
      expect(report.selectedCheckCount).toBe(2);
      expect(report.requestedChecks).toEqual([selectorToken]);
      expect(report.requestedCheckCount).toBe(1);
      expect(report.requestedCheckResolutions).toEqual([
        {
          token: selectorToken,
          normalizedToken: selectorToken.toLowerCase(),
          kind: "specialSelector",
          selector: "libraries",
          resolvedTo: ["tsCore", "runtimeLibraries"],
        },
      ]);
      expect(report.requestedCheckResolutionCounts).toEqual({
        check: 0,
        specialSelector: 1,
        invalid: 0,
      });
      expect(report.skippedChecks).toEqual(["devEnvironment", "wasmPack", "client"]);
      expect(report.skippedCheckCount).toBe(3);
      expect(report.invalidChecks).toEqual([]);
      expect(report.invalidCheckCount).toBe(0);
      expect(report.unknownOptions).toEqual([]);
      expect(report.unknownOptionCount).toBe(0);
      expect(report.activeCliOptions).toEqual(["--no-build", "--only"]);
      expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
      expect(report.activeCliOptionTokens).toEqual(["--no-build", "--only"]);
      expect(report.activeCliOptionResolutions).toEqual(
        expectedActiveCliOptionResolutions(["--no-build", "--only"])
      );
      expect(report.activeCliOptionResolutionCount).toBe(
        report.activeCliOptionResolutions.length
      );
      expect(report.activeCliOptionOccurrences).toEqual(
        expectedActiveCliOptionOccurrences(["--no-build", "--only", selectorToken])
      );
      expect(report.activeCliOptionOccurrenceCount).toBe(
        report.activeCliOptionOccurrences.length
      );
      expect(report.totalChecks).toBe(2);
      expect(report.checks.length).toBe(2);
      expect(report.checks.map((check) => check.name)).toEqual([
        "tsCore",
        "runtimeLibraries",
      ]);
      expectTsCoreNestedReport(report.checks[0].report, true);
      expectRuntimeLibrariesNestedReport(report.checks[1].report, true);
      expect(report.passedCheckCount + report.failedCheckCount).toBe(2);
      expect([...report.passedChecks, ...report.failedChecks].sort()).toEqual([
        "runtimeLibraries",
        "tsCore",
      ]);
      expect(result.status).toBe(report.passed ? 0 : report.exitCode);
    }
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
      "tsCore",
      "runtimeLibraries",
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
        resolvedTo: [
          "devEnvironment",
          "wasmPack",
          "tsCore",
          "runtimeLibraries",
          "client",
        ],
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
      "tsCore",
      "runtimeLibraries",
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
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["ALL"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
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
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["all_checks"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
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
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.specialSelectorsUsed).toEqual(expectedUsedAllSpecialSelector);
    expect(report.requestedChecks).toEqual(["allchecks"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
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
      "tsCore",
      "runtimeLibraries",
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
        resolvedTo: [
          "devEnvironment",
          "wasmPack",
          "tsCore",
          "runtimeLibraries",
          "client",
        ],
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
      "tsCore",
      "runtimeLibraries",
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
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
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
    expect(report.skippedChecks).toEqual([
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
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
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
    ]);
    expect(report.invalidChecks).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual(["client"]);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("uses the last only flag when inline output tokens appear between only flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-only-inline-output-between-")
    );
    const outputPath = path.resolve(tempDirectory, "report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--only",
        "devEnvironment",
        `--output=${outputPath}`,
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
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(fs.readFileSync(outputPath, "utf8")) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.selectedChecks).toEqual(["client"]);
    expect(stdoutReport.selectedCheckCount).toBe(1);
    expect(stdoutReport.requestedChecks).toEqual(["client"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(outputPath);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      `--output=${outputPath}`,
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--only",
        `--output=${outputPath}`,
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual([
      {
        token: "--list-checks",
        canonicalOption: "--list-checks",
        index: 0,
      },
      {
        token: "--only",
        canonicalOption: "--only",
        index: 1,
      },
      {
        token: `--output=${outputPath}`,
        canonicalOption: "--output",
        index: 3,
      },
      {
        token: "--only",
        canonicalOption: "--only",
        index: 4,
      },
    ]);
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last only flag when no-build aliases appear between only flags", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--only",
        "devEnvironment",
        "--verify",
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
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.listChecksOnly).toBe(true);
    expect(report.noBuild).toBe(true);
    expect(report.selectedChecks).toEqual(["client"]);
    expect(report.selectedCheckCount).toBe(1);
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
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--only",
    ]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      "--verify",
    ]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only", "--verify"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "devEnvironment",
        "--verify",
        "--only",
        "client",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(0);
  });

  it("keeps last only parsing when inline no-build misuse appears between only flags", () => {
    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--only",
        "devEnvironment",
        "--verify=1",
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
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.listChecksOnly).toBe(true);
    expect(report.noBuild).toBe(false);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>"])
    );
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
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionCount).toBe(report.activeCliOptions.length);
    expect(report.activeCliOptionTokens).toEqual(["--list-checks", "--only"]);
    expect(report.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--only"])
    );
    expect(report.activeCliOptionResolutionCount).toBe(
      report.activeCliOptionResolutions.length
    );
    expect(report.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--only",
        "devEnvironment",
        "--verify=1",
        "--only",
        "client",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("uses the last output path when no-build aliases appear between only and output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-only-alias-output-path-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const commandArgs = [
      preflightScript,
      "--list-checks",
      "--only",
      "devEnvironment",
      "--verify",
      "--only",
      "client",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ] as const;
    const result = spawnSync(process.execPath, [...commandArgs], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.selectedChecks).toEqual(["client"]);
    expect(stdoutReport.selectedCheckCount).toBe(1);
    expect(stdoutReport.requestedChecks).toEqual(["client"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      "--verify",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--only",
        "--verify",
        "--output",
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([...commandArgs.slice(1)])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("writes unsupported only validation to the last output path when inline no-build misuse appears between only and output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-only-inline-output-path-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const commandArgs = [
      preflightScript,
      "--list-checks",
      "--only",
      "devEnvironment",
      "--verify=1",
      "--only",
      "client",
      "--output",
      firstOutputPath,
      "--output",
      secondOutputPath,
    ] as const;
    const result = spawnSync(process.execPath, [...commandArgs], {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
    });
    const output = `${result.stdout}${result.stderr}`;
    const stdoutReport = JSON.parse(output) as PreflightReport;
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as PreflightReport;

    expect(stdoutReport.schemaVersion).toBe(1);
    expect(stdoutReport.passed).toBe(false);
    expect(stdoutReport.exitCode).toBe(1);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>"])
    );
    expect(stdoutReport.selectedChecks).toEqual([]);
    expect(stdoutReport.selectedCheckCount).toBe(0);
    expect(stdoutReport.requestedChecks).toEqual(["client"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
    expect(stdoutReport.requestedCheckResolutions).toEqual([
      {
        token: "client",
        normalizedToken: "client",
        kind: "check",
        resolvedTo: ["client"],
      },
    ]);
    expect(stdoutReport.requestedCheckResolutionCounts).toEqual({
      check: 1,
      specialSelector: 0,
      invalid: 0,
    });
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--only",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--only",
        "--output",
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([...commandArgs.slice(1)])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(fileReport).toEqual(stdoutReport);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
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
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(result.status).toBe(1);
  });

  it("fails when the last only flag is missing after no-build aliases between only flags", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment", "--verify", "--only"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(report.selectedChecks).toEqual([]);
    expect(report.selectedCheckCount).toBe(0);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
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
      expectedActiveCliOptionOccurrences([
        "--only",
        "devEnvironment",
        "--verify",
        "--only",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
    expect(result.status).toBe(1);
  });

  it("fails when the last only flag is missing after inline no-build misuse between only flags", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "devEnvironment", "--verify=1", "--only"],
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
    expect(report.selectionMode).toBe("only");
    expect(report.specialSelectorsUsed).toEqual([]);
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.requestedCheckResolutions).toEqual([]);
    expect(report.requestedCheckResolutionCounts).toEqual(
      expectedEmptyRequestedCheckResolutionCounts
    );
    expect(report.selectedChecks).toEqual([]);
    expect(report.selectedCheckCount).toBe(0);
    expect(report.skippedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
      "client",
    ]);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
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
      expectedActiveCliOptionOccurrences([
        "--only",
        "devEnvironment",
        "--verify=1",
        "--only",
      ])
    );
    expect(report.activeCliOptionOccurrenceCount).toBe(
      report.activeCliOptionOccurrences.length
    );
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
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
      "tsCore",
      "runtimeLibraries",
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
    expect(report.selectedCheckCount).toBe(expectedAvailableChecks.length);
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
    expect(report.failureSummaryCount).toBe(0);
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
    expect(report.selectedCheckCount).toBe(expectedAvailableChecks.length);
    expect(report.requestedCheckCount).toBe(2);
    expect(report.skippedCheckCount).toBe(0);
    expect(report.selectedChecks).toEqual([
      "devEnvironment",
      "wasmPack",
      "tsCore",
      "runtimeLibraries",
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
        resolvedTo: [
          "devEnvironment",
          "wasmPack",
          "tsCore",
          "runtimeLibraries",
          "client",
        ],
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

  it("does not activate no-build for inline no-build misuse after --only", () => {
    const result = spawnSync(
      process.execPath,
      [preflightScript, "--only", "--verify=1", "--no-build=2"],
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
    expect(report.validationErrorCode).toBe("only_option_missing_value");
    expect(report.message).toBe("Missing value for --only option.");
    expect(report.invalidChecks).toEqual([]);
    expect(report.invalidCheckCount).toBe(0);
    expect(report.requestedChecks).toEqual([]);
    expect(report.requestedCheckCount).toBe(0);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
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
      expectedActiveCliOptionOccurrences([
        "--only",
        "--verify=1",
        "--no-build=2",
      ])
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
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

  it("uses the last output flag when strict aliases appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-output-strict-alias-")
    );
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--output",
        "-l",
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
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.validationErrorCode).toBeNull();
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "-l",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions(["--list-checks", "--output", "-l"])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--output",
        "-l",
        "--output",
        secondOutputPath,
      ])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(result.status).toBe(0);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag when no-build aliases appear between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-preflight-last-output-strict-no-build-alias-")
    );
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--output",
        "--verify",
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
    expect(stdoutReport.passed).toBe(true);
    expect(stdoutReport.exitCode).toBe(0);
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.validationErrorCode).toBeNull();
    expect(stdoutReport.unknownOptions).toEqual([]);
    expect(stdoutReport.unknownOptionCount).toBe(0);
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionCount).toBe(
      stdoutReport.activeCliOptions.length
    );
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "--verify",
    ]);
    expect(stdoutReport.activeCliOptionResolutions).toEqual(
      expectedActiveCliOptionResolutions([
        "--list-checks",
        "--output",
        "--verify",
      ])
    );
    expect(stdoutReport.activeCliOptionResolutionCount).toBe(
      stdoutReport.activeCliOptionResolutions.length
    );
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--list-checks",
        "--output",
        "--verify",
        "--output",
        secondOutputPath,
      ])
    );
    expect(stdoutReport.activeCliOptionOccurrenceCount).toBe(
      stdoutReport.activeCliOptionOccurrences.length
    );
    expect(secondFileReport.outputPath).toBe(secondOutputPath);
    expect(result.status).toBe(0);

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
    expectSelectorAndAliasMetadata(report);
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
    expectSelectorAndAliasMetadata(report);
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
    expectSelectorAndAliasMetadata(report);
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
    expectSelectorAndAliasMetadata(report);
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
    expectAvailableCheckInventoryMetadata(report);
    expectSelectorAndAliasMetadata(report);
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
    expectSelectorAndAliasMetadata(report);
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
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
    expect(report.availableChecks).toEqual(expectedAvailableChecks);
    expect(report.availableCheckMetadata).toEqual(expectedAvailableCheckMetadata);
    expectSelectorAndAliasMetadata(report);
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
        resolvedTo: [
          "devEnvironment",
          "wasmPack",
          "tsCore",
          "runtimeLibraries",
          "client",
        ],
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
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
      "Invalid check name(s): invalidCheck, otherInvalid. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
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

  it("uses the last output flag for unsupported-option validation errors with no-build aliases between outputs", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-preflight-unsupported-last-output-with-no-build-alias-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--mystery",
        "--output",
        firstOutputPath,
        "--verify",
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
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(true);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--mystery"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.message).toBe(expectedUnsupportedOptionsMessage(["--mystery"]));
    expect(stdoutReport.activeCliOptions).toEqual([
      "--list-checks",
      "--no-build",
      "--output",
    ]);
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
      "--verify",
    ]);
    expect(secondFileReport).toEqual(stdoutReport);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(1);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("uses the last output flag for inline no-build misuse validation errors", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-preflight-unsupported-last-output-inline-no-build-misuse-"
      )
    );
    const firstOutputPath = path.resolve(tempDirectory, "first-report.json");
    const secondOutputPath = path.resolve(tempDirectory, "second-report.json");

    const result = spawnSync(
      process.execPath,
      [
        preflightScript,
        "--list-checks",
        "--output",
        firstOutputPath,
        "--verify=1",
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
    expect(stdoutReport.listChecksOnly).toBe(true);
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("unsupported_options");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.message).toBe(
      expectedUnsupportedOptionsMessage(["--no-build=<value>"])
    );
    expect(stdoutReport.activeCliOptions).toEqual(["--list-checks", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual([
      "--list-checks",
      "--output",
    ]);
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
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
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

  it("uses the last output flag for only-selection validation errors with inline no-build misuse", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voxelize-preflight-only-unsupported-inline-no-build-last-output-"
      )
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
        "--verify=1",
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
    expect(stdoutReport.noBuild).toBe(false);
    expect(stdoutReport.validationErrorCode).toBe("only_option_invalid_value");
    expect(stdoutReport.outputPath).toBe(secondOutputPath);
    expect(stdoutReport.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(stdoutReport.unknownOptionCount).toBe(1);
    expect(stdoutReport.invalidChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.invalidCheckCount).toBe(1);
    expect(stdoutReport.requestedChecks).toEqual(["invalidCheck"]);
    expect(stdoutReport.requestedCheckCount).toBe(1);
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
    expect(stdoutReport.activeCliOptions).toEqual(["--only", "--output"]);
    expect(stdoutReport.activeCliOptionTokens).toEqual(["--only", "--output"]);
    expect(stdoutReport.activeCliOptionOccurrences).toEqual(
      expectedActiveCliOptionOccurrences([
        "--only",
        "invalidCheck",
        "--output",
        firstOutputPath,
        "--verify=1",
        "--output",
        secondOutputPath,
      ])
    );
    expect(stdoutReport.message).toBe(
      "Invalid check name(s): invalidCheck. Available checks: devEnvironment, wasmPack, tsCore, runtimeLibraries, client. Special selectors: all (all-checks, all_checks, allchecks); libraries (library, libs, lib)."
    );
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
