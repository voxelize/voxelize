import { readFileSync } from "node:fs";
import path from "node:path";

import init, {
  mesh_chunk_fast,
  mesh_chunk_packed,
  set_float_blocks,
  set_registry,
} from "@voxelize/wasm-mesher";
import { beforeAll, describe, expect, it } from "vitest";

import { computeQuadLightTwist } from "../quad-light";
import {
  POSITION_BLOCK_BIAS,
  positionUnitsPerBlock,
  quantizeNormals,
  quantizePositions,
  quantizeUvs,
} from "../vertex-quantization";

// The worker hands the main thread geometry already packed for upload
// (`mesh_chunk_packed`: crates/mesher/src/mesher/pack.rs). A server mesh is
// still packed on the main thread by the script (vertex-quantization.ts,
// quad-light.ts), so the two must agree to the byte: a section meshed by the
// server and remeshed here after an edit may not move by a rounding step.
//
// The reference below is the packing the worker did in script before the
// mesher took it over, kept here as the thing to hold the mesher to.

type RawGeometry = {
  voxel: number;
  at: [number, number, number] | null | undefined;
  faceName: string | null | undefined;
  positions: number[];
  indices: number[];
  uvs: number[];
  lights: number[];
};

type PackedGeometry = {
  voxel: number;
  at?: [number, number, number];
  faceName?: string;
  positions: Uint16Array | Float32Array;
  uvs: Uint16Array | Float32Array;
  normals: Int8Array | Float32Array;
  indices: Uint16Array | Uint32Array;
  lights: Int32Array;
  lightTwist: Uint8Array;
  bsCenter: [number, number, number];
  bsRadius: number;
};

const wasmPath = path.resolve(
  __dirname,
  "../../../../../../crates/wasm-mesher/pkg/voxelize_wasm_mesher_bg.wasm",
);

const SIZE = 16;
const HEIGHT = 32;
const OPTIONS = { chunkSize: SIZE, maxHeight: HEIGHT, subChunks: 1 };
const UNITS = positionUnitsPerBlock(OPTIONS);

const STONE = 1;
const GLASS = 2;
const SLAB = 3;
const WATER = 4;
const LAMP = 5;

function face(
  name: string,
  dir: [number, number, number],
  corners: [number, number, number][],
  range: [number, number, number, number],
) {
  const uvs = [
    [0, 1],
    [0, 0],
    [1, 1],
    [1, 0],
  ];
  return {
    name,
    independent: false,
    isolated: false,
    textureGroup: null,
    dir,
    corners: corners.map((pos, i) => ({ pos, uv: uvs[i] })),
    range: {
      startU: range[0],
      endU: range[1],
      startV: range[2],
      endV: range[3],
    },
    emissive: 0,
    stageTintMask: 0,
    pigmentMask: 0,
    regionalTint: false,
  };
}

function cubeFaces(height: number, slot: number) {
  const h = height;
  // A third of an atlas tile, so texture coordinates do not land on round
  // sixteen-bit values.
  const range: [number, number, number, number] = [
    slot / 7,
    (slot + 1) / 7,
    1 / 3,
    2 / 3,
  ];
  return [
    face(
      "px",
      [1, 0, 0],
      [
        [1, h, 1],
        [1, 0, 1],
        [1, h, 0],
        [1, 0, 0],
      ],
      range,
    ),
    face(
      "nx",
      [-1, 0, 0],
      [
        [0, h, 0],
        [0, 0, 0],
        [0, h, 1],
        [0, 0, 1],
      ],
      range,
    ),
    face(
      "py",
      [0, 1, 0],
      [
        [0, h, 1],
        [1, h, 1],
        [0, h, 0],
        [1, h, 0],
      ],
      range,
    ),
    face(
      "ny",
      [0, -1, 0],
      [
        [1, 0, 1],
        [0, 0, 1],
        [1, 0, 0],
        [0, 0, 0],
      ],
      range,
    ),
    face(
      "pz",
      [0, 0, 1],
      [
        [0, 0, 1],
        [1, 0, 1],
        [0, h, 1],
        [1, h, 1],
      ],
      range,
    ),
    face(
      "nz",
      [0, 0, -1],
      [
        [1, 0, 0],
        [0, 0, 0],
        [1, h, 0],
        [0, h, 0],
      ],
      range,
    ),
  ];
}

