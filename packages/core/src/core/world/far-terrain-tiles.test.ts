import { describe, expect, it } from "vitest";

import {
  chunkKeepsSeamPixel,
  FAR_SEAM_BAYER,
  farKeepsSeamPixel,
  farSeamDither,
  farSeamScale,
  farSeamWeightAt,
} from "./far-terrain-seam";
import {
  buildCoverageMask,
  buildFarLandArrays,
  buildFarSkyArrays,
  CHUNK_PENDING_GRACE_MS,
  decodeFarTerrainReply,
  farTerrainRings,
  FarTerrainDescriptor,
  farTileBounds,
  FarTileData,
  farTileId,
  farTilesToEvict,
  farTileSpan,
  isChunkColumnPending,
  isCoveredAt,
  pendingChunksWithin,
  selectFarTiles,
} from "./far-terrain-tiles";
import { computeFogRange } from "./fog-range";

const descriptor: FarTerrainDescriptor = {
  baseStep: 8,
  tileSamples: 33,
  levels: 3,
  waterSurface: 86.875,
};

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const u16Bytes = (values: number[]) => {
  const bytes = new Uint8Array(values.length * 2);
  values.forEach((value, i) => {
    bytes[2 * i] = value & 0xff;
    bytes[2 * i + 1] = value >> 8;
  });
  return bytes;
};

const tileOf = (
  size: number,
  height: (i: number, j: number) => number,
  sky?: (i: number, j: number) => [number, number] | null,
): FarTileData => {
  const heights = new Uint16Array(size * size);
  const colors = new Uint8Array(size * size);
  const skyValues = sky ? new Uint16Array(size * size * 2) : null;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      heights[j * size + i] = height(i, j);
      colors[j * size + i] = (i + j) % 3;
      if (sky && skyValues) {
        const s = sky(i, j);
        if (s) {
          skyValues[(j * size + i) * 2] = s[0];
          skyValues[(j * size + i) * 2 + 1] = s[1];
        }
      }
    }
  }
  return {
    key: { level: 0, tx: 1, tz: -1 },
    step: 8,
    size,
    heights,
    colors,
    sky: skyValues,
    bytes: 0,
  };
};

describe("decodeFarTerrainReply", () => {
  it("reads a reply's fixed-width samples back", () => {
    const heights = [100, 101, 300, 383];
    const colors = [0, 2, 9, 19];
    const payload = JSON.stringify({
      level: 1,
      tx: -3,
      tz: 4,
      step: 16,
      size: 2,
      heights: base64(u16Bytes(heights)),
      colors: base64(Uint8Array.from(colors)),
      sky: base64(u16Bytes([0, 0, 200, 190, 0, 0, 0, 0])),
    });
    const tile = decodeFarTerrainReply(payload);
    expect(tile).not.toBeNull();
    expect(tile!.key).toEqual({ level: 1, tx: -3, tz: 4 });
    expect(Array.from(tile!.heights)).toEqual(heights);
    expect(Array.from(tile!.colors)).toEqual(colors);
    expect(Array.from(tile!.sky!)).toEqual([0, 0, 200, 190, 0, 0, 0, 0]);
    expect(tile!.bytes).toBe(payload.length);
  });

  it("rejects a reply whose arrays do not fit its size", () => {
    const bad = JSON.stringify({
      level: 0,
      tx: 0,
      tz: 0,
      step: 8,
      size: 3,
      heights: base64(u16Bytes([1, 2, 3, 4])),
      colors: base64(Uint8Array.from([1, 2, 3, 4])),
    });
    expect(decodeFarTerrainReply(bad)).toBeNull();
    expect(decodeFarTerrainReply("not json")).toBeNull();
    expect(decodeFarTerrainReply({ level: 0 })).toBeNull();
  });
});

