import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePnpmCommand } from "./scripts/command-utils.mjs";
import {
  countRecordEntries,
  createCliOptionCatalog,
  createCliDiagnostics,
  createTimedReportBuilder,
  deriveCliValidationFailureMessage,
  hasCliOption,
  resolveOutputPath,
  serializeReportWithOptionalWrite,
  splitCliArgs,
} from "./scripts/report-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = __dirname;
const runtimeLibraries = [
  {
    packageName: "@voxelize/aabb",
    packagePath: "packages/aabb",
    requiredArtifacts: [
      "packages/aabb/dist/index.js",
      "packages/aabb/dist/index.mjs",
      "packages/aabb/dist/index.d.ts",
    ],
  },
  {
    packageName: "@voxelize/raycast",
    packagePath: "packages/raycast",
    requiredArtifacts: [
      "packages/raycast/dist/index.js",
      "packages/raycast/dist/index.mjs",
      "packages/raycast/dist/index.d.ts",
    ],
  },
  {
    packageName: "@voxelize/physics-engine",
    packagePath: "packages/physics-engine",
    requiredArtifacts: [
      "packages/physics-engine/dist/index.cjs",
      "packages/physics-engine/dist/index.js",
      "packages/physics-engine/dist/index.d.ts",
    ],
  },
];
const checkedPackages = runtimeLibraries.map((library) => library.packageName);
const checkedPackagePaths = runtimeLibraries.map((library) => library.packagePath);
const checkedPackageIndices = checkedPackages.map((_, index) => {
  return index;
});
const checkedPackageIndexMap = Object.fromEntries(
  checkedPackages.map((packageName, index) => {
    return [packageName, index];
  })
);
const checkedPackageIndexMapCount = countRecordEntries(checkedPackageIndexMap);
const checkedPackageNameToIndex = new Map(
  checkedPackages.map((packageName, index) => {
    return [packageName, index];
  })
);
const resolveCheckedPackageIndex = (packageName) => {
  const packageIndex = checkedPackageNameToIndex.get(packageName);
  if (packageIndex === undefined) {
    throw new Error(`Missing checked package index for ${packageName}.`);
  }

  return packageIndex;
};
const checkedPackagePathMap = Object.fromEntries(
  runtimeLibraries.map((library) => {
    return [library.packageName, library.packagePath];
  })
);
const checkedPackagePathMapCount = countRecordEntries(checkedPackagePathMap);
const requiredArtifactCountByPackage = Object.fromEntries(
  runtimeLibraries.map((library) => {
    return [library.packageName, library.requiredArtifacts.length];
  })
);
const requiredArtifactCountByPackageCount = countRecordEntries(
  requiredArtifactCountByPackage
);
const requiredArtifactsByPackage = Object.fromEntries(
  runtimeLibraries.map((library) => {
    return [library.packageName, library.requiredArtifacts];
  })
);
const requiredArtifactsByPackageCount = countRecordEntries(
  requiredArtifactsByPackage
);
const requiredArtifacts = runtimeLibraries.reduce((artifacts, library) => {
  return [...artifacts, ...library.requiredArtifacts];
}, []);
const requiredArtifactCount = runtimeLibraries.reduce((count, library) => {
  return count + library.requiredArtifacts.length;
}, 0);
const packageCheckCommand = "artifact-exists";
const availablePackageIndices = runtimeLibraries.map((_, index) => {
  return index;
});
const availablePackageIndexMap = Object.fromEntries(
  runtimeLibraries.map((library, index) => {
    return [library.packageName, index];
  })
);
const availablePackageIndexMapCount = countRecordEntries(availablePackageIndexMap);
const availablePackagePathMap = Object.fromEntries(
  runtimeLibraries.map((library) => {
    return [library.packageName, library.packagePath];
  })
);
const availablePackagePathMapCount = countRecordEntries(availablePackagePathMap);
const availablePackageCheckCommandMap = Object.fromEntries(
  runtimeLibraries.map((library) => {
    return [library.packageName, packageCheckCommand];
  })
);
const availablePackageCheckCommandMapCount = countRecordEntries(
  availablePackageCheckCommandMap
);
const availablePackageCheckArgsMap = Object.fromEntries(
  runtimeLibraries.map((library) => {
    return [library.packageName, library.requiredArtifacts];
  })
);
const availablePackageCheckArgsMapCount = countRecordEntries(
  availablePackageCheckArgsMap
);
const availablePackageCheckArgCountMap = Object.fromEntries(
  runtimeLibraries.map((library) => {
    return [library.packageName, library.requiredArtifacts.length];
  })
);
const availablePackageCheckArgCountMapCount = countRecordEntries(
  availablePackageCheckArgCountMap
);
const availablePackageMetadata = Object.fromEntries(
  runtimeLibraries.map((library, index) => {
    return [
      library.packageName,
      {
        packageIndex: index,
        packagePath: library.packagePath,
        checkCommand: packageCheckCommand,
        checkArgs: library.requiredArtifacts,
        checkArgCount: library.requiredArtifacts.length,
        requiredArtifactCount: library.requiredArtifacts.length,
      },
    ];
  })
);
const availablePackageMetadataCount = countRecordEntries(availablePackageMetadata);
const resolvePackageReport = (library) => {
  const missingArtifacts = library.requiredArtifacts.filter((artifactPath) => {
    const absoluteArtifactPath = path.resolve(repositoryRoot, artifactPath);
    return !fs.existsSync(absoluteArtifactPath);
  });
  const missingArtifactSet = new Set(missingArtifacts);
  const presentArtifacts = library.requiredArtifacts.filter((artifactPath) => {
    return !missingArtifactSet.has(artifactPath);
  });
  const presentArtifactCount = library.requiredArtifacts.length - missingArtifacts.length;
  const checkArgs = library.requiredArtifacts;
  return {
    packageName: library.packageName,
    packagePath: library.packagePath,
    packageIndex: resolveCheckedPackageIndex(library.packageName),
    requiredArtifacts: library.requiredArtifacts,
    requiredArtifactCount: library.requiredArtifacts.length,
    checkCommand: packageCheckCommand,
    checkArgs,
    checkArgCount: checkArgs.length,
    presentArtifacts,
    presentArtifactCount,
    missingArtifacts,
    missingArtifactCount: missingArtifacts.length,
    artifactsPresent: missingArtifacts.length === 0,
  };
};
const resolvePackageReports = () => {
  return runtimeLibraries.map(resolvePackageReport);
};
const summarizePackageReports = (packageReports) => {
  const presentPackages = packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => packageReport.packageName);
  const presentPackagePaths = packageReports
    .filter((packageReport) => packageReport.artifactsPresent)
    .map((packageReport) => packageReport.packagePath);
  const presentPackagePathMap = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.packagePath];
      })
  );
  const missingPackages = packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => packageReport.packageName);
  const missingPackagePaths = packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => packageReport.packagePath);
  const missingPackagePathMap = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.packagePath];
      })
  );
  const presentPackageCount = packageReports.filter((packageReport) => {
    return packageReport.artifactsPresent;
  }).length;
  const presentPackageIndices = presentPackages.map((packageName) => {
    return resolveCheckedPackageIndex(packageName);
  });
  const presentPackageIndexMap = Object.fromEntries(
    presentPackages.map((packageName) => {
      return [packageName, resolveCheckedPackageIndex(packageName)];
    })
  );
  const presentArtifactCount = packageReports.reduce((count, packageReport) => {
    return count + packageReport.presentArtifactCount;
  }, 0);
  const presentArtifacts = packageReports.reduce((artifacts, packageReport) => {
    return [...artifacts, ...packageReport.presentArtifacts];
  }, []);
  const presentArtifactsByPackage = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.presentArtifacts];
    })
  );
  const presentPackageArtifactsByPackage = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.presentArtifacts];
      })
  );
  const packageCheckCommandMap = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkCommand];
    })
  );
  const packageCheckArgsMap = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkArgs];
    })
  );
  const packageCheckArgCountMap = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.checkArgCount];
    })
  );
  const artifactsPresentByPackage = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.artifactsPresent];
    })
  );
  const packageStatusMap = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [
        packageReport.packageName,
        packageReport.artifactsPresent ? "present" : "missing",
      ];
    })
  );
  const missingPackageCount = packageReports.filter((packageReport) => {
    return packageReport.artifactsPresent === false;
  }).length;
  const missingPackageIndices = missingPackages.map((packageName) => {
    return resolveCheckedPackageIndex(packageName);
  });
  const missingPackageIndexMap = Object.fromEntries(
    missingPackages.map((packageName) => {
      return [packageName, resolveCheckedPackageIndex(packageName)];
    })
  );
  const missingArtifactCount = packageReports.reduce((count, packageReport) => {
    return count + packageReport.missingArtifactCount;
  }, 0);
  const missingArtifacts = packageReports.reduce((artifacts, packageReport) => {
    return [...artifacts, ...packageReport.missingArtifacts];
  }, []);
  const missingArtifactsByPackage = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.missingArtifacts];
    })
  );
  const missingPackageArtifactsByPackage = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.missingArtifacts];
      })
  );
  const presentPackageMetadata = Object.fromEntries(
    packageReports
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
  const presentPackageCheckCommandMap = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkCommand];
      })
  );
  const presentPackageCheckArgsMap = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgs];
      })
  );
  const presentPackageCheckArgCountMap = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgCount];
      })
  );
  const missingPackageMetadata = Object.fromEntries(
    packageReports
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
  const missingPackageCheckCommandMap = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkCommand];
      })
  );
  const missingPackageCheckArgsMap = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgs];
      })
  );
  const missingPackageCheckArgCountMap = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.checkArgCount];
      })
  );
  const presentArtifactCountByPackage = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.presentArtifactCount];
    })
  );
  const presentPackageArtifactCountByPackage = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.presentArtifactCount];
      })
  );
  const missingArtifactCountByPackage = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport.missingArtifactCount];
    })
  );
  const missingPackageArtifactCountByPackage = Object.fromEntries(
    packageReports
      .filter((packageReport) => packageReport.artifactsPresent === false)
      .map((packageReport) => {
        return [packageReport.packageName, packageReport.missingArtifactCount];
      })
  );
  const packageStatusCountMap = {
    present: presentPackageCount,
    missing: missingPackageCount,
  };
  const failureSummaries = packageReports
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
  return {
    presentPackages,
    presentPackagePaths,
    presentPackagePathMap,
    missingPackages,
    missingPackagePaths,
    missingPackagePathMap,
    presentPackageCount,
    presentPackagePathCount: presentPackagePaths.length,
    presentPackagePathMapCount: countRecordEntries(presentPackagePathMap),
    presentPackageIndices,
    presentPackageIndexCount: presentPackageIndices.length,
    presentPackageIndexMap,
    presentPackageIndexMapCount: countRecordEntries(presentPackageIndexMap),
    presentPackageMetadata,
    presentPackageMetadataCount: countRecordEntries(presentPackageMetadata),
    presentPackageCheckCommandMap,
    presentPackageCheckCommandMapCount: countRecordEntries(
      presentPackageCheckCommandMap
    ),
    presentPackageCheckArgsMap,
    presentPackageCheckArgsMapCount: countRecordEntries(presentPackageCheckArgsMap),
    presentPackageCheckArgCountMap,
    presentPackageCheckArgCountMapCount: countRecordEntries(
      presentPackageCheckArgCountMap
    ),
    presentArtifactCount,
    presentArtifacts,
    presentArtifactsByPackage,
    presentPackageArtifactsByPackage,
    presentPackageArtifactsByPackageCount: countRecordEntries(
      presentPackageArtifactsByPackage
    ),
    packageCheckCommandMap,
    packageCheckCommandMapCount: countRecordEntries(packageCheckCommandMap),
    packageCheckArgsMap,
    packageCheckArgsMapCount: countRecordEntries(packageCheckArgsMap),
    packageCheckArgCountMap,
    packageCheckArgCountMapCount: countRecordEntries(packageCheckArgCountMap),
    artifactsPresentByPackage,
    packageStatusMap,
    packageStatusMapCount: countRecordEntries(packageStatusMap),
    packageStatusCountMap,
    packageStatusCountMapCount: countRecordEntries(packageStatusCountMap),
    presentArtifactCountByPackage,
    presentPackageArtifactCountByPackage,
    presentPackageArtifactCountByPackageCount: countRecordEntries(
      presentPackageArtifactCountByPackage
    ),
    missingPackageCount,
    missingPackagePathCount: missingPackagePaths.length,
    missingPackagePathMapCount: countRecordEntries(missingPackagePathMap),
    missingPackageIndices,
    missingPackageIndexCount: missingPackageIndices.length,
    missingPackageIndexMap,
    missingPackageIndexMapCount: countRecordEntries(missingPackageIndexMap),
    missingPackageMetadata,
    missingPackageMetadataCount: countRecordEntries(missingPackageMetadata),
    missingPackageCheckCommandMap,
    missingPackageCheckCommandMapCount: countRecordEntries(
      missingPackageCheckCommandMap
    ),
    missingPackageCheckArgsMap,
    missingPackageCheckArgsMapCount: countRecordEntries(missingPackageCheckArgsMap),
    missingPackageCheckArgCountMap,
    missingPackageCheckArgCountMapCount: countRecordEntries(
      missingPackageCheckArgCountMap
    ),
    missingArtifactCount,
    missingArtifacts,
    missingArtifactsByPackage,
    missingPackageArtifactsByPackage,
    missingPackageArtifactsByPackageCount: countRecordEntries(
      missingPackageArtifactsByPackage
    ),
    missingArtifactCountByPackage,
    missingPackageArtifactCountByPackage,
    missingPackageArtifactCountByPackageCount: countRecordEntries(
      missingPackageArtifactCountByPackage
    ),
    failureSummaries,
    failureSummaryCount: failureSummaries.length,
  };
};
const formatMissingArtifactSummary = (packageReports) => {
  const missingSummaries = packageReports
    .filter((packageReport) => packageReport.artifactsPresent === false)
    .map((packageReport) => {
      return `${packageReport.packageName}: ${packageReport.missingArtifacts.join(", ")}`;
    });
  return missingSummaries.join(" | ");
};

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
const canonicalCliOptions = [
  "--compact",
  "--json",
  "--no-build",
  "--output",
  "--quiet",
];
const isQuiet = cliOptionArgs.includes("--quiet");
const isJson = cliOptionArgs.includes("--json");
const isNoBuild = hasCliOption(cliOptionArgs, "--no-build", noBuildOptionAliases);
const isCompact = cliOptionArgs.includes("--compact");
const jsonFormat = { compact: isCompact };
const buildCommandArgs = [
  "--dir",
  repositoryRoot,
  "--filter",
  "@voxelize/aabb",
  "--filter",
  "@voxelize/raycast",
  "--filter",
  "@voxelize/physics-engine",
  "run",
  "build",
];
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
const withBaseReportFields = (report) => {
  const hasOutputPath = Object.prototype.hasOwnProperty.call(report, "outputPath");
  const packageReports = Array.isArray(report.packageReports)
    ? report.packageReports
    : [];
  const packageReportMap = Object.fromEntries(
    packageReports.map((packageReport) => {
      return [packageReport.packageName, packageReport];
    })
  );
  const packageReportMapCount = countRecordEntries(packageReportMap);
  const missingArtifactSummaryText = formatMissingArtifactSummary(packageReports);
  const missingArtifactSummary =
    missingArtifactSummaryText.length === 0 ? null : missingArtifactSummaryText;
  const {
    presentPackages,
    presentPackagePaths,
    presentPackagePathMap,
    presentPackageIndices,
    presentPackageIndexMap,
    missingPackages,
    missingPackagePaths,
    missingPackagePathMap,
    missingPackageIndices,
    missingPackageIndexMap,
    presentPackageCount,
    presentPackagePathCount,
    presentPackagePathMapCount,
    presentPackageIndexCount,
    presentPackageIndexMapCount,
    presentPackageMetadata,
    presentPackageMetadataCount,
    presentPackageCheckCommandMap,
    presentPackageCheckCommandMapCount,
    presentPackageCheckArgsMap,
    presentPackageCheckArgsMapCount,
    presentPackageCheckArgCountMap,
    presentPackageCheckArgCountMapCount,
    presentArtifactCount,
    presentArtifacts,
    presentArtifactsByPackage,
    presentPackageArtifactsByPackage,
    presentPackageArtifactsByPackageCount,
    packageCheckCommandMap,
    packageCheckCommandMapCount,
    packageCheckArgsMap,
    packageCheckArgsMapCount,
    packageCheckArgCountMap,
    packageCheckArgCountMapCount,
    artifactsPresentByPackage,
    packageStatusMap,
    packageStatusMapCount,
    packageStatusCountMap,
    packageStatusCountMapCount,
    presentArtifactCountByPackage,
    presentPackageArtifactCountByPackage,
    presentPackageArtifactCountByPackageCount,
    missingPackageCount,
    missingPackagePathCount,
    missingPackagePathMapCount,
    missingPackageIndexCount,
    missingPackageIndexMapCount,
    missingPackageMetadata,
    missingPackageMetadataCount,
    missingPackageCheckCommandMap,
    missingPackageCheckCommandMapCount,
    missingPackageCheckArgsMap,
    missingPackageCheckArgsMapCount,
    missingPackageCheckArgCountMap,
    missingPackageCheckArgCountMapCount,
    missingArtifactCount,
    missingArtifacts,
    missingArtifactsByPackage,
    missingPackageArtifactsByPackage,
    missingPackageArtifactsByPackageCount,
    missingArtifactCountByPackage,
    missingPackageArtifactCountByPackage,
    missingPackageArtifactCountByPackageCount,
    failureSummaries,
    failureSummaryCount,
  } = summarizePackageReports(packageReports);
  const buildExitCode =
    typeof report.buildExitCode === "number" ? report.buildExitCode : null;
  const buildDurationMs =
    typeof report.buildDurationMs === "number" ? report.buildDurationMs : null;
  const buildSkippedReason =
    report.buildSkippedReason === "no-build" ||
    report.buildSkippedReason === "artifacts-present"
      ? report.buildSkippedReason
      : null;
  return {
    ...report,
    optionTerminatorUsed,
    positionalArgs,
    positionalArgCount,
    noBuild: isNoBuild,
    outputPath: hasOutputPath ? report.outputPath : outputPath,
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
    checkedPackages,
    checkedPackagePaths,
    checkedPackageIndices,
    checkedPackageIndexCount: checkedPackageIndices.length,
    checkedPackageIndexMap,
    checkedPackagePathMap,
    checkedPackageCount: checkedPackages.length,
    checkedPackagePathCount: checkedPackagePaths.length,
    checkedPackageIndexMapCount,
    checkedPackagePathMapCount,
    availablePackages: checkedPackages,
    availablePackageCount: checkedPackages.length,
    availablePackagePaths: checkedPackagePaths,
    availablePackagePathCount: checkedPackagePaths.length,
    availablePackageIndices,
    availablePackageIndexCount: availablePackageIndices.length,
    availablePackageIndexMap,
    availablePackageIndexMapCount,
    availablePackagePathMap,
    availablePackagePathMapCount,
    availablePackageCheckCommandMap,
    availablePackageCheckCommandMapCount,
    availablePackageCheckArgsMap,
    availablePackageCheckArgsMapCount,
    availablePackageCheckArgCountMap,
    availablePackageCheckArgCountMapCount,
    availablePackageMetadata,
    availablePackageMetadataCount,
    presentPackages,
    presentPackagePaths,
    presentPackagePathMap,
    presentPackageIndices,
    presentPackageIndexMap,
    presentPackageMetadata,
    presentPackageCheckCommandMap,
    presentPackageCheckArgsMap,
    presentPackageCheckArgCountMap,
    missingPackages,
    missingPackagePaths,
    missingPackagePathMap,
    missingPackageIndices,
    missingPackageIndexMap,
    missingPackageMetadata,
    missingPackageCheckCommandMap,
    missingPackageCheckArgsMap,
    missingPackageCheckArgCountMap,
    requiredPackageCount: runtimeLibraries.length,
    presentPackageCount,
    presentPackagePathCount,
    presentPackagePathMapCount,
    presentPackageIndexCount,
    presentPackageIndexMapCount,
    presentPackageMetadataCount,
    presentPackageCheckCommandMapCount,
    presentPackageCheckArgsMapCount,
    presentPackageCheckArgCountMapCount,
    packageReportCount: packageReports.length,
    packageReportMap,
    packageReportMapCount,
    requiredArtifactsByPackage,
    requiredArtifacts,
    requiredArtifactsByPackageCount,
    requiredArtifactCountByPackage,
    requiredArtifactCount,
    requiredArtifactCountByPackageCount,
    presentArtifactCount,
    presentArtifacts,
    presentArtifactsByPackage,
    presentPackageArtifactsByPackage,
    packageCheckCommandMap,
    packageCheckCommandMapCount,
    packageCheckArgsMap,
    packageCheckArgsMapCount,
    packageCheckArgCountMap,
    packageCheckArgCountMapCount,
    artifactsPresentByPackage,
    packageStatusMap,
    packageStatusMapCount,
    packageStatusCountMap,
    packageStatusCountMapCount,
    presentArtifactCountByPackage,
    presentPackageArtifactCountByPackage,
    missingPackageCount,
    missingPackagePathCount,
    missingPackagePathMapCount,
    missingPackageIndexCount,
    missingPackageIndexMapCount,
    missingPackageMetadataCount,
    missingPackageCheckCommandMapCount,
    missingPackageCheckArgsMapCount,
    missingPackageCheckArgCountMapCount,
    missingArtifactCount,
    missingArtifacts,
    missingArtifactsByPackage,
    missingPackageArtifactsByPackage,
    missingArtifactCountByPackage,
    missingPackageArtifactCountByPackage,
    failureSummaries,
    failureSummaryCount,
    presentArtifactsByPackageCount: countRecordEntries(presentArtifactsByPackage),
    presentPackageArtifactsByPackageCount,
    artifactsPresentByPackageCount: countRecordEntries(artifactsPresentByPackage),
    presentArtifactCountByPackageCount: countRecordEntries(
      presentArtifactCountByPackage
    ),
    presentPackageArtifactCountByPackageCount,
    missingArtifactsByPackageCount: countRecordEntries(missingArtifactsByPackage),
    missingPackageArtifactsByPackageCount,
    missingArtifactCountByPackageCount: countRecordEntries(
      missingArtifactCountByPackage
    ),
    missingPackageArtifactCountByPackageCount,
    missingArtifactSummary,
    buildCommand: pnpmCommand,
    buildArgs: buildCommandArgs,
    buildExitCode,
    buildDurationMs,
    buildSkippedReason,
  };
};
const finish = (report) => {
  if (isJson) {
    const finalizedReport = buildTimedReport(
      withBaseReportFields({
        ...report,
        validationErrorCode: null,
      })
    );
    const { reportJson, writeError } = serializeReportWithOptionalWrite(
      finalizedReport,
      {
        jsonFormat,
        outputPath,
        buildTimedReport,
      }
    );

    console.log(reportJson);
    process.exit(writeError === null ? report.exitCode : 1);
  }

  if (!report.passed) {
    console.error(report.message);
  } else if (!isQuiet) {
    console.log(report.message);
  }

  process.exit(report.exitCode);
};