function block(id: number, name: string, overrides: Record<string, unknown>) {
  return {
    id,
    name,
    rotatable: false,
    yRotatable: false,
    isEmpty: false,
    isFluid: false,
    isWaterloggable: false,
    isWaterloggingFluid: false,
    isOpaque: false,
    isSeeThrough: false,
    isTransparent: [false, false, false, false, false, false],
    transparentStandalone: false,
    standaloneFaceDepth: 0,
    occludesFluid: false,
    isPlant: false,
    stackGroup: 0,
    isAnimated: false,
    faces: cubeFaces(1, id),
    aabbs: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }],
    dynamicPatterns: null,
    connected: null,
    branch: null,
    branchSockets: [],
    branchShell: false,
    stageFaces: null,
    tufts: null,
    ...overrides,
  };
}

const BLOCKS = [
  block(0, "Air", { isEmpty: true, faces: [], aabbs: [] }),
  block(STONE, "Stone", { isOpaque: true }),
  block(GLASS, "Glass", {
    isSeeThrough: true,
    isTransparent: [true, true, true, true, true, true],
  }),
  // Never greedy: its faces go through the loose path, off the block grid.
  block(SLAB, "Slab", {
    isTransparent: [true, true, true, false, true, true],
    faces: cubeFaces(0.4375, SLAB),
    aabbs: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.4375, maxZ: 1 }],
  }),
  block(WATER, "Water", {
    isFluid: true,
    isWaterloggingFluid: true,
    isSeeThrough: true,
    isTransparent: [true, true, true, true, true, true],
  }),
  block(LAMP, "Lamp", {
    isOpaque: true,
    faces: cubeFaces(1, LAMP).map((lampFace) => ({ ...lampFace, emissive: 2 })),
  }),
];

/** The blocks the main thread sorts: they keep float attributes. */
const FLOAT_BLOCKS = [GLASS, WATER];

function hash(x: number, y: number, z: number): number {
  let h =
    (Math.imul(x, 0x9e3779b1) ^
      Math.imul(y, 0x85ebca77) ^
      Math.imul(z, 0xc2b2ae3d)) >>>
    0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  return (h ^ (h >>> 12)) >>> 0;
}

/** A section with a bit of everything, lit unevenly in every channel. */
function scene() {
  const voxels = new Uint32Array(SIZE * HEIGHT * SIZE);
  const lights = new Uint32Array(SIZE * HEIGHT * SIZE);
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      for (let z = 0; z < SIZE; z++) {
        const i = x * HEIGHT * SIZE + y * SIZE + z;
        const roll = hash(x, y, z) % 16;
        let id = 0;
        if (y < 6) id = STONE;
        else if (y < 9) id = roll < 5 ? WATER : roll < 9 ? STONE : 0;
        else if (y < 20) {
          id =
            roll === 0
              ? LAMP
              : roll < 4
                ? STONE
                : roll < 6
                  ? GLASS
                  : roll < 8
                    ? SLAB
                    : 0;
        }
        voxels[i] = id;
        if (id !== STONE && id !== LAMP) {
          const sun = Math.max(0, 15 - Math.max(0, 22 - y));
          const red = hash(x >> 2, y >> 2, z >> 2) % 16;
          const green = hash(z, x, y) % 9;
          const blue = (x + z) % 16;
          lights[i] = (sun << 12) | (red << 8) | (green << 4) | blue;
        }
      }
    }
  }
  return {
    voxels,
    lights,
    shape: [SIZE, HEIGHT, SIZE],
    min: [0, 0, 0],
  };
}

function scriptNormals(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const e1x = positions[ib] - positions[ia];
    const e1y = positions[ib + 1] - positions[ia + 1];
    const e1z = positions[ib + 2] - positions[ia + 2];
    const e2x = positions[ic] - positions[ia];
    const e2y = positions[ic + 1] - positions[ia + 1];
    const e2z = positions[ic + 2] - positions[ia + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    for (const base of [ia, ib, ic]) {
      normals[base] = nx;
      normals[base + 1] = ny;
      normals[base + 2] = nz;
    }
  }
  return normals;
}

function scriptBoundingSphere(positions: Float32Array) {
  const count = positions.length / 3;
  if (count === 0) return { center: [0, 0, 0], radius: 0 };
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i];
    cy += positions[i + 1];
    cz += positions[i + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let maxR2 = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - cx;
    const dy = positions[i + 1] - cy;
    const dz = positions[i + 2] - cz;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > maxR2) maxR2 = r2;
  }
  return { center: [cx, cy, cz], radius: Math.sqrt(maxR2) };
}