describe("farTerrainRings", () => {
  it("doubles the reach per level and stops at the distance", () => {
    expect(farTerrainRings(descriptor, 128, 512)).toEqual([
      { level: 0, inner: 0, outer: 256 },
      { level: 1, inner: 256, outer: 512 },
    ]);
    expect(farTerrainRings(descriptor, 128, 1024)).toEqual([
      { level: 0, inner: 0, outer: 256 },
      { level: 1, inner: 256, outer: 512 },
      { level: 2, inner: 512, outer: 1024 },
    ]);
  });

  it("gives the finest ring at least the render distance", () => {
    expect(farTerrainRings(descriptor, 384, 512)).toEqual([
      { level: 0, inner: 0, outer: 384 },
      { level: 1, inner: 384, outer: 512 },
    ]);
  });

  it("stretches the last level the server offers to the distance", () => {
    expect(farTerrainRings({ ...descriptor, levels: 1 }, 128, 900)).toEqual([
      { level: 0, inner: 0, outer: 900 },
    ]);
    expect(farTerrainRings(descriptor, 128, 3000)).toEqual([
      { level: 0, inner: 0, outer: 256 },
      { level: 1, inner: 256, outer: 512 },
      { level: 2, inner: 512, outer: 3000 },
    ]);
  });

  it("is empty when the layer is off", () => {
    expect(farTerrainRings(descriptor, 128, 0)).toEqual([]);
  });
});

describe("selectFarTiles", () => {
  const span = farTileSpan(descriptor, 0);

  it("spans 256 blocks per fine tile", () => {
    expect(span).toBe(256);
    expect(farTileSpan(descriptor, 2)).toBe(1024);
  });

  it("picks every tile touching the ring, nearest first", () => {
    const ring = { level: 0, inner: 0, outer: 256 };
    const tiles = selectFarTiles(10, 10, ring, span);
    const ids = tiles.map(farTileId);
    // The viewer's own tile first, then its neighbours; nothing two tiles out.
    expect(ids[0]).toBe("0:0:0");
    expect(ids).toContain("0:-1:-1");
    expect(ids).toContain("0:1:0");
    expect(ids).not.toContain("0:2:0");
    for (let i = 1; i < tiles.length; i++) {
      const d = (t: { tx: number; tz: number }) =>
        Math.hypot(t.tx * span + span / 2 - 10, t.tz * span + span / 2 - 10);
      expect(d(tiles[i - 1])).toBeLessThanOrEqual(d(tiles[i]));
    }
  });

  it("skips tiles wholly inside the ring's inner radius", () => {
    const outerRing = { level: 1, inner: 256, outer: 512 };
    const coarse = farTileSpan(descriptor, 1);
    const ids = selectFarTiles(0, 0, outerRing, coarse).map(farTileId);
    // Coarse tiles are 512 wide: the four around the origin all reach past 256.
    expect(ids).toEqual(
      expect.arrayContaining(["1:0:0", "1:-1:0", "1:0:-1", "1:-1:-1"]),
    );
    expect(ids).not.toContain("1:2:2");
    const tiny = { level: 0, inner: 1000, outer: 1100 };
    expect(selectFarTiles(128, 128, tiny, span).map(farTileId)).not.toContain(
      "0:0:0",
    );
  });
});

