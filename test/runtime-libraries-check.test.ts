import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type RuntimePackageReport = {
  packageName: string;
  packagePath: string;
  packageIndex: number;
  requiredArtifacts: string[];
  requiredArtifactCount: number;
  checkCommand: string;
  checkArgs: string[];
  checkArgCount: number;
  presentArtifacts: string[];
  presentArtifactCount: number;
  missingArtifacts: string[];
  missingArtifactCount: number;
  artifactsPresent: boolean;
};

type RuntimeLibrariesCheckReport = {
  schemaVersion: number;
  passed: boolean;
  exitCode: number;
  optionTerminatorUsed: boolean;
  positionalArgs: string[];
  positionalArgCount: number;
  noBuild: boolean;
  packagesPresent: boolean;
  packageReports: RuntimePackageReport[];
  checkedPackages: string[];
  checkedPackagePaths: string[];
  checkedPackageIndices: number[];
  checkedPackageIndexCount: number;
  checkedPackageIndexMap: Record<string, number>;
  checkedPackageIndexMapCount: number;
  checkedPackagePathMap: Record<string, string>;
  availablePackages: string[];
  availablePackageCount: number;
  availablePackagePaths: string[];
  availablePackagePathCount: number;
  availablePackageIndices: number[];
  availablePackageIndexCount: number;
  availablePackageIndexMap: Record<string, number>;
  availablePackageIndexMapCount: number;
  availablePackagePathMap: Record<string, string>;
  availablePackagePathMapCount: number;
  availablePackageCheckCommandMap: Record<string, string>;
  availablePackageCheckCommandMapCount: number;
  availablePackageCheckArgsMap: Record<string, string[]>;
  availablePackageCheckArgsMapCount: number;
  availablePackageCheckArgCountMap: Record<string, number>;
  availablePackageCheckArgCountMapCount: number;
  availablePackageMetadata: Record<
    string,
    {
      packageIndex: number;
      packagePath: string;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
      requiredArtifactCount: number;
    }
  >;
  availablePackageMetadataCount: number;
  checkedPackageCount: number;
  checkedPackagePathCount: number;
  checkedPackagePathMapCount: number;
  presentPackages: string[];
  presentPackagePaths: string[];
  presentPackagePathMap: Record<string, string>;
  presentPackageIndices: number[];
  presentPackageIndexMap: Record<string, number>;
  presentPackageCheckCommandMap: Record<string, string>;
  presentPackageCheckArgsMap: Record<string, string[]>;
  presentPackageCheckArgCountMap: Record<string, number>;
  presentPackagePathMapCount: number;
  presentPackageIndexCount: number;
  presentPackageIndexMapCount: number;
  presentPackageCheckCommandMapCount: number;
  presentPackageCheckArgsMapCount: number;
  presentPackageCheckArgCountMapCount: number;
  presentPackageMetadata: Record<
    string,
    {
      packagePath: string;
      packageIndex: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
      presentArtifactCount: number;
      missingArtifactCount: number;
      artifactsPresent: boolean;
    }
  >;
  presentPackageMetadataCount: number;
  missingPackages: string[];
  missingPackagePaths: string[];
  missingPackagePathMap: Record<string, string>;
  missingPackageIndices: number[];
  missingPackageIndexMap: Record<string, number>;
  missingPackageCheckCommandMap: Record<string, string>;
  missingPackageCheckArgsMap: Record<string, string[]>;
  missingPackageCheckArgCountMap: Record<string, number>;
  missingPackagePathMapCount: number;
  missingPackageIndexCount: number;
  missingPackageIndexMapCount: number;
  missingPackageCheckCommandMapCount: number;
  missingPackageCheckArgsMapCount: number;
  missingPackageCheckArgCountMapCount: number;
  missingPackageMetadata: Record<
    string,
    {
      packagePath: string;
      packageIndex: number;
      checkCommand: string;
      checkArgs: string[];
      checkArgCount: number;
      presentArtifactCount: number;
      missingArtifactCount: number;
      artifactsPresent: boolean;
    }
  >;
  missingPackageMetadataCount: number;
  requiredPackageCount: number;
  presentPackageCount: number;
  presentPackagePathCount: number;
  packageReportCount: number;
  packageReportMap: Record<string, RuntimePackageReport>;
  packageReportMapCount: number;
  requiredArtifactsByPackage: Record<string, string[]>;
  requiredArtifacts: string[];
  requiredArtifactsByPackageCount: number;
  requiredArtifactCountByPackage: Record<string, number>;
  requiredArtifactCount: number;
  requiredArtifactCountByPackageCount: number;
  packageCheckCommandMap: Record<string, string>;
  packageCheckCommandMapCount: number;
  packageCheckArgsMap: Record<string, string[]>;
  packageCheckArgsMapCount: number;
  packageCheckArgCountMap: Record<string, number>;
  packageCheckArgCountMapCount: number;
  packageStatusMap: Record<string, "present" | "missing">;
  packageStatusMapCount: number;
  packageStatusCountMap: {
    present: number;
    missing: number;
  };
  packageStatusCountMapCount: number;
  artifactsPresentByPackage: Record<string, boolean>;
  artifactsPresentByPackageCount: number;
  presentArtifactsByPackage: Record<string, string[]>;
  presentArtifacts: string[];
  presentArtifactCount: number;
  presentArtifactsByPackageCount: number;
  presentArtifactCountByPackage: Record<string, number>;
  presentArtifactCountByPackageCount: number;
  presentPackageArtifactsByPackage: Record<string, string[]>;
  presentPackageArtifactsByPackageCount: number;
  presentPackageArtifactCountByPackage: Record<string, number>;
  presentPackageArtifactCountByPackageCount: number;
  missingPackageCount: number;
  missingPackagePathCount: number;
  missingArtifactsByPackage: Record<string, string[]>;
  missingArtifacts: string[];
  missingArtifactCount: number;
  missingArtifactsByPackageCount: number;
  missingArtifactCountByPackage: Record<string, number>;
  missingArtifactCountByPackageCount: number;
  missingPackageArtifactsByPackage: Record<string, string[]>;
  missingPackageArtifactsByPackageCount: number;
  missingPackageArtifactCountByPackage: Record<string, number>;
  missingPackageArtifactCountByPackageCount: number;
  failureSummaries: Array<{
    kind: "artifacts";
    packageName: string;
    packagePath: string;
    packageIndex: number;
    checkCommand: string;
    checkArgs: string[];
    checkArgCount: number;
    missingArtifacts: string[];
    missingArtifactCount: number;
    message: string;
  }>;
  failureSummaryCount: number;
  missingArtifactSummary: string | null;
  attemptedBuild: boolean;
  buildSkipped: boolean;
  buildSkippedReason: "no-build" | "artifacts-present" | null;
  buildOutput: string | null;
  buildCommand: string;
  buildArgs: string[];
  buildExitCode: number | null;
  buildDurationMs: number | null;
  outputPath: string | null;
  unknownOptions: string[];
  unknownOptionCount: number;
  supportedCliOptions: string[];
  supportedCliOptionCount: number;
  availableCliOptionAliases: {
    "--no-build": string[];
  };
  availableCliOptionCanonicalMap: Record<string, string>;
  validationErrorCode:
    | "output_option_missing_value"
    | "unsupported_options"
    | null;
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
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message: string;
  writeError?: string;
};

