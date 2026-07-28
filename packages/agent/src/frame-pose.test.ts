import { describe, expect, it } from "vitest";

import {
  DEFAULT_FRAME_DISTANCE_MULTIPLIER,
  DEFAULT_SUBJECT_EXTENT,
  MIN_FRAME_DISTANCE,
  computeFramePose,
  facingYawRad,
  subjectExtent,
} from "./frame-pose";

const position = { x: 10, y: 64, z: -5 };

describe("subjectExtent", () => {
  it("prefers the live debug AABB", () => {
    const metadata = {
      size: 0.5,
      debug: {
        aabb: {
          minX: 0,
          minY: 0,
          minZ: 0,
          maxX: 2,
          maxY: 1,
          maxZ: 0.5,
        },
      },
    };
    expect(subjectExtent(metadata)).toBe(2);
  });

  it("falls back to the scalar size, then the default", () => {
    expect(subjectExtent({ size: 1.5 })).toBe(1.5);
    expect(subjectExtent({})).toBe(DEFAULT_SUBJECT_EXTENT);
    expect(subjectExtent({ size: -3 })).toBe(DEFAULT_SUBJECT_EXTENT);
  });
});

describe("facingYawRad", () => {
  it("reads the replicated direction vector", () => {
    expect(facingYawRad({ direction: [1, 0, 0] })).toBeCloseTo(0);
    expect(facingYawRad({ direction: [0, 0, 1] })).toBeCloseTo(Math.PI / 2);
  });

  it("returns null when absent or degenerate", () => {
    expect(facingYawRad({})).toBeNull();
    expect(facingYawRad({ direction: [0, 1, 0] })).toBeNull();
  });
});

describe("computeFramePose", () => {
  it("scales distance from the subject extent and multiplier", () => {
    const pose = computeFramePose({
      position,
      metadata: { size: 4 },
      preset: "side",
    });
    expect(pose.distance).toBe(4 * DEFAULT_FRAME_DISTANCE_MULTIPLIER);
    expect(pose.subjectExtent).toBe(4);
  });

  it("clamps tiny subjects to the minimum distance", () => {
    const pose = computeFramePose({
      position,
      metadata: { size: 0.2 },
      preset: "portrait",
    });
    expect(pose.distance).toBe(MIN_FRAME_DISTANCE);
  });

  it("honors an absolute distance override", () => {
    const pose = computeFramePose({
      position,
      metadata: { size: 4 },
      preset: "side",
      distance: 7,
    });
    expect(pose.distance).toBe(7);
  });

  it("places side shots perpendicular to the facing direction", () => {
    const pose = computeFramePose({
      position,
      metadata: { size: 1, direction: [1, 0, 0] },
      preset: "side",
    });
    // Facing +x, so a side shot stands along +z of the subject.
    expect(pose.from.x).toBeCloseTo(position.x, 1);
    expect(pose.from.z).toBeGreaterThan(position.z);
    expect(pose.lookAt).toEqual(position);
  });

  it("puts top shots high above the subject", () => {
    const pose = computeFramePose({
      position,
      metadata: {},
      preset: "top",
    });
    expect(pose.from.y - position.y).toBeGreaterThan(pose.distance * 0.9);
  });

  it("uses the explicit azimuth for orbit shots", () => {
    const east = computeFramePose({
      position,
      metadata: { direction: [0, 0, 1] },
      preset: "side",
      azimuthDeg: 0,
    });
    expect(east.from.x).toBeGreaterThan(position.x);
    expect(east.from.z).toBeCloseTo(position.z, 1);
    const west = computeFramePose({
      position,
      metadata: {},
      preset: "side",
      azimuthDeg: 180,
    });
    expect(west.from.x).toBeLessThan(position.x);
  });
});
