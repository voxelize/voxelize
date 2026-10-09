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
  CHUNK_PENDING_GRACE_MS,
  decodeFarTerrainReply,
  FarTerrainDescriptor,
  farTileId,
  farTileSpan,
  isChunkColumnPending,
  isCoveredAt,
  meanLinearRgb,
  pendingChunksWithin,
} from "./far-terrain-tiles";
import { computeFogRange } from "./fog-range";

const descriptor: FarTerrainDescriptor = {
  baseStep: 8,
  tileSamples: 33,
  levels: 3,
  waterSurface: 86.875,
};

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined)
    throw new Error("expected a value");
  return value;
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

describe("tile keys", () => {
  it("spans 32 cells of its level's step and names itself by level and position", () => {
    expect(farTileSpan(descriptor, 0)).toBe(32 * 8);
    expect(farTileSpan(descriptor, 2)).toBe(32 * 32);
    expect(farTileId({ level: 1, tx: -3, tz: 4 })).toBe("1:-3:4");
  });
});

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
    const tile = must(decodeFarTerrainReply(payload));
    expect(tile.key).toEqual({ level: 1, tx: -3, tz: 4 });
    expect(Array.from(tile.heights)).toEqual(heights);
    expect(Array.from(tile.colors)).toEqual(colors);
    expect(Array.from(must(tile.sky))).toEqual([0, 0, 200, 190, 0, 0, 0, 0]);
    expect(tile.tints).toBeNull();
    expect(tile.bytes).toBe(payload.length);
  });

  it("reads a tint per sample and refuses tints that do not fit", () => {
    const reply = {
      level: 0,
      tx: 0,
      tz: 0,
      step: 8,
      size: 2,
      heights: base64(u16Bytes([90, 90, 90, 90])),
      colors: base64(Uint8Array.from([0, 0, 0, 0])),
      tints: base64(
        Uint8Array.from([128, 128, 128, 177, 120, 79, 1, 2, 3, 4, 5, 6]),
      ),
    };
    const tile = must(decodeFarTerrainReply(JSON.stringify(reply)));
    expect(Array.from(must(tile.tints))).toEqual([
      128, 128, 128, 177, 120, 79, 1, 2, 3, 4, 5, 6,
    ]);
    expect(
      decodeFarTerrainReply({
        ...reply,
        tints: base64(Uint8Array.from([1, 2, 3])),
      }),
    ).toBeNull();
  });

  it("reads the crowns over each cell and refuses a canopy that does not fit", () => {
    const reply = {
      level: 0,
      tx: 0,
      tz: 0,
      step: 2,
      size: 2,
      heights: base64(u16Bytes([90, 90, 90, 90])),
      colors: base64(Uint8Array.from([0, 0, 0, 0])),
      canopy: base64(
        Uint8Array.from([
          16, 6, 255, 0x81, 0, 0, 0, 0, 12, 4, 128, 2, 0, 0, 0, 0,
        ]),
      ),
    };
    const tile = must(decodeFarTerrainReply(reply));
    expect(Array.from(must(tile.canopy))).toEqual([
      16, 6, 255, 0x81, 0, 0, 0, 0, 12, 4, 128, 2, 0, 0, 0, 0,
    ]);
    expect(
      decodeFarTerrainReply({ ...reply, canopy: base64(Uint8Array.from([1])) }),
    ).toBeNull();
    expect(
      must(decodeFarTerrainReply({ ...reply, canopy: undefined })).canopy,
    ).toBeNull();
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

/** Each triangle's outward normal (right-hand rule), one vec3 per triangle. */

/** The y of every vertex of the triangles whose normal passes `pick`. */

describe("meanLinearRgb", () => {
  it("averages in linear light, weighting by alpha", () => {
    // Black and white average to linear 0.5 (sRGB 188), not sRGB 128.
    const mean = meanLinearRgb([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(mean).toEqual([0.5, 0.5, 0.5].map((v) => expect.closeTo(v, 6)));
    // A transparent texel counts for nothing; a half-transparent one half.
    expect(meanLinearRgb([255, 0, 0, 255, 0, 255, 0, 0])).toEqual([1, 0, 0]);
    const half = must(meanLinearRgb([255, 255, 255, 255, 0, 0, 0, 128]));
    expect(half[0]).toBeCloseTo(255 / (255 + 128), 6);
  });

  it("is null when every texel is transparent", () => {
    expect(meanLinearRgb([10, 20, 30, 0])).toBeNull();
    expect(meanLinearRgb([])).toBeNull();
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