/** Each triangle's outward normal (right-hand rule), one vec3 per triangle. */
const normalsOf = ({
  positions,
  indices,
}: {
  positions: Float32Array;
  indices: Uint32Array;
}) => {
  const out: [number, number, number][] = [];
  const p = (k: number) =>
    [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]] as const;
  for (let t = 0; t < indices.length; t += 3) {
    const a = p(indices[t]);
    const b = p(indices[t + 1]);
    const c = p(indices[t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: [number, number, number] = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const len = Math.hypot(...n) || 1;
    out.push([n[0] / len, n[1] / len, n[2] / len]);
  }
  return out;
};

/** The y of every vertex of the triangles whose normal passes `pick`. */
const ysWhere = (
  mesh: { positions: Float32Array; indices: Uint32Array },
  pick: (n: [number, number, number]) => boolean,
) => {
  const ys = new Set<number>();
  normalsOf(mesh).forEach((n, t) => {
    if (!pick(n)) return;
    for (let k = 0; k < 3; k++)
      ys.add(mesh.positions[mesh.indices[t * 3 + k] * 3 + 1]);
  });
  return ys;
};

const isUp = (n: [number, number, number]) => n[1] > 0.99;
const isDown = (n: [number, number, number]) => n[1] < -0.99;
const isSide = (n: [number, number, number]) => Math.abs(n[1]) < 0.01;

describe("buildFarLandArrays", () => {
  it("draws a flat plain as one flat-topped quad per cell and no walls", () => {
    const tile = tileOf(3, () => 100);
    const palette = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const mesh = buildFarLandArrays(tile, palette);
    // Four cells, two triangles each, four vertices each.
    expect(mesh.indices.length).toBe(4 * 6);
    expect(mesh.positions.length).toBe(4 * 4 * 3);
    expect(normalsOf(mesh).every(isUp)).toBe(true);
    for (let k = 1; k < mesh.positions.length; k += 3)
      expect(mesh.positions[k]).toBe(100);
  });

  it("puts each top at its sample's height, rounded to a whole block, over the cell it starts", () => {
    const tile = tileOf(3, (i, j) => 100 + i + 10 * j);
    tile.heights[0] = 100;
    const palette = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const mesh = buildFarLandArrays(tile, palette);
    const span = 2 * 8;
    // Cell (1, 1): x in [tx*span + 8, +16], z in [tz*span + 8, +16], y = 111.
    const tops = normalsOf(mesh)
      .map((n, t) => (isUp(n) ? t : -1))
      .filter((t) => t >= 0);
    const cell = tops.filter((t) => {
      const k = mesh.indices[t * 3];
      return mesh.positions[k * 3 + 1] === 111;
    });
    expect(cell.length).toBe(2);
    const xs = new Set<number>();
    const zs = new Set<number>();
    for (const t of cell)
      for (let k = 0; k < 3; k++) {
        const v = mesh.indices[t * 3 + k];
        xs.add(mesh.positions[v * 3]);
        zs.add(mesh.positions[v * 3 + 2]);
      }
    expect(xs).toEqual(new Set([1 * span + 8, 1 * span + 16]));
    expect(zs).toEqual(new Set([-1 * span + 8, -1 * span + 16]));
    // Class (i + j) % 3 = 0 at the origin: red on every vertex of its top.
    expect(Array.from(mesh.colors.subarray(0, 12))).toEqual([
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    ]);
    // Every top winds counter-clockwise seen from above: a negative signed
    // area in the xz plane.
    const p = (k: number) => [mesh.positions[k * 3], mesh.positions[k * 3 + 2]];
    const [ax, az] = p(mesh.indices[0]);
    const [bx, bz] = p(mesh.indices[1]);
    const [cx, cz] = p(mesh.indices[2]);
    expect((bx - ax) * (cz - az) - (cx - ax) * (bz - az)).toBeLessThan(0);
  });

  it("walls a step only where a neighbour is lower, facing the lower cell", () => {
    // A 2x2-cell tile: the west column of cells is 100, the east is 90.
    const tile = tileOf(3, (i) => (i === 0 ? 100 : 90));
    const palette = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const mesh = buildFarLandArrays(tile, palette);
    const normals = normalsOf(mesh);
    // 4 tops (8 triangles) + 2 walls along the one step (4 triangles).
    expect(normals.length).toBe(12);
    const walls = normals.filter(isSide);
    expect(walls.length).toBe(4);
    // The wall faces +x, toward the lower eastern cells, from 90 up to 100.
    for (const n of walls) expect(n[0]).toBeCloseTo(1, 5);
    expect(ysWhere(mesh, isSide)).toEqual(new Set([90, 100]));
    const wallXs = new Set<number>();
    normals.forEach((n, t) => {
      if (!isSide(n)) return;
      for (let k = 0; k < 3; k++)
        wallXs.add(mesh.positions[mesh.indices[t * 3 + k] * 3]);
    });
    expect(wallXs).toEqual(new Set([1 * 16 + 8]));
    // The wall is coloured as the higher column (class 0 at i = 0, j = 0;
    // class 1 at i = 0, j = 1): red and green, never the lower cell's.
    const wallColors = new Set<string>();
    normals.forEach((n, t) => {
      if (!isSide(n)) return;
      const v = mesh.indices[t * 3];
      wallColors.add(Array.from(mesh.colors.subarray(v * 3, v * 3 + 3)).join());
    });
    expect(wallColors).toEqual(new Set(["1,0,0", "0,1,0"]));
  });

  it("walls the shared edge with the next tile from both heights, and never its own low edge", () => {
    // Three samples: the last row is the next tile's first cell. The middle
    // cell sits at 90 and the shared row at 100, so the step up belongs to
    // the next tile's column but is walled here, facing -x.
    const tile = tileOf(3, (i) => (i === 2 ? 100 : 90));
    const palette = Float32Array.from([1, 0, 0]);
    const mesh = buildFarLandArrays(tile, palette);
    const normals = normalsOf(mesh);
    const walls = normals.filter(isSide);
    expect(walls.length).toBe(4);
    for (const n of walls) expect(n[0]).toBeCloseTo(-1, 5);
    const xs = new Set<number>();
    normals.forEach((n, t) => {
      if (!isSide(n)) return;
      for (let k = 0; k < 3; k++)
        xs.add(mesh.positions[mesh.indices[t * 3 + k] * 3]);
    });
    // At the tile's east edge (x = tx * span + span), not its west edge.
    expect(xs).toEqual(new Set([1 * 16 + 16]));
  });

  it("rounds fractional heights to whole blocks", () => {
    const tile = tileOf(2, () => 90);
    // Heights are u16 on the wire; a decoded-then-scaled value still lands
    // on a block.
    (tile as { heights: Uint16Array | Float32Array }).heights =
      Float32Array.from([90.4, 90.6, 89.5, 90]);
    const palette = Float32Array.from([1, 0, 0]);
    const mesh = buildFarLandArrays(tile, palette);
    const ys = new Set<number>();
    for (let k = 1; k < mesh.positions.length; k += 3)
      ys.add(mesh.positions[k]);
    expect(ys).toEqual(new Set([90, 91]));
  });

  it("takes the last palette entry for an unknown class", () => {
    const tile = tileOf(2, () => 90);
    tile.colors.fill(7);
    const palette = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const { colors } = buildFarLandArrays(tile, palette);
    expect(Array.from(colors.subarray(0, 3))).toEqual(
      [0.4, 0.5, 0.6].map((v) => expect.closeTo(v, 5)),
    );
  });
});

describe("farTileBounds", () => {
  it("spans the tile and runs from its lowest to its highest surface", () => {
    const tile = tileOf(3, (i, j) => 100 + i + 10 * j);
    expect(farTileBounds(tile)).toEqual({
      x0: 16,
      y0: 100,
      z0: -16,
      x1: 32,
      y1: 122,
      z1: 0,
    });
    const island = tileOf(
      3,
      () => 90,
      (i, j) => (i === 1 && j === 1 ? [200, 60] : null),
    );
    expect(farTileBounds(island)).toMatchObject({ y0: 60, y1: 200 });
  });
});

describe("buildFarSkyArrays", () => {
  it("is null without floating land", () => {
    expect(
      buildFarSkyArrays(
        tileOf(3, () => 90),
        [0, 1, 0],
        [0.5, 0.5, 0.5],
      ),
    ).toBeNull();
    const empty = tileOf(
      3,
      () => 90,
      () => null,
    );
    expect(buildFarSkyArrays(empty, [0, 1, 0], [0.5, 0.5, 0.5])).toBeNull();
  });

  it("makes a boxy slab: flat top, flat underside and four full walls for one island cell", () => {
    // A 3x3-cell tile with land in the middle cell only, so all four of its
    // walls are drawn here (an edge cell's low walls come from the tile
    // before it, see the shared-edge test).
    const tile = tileOf(
      4,
      () => 90,
      (i, j) => (i === 1 && j === 1 ? [200, 180] : null),
    );
    const sky = buildFarSkyArrays(tile, [0, 1, 0], [0.5, 0.5, 0.5])!;
    expect(sky).not.toBeNull();
    // 1 cell: top (2 tris) + bottom (2) + 4 walls (2 each) = 12 triangles.
    expect(sky.indices.length).toBe(12 * 3);
    const normals = normalsOf(sky);
    expect(normals.filter(isUp).length).toBe(2);
    expect(normals.filter(isDown).length).toBe(2);
    expect(normals.filter(isSide).length).toBe(8);
    expect(ysWhere(sky, isUp)).toEqual(new Set([200]));
    expect(ysWhere(sky, isDown)).toEqual(new Set([180]));
    expect(ysWhere(sky, isSide)).toEqual(new Set([200, 180]));
    // The walls face away from the cell, one per direction.
    const facings = new Set(
      normals
        .filter(isSide)
        .map((n) => `${Math.round(n[0])},${Math.round(n[2])}`),
    );
    expect(facings).toEqual(new Set(["1,0", "-1,0", "0,1", "0,-1"]));
  });

  it("steps between two island cells only where their tops or bottoms differ", () => {
    // Cells (1,1) and (2,1) carry land; the second is a block higher on top
    // and hangs a block deeper. Everything else is air.
    const tile = tileOf(
      4,
      () => 90,
      (i, j) =>
        j === 1 && i === 1
          ? [200, 180]
          : j === 1 && i === 2
            ? [201, 179]
            : null,
    );
    const sky = buildFarSkyArrays(tile, [0, 1, 0], [0.5, 0.5, 0.5])!;
    const normals = normalsOf(sky);
    // 2 tops + 2 bottoms + outside walls (3 per cell: north, south and the
    // far side) + a top step and a bottom step between them = 4 + 6 + 2 =
    // 12 quads.
    expect(sky.indices.length).toBe(12 * 2 * 3);
    const stepWalls = normals
      .map((n, t) => [n, t] as const)
      .filter(([n, t]) => {
        // Walls in the plane of the shared edge: tx * span + 2 cells, span
        // being 3 * 8.
        if (!isSide(n) || Math.abs(n[0]) < 0.99) return false;
        return sky.positions[sky.indices[t * 3] * 3] === 1 * 24 + 16;
      });
    // Two quads at the shared edge: the top step faces -x (toward the lower
    // top), the bottom step faces -x too (toward the shallower bottom).
    expect(stepWalls.length).toBe(4);
    for (const [n] of stepWalls) expect(n[0]).toBeCloseTo(-1, 5);
    const stepYs = new Set<number>();
    for (const [, t] of stepWalls)
      for (let k = 0; k < 3; k++)
        stepYs.add(sky.positions[sky.indices[t * 3 + k] * 3 + 1]);
    expect(stepYs).toEqual(new Set([200, 201, 179, 180]));
  });

  it("walls the shared edge with the next tile where land ends or begins there", () => {
    // Land only in the shared row (the next tile's first column): this tile
    // still draws the wall that faces its own empty cells.
    const tile = tileOf(
      3,
      () => 90,
      (i) => (i === 2 ? [200, 180] : null),
    );
    const sky = buildFarSkyArrays(tile, [0, 1, 0], [0.5, 0.5, 0.5])!;
    const normals = normalsOf(sky);
    expect(normals.filter(isUp).length).toBe(0);
    const walls = normals.filter(isSide);
    expect(walls.length).toBe(4);
    for (const n of walls) expect(n[0]).toBeCloseTo(-1, 5);
    expect(ysWhere(sky, isSide)).toEqual(new Set([200, 180]));
  });
});

describe("coverage mask", () => {
  it("marks meshed chunks inside the window and nothing else", () => {
    const mask = buildCoverageMask(
      [
        [0, 0],
        [3, -2],
        [100, 100],
      ],
      -4,
      -4,
      8,
    );
    expect(mask[(0 + 4) * 8 + (0 + 4)]).toBe(255);
    expect(mask[(-2 + 4) * 8 + (3 + 4)]).toBe(255);
    expect(mask.reduce((sum, v) => sum + (v ? 1 : 0), 0)).toBe(2);
    expect(isCoveredAt(mask, -4, -4, 8, 16, 5, 7)).toBe(true);
    expect(isCoveredAt(mask, -4, -4, 8, 16, 60, -20)).toBe(true);
    expect(isCoveredAt(mask, -4, -4, 8, 16, 16, 0)).toBe(false);
    expect(isCoveredAt(mask, -4, -4, 8, 16, 1600, 1600)).toBe(false);
  });

  it("reuses the buffer it is given", () => {
    const into = new Uint8Array(4);
    into.fill(255);
    const mask = buildCoverageMask([], 0, 0, 2, into);
    expect(mask).toBe(into);
    expect(Array.from(mask)).toEqual([0, 0, 0, 0]);
  });
});

describe("isChunkColumnPending", () => {
  const settled = {
    stage: "loaded",
    isReady: true,
    isMeshOwed: false,
    loadedForMs: 0,
  } as const;

  it("owes terrain until loaded, ready and meshed", () => {
    expect(isChunkColumnPending({ ...settled, stage: null })).toBe(true);
    expect(isChunkColumnPending({ ...settled, stage: "requested" })).toBe(true);
    expect(isChunkColumnPending({ ...settled, stage: "processing" })).toBe(
      true,
    );
    expect(isChunkColumnPending({ ...settled, isReady: false })).toBe(true);
    // Loaded, with the mesh still being built: the hole real terrain is
    // about to fill.
    expect(isChunkColumnPending({ ...settled, isMeshOwed: true })).toBe(true);
    expect(
      isChunkColumnPending({
        ...settled,
        isMeshOwed: true,
        loadedForMs: CHUNK_PENDING_GRACE_MS - 1,
      }),
    ).toBe(true);
  });

  it("is settled once loaded, ready and meshed, whatever it drew", () => {
    // Loaded and empty draws nothing, and that is final: the far layer may show.
    expect(isChunkColumnPending(settled)).toBe(false);
    expect(isChunkColumnPending({ ...settled, loadedForMs: 1e9 })).toBe(false);
  });

  it("gives up on a loaded column that still owes its mesh past the grace", () => {
    // A perimeter section a missing neighbour keeps failing to mesh: the
    // far layer stands in again rather than sky for the rest of the session.
    expect(
      isChunkColumnPending({
        ...settled,
        isMeshOwed: true,
        loadedForMs: CHUNK_PENDING_GRACE_MS,
      }),
    ).toBe(false);
    expect(
      isChunkColumnPending(
        { ...settled, isReady: false, loadedForMs: 2000 },
        1000,
      ),
    ).toBe(false);
    // Not loaded at all is pending however long it has been asked for.
    expect(
      isChunkColumnPending({
        ...settled,
        stage: "requested",
        loadedForMs: 1e9,
      }),
    ).toBe(true);
  });
});

describe("pendingChunksWithin", () => {
  it("walks the render disc and keeps the columns still on their way", () => {
    // Everything inside is pending but the centre column and one neighbour.
    const loaded = new Set(["10,20", "11,20"]);
    const pending = pendingChunksWithin(
      10,
      20,
      3,
      (cx, cz) => !loaded.has(`${cx},${cz}`),
    );
    const disc: string[] = [];
    for (let ox = -3; ox <= 3; ox++)
      for (let oz = -3; oz <= 3; oz++)
        if (ox * ox + oz * oz <= 9) disc.push(`${10 + ox},${20 + oz}`);
    expect(pending.map(([x, z]) => `${x},${z}`).sort()).toEqual(
      disc.filter((key) => !loaded.has(key)).sort(),
    );
    // The corners of the square are outside the disc, so never asked about.
    expect(pending).not.toContainEqual([13, 23]);
  });

  it("is empty once everything inside is loaded, and at a radius of zero but the centre", () => {
    expect(pendingChunksWithin(0, 0, 4, () => false)).toEqual([]);
    expect(pendingChunksWithin(5, -5, 0, () => true)).toEqual([[5, -5]]);
  });
});

describe("coverage mask after a fresh arrival", () => {
  // The viewer lands at chunk (0, 0) with a render radius of 2. Only the
  // centre chunk is meshed so far; (1, 0) is loaded with nothing to draw
  // (an empty column); the rest are still on their way.
  const meshed: [number, number][] = [[0, 0]];
  const loadedEmpty = new Set(["1,0"]);
  const isPending = (cx: number, cz: number) =>
    !(cx === 0 && cz === 0) && !loadedEmpty.has(`${cx},${cz}`);
  const covered = [...pendingChunksWithin(0, 0, 2, isPending), ...meshed];
  const mask = buildCoverageMask(covered, -4, -4, 8);
  const coveredAt = (x: number, z: number) =>
    isCoveredAt(mask, -4, -4, 8, 16, x, z);

  it("hides the far layer under chunks inside the radius that have not loaded yet", () => {
    expect(coveredAt(8, 8)).toBe(true); // the meshed centre
    expect(coveredAt(-8, 8)).toBe(true); // (-1, 0): requested, not here yet
    expect(coveredAt(8, 40)).toBe(true); // (0, 2): the far edge of the disc
    expect(coveredAt(-24, 8)).toBe(true); // (-2, 0)
  });

  it("still shows it where a chunk loaded with nothing to draw, and past the radius", () => {
    expect(coveredAt(24, 8)).toBe(false); // (1, 0): loaded and empty
    expect(coveredAt(40, 40)).toBe(false); // (2, 2): outside the disc
    expect(coveredAt(56, 8)).toBe(false); // (3, 0): past the radius
  });

  it("settles to the meshed-only mask once every chunk inside has loaded (no gap, no double surface)", () => {
    const steady = buildCoverageMask(
      [...pendingChunksWithin(0, 0, 2, () => false), ...meshed],
      -4,
      -4,
      8,
    );
    expect(Array.from(steady)).toEqual(
      Array.from(buildCoverageMask(meshed, -4, -4, 8)),
    );
  });
});

describe("farTilesToEvict", () => {
  const rings = [
    { level: 0, inner: 0, outer: 256 },
    { level: 1, inner: 256, outer: 512 },
  ];
  const spanOf = (level: number) => farTileSpan(descriptor, level);

  it("keeps tiles a ring still wants or that sit within a tile of it", () => {
    const resident = [
      { level: 0, tx: 0, tz: 0 },
      { level: 0, tx: 1, tz: 0 },
      { level: 0, tx: 5, tz: 5 },
      { level: 2, tx: 0, tz: 0 },
    ];
    const needed = new Set([farTileId(resident[0])]);
    const gone = farTilesToEvict(resident, needed, 10, 10, rings, spanOf).map(
      farTileId,
    );
    // Tile (1,0) starts 246 blocks away: inside outer + span, kept.
    expect(gone).not.toContain("0:1:0");
    // Tile (5,5) is over a thousand blocks out: dropped.
    expect(gone).toContain("0:5:5");
    // A level no ring draws any more goes at once.
    expect(gone).toContain("2:0:0");
    expect(gone).not.toContain("0:0:0");
  });
});

describe("computeFogRange with a far layer", () => {
  const base = {
    chunkSize: 16,
    renderRadius: 8,
    fogNearRenderRatio: 0.45,
    fogFarRenderRatio: 0.78,
  };

  it("keeps the old range when the far layer is off or inside the loaded disc", () => {
    expect(computeFogRange(base)).toEqual({ near: 57.6, far: 99.84 });
    expect(computeFogRange({ ...base, farTerrainDistance: 100 })).toEqual({
      near: 57.6,
      far: 99.84,
    });
  });

  it("starts fog near the loaded edge and closes it at the far layer's edge", () => {
    expect(computeFogRange({ ...base, farTerrainDistance: 512 })).toEqual({
      near: 128 * 0.6,
      far: 512,
    });
    expect(
      computeFogRange({
        ...base,
        farTerrainDistance: 512,
        farTerrainFogNearRatio: 0.9,
      }),
    ).toEqual({ near: 128 * 0.9, far: 512 });
  });

  it("lets a fixed fog distance reach to the far layer, no further", () => {
    expect(
      computeFogRange({ ...base, farTerrainDistance: 512, fogDistance: 400 }),
    ).toEqual({
      near: expect.closeTo(400 * ((128 * 0.6) / 512), 5),
      far: 400,
    });
    expect(
      computeFogRange({ ...base, farTerrainDistance: 512, fogDistance: 9000 })
        .far,
    ).toBe(512);
    expect(computeFogRange({ ...base, fogDistance: 9000 }).far).toBe(128);
  });
});

describe("the seam band", () => {
  // A 16-texel window from chunk (-8, -8); the loaded disc is radius 3 in
  // chunks around the origin, as a full square for simplicity.
  const size = 16;
  const origin = -8;
  const loaded: [number, number][] = [];
  for (let cx = -3; cx <= 2; cx++)
    for (let cz = -3; cz <= 2; cz++) loaded.push([cx, cz]);
  const mask = buildCoverageMask(loaded, origin, origin, size);
  const scale = farSeamScale(16, 8);
  const weightAt = (x: number, z: number, s = scale) =>
    farSeamWeightAt(mask, origin, origin, size, 16, s, x, z);

  it("dithers with every Bayer threshold once, the same on both sides", () => {
    expect([...FAR_SEAM_BAYER].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, k) => k),
    );
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) seen.add(farSeamDither(x + 0.5, y + 0.5));
    expect(seen.size).toBe(16);
    expect(farSeamDither(100, 200)).toBe(farSeamDither(100 % 4, 200 % 4));
    for (const d of seen)
      for (const w of [0, 0.1, 0.5, 0.9, 1]) {
        // Exactly one of the two layers draws a pixel in the band.
        expect(chunkKeepsSeamPixel(w, d)).not.toBe(farKeepsSeamPixel(w, d));
      }
  });

  it("keeps every pixel for a chunk deep inside and yields every pixel at the loaded edge", () => {
    // Deep inside: weight 1 beats every threshold, so the far layer draws
    // nothing there (no double surface).
    expect(weightAt(0, 0)).toBe(1);
    expect(weightAt(8, 8)).toBe(1);
    // The loaded edge runs at x = 3 * 16 = 48: weight 0, so the chunk
    // yields every pixel and the far layer takes every one (no gap).
    expect(weightAt(48, 0)).toBe(0);
    expect(weightAt(60, 0)).toBe(0);
    expect(weightAt(400, 0)).toBe(0);
  });

  it("ramps across the outer half chunk, shorter with a narrower band", () => {
    // From the loaded edge at x = 48 back to 40 the weight climbs 0 -> 1.
    expect(weightAt(44, 0)).toBeCloseTo(0.5, 5);
    expect(weightAt(42, 0)).toBeCloseTo(0.75, 5);
    expect(weightAt(40, 0)).toBe(1);
    expect(weightAt(32, 0)).toBe(1);
    // A 4-block band reaches 1 four blocks in; a 0 band is a hard edge.
    const steep = farSeamScale(16, 4);
    expect(steep).toBe(2);
    expect(weightAt(44, 0, steep)).toBe(1);
    expect(weightAt(46, 0, steep)).toBeCloseTo(0.5, 5);
    expect(farSeamScale(16, 0)).toBe(0);
    expect(farSeamScale(16, 100)).toBe(1);
  });

  it("is the hard mask where the band is off", () => {
    const hard = 0;
    for (const x of [0, 40, 44, 47.9]) expect(weightAt(x, 0, hard)).toBe(0);
    expect(isCoveredAt(mask, origin, origin, size, 16, 47.9, 0)).toBe(true);
    expect(isCoveredAt(mask, origin, origin, size, 16, 48, 0)).toBe(false);
  });
});
