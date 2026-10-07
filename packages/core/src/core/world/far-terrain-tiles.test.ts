import { describe, expect, it } from "vitest";

import {
  buildCoverageMask,
  buildFarLandArrays,
  buildFarSkyArrays,
  decodeFarTerrainReply,
  farTerrainRings,
  FarTerrainDescriptor,
  FarTileData,
  farTileId,
  farTilesToEvict,
  farTileSpan,
  isCoveredAt,
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

describe("buildFarLandArrays", () => {
  it("places samples on the tile's lattice with palette colours", () => {
    const tile = tileOf(3, (i, j) => 100 + i + 10 * j);
    const palette = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const { positions, colors, indices } = buildFarLandArrays(tile, palette);
    expect(positions.length).toBe(9 * 3);
    // Sample (1, 2) sits at world (tx*span + 8, tz*span + 16).
    const span = 2 * 8;
    const at = (2 * 3 + 1) * 3;
    expect(positions[at]).toBe(1 * span + 8);
    expect(positions[at + 1]).toBe(100 + 1 + 20);
    expect(positions[at + 2]).toBe(-1 * span + 16);
    // Class (i + j) % 3 = 0 at the origin: red.
    expect(Array.from(colors.subarray(0, 3))).toEqual([1, 0, 0]);
    // Four cells, two triangles each, wound upward.
    expect(indices.length).toBe(4 * 6);
    const i0 = indices[0];
    const i1 = indices[1];
    const i2 = indices[2];
    const p = (k: number) => [positions[k * 3], positions[k * 3 + 2]];
    const [ax, az] = p(i0);
    const [bx, bz] = p(i1);
    const [cx, cz] = p(i2);
    // Counter-clockwise seen from +y in a right-handed world means a
    // negative signed area in the xz plane.
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    expect(area).toBeLessThan(0);
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

  it("makes a top, an underside and four walls for one island cell", () => {
    const tile = tileOf(
      3,
      () => 90,
      (i, j) => (i < 2 && j < 2 ? [200, 180] : null),
    );
    const sky = buildFarSkyArrays(tile, [0, 1, 0], [0.5, 0.5, 0.5])!;
    expect(sky).not.toBeNull();
    // 1 cell: top (2 tris) + bottom (2) + 4 walls (2 each) = 12 triangles.
    expect(sky.indices.length).toBe(12 * 3);
    const ys = new Set<number>();
    for (let k = 1; k < sky.positions.length; k += 3) ys.add(sky.positions[k]);
    expect(ys).toEqual(new Set([200, 180]));
  });

  it("shares no wall between two neighbouring island cells", () => {
    const tile = tileOf(
      4,
      () => 90,
      (i, j) => (j < 2 ? [200, 180] : null),
    );
    const sky = buildFarSkyArrays(tile, [0, 1, 0], [0.5, 0.5, 0.5])!;
    // Three cells in a row: 3 tops + 3 bottoms + walls on the outside only
    // (3 north + 3 south + 1 west + 1 east = 8) = 6 + 8 = 14 quads.
    expect(sky.indices.length).toBe(14 * 2 * 3);
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
