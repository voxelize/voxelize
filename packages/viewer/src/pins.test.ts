import { describe, expect, it } from "vitest";

import { glyph } from "./pin-art";
import {
  buildGeometry,
  layoutAtlas,
  PIN_PARTS,
  PIN_TEXELS_PER_BLOCK,
} from "./pin-model";
import {
  formatCoordinates,
  measure,
  pinFromUrl,
  serializePin,
  standingPose,
} from "./pins";
import { sectorAt, slotOffset } from "./wheel";

describe("measure", () => {
  it("reports run, rise, distance and slope", () => {
    const m = measure([0, 64, 0], [3, 68, 0]);
    expect(m.horizontal).toBeCloseTo(3, 9);
    expect(m.rise).toBeCloseTo(4, 9);
    expect(m.distance).toBeCloseTo(5, 9);
    expect(m.slopePercent).toBeCloseTo(133.333, 2);
    expect(m.slopeDegrees).toBeCloseTo(53.13, 2);
    expect(measure([5, 70, 5], [2, 66, 1]).rise).toBeCloseTo(-4, 9);
  });

  it("has no slope percentage for two points in one column", () => {
    const m = measure([1, 60, 1], [1, 70, 1]);
    expect(m.slopePercent).toBeNull();
    expect(m.slopeDegrees).toBeCloseTo(90, 9);
  });
});

describe("standingPose", () => {
  it("stands at the block's centre with the eyes over its top face, looking along the camera's heading", () => {
    const pose = standingPose([10.8, 70, -3.2], 0, 1.5);
    expect(pose.eye).toEqual([10.5, 71.5, -3.5]);
    expect(pose.look[1]).toBe(71.5);
    expect(pose.look[2]).toBeLessThan(pose.eye[2]);
    expect(pose.look[0]).toBeCloseTo(pose.eye[0], 9);
    const west = standingPose([0, 64, 0], Math.PI / 2, 1.5);
    expect(west.look[0]).toBeLessThan(west.eye[0]);
  });

  it("prints a column the way a chat command takes it", () => {
    expect(formatCoordinates([-106.4, 108.6, 127.9])).toBe("-107 109 127");
  });
});

describe("the pin in a URL", () => {
  it("round-trips its point as pin=x,y,z", () => {
    const text = serializePin([-106.25, 109, 127.5]);
    expect(text).toBe("-106.3,109,127.5");
    expect(pinFromUrl(`?a=new&pin=${text}`)).toEqual([-106.3, 109, 127.5]);
  });

  it("takes the first pin of a link from before there was one", () => {
    expect(pinFromUrl("?pins=A:-106.3,109,127.5;camp%3B%202:1,2,3")).toEqual([
      -106.3, 109, 127.5,
    ]);
    expect(pinFromUrl("?pin=4,5,6&pins=A:1,2,3")).toEqual([4, 5, 6]);
  });

  it("carries none when the link has none, and refuses what it cannot read", () => {
    expect(pinFromUrl("?a=new")).toBeNull();
    expect(pinFromUrl("?pin=")).toBeNull();
    expect(() => pinFromUrl("?pin=1,2")).toThrow(/x,y,z in pin/);
    expect(() => pinFromUrl("?pins=A:1,x,3")).toThrow(/x,y,z in pins/);
  });
});

describe("wheel geometry", () => {
  it("picks the slot a flick points at, slot 0 straight up, clockwise", () => {
    expect(sectorAt(0, -50, 8, 18)).toBe(0);
    expect(sectorAt(40, -40, 8, 18)).toBe(1);
    expect(sectorAt(50, 0, 8, 18)).toBe(2);
    expect(sectorAt(40, 40, 8, 18)).toBe(3);
    expect(sectorAt(0, 50, 8, 18)).toBe(4);
    expect(sectorAt(-50, 0, 8, 18)).toBe(6);
    expect(sectorAt(-30, -45, 8, 18)).toBe(7);
    expect(sectorAt(5, -10, 8, 18)).toBeNull();
  });

  it("lays slots out round the hub from the top", () => {
    expect(slotOffset(0, 8, 76)).toEqual([0, -76]);
    expect(slotOffset(2, 8, 76)).toEqual([76, 0]);
    expect(slotOffset(4, 8, 76)).toEqual([0, 76]);
  });
});

describe("pin model", () => {
  it("packs every face into the atlas without overlap", () => {
    const { rects, width, height } = layoutAtlas(PIN_PARTS);
    expect(rects).toHaveLength(PIN_PARTS.length * 6);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(width);
      expect(r.y + r.h).toBeLessThanOrEqual(height);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const apart =
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("shows every face at 16 texels per block on both axes", () => {
    const { rects, width, height } = layoutAtlas(PIN_PARTS);
    const geometry = buildGeometry(rects, width, height);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    for (let face = 0; face < rects.length; face++) {
      const at = (i: number) => [
        position.getX(face * 4 + i),
        position.getY(face * 4 + i),
        position.getZ(face * 4 + i),
      ];
      const [a, b, , d] = [0, 1, 2, 3].map(at);
      const across = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const up = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
      const uSpan = (uv.getX(face * 4 + 1) - uv.getX(face * 4)) * width;
      const vSpan = (uv.getY(face * 4 + 3) - uv.getY(face * 4)) * height;
      expect(uSpan).toBeCloseTo(across * PIN_TEXELS_PER_BLOCK, 4);
      expect(vSpan).toBeCloseTo(up * PIN_TEXELS_PER_BLOCK, 4);
    }
  });

  it("letters the banner from a 3x5 set", () => {
    expect(glyph("a")).toHaveLength(15);
    expect(glyph("B")?.filter(Boolean)).toHaveLength(10);
    expect(glyph("?")).toBeNull();
  });
});
