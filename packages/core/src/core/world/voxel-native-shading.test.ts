import { describe, expect, it } from "vitest";

import {
  band,
  installVoxelNativeShaderChunk,
  snapLengthToTexels,
  snapToTexel,
  stepTime,
  VOXEL_NATIVE_CHUNK_NAME,
  VOXEL_NATIVE_GLSL,
} from "./voxel-native-shading";

describe("snapToTexel", () => {
  it("lands every point of a texel on that texel's centre", () => {
    expect(snapToTexel(0, 16)).toBeCloseTo(0.5 / 16);
    expect(snapToTexel(0.06, 16)).toBeCloseTo(0.5 / 16);
    expect(snapToTexel(0.0626, 16)).toBeCloseTo(1.5 / 16);
    expect(snapToTexel(-0.01, 16)).toBeCloseTo(-0.5 / 16);
  });

  it("changes value only at texel edges", () => {
    const values = new Set<number>();
    for (let i = 0; i < 160; i += 1) values.add(snapToTexel(i / 160, 16));
    expect(values.size).toBe(16);
  });
});

describe("band", () => {
  it("steps a ramp into flat levels, 0 and 1 included", () => {
    expect([0, 0.2, 0.34, 0.5, 0.66, 0.67, 1].map((x) => band(x, 3))).toEqual([
      0, 0, 0.5, 0.5, 0.5, 1, 1,
    ]);
  });

  it("is a hard threshold at one half with two steps", () => {
    expect(band(0.49, 2)).toBe(0);
    expect(band(0.5, 2)).toBe(1);
  });

  it("clamps out-of-range input and survives a single step", () => {
    expect(band(-3, 4)).toBe(0);
    expect(band(7, 4)).toBe(1);
    expect(band(0.8, 1)).toBe(0);
  });

  it("never produces more distinct levels than steps", () => {
    const levels = new Set<number>();
    for (let i = 0; i <= 1000; i += 1) levels.add(band(i / 1000, 4));
    expect([...levels].sort()).toEqual([0, 1 / 3, 2 / 3, 1]);
  });
});

describe("stepTime", () => {
  it("holds each frame for its whole duration", () => {
    expect(stepTime(0.0, 8)).toBe(0);
    expect(stepTime(0.124, 8)).toBe(0);
    expect(stepTime(0.125, 8)).toBe(0.125);
    expect(stepTime(1.3, 8)).toBe(1.25);
  });
});

describe("snapLengthToTexels", () => {
  it("rounds to whole texels and never below one", () => {
    expect(snapLengthToTexels(0.5, 16)).toBe(0.5);
    expect(snapLengthToTexels(0.52, 16)).toBe(0.5);
    expect(snapLengthToTexels(0.001, 16)).toBe(1 / 16);
  });
});

describe("the GLSL chunk", () => {
  it("declares every function the mirror implements", () => {
    for (const signature of [
      "float snapToTexel(float p, float texelsPerUnit)",
      "vec2 snapToTexel(vec2 p, float texelsPerUnit)",
      "vec3 snapToTexel(vec3 p, float texelsPerUnit)",
      "float band(float x, float steps)",
      "float stepTime(float t, float framesPerSecond)",
    ]) {
      expect(VOXEL_NATIVE_GLSL).toContain(signature);
    }
  });

  it("installs under its include name", () => {
    const chunks: Record<string, string> = {};
    installVoxelNativeShaderChunk(chunks);
    installVoxelNativeShaderChunk(chunks);
    expect(chunks[VOXEL_NATIVE_CHUNK_NAME]).toBe(VOXEL_NATIVE_GLSL);
    expect(Object.keys(chunks)).toEqual([VOXEL_NATIVE_CHUNK_NAME]);
  });
});
