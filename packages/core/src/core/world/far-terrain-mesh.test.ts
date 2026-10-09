import { describe, expect, it } from "vitest";

import {
  buildFarLandMesh,
  buildFarSkyMesh,
  FAR_FACE_KIND,
  farHash,
  FarMeshData,
  FarMeshInput,
} from "./far-terrain-mesh";

const TREE_CLASS = 3;

/** A canopy over `size`² cells, `crown(i, j)` giving `[top, bottom, cover, kind]` or null. */
const canopyOf = (
  size: number,
  crown: (i: number, j: number) => [number, number, number, number] | null,
) => {
  const canopy = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const cell = crown(i, j);
      if (cell) canopy.set(cell, (j * size + i) * 4);
    }
  }
  return canopy;
};

const inputOf = (
  size: number,
  height: (i: number, j: number) => number,
  overrides: Partial<FarMeshInput> = {},
): FarMeshInput => {
  const heights = new Uint16Array(size * size);
  const classes = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) heights[j * size + i] = height(i, j);
  }
  return {
    originX: 64,
    originZ: -32,
    step: 4,
    size,
    heights,
    classes,
    tints: null,
    sky: null,
    canopy: null,
    classCount: TREE_CLASS,
    treeClass: TREE_CLASS,
    skyClass: 0,
    waterSurface: null,
    ...overrides,
  };
};

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined)
    throw new Error("expected a value");
  return value;
};

type Quad = {
  corners: [number, number, number][];
  ground: number;
  top: number;
  cls: number;
  kind: number;
  occlusion: number[];
};

const quadsOf = (mesh: FarMeshData): Quad[] => {
  const quads: Quad[] = [];
  for (let q = 0; q < mesh.quads; q++) {
    const corners: [number, number, number][] = [];
    const occlusion: number[] = [];
    for (let k = 0; k < 4; k++) {
      const v = q * 4 + k;
      corners.push([
        mesh.position[v * 3],
        mesh.position[v * 3 + 1],
        mesh.position[v * 3 + 2],
      ]);
      occlusion.push(mesh.material[v * 4 + 2]);
    }
    const v = q * 4;
    quads.push({
      corners,
      ground: mesh.column[v * 2],
      top: mesh.column[v * 2 + 1],
      cls: mesh.material[v * 4],
      kind: mesh.material[v * 4 + 1],
      occlusion,
    });
  }
  return quads;
};

const isFlat = (q: Quad) => q.corners.every(([, y]) => y === q.corners[0][1]);
const tops = (mesh: FarMeshData) =>
  quadsOf(mesh).filter((q) => isFlat(q) && q.kind !== FAR_FACE_KIND.wall);
const walls = (mesh: FarMeshData) =>
  quadsOf(mesh).filter((q) => q.kind === FAR_FACE_KIND.wall);

