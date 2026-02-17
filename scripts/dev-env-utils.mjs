import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MINIMUM_VERSIONS = {
  node: [18, 0, 0],
  pnpm: [10, 0, 0],
};

export const parseSemver = (value) => {
  const match = value.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return [
    Number(match[1]),
    Number(match[2] ?? "0"),
    Number(match[3] ?? "0"),
  ];
};

export const isSemverAtLeast = (version, minimumVersion) => {
  for (let index = 0; index < minimumVersion.length; index += 1) {
    if (version[index] > minimumVersion[index]) {
      return true;
    }

    if (version[index] < minimumVersion[index]) {
      return false;
    }
  }

  return true;
};

export const formatSemver = (version) => {
  return `${version[0]}.${version[1]}.${version[2]}`;
};

export const toMajorMinimumVersion = (version) => {
  return [version[0], 0, 0];
};

export const loadWorkspaceMinimumVersions = (workspaceRoot) => {
  try {
    const packageJsonPath = path.resolve(workspaceRoot, "package.json");
    const packageJsonRaw = fs.readFileSync(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw);

    const configuredNodeVersion =
      typeof packageJson.engines?.node === "string"
        ? parseSemver(packageJson.engines.node)
        : null;
    const configuredPnpmVersion =
      typeof packageJson.packageManager === "string"
        ? parseSemver(packageJson.packageManager)
        : null;

    return {
      node: configuredNodeVersion ?? DEFAULT_MINIMUM_VERSIONS.node,
      pnpm:
        configuredPnpmVersion === null
          ? DEFAULT_MINIMUM_VERSIONS.pnpm
          : toMajorMinimumVersion(configuredPnpmVersion),
    };
  } catch {
    return DEFAULT_MINIMUM_VERSIONS;
  }
};