if (isJson && validationFailureMessage !== null) {
  const packageReports = resolvePackageReports();
  const { missingPackageCount } = summarizePackageReports(packageReports);
  const report = buildTimedReport(
    withBaseReportFields({
      passed: false,
      exitCode: 1,
      outputPath: outputPathError === null ? outputPath : null,
      packagesPresent: missingPackageCount === 0,
      packageReports,
      attemptedBuild: false,
      buildSkipped: isNoBuild,
      buildSkippedReason: isNoBuild ? "no-build" : null,
      buildOutput: null,
      validationErrorCode,
      message: validationFailureMessage,
    })
  );
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

const initialPackageReports = resolvePackageReports();
const initialSummary = summarizePackageReports(initialPackageReports);
if (initialSummary.missingPackageCount === 0) {
  finish({
    passed: true,
    exitCode: 0,
    packagesPresent: true,
    packageReports: initialPackageReports,
    attemptedBuild: false,
    buildSkipped: true,
    buildSkippedReason: "artifacts-present",
    buildOutput: null,
    message: "Runtime library build artifacts are available.",
  });
}

if (isNoBuild) {
  finish({
    passed: false,
    exitCode: 1,
    packagesPresent: false,
    packageReports: initialPackageReports,
    attemptedBuild: false,
    buildSkipped: true,
    buildSkippedReason: "no-build",
    buildOutput: null,
    message: `Missing runtime library artifacts: ${formatMissingArtifactSummary(initialPackageReports)}. Build was skipped due to --no-build. Run \`pnpm --filter @voxelize/aabb --filter @voxelize/raycast --filter @voxelize/physics-engine run build\` from the repository root.`,
  });
}

if (!isJson && !isQuiet) {
  console.log(
    "Runtime library artifacts missing. Running package builds for @voxelize/aabb, @voxelize/raycast, and @voxelize/physics-engine..."
  );
}

const buildStartedAt = Date.now();
const buildResult = isJson
  ? spawnSync(pnpmCommand, buildCommandArgs, {
      encoding: "utf8",
      shell: false,
      cwd: repositoryRoot,
    })
  : spawnSync(pnpmCommand, buildCommandArgs, {
      stdio: "inherit",
      shell: false,
      cwd: repositoryRoot,
    });
const buildDurationMs = Date.now() - buildStartedAt;
const buildExitCode = buildResult.status ?? 1;
const buildOutput = `${buildResult.stdout ?? ""}${buildResult.stderr ?? ""}`.trim();
const packageReportsAfterBuild = resolvePackageReports();
const summaryAfterBuild = summarizePackageReports(packageReportsAfterBuild);
if (buildExitCode === 0 && summaryAfterBuild.missingPackageCount === 0) {
  finish({
    passed: true,
    exitCode: 0,
    packagesPresent: true,
    packageReports: packageReportsAfterBuild,
    attemptedBuild: true,
    buildSkipped: false,
    buildSkippedReason: null,
    buildOutput: isJson ? buildOutput : null,
    buildExitCode,
    buildDurationMs,
    message: "Runtime library build artifacts are available.",
  });
}

finish({
  passed: false,
  exitCode: buildExitCode,
  packagesPresent: false,
  packageReports: packageReportsAfterBuild,
  attemptedBuild: true,
  buildSkipped: false,
  buildSkippedReason: null,
  buildOutput: isJson ? buildOutput : null,
  buildExitCode,
  buildDurationMs,
  message:
    summaryAfterBuild.missingPackageCount === 0
      ? "Failed to build runtime libraries."
      : `Failed to generate required runtime library artifacts: ${formatMissingArtifactSummary(packageReportsAfterBuild)}.`,
});