describe("buildFarLandMesh", () => {
  it("draws one top per cell at its sample's height, rounded to a whole block", () => {
    const mesh = must(
      buildFarLandMesh(inputOf(3, (i, j) => 100.4 + i + 10 * j)),
    );
    const flat = tops(mesh);
    expect(flat).toHaveLength(4);
    const ys = flat.map((q) => q.corners[0][1]).sort((a, b) => a - b);
    expect(ys).toEqual([100, 101, 110, 111]);
    // Cell (1, 1) spans one step from the tile origin's second sample.
    const cell = flat.find((q) => q.corners[0][1] === 111);
    const xs = new Set(must(cell).corners.map(([x]) => x));
    const zs = new Set(must(cell).corners.map(([, , z]) => z));
    expect(xs).toEqual(new Set([4, 8]));
    expect(zs).toEqual(new Set([4, 8]));
  });

  it("walls a step from the lower top up, for the higher column", () => {
    // West cells at 100, east cells at 92: one riser 8 blocks tall.
    const input = inputOf(3, (i) => (i === 0 ? 100 : 92));
    input.classes = Uint8Array.from([1, 2, 2, 1, 2, 2, 1, 2, 2]);
    const risers = walls(must(buildFarLandMesh(input))).filter((q) =>
      q.corners.every(([x]) => x === 4),
    );
    // The same step along the whole line is one quad.
    expect(risers).toHaveLength(1);
    expect(new Set(risers[0].corners.map(([, , z]) => z))).toEqual(
      new Set([0, 8]),
    );
    for (const riser of risers) {
      const ys = riser.corners.map(([, y]) => y);
      expect(Math.min(...ys)).toBe(92);
      expect(Math.max(...ys)).toBe(100);
      // Painted as the west column: its ground, its top, its class.
      expect([riser.ground, riser.top, riser.cls]).toEqual([100, 100, 1]);
    }
  });

  it("skirts every tile edge down past anything a coarser neighbour leaves open", () => {
    const mesh = must(buildFarLandMesh(inputOf(3, () => 90)));
    const skirts = walls(mesh);
    // Two cells along each of four edges, nothing else steps.
    expect(skirts).toHaveLength(8);
    for (const skirt of skirts) {
      const ys = skirt.corners.map(([, y]) => y);
      expect(Math.max(...ys)).toBe(90);
      expect(Math.min(...ys)).toBeLessThanOrEqual(90 - 3 * 4);
    }
  });

  it("darkens a top's corners beside a higher column, as the chunk mesher does", () => {
    const mesh = must(
      buildFarLandMesh(inputOf(3, (i) => (i === 2 ? 120 : 100))),
    );
    const flat = tops(mesh).filter((q) => q.corners[0][1] === 100);
    // Cell (1, j) borders the tall shared column on its +x side.
    const beside = flat.filter((q) => q.corners.some(([x]) => x === 8));
    for (const quad of beside) {
      const open = quad.corners.map(([x], k) => [x, quad.occlusion[k]]);
      for (const [x, occlusion] of open) {
        if (x === 8) expect(occlusion).toBeLessThan(255);
        else expect(occlusion).toBe(255);
      }
    }
    // Spread over a 4-block cell, a quarter of a block's darkening.
    expect(Math.min(...beside.flatMap((q) => q.occlusion))).toBeGreaterThan(
      200,
    );
  });

  it("stands the canopy's crowns on their trunks, in their species' class, over shaded ground", () => {
    // One crown of species 1 three cells round its trunk at cell (4, 4):
    // leaves from 6 to 16 blocks over the ground.
    const canopy = canopyOf(9, (i, j) =>
      Math.hypot(i - 4, j - 4) <= 3
        ? [16, 6, 255, i === 4 && j === 4 ? 0x81 : 1]
        : null,
    );
    const quads = quadsOf(
      must(buildFarLandMesh(inputOf(9, () => 80, { step: 2, canopy }))),
    );
    const crownFaces = quads.filter((q) => q.kind === FAR_FACE_KIND.crown);
    expect(crownFaces.length).toBeGreaterThan(0);
    for (const face of crownFaces) expect(face.cls).toBe(TREE_CLASS + 1);
    const crownTops = crownFaces.filter(
      (q) => isFlat(q) && q.corners[0][1] === q.top,
    );
    expect(new Set(crownTops.map((q) => q.corners[0][1]))).toEqual(
      new Set([96]),
    );
    // A crown's cells merge into runs: fewer tops than its 29 cells.
    expect(crownTops.length).toBeLessThan(29);
    const undersides = crownFaces.filter(
      (q) => isFlat(q) && q.corners[0][1] < q.top,
    );
    expect(new Set(undersides.map((q) => q.corners[0][1]))).toEqual(
      new Set([86]),
    );
    expect(crownFaces.some((q) => !isFlat(q))).toBe(true);
    // One trunk, a block across, bark from the ground up into the leaves.
    const trunks = quads.filter((q) => q.kind === FAR_FACE_KIND.trunk);
    expect(trunks).toHaveLength(4);
    for (const trunk of trunks) {
      expect(trunk.cls).toBe(TREE_CLASS + 1);
      const ys = trunk.corners.map(([, y]) => y);
      expect([Math.min(...ys), Math.max(...ys)]).toEqual([80, 86]);
      for (const axis of [0, 2]) {
        const values = trunk.corners.map((corner) => corner[axis]);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(
          1,
        );
      }
    }
    // The ground goes on under the crown, in its shade.
    const shaded = quads.filter(
      (q) =>
        q.kind === FAR_FACE_KIND.top && q.occlusion.every((ao) => ao < 200),
    );
    expect(shaded.length).toBeGreaterThan(0);
    // No canopy, no crowns.
    expect(
      quadsOf(must(buildFarLandMesh(inputOf(9, () => 80, { step: 2 })))).some(
        (q) => q.kind !== FAR_FACE_KIND.top && q.kind !== FAR_FACE_KIND.wall,
      ),
    ).toBe(false);
  });

  it("keeps a crown in a cell trees cover only partly at that share", () => {
    const crowned = (cover: number) => {
      const canopy = canopyOf(33, () => [14, 9, cover, 0]);
      const mesh = must(
        buildFarLandMesh(inputOf(33, () => 80, { step: 16, canopy })),
      );
      return quadsOf(mesh)
        .filter(
          (q) =>
            q.kind === FAR_FACE_KIND.crown &&
            isFlat(q) &&
            q.corners[0][1] === q.top,
        )
        .reduce((cells, q) => {
          const xs = q.corners.map(([x]) => x);
          return cells + (Math.max(...xs) - Math.min(...xs)) / 16;
        }, 0);
    };
    expect(crowned(255)).toBe(32 * 32);
    const half = crowned(128) / (32 * 32);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    expect(crowned(0)).toBe(0);
  });

  it("builds nothing the far water plane hides", () => {
    // A sea floor at 60 under a plane at 86.875, rising to a shore at 90.
    const input = inputOf(5, (i) => (i < 3 ? 60 : 90), {
      waterSurface: 86.875,
    });
    const quads = quadsOf(must(buildFarLandMesh(input)));
    for (const quad of quads) {
      for (const [, y] of quad.corners) expect(y).toBeGreaterThanOrEqual(86);
    }
    // The shore's riser starts at the water, not the sea floor.
    const riser = quads.find(
      (q) =>
        q.kind === FAR_FACE_KIND.wall && q.corners.every(([x]) => x === 12),
    );
    expect(Math.min(...must(riser).corners.map(([, y]) => y))).toBe(86);
    // A tile wholly under water builds nothing.
    expect(
      buildFarLandMesh(inputOf(3, () => 50, { waterSurface: 86.875 })),
    ).toBeNull();
  });

  it("merges an open run of equal tops into one quad", () => {
    const flat = tops(must(buildFarLandMesh(inputOf(5, () => 90))));
    // Four cells a row, four rows.
    expect(flat).toHaveLength(4);
    for (const quad of flat) {
      const xs = quad.corners.map(([x]) => x);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(16);
    }
  });

  it("is the same tile for every caller", () => {
    const canopy = canopyOf(17, (i, j) =>
      (i * 5 + j * 3) % 4 === 0 ? [12, 5, 255, (i + j) % 3] : null,
    );
    const input = inputOf(17, (i, j) => 70 + ((i * 7 + j * 3) % 5), {
      step: 2,
      canopy,
    });
    const a = must(buildFarLandMesh(input));
    const b = must(buildFarLandMesh(input));
    expect(Array.from(a.position)).toEqual(Array.from(b.position));
    expect(Array.from(a.material)).toEqual(Array.from(b.material));
  });
});

