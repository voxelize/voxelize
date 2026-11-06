import type { GeometryProtocol } from "@voxelize/protocol";
import { BufferAttribute, BufferGeometry } from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { describe, expect, it } from "vitest";

import { biomeTintAttribute } from "./biome-tint";
import {
  BYTE_VECTOR_STRIDE,
  POSITION_STRIDE,
  packQuantizedPositions,
  padByteVectors,
} from "./vertex-layout";
import {
  mergeSectionGeometries,
  ownMergeStorage,
  ScratchMergeStorage,
} from "./chunk-geometry-merge";
import { computeQuadLightTwist } from "./quad-light";

/** The value, or the test fails here naming what was missing. */
const must = <T>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`no ${what}`);
  return value;
};

const UNITS = 16;
const BIAS = 2;
const CORNERS = new Uint8Array([
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
]);

/** `quads` quantized quads of `voxel`, half of them tinted (sign bit set). */
const part = (voxel: number, quads: number, seed: number): GeometryProtocol => {
  const positions = new Uint16Array(quads * 12);
  const uvs = new Uint16Array(quads * 8);
  const lights = new Int32Array(quads * 4) as unknown as Uint32Array;
  const normals = new Int8Array(quads * 12);
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    for (let v = 0; v < 4; v++) {
      const i = q * 4 + v;
      positions[i * 3] = (BIAS + ((q + seed) % 16) + (v & 1)) * UNITS;
      positions[i * 3 + 1] = (BIAS + 3) * UNITS;
      positions[i * 3 + 2] = (BIAS + ((q * 3 + seed) % 16) + (v >> 1)) * UNITS;
      uvs[i * 2] = (v & 1) * 65535;
      uvs[i * 2 + 1] = (v >> 1) * 65535;
      lights[i] = (q % 2 === 0 ? 0x80000000 : 0) | ((q * 7 + v) & 0xfff);
      normals[i * 3 + 1] = 127;
    }
    const n = q * 4;
    indices.set([n, n + 1, n + 3, n + 3, n + 2, n], q * 6);
  }
  return {
    voxel,
    positions,
    uvs,
    lights,
    normals,
    indices,
    lightTwist: computeQuadLightTwist(lights, indices),
  };
};

/** One part as the world builds it alone (`makeChunkBufferGeometry`). */
const single = (geo: GeometryProtocol, sway: number) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      packQuantizedPositions(geo.positions, sway),
      POSITION_STRIDE,
    ),
  );
  geometry.setAttribute("uv", new BufferAttribute(geo.uvs, 2, true));
  geometry.setAttribute("light", new BufferAttribute(geo.lights, 1));
  geometry.setAttribute(
    "lightTwist",
    new BufferAttribute(must(geo.lightTwist, "lightTwist"), 4),
  );
  geometry.setAttribute(
    "biomeTint",
    biomeTintAttribute(geo.positions, geo.lights, CORNERS, 16, UNITS, BIAS),
  );
  geometry.setIndex(new BufferAttribute(geo.indices, 1));
  geometry.setAttribute(
    "normal",
    new BufferAttribute(
      padByteVectors(must(geo.normals, "normals") as Int8Array),
      BYTE_VECTOR_STRIDE,
      true,
    ),
  );
  return geometry;
};

const arrays = (geometry: BufferGeometry) => {
  const out: Record<string, number[]> = {};
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    out[name] = Array.from(attribute.array as ArrayLike<number>);
  }
  out.index = Array.from(
    must(geometry.getIndex(), "index").array as ArrayLike<number>,
  );
  return out;
};

describe("mergeSectionGeometries", () => {
  const parts = [part(5, 7, 1), part(9, 3, 4), part(5, 11, 9)];
  const sways = new Map([
    [5, 2],
    [9, 6],
  ]);
  const extras = {
    biomeCorners: CORNERS,
    chunkSize: 16,
    positionUnits: UNITS,
    positionBias: BIAS,
    swayProfileOf: (voxel: number) => sways.get(voxel) ?? 0,
  };

  it("writes what building each part and merging them gives", () => {
    const expected = must(
      mergeGeometries(
        parts.map((geo) => single(geo, sways.get(geo.voxel) ?? 0)),
        false,
      ),
    );
    const merged = must(mergeSectionGeometries(parts, extras, ownMergeStorage));
    expect(arrays(merged)).toEqual(arrays(expected));
    for (const name of Object.keys(expected.attributes)) {
      expect(merged.getAttribute(name).normalized).toBe(
        expected.getAttribute(name).normalized,
      );
      expect(merged.getAttribute(name).array.constructor).toBe(
        expected.getAttribute(name).array.constructor,
      );
    }
  });

  it("leaves out the tint without corners, and zeroes the sway without profiles", () => {
    const merged = must(
      mergeSectionGeometries(
        parts,
        { ...extras, biomeCorners: undefined, swayProfileOf: undefined },
        ownMergeStorage,
      ),
    );
    expect(merged.getAttribute("biomeTint")).toBeUndefined();
    const position = merged.getAttribute("position");
    expect(position.itemSize).toBe(POSITION_STRIDE);
    for (let v = 0; v < position.count; v++) expect(position.getW(v)).toBe(0);
  });

  it("reuses scratch arrays and writes each merge whole", () => {
    const scratch = new ScratchMergeStorage();
    const big = must(mergeSectionGeometries(parts, extras, scratch.take));
    const bigArrays = arrays(big);
    const small = must(
      mergeSectionGeometries([parts[1]], extras, scratch.take),
    );
    expect(small.getAttribute("position").array.buffer).toBe(
      big.getAttribute("position").array.buffer,
    );
    expect(arrays(small)).toEqual(
      arrays(must(mergeSectionGeometries([parts[1]], extras, ownMergeStorage))),
    );
    expect(
      arrays(must(mergeSectionGeometries(parts, extras, scratch.take))),
    ).toEqual(bigArrays);
  });

  it("keeps one scratch array per kind, so alternating kinds cannot grow it", () => {
    const scratch = new ScratchMergeStorage();
    let floats: Float32Array | null = null;
    let shorts: Uint16Array | null = null;
    for (let i = 0; i < 200; i++) {
      floats = scratch.take("position", Float32Array, 1024) as Float32Array;
      shorts = scratch.take("position", Uint16Array, 1024) as Uint16Array;
    }
    // Each the size it was asked for: before, every switch grew the next
    // one half again (1.5^400 of the first).
    expect(floats!.buffer.byteLength).toBe(1024 * 4);
    expect(shorts!.buffer.byteLength).toBe(1024 * 2);
  });

  it("refuses parts whose arrays disagree in type", () => {
    const float = {
      ...parts[0],
      positions: new Float32Array(parts[0].positions),
    };
    expect(
      mergeSectionGeometries([parts[0], float], extras, ownMergeStorage),
    ).toBeNull();
  });
});
