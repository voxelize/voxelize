import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MINIMUM_VERSIONS,
  formatSemver,
  isSemverAtLeast,
  loadWorkspaceMinimumVersions,
  parseSemver,
  toMajorMinimumVersion,
} from "../scripts/dev-env-utils.mjs";

const tempDirectories: string[] = [];
const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = path.resolve(testDirectory, "..");

afterEach(() => {
  for (const tempDirectory of tempDirectories) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }

  tempDirectories.length = 0;
});

describe("dev-env-utils", () => {
  it("parses semver values from command and metadata strings", () => {
    expect(parseSemver("v22.22.0")).toEqual([22, 22, 0]);
    expect(parseSemver(">=18")).toEqual([18, 0, 0]);
    expect(parseSemver("pnpm@10.9.0")).toEqual([10, 9, 0]);
    expect(parseSemver("no semver here")).toBeNull();
  });

  it("compares semver values correctly", () => {
    expect(isSemverAtLeast([22, 0, 0], [18, 0, 0])).toBe(true);
    expect(isSemverAtLeast([10, 8, 0], [10, 9, 0])).toBe(false);
    expect(isSemverAtLeast([10, 9, 0], [10, 9, 0])).toBe(true);
  });

  it("formats and normalizes semver values", () => {
    expect(formatSemver([10, 9, 0])).toBe("10.9.0");
    expect(toMajorMinimumVersion([10, 9, 3])).toEqual([10, 0, 0]);
  });

  it("loads minimum versions from workspace metadata", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-")
    );
    tempDirectories.push(tempDirectory);

    fs.writeFileSync(
      path.resolve(tempDirectory, "package.json"),
      JSON.stringify(
        {
          engines: { node: ">=20.2.0" },
          packageManager: "pnpm@10.9.0",
        },
        null,
        2
      )
    );

    expect(loadWorkspaceMinimumVersions(tempDirectory)).toEqual({
      node: [20, 2, 0],
      pnpm: [10, 0, 0],
    });
  });

  it("falls back to defaults when package metadata is unavailable", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "voxelize-dev-env-missing-")
    );
    tempDirectories.push(tempDirectory);

    expect(loadWorkspaceMinimumVersions(tempDirectory)).toEqual(
      DEFAULT_MINIMUM_VERSIONS
    );
  });

  it("reads workspace metadata defaults from repository package.json", () => {
    expect(loadWorkspaceMinimumVersions(workspaceRoot)).toEqual({
      node: [18, 0, 0],
      pnpm: [10, 0, 0],
    });
  });
});