/** What the worker's script made of one meshed geometry. */
function scriptPack(geometry: RawGeometry, isQuantized: boolean) {
  const positions = new Float32Array(geometry.positions);
  const vertexCount = positions.length / 3;
  const indices =
    vertexCount > 65535
      ? new Uint32Array(geometry.indices.length)
      : new Uint16Array(geometry.indices.length);
  for (let i = 0; i < geometry.indices.length; i++) {
    indices[i] = geometry.indices[i];
  }
  const normals = scriptNormals(positions, indices);
  const sphere = scriptBoundingSphere(positions);
  const lights = new Int32Array(geometry.lights);
  return {
    indices,
    lights,
    lightTwist: computeQuadLightTwist(lights, indices),
    positions: isQuantized ? quantizePositions(positions, UNITS) : positions,
    uvs: isQuantized
      ? quantizeUvs(geometry.uvs)
      : new Float32Array(geometry.uvs),
    normals: isQuantized ? quantizeNormals(normals) : normals,
    bsCenter: isQuantized
      ? sphere.center.map((c) => (c + POSITION_BLOCK_BIAS) * UNITS)
      : sphere.center,
    bsRadius: isQuantized ? sphere.radius * UNITS : sphere.radius,
  };
}

const keyOf = (geometry: { voxel: number; faceName?: string | null }) =>
  `${geometry.voxel}|${geometry.faceName ?? ""}`;

function bytes(view: ArrayBufferView): number[] {
  return [...new Uint8Array(view.buffer, view.byteOffset, view.byteLength)];
}

describe("the mesher packs a geometry exactly as the script does", () => {
  let raw: RawGeometry[];
  let packed: PackedGeometry[];

  beforeAll(async () => {
    (globalThis as { onmessage?: unknown }).onmessage = null;
    const { convertRegistryToWasm } = await import("./mesh-worker");
    await init({ module_or_path: readFileSync(wasmPath) });
    set_registry(
      convertRegistryToWasm({
        blocksById: BLOCKS.map((entry) => [entry.id, entry as never]),
        blocksByName: BLOCKS.map((entry) => [
          entry.name.toLowerCase(),
          entry as never,
        ]),
      }),
    );
    set_float_blocks(Uint32Array.from(FLOAT_BLOCKS));

    const chunks = () => [
      null,
      null,
      null,
      null,
      scene(),
      null,
      null,
      null,
      null,
    ];
    const min = new Int32Array([0, 0, 0]);
    const max = new Int32Array([SIZE, HEIGHT, SIZE]);
    raw = (
      mesh_chunk_fast(chunks(), min, max, SIZE) as { geometries: RawGeometry[] }
    ).geometries;
    packed = (
      mesh_chunk_packed(chunks(), min, max, SIZE, UNITS) as {
        geometries: PackedGeometry[];
      }
    ).geometries;
  });

  it("meshes the same geometries through either entry", () => {
    expect(raw.length).toBeGreaterThanOrEqual(BLOCKS.length - 1);
    expect(packed.map(keyOf).sort()).toEqual(raw.map(keyOf).sort());
  });

  it("keeps floats for the blocks the main thread sorts and packs the rest", () => {
    for (const geometry of packed) {
      const isFloat = FLOAT_BLOCKS.includes(geometry.voxel);
      expect(geometry.positions).toBeInstanceOf(
        isFloat ? Float32Array : Uint16Array,
      );
      expect(geometry.uvs).toBeInstanceOf(isFloat ? Float32Array : Uint16Array);
      expect(geometry.normals).toBeInstanceOf(
        isFloat ? Float32Array : Int8Array,
      );
    }
  });

  it("agrees with the script on every byte of every buffer", () => {
    const byKey = new Map(raw.map((geometry) => [keyOf(geometry), geometry]));
    let vertices = 0;
    for (const geometry of packed) {
      const source = byKey.get(keyOf(geometry));
      expect(source).toBeDefined();
      if (!source) continue;
      const expected = scriptPack(
        source,
        !FLOAT_BLOCKS.includes(geometry.voxel),
      );
      const label = `block ${geometry.voxel}`;
      for (const name of [
        "positions",
        "uvs",
        "normals",
        "indices",
        "lights",
        "lightTwist",
      ] as const) {
        expect(geometry[name].constructor, `${label} ${name} type`).toBe(
          expected[name].constructor,
        );
        expect(bytes(geometry[name]), `${label} ${name}`).toEqual(
          bytes(expected[name]),
        );
      }
      expect(geometry.bsCenter, `${label} bsCenter`).toEqual(expected.bsCenter);
      expect(geometry.bsRadius, `${label} bsRadius`).toBe(expected.bsRadius);
      vertices += geometry.lights.length;
    }
    // Enough geometry that a slip in any path shows: merged quads, loose
    // faces off the grid, fluid surfaces, emissive faces.
    expect(vertices).toBeGreaterThan(4000);
  });
});
