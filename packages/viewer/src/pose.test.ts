import { describe, expect, it } from "vitest";

import { chunksAround, nearRadiusFor } from "./lod";
import {
  applyOptionPairs,
  DEFAULT_OPTIONS,
  parseOptions,
  serializeOptions,
} from "./options";
import {
  formatVec,
  ISO_PITCH,
  orbitFromPose,
  parseVec,
  poseFromOrbit,
  presetOrbit,
  presetProjection,
  standInPose,
  type Vec3,
} from "./pose";

const close = (a: Vec3, b: Vec3) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("pose", () => {
  it("round-trips a pose through an orbit", () => {
    const pose = { eye: [120, 180, -40] as Vec3, look: [20, 90, 16] as Vec3 };
    const back = poseFromOrbit(orbitFromPose(pose));
    close(back.eye, pose.eye);
    close(back.look, pose.look);
  });

  it("frames isometric views on a diagonal at the true isometric pitch", () => {
    const orbit = presetOrbit("iso", [0, 80, 0], 256, 0.3);
    expect(orbit.pitch).toBeCloseTo(ISO_PITCH, 9);
    expect(Math.abs(Math.sin(2 * orbit.yaw))).toBeCloseTo(1, 9);
    expect(presetProjection("iso")).toBe("orthographic");
    expect(presetProjection("free")).toBe("perspective");
  });

  it("gives an orthographic frame an eye a game camera can stand at", () => {
    const pose = standInPose({ eye: [0, 6000, 1], look: [10, 80, 10] }, 40);
    expect(pose.look).toEqual([10, 80, 10]);
    expect(
      Math.hypot(pose.eye[0] - 10, pose.eye[1] - 80, pose.eye[2] - 10),
    ).toBeCloseTo(40, 6);
  });

  it("parses and prints vectors", () => {
    expect(parseVec(" 1, -2.5 ,3 ")).toEqual([1, -2.5, 3]);
    expect(() => parseVec("1,2")).toThrow();
    expect(formatVec([1.04, -0.0001, 3], 1)).toBe("1,0,3");
  });
});

describe("options", () => {
  it("applies the CLI's key=value toggles", () => {
    const options = applyOptionPairs(DEFAULT_OPTIONS, [
      "water=off",
      "fog=game",
      "time=0.75",
      "overlays=biome,grid",
    ]);
    expect(options.water).toBe(false);
    expect(options.fog).toBe("game");
    expect(options.time).toBe(0.75);
    expect(options.overlays).toEqual(["biome", "grid"]);
    const more = applyOptionPairs(options, "overlays=+contours,-grid");
    expect(more.overlays).toEqual(["biome", "contours"]);
  });

  it("refuses unknown keys and bad values loudly", () => {
    expect(() => applyOptionPairs(DEFAULT_OPTIONS, "watr=off")).toThrow(
      /unknown option/,
    );
    expect(() => applyOptionPairs(DEFAULT_OPTIONS, "water=maybe")).toThrow(
      /on or off/,
    );
    expect(() => applyOptionPairs(DEFAULT_OPTIONS, "fog=thick")).toThrow(
      /fog takes/,
    );
  });

  it("serializes only what differs and parses it back", () => {
    const options = applyOptionPairs(DEFAULT_OPTIONS, [
      "plants=off",
      "overlays=landform",
    ]);
    const params = serializeOptions(options);
    expect(params).toEqual({ plants: "off", overlays: "landform" });
    expect(parseOptions(new URLSearchParams(params))).toEqual(options);
  });
});

describe("lod", () => {
  it("lists the chunks of a disc nearest first", () => {
    const chunks = chunksAround(10, -4, 2);
    expect(chunks[0]).toEqual([10, -4]);
    expect(chunks).toContainEqual([12, -4]);
    expect(chunks).not.toContainEqual([12, -2]);
    const distances = chunks.map(([x, z]) => (x - 10) ** 2 + (z + 4) ** 2);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("sizes the disc to the frame within the budget", () => {
    expect(nearRadiusFor({ span: 64, chunkSize: 16, max: 12 })).toBe(3);
    expect(nearRadiusFor({ span: 4000, chunkSize: 16, max: 12 })).toBe(12);
    expect(nearRadiusFor({ span: 4, chunkSize: 16, max: 12 })).toBe(2);
  });
});