type ScriptResult = {
  status: number;
  output: string;
};

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(testDir, "..");
const checkerScript = path.resolve(rootDir, "check-runtime-libraries.mjs");
const expectedCheckedPackages = [
  "@voxelize/aabb",
  "@voxelize/raycast",
  "@voxelize/physics-engine",
];
const expectedCheckedPackagePaths = [
  "packages/aabb",
  "packages/raycast",
  "packages/physics-engine",
];
const expectedCheckedPackageIndices = expectedCheckedPackages.map((_, index) => {
  return index;
});
const expectedCheckedPackageIndexMap = Object.fromEntries(
  expectedCheckedPackages.map((packageName, index) => {
    return [packageName, index];
  })
);
const expectedCheckedPackagePathMap = Object.fromEntries(
  expectedCheckedPackages.map((packageName, index) => {
    return [packageName, expectedCheckedPackagePaths[index]];
  })
);
const expectedSupportedCliOptions = [
  "--compact",
  "--json",
  "--no-build",
  "--output",
  "--quiet",
  "--verify",
];
const expectedPackageCheckCommand = "artifact-exists";
const expectedBuildArgs = [
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
const expectedArtifactsByPackage = {
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
const expectedRequiredArtifactCount = Object.values(
  expectedArtifactsByPackage
).reduce((count, artifacts) => {
  return count + artifacts.length;
}, 0);
const expectedRequiredArtifactCountByPackage = Object.fromEntries(
  Object.entries(expectedArtifactsByPackage).map(([packageName, artifacts]) => {
    return [packageName, artifacts.length];
  })
);
const expectedRequiredArtifacts = Object.values(expectedArtifactsByPackage).reduce(
  (artifacts, packageArtifacts) => {
    return [...artifacts, ...packageArtifacts];
  },
  [] as string[]
);
const resolveArtifactPath = (artifactPath: string) => {
  return path.resolve(rootDir, artifactPath);
};
const runWithTemporarilyMovedArtifact = (
  artifactPath: string,
  run: () => void
) => {
  const absoluteArtifactPath = resolveArtifactPath(artifactPath);
  if (!fs.existsSync(absoluteArtifactPath)) {
    throw new Error(`Artifact does not exist for test setup: ${artifactPath}`);
  }
  const backupPath = `${absoluteArtifactPath}.backup-${Date.now()}`;
  fs.renameSync(absoluteArtifactPath, backupPath);

  try {
    run();
  } finally {
    const artifactExists = fs.existsSync(absoluteArtifactPath);
    const backupExists = fs.existsSync(backupPath);

    if (artifactExists && backupExists) {
      fs.rmSync(backupPath, { force: true });
      return;
    }

    if (!artifactExists && backupExists) {
      fs.renameSync(backupPath, absoluteArtifactPath);
    }
  }
};
const runScript = (args: string[] = []): ScriptResult => {
  const result = spawnSync(process.execPath, [checkerScript, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  };
};
const parseReport = (result: ScriptResult): RuntimeLibrariesCheckReport => {
  const report = JSON.parse(result.output) as RuntimeLibrariesCheckReport;
  expect(report.checkedPackages).toEqual(expectedCheckedPackages);
  expect(report.checkedPackagePaths).toEqual(expectedCheckedPackagePaths);
  expect(report.checkedPackageIndices).toEqual(expectedCheckedPackageIndices);
  expect(report.checkedPackageIndexCount).toBe(report.checkedPackageIndices.length);
  expect(report.checkedPackageIndexMap).toEqual(expectedCheckedPackageIndexMap);
  expect(report.checkedPackageIndexMapCount).toBe(
    Object.keys(report.checkedPackageIndexMap).length
  );
  expect(report.checkedPackagePathMap).toEqual(expectedCheckedPackagePathMap);
  expect(report.checkedPackagePathMapCount).toBe(
    Object.keys(report.checkedPackagePathMap).length
  );
  expect(report.availablePackages).toEqual(report.checkedPackages);
  expect(report.availablePackageCount).toBe(report.availablePackages.length);
  expect(report.availablePackagePaths).toEqual(report.checkedPackagePaths);
  expect(report.availablePackagePathCount).toBe(
    report.availablePackagePaths.length
  );
  expect(report.availablePackageIndices).toEqual(report.checkedPackageIndices);
  expect(report.availablePackageIndexCount).toBe(
    report.availablePackageIndices.length
  );
  expect(report.availablePackageIndexMap).toEqual(report.checkedPackageIndexMap);
  expect(report.availablePackageIndexMapCount).toBe(
    Object.keys(report.availablePackageIndexMap).length
  );
  expect(report.availablePackagePathMap).toEqual(report.checkedPackagePathMap);
  expect(report.availablePackagePathMapCount).toBe(
    Object.keys(report.availablePackagePathMap).length
  );
  expect(report.availablePackageCheckCommandMap).toEqual(
    Object.fromEntries(
      report.checkedPackages.map((packageName) => {
        return [packageName, expectedPackageCheckCommand];
      })
    )
  );
  expect(report.availablePackageCheckCommandMapCount).toBe(
    Object.keys(report.availablePackageCheckCommandMap).length
  );
  expect(report.availablePackageCheckArgsMap).toEqual(
    report.requiredArtifactsByPackage
  );
  expect(report.availablePackageCheckArgsMapCount).toBe(
    Object.keys(report.availablePackageCheckArgsMap).length
  );
  expect(report.availablePackageCheckArgCountMap).toEqual(
    report.requiredArtifactCountByPackage
  );
  expect(report.availablePackageCheckArgCountMapCount).toBe(
    Object.keys(report.availablePackageCheckArgCountMap).length
  );
  expect(report.availablePackageMetadata).toEqual(
    Object.fromEntries(
      report.checkedPackages.map((packageName) => {
        return [
          packageName,
          {
            packageIndex: report.checkedPackageIndexMap[packageName],
            packagePath: report.checkedPackagePathMap[packageName],
            checkCommand: expectedPackageCheckCommand,
            checkArgs: report.requiredArtifactsByPackage[packageName],
            checkArgCount: report.requiredArtifactCountByPackage[packageName],
            requiredArtifactCount: report.requiredArtifactCountByPackage[packageName],
          },
        ];
      })
    )
  );
  expect(report.availablePackageMetadataCount).toBe(
    Object.keys(report.availablePackageMetadata).length
  );
  expect(report.checkedPackages).toEqual(
    report.packageReports.map((packageReport) => packageReport.packageName)
  );
  expect(report.checkedPackagePaths).toEqual(
    report.packageReports.map((packageReport) => packageReport.packagePath)
  );
  expect(report.checkedPackageIndices).toEqual(
    report.packageReports.map((_, index) => {
      return index;
    })
  );
  expect(report.checkedPackageIndexMap).toEqual(
    Object.fromEntries(
      report.packageReports.map((packageReport, index) => {
        return [packageReport.packageName, index];
      })
    )
  );
  expect(report.checkedPackagePathMap).toEqual(
    Object.fromEntries(
      report.packageReports.map((packageReport) => {
        return [packageReport.packageName, packageReport.packagePath];
      })
    )
  );
  expect(report.checkedPackageCount).toBe(report.checkedPackages.length);
  expect(report.checkedPackagePathCount).toBe(report.checkedPackagePaths.length);
  expect(report.checkedPackagePathCount).toBe(report.requiredPackageCount);
  expect(report.requiredPackageCount).toBe(expectedCheckedPackages.length);
  expect(report.packageReportCount).toBe(report.packageReports.length);
  expect(report.packageReportMap).toEqual(
    Object.fromEntries(
      report.packageReports.map((packageReport) => {
        return [packageReport.packageName, packageReport];
      })
    )
  );
  expect(report.packageReportMapCount).toBe(
    Object.keys(report.packageReportMap).length
  );
  expect(report.requiredArtifactCount).toBe(expectedRequiredArtifactCount);
  expect(report.requiredArtifacts).toEqual(expectedRequiredArtifacts);
  expect(report.requiredArtifacts.length).toBe(report.requiredArtifactCount);
  expect(report.requiredArtifactsByPackage).toEqual(expectedArtifactsByPackage);
  expect(report.requiredArtifactsByPackageCount).toBe(
    Object.keys(report.requiredArtifactsByPackage).length
  );
  expect(report.requiredArtifactCountByPackage).toEqual(
    expectedRequiredArtifactCountByPackage
  );
  expect(report.requiredArtifactCountByPackageCount).toBe(
    Object.keys(report.requiredArtifactCountByPackage).length
  );
  expect(report.supportedCliOptions).toEqual(expectedSupportedCliOptions);
  expect(report.supportedCliOptionCount).toBe(expectedSupportedCliOptions.length);
  expect(report.availableCliOptionAliases).toEqual({
    "--no-build": ["--verify"],
  });
  expect(report.availableCliOptionCanonicalMap).toEqual({
    "--compact": "--compact",
    "--json": "--json",
    "--no-build": "--no-build",
    "--output": "--output",
    "--quiet": "--quiet",
    "--verify": "--no-build",
  });
  expect(report.packageReports).toHaveLength(3);
  const missingPackageCount = report.packageReports.filter((packageReport) => {
    return packageReport.artifactsPresent === false;
  }).length;
  const missingArtifactCount = report.packageReports.reduce((count, packageReport) => {
    return count + packageReport.missingArtifactCount;
  }, 0);
  const presentPackageCount = report.packageReports.length - missingPackageCount;
  const presentPackages = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => packageReport.packageName);
  const presentPackagePaths = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => packageReport.packagePath);
  const presentPackagePathMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.packagePath];
      })
  );
  const presentPackageIndices = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => {
      return report.checkedPackageIndexMap[packageReport.packageName];
    });
  const presentPackageIndexMap = Object.fromEntries(
    presentPackages.map((packageName) => {
      return [packageName, report.checkedPackageIndexMap[packageName]];
    })
  );
  const presentPackageCheckCommandMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkCommand];
      })
  );
  const presentPackageCheckArgsMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgs];
      })
  );
  const presentPackageCheckArgCountMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgCount];
      })
  );
  const presentPackageMetadata = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [
          packageReport.packageName,
          {
            packagePath: packageReport.packagePath,
            packageIndex: packageReport.packageIndex,
            checkCommand: packageReport.checkCommand,
            checkArgs: packageReport.checkArgs,
            checkArgCount: packageReport.checkArgCount,
            presentArtifactCount: packageReport.presentArtifactCount,
            missingArtifactCount: packageReport.missingArtifactCount,
            artifactsPresent: packageReport.artifactsPresent,
          },
        ];
      })
  );
  const missingPackages = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => packageReport.packageName);
  const missingPackagePaths = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => packageReport.packagePath);
  const missingPackagePathMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.packagePath];
      })
  );
  const missingPackageIndices = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => {
      return report.checkedPackageIndexMap[packageReport.packageName];
    });
  const missingPackageIndexMap = Object.fromEntries(
    missingPackages.map((packageName) => {
      return [packageName, report.checkedPackageIndexMap[packageName]];
    })
  );
  const missingPackageCheckCommandMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkCommand];
      })
  );
  const missingPackageCheckArgsMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgs];
      })
  );
  const missingPackageCheckArgCountMap = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgCount];
      })
  );
  const missingPackageMetadata = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [
          packageReport.packageName,
          {
            packagePath: packageReport.packagePath,
            packageIndex: packageReport.packageIndex,
            checkCommand: packageReport.checkCommand,
            checkArgs: packageReport.checkArgs,
            checkArgCount: packageReport.checkArgCount,
            presentArtifactCount: packageReport.presentArtifactCount,
            missingArtifactCount: packageReport.missingArtifactCount,
            artifactsPresent: packageReport.artifactsPresent,
          },
        ];
      })
  );
  const presentArtifactCount = report.packageReports.reduce((count, packageReport) => {
    return count + packageReport.presentArtifactCount;
  }, 0);
  const presentArtifactCountByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.presentArtifactCount];
    })
  );
  const artifactsPresentByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.artifactsPresent];
    })
  );
  const packageStatusMap = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [
        packageReport.packageName,
        packageReport.artifactsPresent ? "present" : "missing",
      ];
    })
  );
  const packageCheckCommandMap = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkCommand];
    })
  );
  const packageCheckArgsMap = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkArgs];
    })
  );
  const packageCheckArgCountMap = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkArgCount];
    })
  );
  const presentArtifacts = report.packageReports.reduce((artifacts, packageReport) => {
    return [...artifacts, ...packageReport.presentArtifacts];
  }, [] as string[]);
  const presentArtifactsByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.presentArtifacts];
    })
  );
  const presentPackageArtifactsByPackage = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.presentArtifacts];
      })
  );
  const missingArtifactCountByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.missingArtifactCount];
    })
  );
  const presentPackageArtifactCountByPackage = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.presentArtifactCount];
      })
  );
  const missingArtifacts = report.packageReports.reduce((artifacts, packageReport) => {
    return [...artifacts, ...packageReport.missingArtifacts];
  }, [] as string[]);
  const missingArtifactsByPackage = Object.fromEntries(
    report.packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.missingArtifacts];
    })
  );
  const missingPackageArtifactsByPackage = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.missingArtifacts];
      })
  );
  const missingPackageArtifactCountByPackage = Object.fromEntries(
    report.packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.missingArtifactCount];
      })
  );
  expect(report.packagesPresent).toBe(missingPackageCount === 0);
  expect(report.requiredPackageCount).toBe(
    report.presentPackageCount + report.missingPackageCount
  );
  expect(report.checkedPackageIndexCount).toBe(
    report.presentPackageIndexCount + report.missingPackageIndexCount
  );
  expect(report.checkedPackageIndexMapCount).toBe(
    report.presentPackageIndexMapCount + report.missingPackageIndexMapCount
  );
  expect(report.checkedPackagePathCount).toBe(
    report.presentPackagePathCount + report.missingPackagePathCount
  );
  expect(report.checkedPackageCount).toBe(
    report.presentPackageMetadataCount + report.missingPackageMetadataCount
  );
  expect(report.packageCheckCommandMapCount).toBe(
    report.presentPackageCheckCommandMapCount +
      report.missingPackageCheckCommandMapCount
  );
  expect(report.packageCheckArgsMapCount).toBe(
    report.presentPackageCheckArgsMapCount + report.missingPackageCheckArgsMapCount
  );
  expect(report.packageCheckArgCountMapCount).toBe(
    report.presentPackageCheckArgCountMapCount +
      report.missingPackageCheckArgCountMapCount
  );
  expect(report.presentArtifactsByPackageCount).toBe(
    report.presentPackageArtifactsByPackageCount +
      report.missingPackageArtifactsByPackageCount
  );
  expect(report.presentArtifactCountByPackageCount).toBe(
    report.presentPackageArtifactCountByPackageCount +
      report.missingPackageArtifactCountByPackageCount
  );
  expect(report.checkedPackagePathMapCount).toBe(
    report.presentPackagePathMapCount + report.missingPackagePathMapCount
  );
  expect(report.requiredArtifactCount).toBe(
    report.presentArtifactCount + report.missingArtifactCount
  );
  expect(report.presentPackageCount).toBe(presentPackageCount);
  expect(report.presentPackages).toEqual(presentPackages);
  expect(report.presentPackages.length).toBe(report.presentPackageCount);
  expect(report.presentPackagePaths).toEqual(presentPackagePaths);
  expect(report.presentPackagePaths.length).toBe(report.presentPackagePathCount);
  expect(report.presentPackagePathMap).toEqual(presentPackagePathMap);
  expect(report.presentPackagePathMapCount).toBe(
    Object.keys(report.presentPackagePathMap).length
  );
  expect(report.presentPackageIndices).toEqual(presentPackageIndices);
  expect(report.presentPackageIndices.length).toBe(report.presentPackageIndexCount);
  expect(report.presentPackageIndexMap).toEqual(presentPackageIndexMap);
  expect(report.presentPackageIndexMapCount).toBe(
    Object.keys(report.presentPackageIndexMap).length
  );
  expect(report.presentPackageCheckCommandMap).toEqual(
    presentPackageCheckCommandMap
  );
  expect(report.presentPackageCheckCommandMapCount).toBe(
    Object.keys(report.presentPackageCheckCommandMap).length
  );
  expect(report.presentPackageCheckArgsMap).toEqual(presentPackageCheckArgsMap);
  expect(report.presentPackageCheckArgsMapCount).toBe(
    Object.keys(report.presentPackageCheckArgsMap).length
  );
  expect(report.presentPackageCheckArgCountMap).toEqual(
    presentPackageCheckArgCountMap
  );
  expect(report.presentPackageCheckArgCountMapCount).toBe(
    Object.keys(report.presentPackageCheckArgCountMap).length
  );
  expect(report.presentPackageMetadata).toEqual(presentPackageMetadata);
  expect(report.presentPackageMetadataCount).toBe(
    Object.keys(report.presentPackageMetadata).length
  );
  expect(report.missingPackages).toEqual(missingPackages);
  expect(report.missingPackages.length).toBe(report.missingPackageCount);
  expect(report.missingPackagePaths).toEqual(missingPackagePaths);
  expect(report.missingPackagePaths.length).toBe(report.missingPackagePathCount);
  expect(report.missingPackagePathMap).toEqual(missingPackagePathMap);
  expect(report.missingPackagePathMapCount).toBe(
    Object.keys(report.missingPackagePathMap).length
  );
  expect(report.missingPackageIndices).toEqual(missingPackageIndices);
  expect(report.missingPackageIndices.length).toBe(report.missingPackageIndexCount);
  expect(report.missingPackageIndexMap).toEqual(missingPackageIndexMap);
  expect(report.missingPackageIndexMapCount).toBe(
    Object.keys(report.missingPackageIndexMap).length
  );
  expect(report.missingPackageCheckCommandMap).toEqual(
    missingPackageCheckCommandMap
  );
  expect(report.missingPackageCheckCommandMapCount).toBe(
    Object.keys(report.missingPackageCheckCommandMap).length
  );
  expect(report.missingPackageCheckArgsMap).toEqual(missingPackageCheckArgsMap);
  expect(report.missingPackageCheckArgsMapCount).toBe(
    Object.keys(report.missingPackageCheckArgsMap).length
  );
  expect(report.missingPackageCheckArgCountMap).toEqual(
    missingPackageCheckArgCountMap
  );
  expect(report.missingPackageCheckArgCountMapCount).toBe(
    Object.keys(report.missingPackageCheckArgCountMap).length
  );
  expect(report.missingPackageMetadata).toEqual(missingPackageMetadata);
  expect(report.missingPackageMetadataCount).toBe(
    Object.keys(report.missingPackageMetadata).length
  );
  expect({
    ...report.presentPackageIndexMap,
    ...report.missingPackageIndexMap,
  }).toEqual(report.checkedPackageIndexMap);
  expect(report.presentArtifactCount).toBe(presentArtifactCount);
  expect(report.packageCheckCommandMap).toEqual(packageCheckCommandMap);
  expect(report.packageCheckCommandMapCount).toBe(
    Object.keys(report.packageCheckCommandMap).length
  );
  expect(report.packageCheckArgsMap).toEqual(packageCheckArgsMap);
  expect(report.packageCheckArgsMapCount).toBe(
    Object.keys(report.packageCheckArgsMap).length
  );
  expect(report.packageCheckArgCountMap).toEqual(packageCheckArgCountMap);
  expect(report.packageCheckArgCountMapCount).toBe(
    Object.keys(report.packageCheckArgCountMap).length
  );
  expect(report.packageStatusMap).toEqual(packageStatusMap);
  expect(report.packageStatusMapCount).toBe(
    Object.keys(report.packageStatusMap).length
  );
  expect(report.packageStatusCountMap).toEqual({
    present: report.presentPackageCount,
    missing: report.missingPackageCount,
  });
  expect(report.packageStatusCountMapCount).toBe(
    Object.keys(report.packageStatusCountMap).length
  );
  expect(report.artifactsPresentByPackage).toEqual(artifactsPresentByPackage);
  expect(report.artifactsPresentByPackageCount).toBe(
    Object.keys(report.artifactsPresentByPackage).length
  );
  expect(report.presentArtifactCountByPackage).toEqual(
    presentArtifactCountByPackage
  );
  expect(report.presentPackageArtifactCountByPackage).toEqual(
    presentPackageArtifactCountByPackage
  );
  expect(report.presentPackageArtifactCountByPackageCount).toBe(
    Object.keys(report.presentPackageArtifactCountByPackage).length
  );
  expect(report.presentArtifactsByPackage).toEqual(presentArtifactsByPackage);
  expect(report.presentPackageArtifactsByPackage).toEqual(
    presentPackageArtifactsByPackage
  );
  expect(report.presentPackageArtifactsByPackageCount).toBe(
    Object.keys(report.presentPackageArtifactsByPackage).length
  );
  expect(report.presentArtifactsByPackageCount).toBe(
    Object.keys(report.presentArtifactsByPackage).length
  );
  expect(report.presentArtifactCountByPackageCount).toBe(
    Object.keys(report.presentArtifactCountByPackage).length
  );
  expect(report.presentArtifacts).toEqual(presentArtifacts);
  expect(report.presentArtifacts.length).toBe(report.presentArtifactCount);
  expect(report.missingPackageCount).toBe(missingPackageCount);
  expect(report.missingArtifactCount).toBe(missingArtifactCount);
  expect(report.missingArtifactCountByPackage).toEqual(
    missingArtifactCountByPackage
  );
  expect(report.missingPackageArtifactCountByPackage).toEqual(
    missingPackageArtifactCountByPackage
  );
  expect(report.missingPackageArtifactCountByPackageCount).toBe(
    Object.keys(report.missingPackageArtifactCountByPackage).length
  );
  expect(report.missingArtifactsByPackage).toEqual(missingArtifactsByPackage);
  expect(report.missingPackageArtifactsByPackage).toEqual(
    missingPackageArtifactsByPackage
  );
  expect(report.missingPackageArtifactsByPackageCount).toBe(
    Object.keys(report.missingPackageArtifactsByPackage).length
  );
  expect(report.missingArtifactsByPackageCount).toBe(
    Object.keys(report.missingArtifactsByPackage).length
  );
  expect(report.missingArtifactCountByPackageCount).toBe(
    Object.keys(report.missingArtifactCountByPackage).length
  );
  const expectedFailureSummaries = report.packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => {
      return {
        kind: "artifacts",
        packageName: packageReport.packageName,
        packagePath: packageReport.packagePath,
        packageIndex: packageReport.packageIndex,
        checkCommand: packageReport.checkCommand,
        checkArgs: packageReport.checkArgs,
        checkArgCount: packageReport.checkArgCount,
        missingArtifacts: packageReport.missingArtifacts,
        missingArtifactCount: packageReport.missingArtifactCount,
        message: `Missing artifacts for ${packageReport.packageName}: ${packageReport.missingArtifacts.join(", ")}.`,
      };
    });
  expect(report.failureSummaries).toEqual(expectedFailureSummaries);
  expect(report.failureSummaryCount).toBe(report.failureSummaries.length);
  expect(report.missingArtifacts).toEqual(missingArtifacts);
  expect(report.missingArtifacts.length).toBe(report.missingArtifactCount);
  expect([...report.presentArtifacts, ...report.missingArtifacts].sort()).toEqual(
    [...report.requiredArtifacts].sort()
  );
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
    expect(packageReport.packageIndex).toBe(
      report.checkedPackageIndexMap[packageReport.packageName]
    );
    expect(packageReport.checkCommand).toBe(expectedPackageCheckCommand);
    expect(packageReport.checkArgs).toEqual(packageReport.requiredArtifacts);
    expect(packageReport.checkArgCount).toBe(packageReport.checkArgs.length);
    expect(packageReport.requiredArtifacts).toEqual(
      expectedArtifactsByPackage[
        packageReport.packageName as keyof typeof expectedArtifactsByPackage
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
  expect(report.buildArgs).toEqual(expectedBuildArgs);
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
  return report;
};

describe("check-runtime-libraries script", () => {
  it("prints clear non-json success output", () => {
    const result = runScript();

    expect(result.status).toBe(0);
    expect(result.output).toContain("Runtime library build artifacts are available.");
  });

  it("suppresses non-json success output in quiet mode", () => {
    const result = runScript(["--quiet"]);

    expect(result.status).toBe(0);
    expect(result.output).toBe("");
  });

  it("keeps non-json failures visible in quiet mode", () => {
    const missingArtifactPath = "packages/aabb/dist/index.js";
    runWithTemporarilyMovedArtifact(missingArtifactPath, () => {
      const result = runScript(["--no-build", "--quiet"]);

      expect(result.status).toBe(1);
      expect(result.output).toContain("Build was skipped due to --no-build.");
    });
  });

  it("emits machine-readable json report and auto-builds if needed", () => {
    const result = runScript(["--json"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.validationErrorCode).toBeNull();
    expect(report.packagesPresent).toBe(true);
    expect(report.presentPackages).toEqual(expectedCheckedPackages);
    expect(report.presentPackagePaths).toEqual(expectedCheckedPackagePaths);
    expect(report.missingPackages).toEqual([]);
    expect(report.missingPackagePaths).toEqual([]);
    expect(report.presentPackageCount).toBe(report.requiredPackageCount);
    expect(report.presentPackagePathCount).toBe(report.requiredPackageCount);
    expect(report.presentArtifactCount).toBe(report.requiredArtifactCount);
    expect(report.missingPackageCount).toBe(0);
    expect(report.missingPackagePathCount).toBe(0);
    expect(report.missingArtifactCount).toBe(0);
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
  });

  it("supports verify mode alias and skips builds when artifacts are present", () => {
    const result = runScript(["--json", "--verify"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(report.noBuild).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.buildSkipped).toBe(true);
    expect(report.buildSkippedReason).toBe("artifacts-present");
    expect(report.attemptedBuild).toBe(false);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--verify"]);
  });

  it("supports compact json output mode", () => {
    const result = runScript(["--json", "--compact"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(result.output).not.toContain("\n  \"");
    expect(report.schemaVersion).toBe(1);
  });

  it("reports strict output validation errors while keeping verify aliases active", () => {
    const result = runScript(["--json", "--output", "--verify"]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.noBuild).toBe(true);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output", "--verify"]);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
  });

  it("reports strict output validation for empty split output values", () => {
    const result = runScript(["--json", "--output", ""]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output"]);
  });

  it("reports strict output validation for whitespace split output values", () => {
    const result = runScript(["--json", "--output", "   "]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output"]);
  });

  it("reports strict output validation for empty inline output values", () => {
    const result = runScript(["--json", "--output="]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output="]);
  });

  it("reports strict output validation for whitespace inline output values", () => {
    const result = runScript(["--json", "--output=   "]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("output_option_missing_value");
    expect(report.message).toBe("Missing value for --output option.");
    expect(report.outputPath).toBeNull();
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output=   "]);
  });

  it("reports unsupported options with canonical alias normalization", () => {
    const result = runScript(["--json", "--verify=1", "--mystery"]);
    const report = parseReport(result);

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.unknownOptions).toEqual(["--no-build=<value>", "--mystery"]);
    expect(report.unknownOptionCount).toBe(2);
    expect(report.message).toContain("Unsupported option(s):");
  });

  it("writes json reports to output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-libraries-check-output-")
    );
    const outputPath = path.join(tempDirectory, "report.json");
    const result = runScript(["--json", "--output", outputPath]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as RuntimeLibrariesCheckReport;

    expect(result.status).toBe(0);
    expect(report.outputPath).toBe(outputPath);
    expect(fileReport.outputPath).toBe(outputPath);
    expect(fileReport.checkedPackages).toEqual(expectedCheckedPackages);
    expect(fileReport.requiredArtifactCount).toBe(expectedRequiredArtifactCount);
  });

  it("writes unsupported-option validation reports to trailing output paths", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-libraries-check-validation-output-")
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const result = runScript([
      "--json",
      "--output",
      firstOutputPath,
      "--verify=1",
      "--output",
      secondOutputPath,
    ]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as RuntimeLibrariesCheckReport;

    expect(result.status).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.outputPath).toBe(secondOutputPath);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.activeCliOptions).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output"]);
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 1,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 4,
      },
    ]);
    expect(fileReport).toEqual(report);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
  });

  it("reports validation output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-libraries-check-validation-write-failure-")
    );
    const result = runScript([
      "--json",
      "--verify=1",
      "--output",
      tempDirectory,
    ]);
    const report = parseReport(result);
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBe("unsupported_options");
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.unknownOptions).toEqual(["--no-build=<value>"]);
    expect(report.unknownOptionCount).toBe(1);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    expect(result.status).toBe(1);
  });

  it("keeps trailing output paths when no-build aliases appear between output flags", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "runtime-libraries-check-last-output-strict-no-build-alias-"
      )
    );
    const firstOutputPath = path.join(tempDirectory, "first-report.json");
    const secondOutputPath = path.join(tempDirectory, "second-report.json");
    const result = runScript([
      "--json",
      "--output",
      firstOutputPath,
      "--verify",
      "--output",
      secondOutputPath,
    ]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(secondOutputPath, "utf8")
    ) as RuntimeLibrariesCheckReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.outputPath).toBe(secondOutputPath);
    expect(report.validationErrorCode).toBeNull();
    expect(report.noBuild).toBe(true);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
    expect(report.activeCliOptionTokens).toEqual(["--json", "--output", "--verify"]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
    ]);
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 1,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 3,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 4,
      },
    ]);
    expect(fileReport).toEqual(report);
    expect(fs.existsSync(firstOutputPath)).toBe(false);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("resolves trailing inline output values after strict no-build aliases", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "runtime-libraries-check-inline-last-output-strict-alias-"
      )
    );
    const outputPath = path.join(tempDirectory, "report.json");
    const result = runScript([
      "--json",
      "--output",
      "--verify",
      `--output=${outputPath}`,
    ]);
    const report = parseReport(result);
    const fileReport = JSON.parse(
      fs.readFileSync(outputPath, "utf8")
    ) as RuntimeLibrariesCheckReport;

    expect(report.schemaVersion).toBe(1);
    expect(report.validationErrorCode).toBeNull();
    expect(report.noBuild).toBe(true);
    expect(report.outputPath).toBe(outputPath);
    expect(report.unknownOptions).toEqual([]);
    expect(report.unknownOptionCount).toBe(0);
    expect(report.activeCliOptions).toEqual(["--json", "--no-build", "--output"]);
    expect(report.activeCliOptionTokens).toEqual([
      "--json",
      "--output",
      "--verify",
      `--output=${outputPath}`,
    ]);
    expect(report.activeCliOptionResolutions).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
      },
      {
        token: "--output",
        canonicalOption: "--output",
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
      },
      {
        token: `--output=${outputPath}`,
        canonicalOption: "--output",
      },
    ]);
    expect(report.activeCliOptionOccurrences).toEqual([
      {
        token: "--json",
        canonicalOption: "--json",
        index: 0,
      },
      {
        token: "--output",
        canonicalOption: "--output",
        index: 1,
      },
      {
        token: "--verify",
        canonicalOption: "--no-build",
        index: 2,
      },
      {
        token: `--output=${outputPath}`,
        canonicalOption: "--output",
        index: 3,
      },
    ]);
    expect(fileReport).toEqual(report);
    expect(result.status).toBe(report.passed ? 0 : report.exitCode);
  });

  it("reports output write failures with details", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runtime-libraries-check-output-write-failure-")
    );
    const result = runScript(["--json", "--output", tempDirectory]);
    const report = parseReport(result);
    const failurePrefix = `Failed to write report to ${tempDirectory}.`;

    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationErrorCode).toBeNull();
    expect(report.outputPath).toBe(tempDirectory);
    expect(report.writeError).toContain(failurePrefix);
    expect(report.message).toContain(failurePrefix);
    if (report.message !== undefined) {
      expect(report.message.length).toBeGreaterThan(failurePrefix.length);
    }
    expect(result.status).toBe(1);
  });

  it("reports missing artifacts in no-build mode", () => {
    const missingArtifactPath = "packages/aabb/dist/index.js";
    runWithTemporarilyMovedArtifact(missingArtifactPath, () => {
      const result = runScript(["--json", "--no-build"]);
      const report = parseReport(result);

      expect(result.status).toBe(1);
      expect(report.passed).toBe(false);
      expect(report.noBuild).toBe(true);
      expect(report.packagesPresent).toBe(false);
      expect(report.presentPackages.length).toBe(report.presentPackageCount);
      expect(report.presentPackagePaths.length).toBe(report.presentPackagePathCount);
      expect(report.missingPackages.length).toBe(report.missingPackageCount);
      expect(report.missingPackagePaths.length).toBe(report.missingPackagePathCount);
      expect(report.presentPackageCount).toBeLessThan(report.requiredPackageCount);
      expect(report.presentArtifactCount).toBeLessThan(report.requiredArtifactCount);
      expect(report.missingPackageCount).toBeGreaterThanOrEqual(1);
      expect(report.missingArtifactCount).toBeGreaterThanOrEqual(1);
      expect(report.buildSkipped).toBe(true);
      expect(report.buildSkippedReason).toBe("no-build");
      expect(report.attemptedBuild).toBe(false);
      expect(report.message).toContain("Build was skipped due to --no-build.");
    });
  });

  it("rebuilds missing artifacts when no-build mode is disabled", () => {
    const missingArtifactPath = "packages/aabb/dist/index.js";
    runWithTemporarilyMovedArtifact(missingArtifactPath, () => {
      const result = runScript(["--json"]);
      const report = parseReport(result);

      expect(result.status).toBe(0);
      expect(report.passed).toBe(true);
      expect(report.packagesPresent).toBe(true);
      expect(report.presentPackages).toEqual(expectedCheckedPackages);
      expect(report.presentPackagePaths).toEqual(expectedCheckedPackagePaths);
      expect(report.missingPackages).toEqual([]);
      expect(report.missingPackagePaths).toEqual([]);
      expect(report.presentPackageCount).toBe(report.requiredPackageCount);
      expect(report.presentPackagePathCount).toBe(report.requiredPackageCount);
      expect(report.presentArtifactCount).toBe(report.requiredArtifactCount);
      expect(report.missingPackageCount).toBe(0);
      expect(report.missingPackagePathCount).toBe(0);
      expect(report.missingArtifactCount).toBe(0);
      expect(report.attemptedBuild).toBe(true);
      expect(report.buildSkipped).toBe(false);
      expect(report.buildSkippedReason).toBeNull();
      expect(fs.existsSync(resolveArtifactPath(missingArtifactPath))).toBe(true);
    });
  });

  it("does not activate no-build aliases after option terminator", () => {
    const result = runScript(["--json", "--", "--verify"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(report.noBuild).toBe(false);
    expect(report.optionTerminatorUsed).toBe(true);
    expect(report.positionalArgs).toEqual(["--verify"]);
    expect(report.activeCliOptions).toEqual(["--json"]);
  });

  it("keeps json output machine-readable in quiet mode", () => {
    const result = runScript(["--json", "--quiet"]);
    const report = parseReport(result);

    expect(result.status).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.activeCliOptions).toEqual(["--json", "--quiet"]);
    expect(report.outputPath).toBeNull();
  });

  it("non-json mode prioritizes missing output value over inline json misuse", () => {
    const result = runScript(["--output", "--json=1"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
    expect(result.output).not.toContain("--json=1");
  });

  it("non-json mode prioritizes whitespace inline output value over unsupported options", () => {
    const result = runScript(["--mystery", "--output=   "]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });

  it("non-json mode prioritizes empty inline output value over unsupported options", () => {
    const result = runScript(["--mystery", "--output="]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing value for --output option.");
    expect(result.output).not.toContain("Unsupported option(s):");
  });
});
