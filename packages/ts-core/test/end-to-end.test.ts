import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parseJsonOutput } from "../../../scripts/report-utils.mjs";

type ExampleOutput = {
  voxel: {
    id: number;
    rotation: {
      value: number;
      yRotation: number;
    };
    stage: number;
  };
  light: {
    sunlight: number;
    red: number;
    green: number;
    blue: number;
  };
  rotatedAabb: {
    min: [number, number, number];
    max: [number, number, number];
  };
  ruleMatched: boolean;
  patternMatched: boolean;
};

const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const packageDirectory = path.resolve(testDirectory, "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

describe("ts-core end-to-end example", () => {
  it("runs the package example script successfully", () => {
    const result = spawnSync(pnpmCommand, ["run", "example:end-to-end"], {
      cwd: packageDirectory,
      encoding: "utf8",
      shell: false,
    });
    const parsed = parseJsonOutput(`${result.stdout}${result.stderr}`) as
      | ExampleOutput
      | null;

    expect(result.status).toBe(0);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      throw new Error("Expected JSON output from ts-core example script.");
    }
    expect(parsed.voxel.id).toBe(42);
    expect(parsed.voxel.stage).toBe(7);
    expect(parsed.voxel.rotation.value).toBe(0);
    expect(Number.isInteger(parsed.voxel.rotation.value)).toBe(true);
    expect(parsed.voxel.rotation.value).toBeGreaterThanOrEqual(0);
    expect(parsed.voxel.rotation.value).toBeLessThanOrEqual(5);
    expect(parsed.voxel.rotation.yRotation).toBeGreaterThan(0);
    expect(Number.isFinite(parsed.voxel.rotation.yRotation)).toBe(true);
    expect(parsed.light).toEqual({
      sunlight: 15,
      red: 10,
      green: 5,
      blue: 3,
    });
    for (const channelValue of Object.values(parsed.light)) {
      expect(Number.isInteger(channelValue)).toBe(true);
      expect(channelValue).toBeGreaterThanOrEqual(0);
      expect(channelValue).toBeLessThanOrEqual(15);
    }
    expect(parsed.rotatedAabb.min).toHaveLength(3);
    expect(parsed.rotatedAabb.max).toHaveLength(3);
    expect(parsed.rotatedAabb.min.every((value) => Number.isFinite(value))).toBe(
      true
    );
    expect(parsed.rotatedAabb.max.every((value) => Number.isFinite(value))).toBe(
      true
    );
    expect(parsed.rotatedAabb.min[0]).toBeLessThan(parsed.rotatedAabb.max[0]);
    expect(parsed.rotatedAabb.min[1]).toBeLessThan(parsed.rotatedAabb.max[1]);
    expect(parsed.rotatedAabb.min[2]).toBeLessThan(parsed.rotatedAabb.max[2]);
    expect(parsed.ruleMatched).toBe(true);
    expect(parsed.patternMatched).toBe(true);
  });
});