describe("farHash", () => {
  it("hashes lattice points into [0, 1) the same way every time", () => {
    const values = [farHash(3, -7, 1), farHash(3, -7, 1), farHash(-3, 7, 1)];
    expect(values[0]).toBe(values[1]);
    expect(values[0]).not.toBe(values[2]);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("buildFarSkyMesh", () => {
  it("is null without floating land", () => {
    expect(buildFarSkyMesh(inputOf(3, () => 90))).toBeNull();
    const empty = inputOf(3, () => 90, { sky: new Uint16Array(18) });
    expect(buildFarSkyMesh(empty)).toBeNull();
  });

  it("makes a boxy slab: top, underside and four full walls for one island cell", () => {
    const sky = new Uint16Array(9 * 2);
    sky[(1 * 3 + 1) * 2] = 200;
    sky[(1 * 3 + 1) * 2 + 1] = 180;
    const mesh = must(
      buildFarSkyMesh(inputOf(3, () => 90, { sky, skyClass: 2 })),
    );
    const quads = quadsOf(mesh);
    expect(quads).toHaveLength(6);
    expect(quads.filter((q) => q.kind === FAR_FACE_KIND.top)).toHaveLength(1);
    expect(quads.filter((q) => q.kind === FAR_FACE_KIND.bottom)).toHaveLength(
      1,
    );
    expect(quads.filter((q) => q.kind === FAR_FACE_KIND.wall)).toHaveLength(4);
    expect(quads.every((q) => q.cls === 2)).toBe(true);
  });
});
