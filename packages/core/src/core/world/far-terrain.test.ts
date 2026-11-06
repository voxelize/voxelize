import { DataTexture, Vector3 } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChunkRenderer } from "./chunk-renderer";
import type { FarTerrainUniforms } from "./shading/far-terrain";
import {
  FAR_TERRAIN_METHOD,
  FarBuiltTile,
  FarTerrain,
  FarTerrainOptions,
  FarTerrainSharedUniforms,
} from "./far-terrain";
import {
  buildFarLandMesh,
  buildFarSkyMesh,
  FarMeshInput,
} from "./far-terrain-mesh";
import { FarFaceLook, FarTerrainDescriptor } from "./far-terrain-tiles";

vi.mock("./workers/far-terrain-worker.ts?worker&inline", () => ({
  default: class {},
}));

/** The world's own uniform nodes, as the world hands them to the far layer. */
const shared = (): FarTerrainSharedUniforms => {
  const renderer = new ChunkRenderer();
  return {
    ...renderer.uniforms,
    ...renderer.shaderLightingUniforms,
  } as FarTerrainSharedUniforms;
};

// One level of 3-sample tiles: every tile 4 blocks wide at step 2.
const descriptor: FarTerrainDescriptor = {
  baseStep: 2,
  tileSamples: 3,
  levels: 1,
  waterSurface: 86.875,
  materials: [{ top: 1, side: 2 }],
};

const world = {
  renderRadius: 2,
  chunkSize: 16,
  loadedGeneration: 0,
  forEachMeshedChunk: () => {},
  isChunkPending: () => false,
};

const tileReply = (tx = 0, tz = 0) => {
  const heights = new Uint8Array(9 * 2);
  for (let i = 0; i < 9; i++) heights[i * 2] = 100;
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return JSON.stringify({
    level: 0,
    tx,
    tz,
    step: 2,
    size: 3,
    heights: b64(heights),
    colors: b64(new Uint8Array(9)),
  });
};

const syncBuild = (input: FarMeshInput): Promise<FarBuiltTile | null> =>
  Promise.resolve({
    land: buildFarLandMesh(input),
    sky: buildFarSkyMesh(input),
    buildMs: 0,
  });

const landMeshes = (far: FarTerrain) =>
  far.tileSlots().filter((slot) => slot.name.startsWith("far-terrain-0:"));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined)
    throw new Error("expected a value");
  return value;
};

/** Update until `done` holds or the budget of frames runs out. */
const settle = async (far: FarTerrain, done: () => boolean, frames = 12) => {
  for (let i = 0; i < frames && !done(); i++) {
    far.update(new Vector3(2, 120, 2), world);
    await flush();
  }
};

const grass: FarFaceLook = {
  color: [0.05, 0.12, 0.04],
  isTinted: true,
  pixels: new Array(16 * 16 * 4).fill(200),
  size: 16,
};

describe("FarTerrain materials", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds no tile until every face its materials name is readable", async () => {
    let ready = false;
    const far = new FarTerrain(shared(), {
      distance: 256,
      buildMesh: syncBuild,
      faceLook: () => (ready ? grass : null),
    });
    far.configure(descriptor);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    await settle(far, () => false, 3);
    expect(landMeshes(far)).toHaveLength(0);
    expect(far.stats.facesPending).toBeGreaterThan(0);

    ready = true;
    await settle(far, () => landMeshes(far).length > 0);
    expect(landMeshes(far)).toHaveLength(1);
    expect(far.stats.facesPending).toBe(0);
    expect(far.stats.tilesBuilt).toBe(1);
  });

  it("paints a face that never becomes readable grey and says which", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const far = new FarTerrain(shared(), {
      distance: 256,
      buildMesh: syncBuild,
      faceLook: () => null,
      faceLookTimeoutMs: 0,
    });
    far.configure(descriptor);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    await settle(far, () => landMeshes(far).length > 0);
    expect(landMeshes(far)).toHaveLength(1);
    expect(far.stats.facesMissing).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("block 1's top face never became readable"),
    );
  });

  it("warms every face ahead of time, so no later frame reads one", async () => {
    let reads = 0;
    const far = new FarTerrain(shared(), {
      distance: 256,
      buildMesh: syncBuild,
      faceLook: () => {
        reads += 1;
        return grass;
      },
    });
    far.configure(descriptor);
    await far.warmLooks();
    // Grass top, grass side, the side block's side.
    expect(reads).toBe(3);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    await settle(far, () => landMeshes(far).length > 0);
    expect(reads).toBe(3);
  });

  it("falls back to the palette when the server names no materials", async () => {
    const far = new FarTerrain(shared(), {
      distance: 256,
      buildMesh: syncBuild,
      palette: [0.2, 0.3, 0.4],
      faceLook: () => {
        throw new Error("no face is read without materials");
      },
    });
    far.configure({ ...descriptor, materials: undefined });
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    await settle(far, () => landMeshes(far).length > 0);
    expect(landMeshes(far)).toHaveLength(1);
  });
});

describe("FarTerrain detail", () => {
  it("draws a tile that lands where nothing is shown", async () => {
    const far = new FarTerrain(shared(), {
      distance: 256,
      buildMesh: syncBuild,
      faceLook: () => grass,
      fadeMs: 100,
    });
    far.configure(descriptor);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    await settle(far, () => landMeshes(far).length > 0);
    const [mesh] = landMeshes(far);
    // The frame after it lands, the tile is drawn.
    far.update(new Vector3(2, 120, 2), world);
    expect(far.stats.tilesDrawn).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    far.update(new Vector3(2, 120, 2), world);
    expect(mesh.visible).toBe(true);
    expect(far.stats.levelCounts).toEqual([1]);
  });

  it("asks only for tiles it does not hold", () => {
    const far = new FarTerrain(shared(), {
      distance: 12,
      buildMesh: syncBuild,
      faceLook: () => grass,
      requestIntervalMs: 0,
      maxTilesPerRequest: 100,
    });
    far.configure(descriptor);
    far.update(new Vector3(2, 120, 2), world);
    const asked = far.takePackets();
    expect(asked).toHaveLength(1);
    const tiles = JSON.parse(
      (asked[0] as { method: { payload: string } }).method.payload,
    ).tiles as number[][];
    expect(tiles.length).toBeGreaterThan(1);
    // Asked again only after the retry window, not every frame.
    far.update(new Vector3(2, 120, 2), world);
    expect(far.takePackets()).toHaveLength(0);
  });

  it("asks no more than the server's budget grants, so none is refused", () => {
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const far = new FarTerrain(shared(), {
      distance: 64,
      buildMesh: syncBuild,
      faceLook: () => grass,
      requestIntervalMs: 0,
      maxTilesPerRequest: 100,
      budgetHeadroom: 1,
    });
    far.configure({
      ...descriptor,
      budget: { tilesPerSecond: 10, burst: 5, maxTilesPerRequest: 16 },
    });
    const asked = () =>
      far
        .takePackets()
        .flatMap(
          (packet) =>
            JSON.parse(
              (packet as { method: { payload: string } }).method.payload,
            ).tiles as number[][],
        );
    const at = new Vector3(2, 120, 2);
    // The burst, one tile short of it, nearest first.
    far.update(at, world);
    const first = asked();
    expect(first).toHaveLength(4);
    expect(first[0]).toEqual([0, 0, 0]);
    // Spent: nothing until the bucket refills.
    far.update(at, world);
    expect(asked()).toHaveLength(0);
    // A quarter second at 10 a second: two whole tiles.
    clock += 250;
    far.update(at, world);
    expect(asked()).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it("keeps a tall tile split, and resident as its children's stand-in", async () => {
    // Two levels; the root splits for its relief alone, never for distance.
    const far = new FarTerrain(shared(), {
      distance: 1,
      buildMesh: syncBuild,
      faceLook: () => grass,
      fadeMs: 1,
      evictAfterMs: 0,
      requestIntervalMs: 0,
      retryAfterMs: 60_000,
      maxTilesPerRequest: 100,
      lod: { splitFactor: 0, reliefSplit: 0.1, reliefMinLevel: 0 },
    });
    far.configure({ ...descriptor, levels: 2 });
    const asked = () =>
      far
        .takePackets()
        .flatMap(
          (packet) =>
            JSON.parse(
              (packet as { method: { payload: string } }).method.payload,
            ).tiles as number[][],
        );
    const reply = (level: number, heights: number[]) => {
      const bytes = new Uint8Array(heights.length * 2);
      heights.forEach((height, i) => (bytes[i * 2] = height));
      const b64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
      far.onMethodReply(
        FAR_TERRAIN_METHOD,
        JSON.stringify({
          level,
          tx: 0,
          tz: 0,
          step: 2 << level,
          size: 3,
          heights: b64(bytes),
          colors: b64(new Uint8Array(heights.length)),
        }),
      );
    };
    const at = new Vector3(2, 120, 2);
    far.update(at, world);
    expect(asked()).toEqual([[1, 0, 0]]);
    reply(1, [100, 104, 100, 100, 100, 100, 100, 100, 100]);
    await settle(far, () => far.stats.tilesBuilt === 1);
    far.update(at, world);
    expect(asked()).toEqual([[0, 0, 0]]);
    reply(0, new Array(9).fill(100));
    await settle(far, () => far.stats.levelCounts[0] === 1);
    // The root is drawn no more, yet stays for when its child goes missing,
    // and is never asked for twice.
    await settle(far, () => false, 6);
    expect(far.stats.tilesResident).toBe(2);
    far.update(at, world);
    expect(asked()).toEqual([]);
    expect(far.stats.levelCounts).toEqual([1, 0]);
  });
});

describe("FarTerrain coverage", () => {
  // Two levels of 9-sample tiles: a level-0 tile is one chunk column, and
  // the viewer stands in column (0, 0), the one still on its way.
  const coverage = (options: Partial<FarTerrainOptions>) => {
    const uniforms = shared();
    const far = new FarTerrain(uniforms, {
      distance: 1,
      buildMesh: syncBuild,
      faceLook: () => grass,
      fadeMs: 1,
      requestIntervalMs: 0,
      retryAfterMs: 60_000,
      maxTilesPerRequest: 100,
      ...options,
    });
    far.configure({ ...descriptor, tileSamples: 9, levels: 2 });
    let isLanded = false;
    // In the scene with a section or more but still owing the rest.
    let isPartial = false;
    // Whether the column still owes meshes once in the scene: false once
    // it stops owing them with no mesh landing (its grace out).
    let isOwed = true;
    // Whether the world drew chunk (0, 0) on the last frame.
    let isShown = false;
    const chunks = {
      ...world,
      renderRadius: 1,
      loadedGeneration: 0,
      forEachMeshedChunk: (callback: (cx: number, cz: number) => void) => {
        if (isLanded || isPartial) callback(0, 0);
      },
      isChunkPending: (cx: number, cz: number) =>
        !isLanded && isOwed && cx === 0 && cz === 0,
    };
    const at = new Vector3(8, 120, 8);
    const coveredAt = (cx: number, cz: number) => {
      const cover = uniforms.farCover.value;
      const mask = must(uniforms.farCoverMask.value) as DataTexture;
      const data = mask.image.data as Uint8Array;
      return data[(cz - cover.y) * cover.w + (cx - cover.x)];
    };
    const reply = (level: number) => {
      const bytes = new Uint8Array(81 * 2);
      for (let i = 0; i < 81; i++) bytes[i * 2] = 100;
      const b64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
      far.onMethodReply(
        FAR_TERRAIN_METHOD,
        JSON.stringify({
          level,
          tx: 0,
          tz: 0,
          step: 2 << level,
          size: 9,
          heights: b64(bytes),
          colors: b64(new Uint8Array(81)),
        }),
      );
    };
    // One frame as the world runs it: its visibility pass asks which
    // chunks in the scene to hide, then the far layer updates.
    const frame = () => {
      isShown = false;
      chunks.forEachMeshedChunk((cx, cz) => {
        isShown = !far.hidesChunk(cx, cz, () => chunks.isChunkPending(cx, cz));
      });
      far.update(at, chunks);
    };
    const run = async (done: () => boolean) => {
      for (let i = 0; i < 12 && !done(); i++) {
        frame();
        await flush();
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    };
    const land = () => {
      isLanded = true;
      isPartial = false;
      chunks.loadedGeneration += 1;
      frame();
    };
    const landPart = () => {
      isPartial = true;
      chunks.loadedGeneration += 1;
      frame();
    };
    const outlast = () => {
      isOwed = false;
      frame();
    };
    return {
      far,
      coveredAt,
      reply,
      run,
      land,
      landPart,
      outlast,
      isShown: () => isShown,
      update: () => far.update(at, chunks),
    };
  };

  it("stands in for a chunk on its way with any tile it draws", async () => {
    const { far, coveredAt, reply, run, land } = coverage({
      pendingGuardRadius: 0,
    });

    // Only the coarser tile has landed, drawn in place of the one the
    // plan wants: it keeps the column's terrain rather than a hole of sky.
    reply(1);
    await run(() => far.stats.pendingStoodIn === 1);
    expect(far.stats.levelCounts).toEqual([0, 1]);
    expect(coveredAt(0, 0)).toBe(0);
    expect(far.stats.pendingCovered).toBe(0);
    expect(far.drawsColumn(0, 0)).toBe(true);
    // The coarser tile spans two columns; the third lies past it.
    expect(far.drawsColumn(2, 0)).toBe(false);

    // The tile the plan wants takes over, and keeps standing in.
    reply(0);
    await run(() => far.stats.levelCounts[0] === 1);
    await run(() => far.stats.pendingStoodIn === 1);
    expect(far.stats.levelCounts).toEqual([1, 0]);
    expect(coveredAt(0, 0)).toBe(0);

    // The chunk lands and draws: the far layer leaves it.
    land();
    expect(coveredAt(0, 0)).toBe(255);
    expect(far.stats.pendingStoodIn).toBe(0);

    // A layer switched off draws nothing, whatever it last stood in for.
    far.distance = 0;
    land();
    expect(far.drawsColumn(0, 0)).toBe(false);
  });

  it("keeps drawing a chunk's column until every section of it has meshed", async () => {
    const { far, coveredAt, reply, run, land, landPart, isShown } = coverage({
      pendingGuardRadius: 0,
    });
    reply(0);
    await run(() => far.stats.pendingStoodIn === 1);

    // A first section lands: the chunk is held back and the far layer keeps
    // the column, rather than opening it onto the sky section by section.
    // Hidden on the very frame it lands: shown then, it flashed through the
    // stand-in for a frame before the far layer held it.
    landPart();
    expect(isShown()).toBe(false);
    expect(far.isHeld(0, 0)).toBe(true);
    expect(coveredAt(0, 0)).toBe(0);

    // The last section lands: the two change hands in one frame.
    land();
    expect(isShown()).toBe(true);
    expect(far.isHeld(0, 0)).toBe(false);
    expect(coveredAt(0, 0)).toBe(255);
  });

  it("gives a held chunk its column the frame it stops owing meshes, with none landing", async () => {
    const { far, coveredAt, reply, run, landPart, outlast, isShown } = coverage(
      { pendingGuardRadius: 0 },
    );
    reply(0);
    await run(() => far.stats.pendingStoodIn === 1);
    landPart();
    expect(far.isHeld(0, 0)).toBe(true);

    // Its grace runs out with a section still owed: nothing loads or
    // meshes, yet the world shows it, so the mask lets go in the same
    // frame rather than at its next recheck, with both drawing meanwhile.
    outlast();
    expect(isShown()).toBe(true);
    expect(far.isHeld(0, 0)).toBe(false);
    expect(coveredAt(0, 0)).toBe(255);
  });

  it("holds no chunk on a frame the world hides none", async () => {
    const { far, coveredAt, reply, run, landPart, update } = coverage({
      pendingGuardRadius: 0,
    });
    reply(0);
    await run(() => far.stats.pendingStoodIn === 1);
    landPart();
    expect(far.isHeld(0, 0)).toBe(true);

    // A world that culls nothing asks about no chunk and hides none: the
    // far layer stepping aside is what keeps the column from being drawn
    // twice.
    update();
    expect(far.isHeld(0, 0)).toBe(false);
    expect(coveredAt(0, 0)).toBe(255);
  });

  it("shows a tile over nothing whole at once, but dissolves one over a coarser tile", async () => {
    const { far, reply, run } = coverage({
      pendingGuardRadius: 0,
      fadeMs: 60_000,
    });
    // Nothing of the column's ground is on screen: the coarser tile is
    // whole on its first frame, so it stands in at once.
    reply(1);
    await run(() => far.stats.levelCounts[1] === 1);
    expect(far.drawsColumn(0, 0)).toBe(true);
    // The finer tile lands over it and dissolves in over the minute's
    // fade; the coarser one keeps standing in while it dissolves out.
    reply(0);
    await run(() => far.stats.levelCounts[0] === 1);
    await run(() => false);
    expect(far.stats.levelCounts).toEqual([1, 0]);
    expect(far.drawsColumn(0, 0)).toBe(true);
    expect(far.stats.pendingCovered).toBe(0);
  });

  it("keeps sky over a chunk on its way right by the viewer", async () => {
    const { far, coveredAt, reply, run } = coverage({});
    reply(0);
    await run(() => far.stats.levelCounts[0] === 1);
    await run(() => false);
    // The tile is drawn, but a column inside the guard radius never shows
    // a stand-in: from a canyon floor it would show through the walls.
    expect(far.stats.levelCounts).toEqual([1, 0]);
    expect(coveredAt(0, 0)).toBe(255);
    expect(far.stats.pendingCovered).toBe(1);
    expect(far.stats.pendingStoodIn).toBe(0);
    expect(far.drawsColumn(0, 0)).toBe(false);
  });

  it("keeps a tile it stopped drawing for a minute, under the cap", async () => {
    const far = new FarTerrain(shared(), {
      distance: 1,
      buildMesh: syncBuild,
      faceLook: () => grass,
      fadeMs: 1,
      requestIntervalMs: 0,
      retryAfterMs: 60_000,
    });
    far.configure({ ...descriptor, levels: 1 });
    far.update(new Vector3(2, 120, 2), world);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    await settle(far, () => far.stats.levelCounts[0] === 1);
    // Far away, the tile is drawn no more and dissolves out.
    const away = new Vector3(82, 120, 2);
    for (let i = 0; i < 6; i++) {
      far.update(away, world);
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(far.stats.tilesDrawn).toBe(0);
    expect(far.stats.tilesResident).toBe(1);
    // Twenty seconds on it is still there for the way back; past a minute
    // it leaves.
    const left = performance.now();
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValue(left + 20_000);
    far.update(away, world);
    expect(far.stats.tilesResident).toBe(1);
    clock.mockReturnValue(left + 61_000);
    far.update(away, world);
    expect(far.stats.tilesResident).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("FarTerrain water", () => {
  it("knows how deep the sea is wherever a tile has said", async () => {
    const far = new FarTerrain(shared(), {
      distance: 256,
      buildMesh: syncBuild,
      faceLook: () => grass,
    });
    far.configure({ ...descriptor, levels: 2 });
    far.update(new Vector3(2, 120, 2), world);
    // A sea floor at 60, 27 blocks under the plane at 86.875; and a dry tile.
    const heights = new Uint8Array(9 * 2);
    for (let i = 0; i < 9; i++) heights[i * 2] = 60;
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    far.onMethodReply(
      FAR_TERRAIN_METHOD,
      JSON.stringify({
        level: 0,
        tx: 0,
        tz: 0,
        step: 2,
        size: 3,
        heights: b64(heights),
        colors: b64(new Uint8Array(9)),
      }),
    );
    // Tiles here are 4 blocks wide and a texel 8: the dry one well away.
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply(10, 0));
    // What the far water reads: the depth map and its window.
    const uniforms = (
      far as unknown as {
        uniforms: FarTerrainUniforms;
      }
    ).uniforms;
    const window = uniforms.depthWindow.value;
    const map = uniforms.depthMap.value as DataTexture;
    const depth = map.image.data as Uint8Array;
    const at = (x: number, z: number) =>
      depth[
        Math.floor((z - window.y) / window.z) * window.w +
          Math.floor((x - window.x) / window.z)
      ];
    expect(at(1, 1)).toBe(Math.round(((86.875 - 60) / 32) * 255));
    expect(at(41, 1)).toBe(0);
    // A coarser tile over the same ground, arriving later, says less.
    const coarse = new Uint8Array(9 * 2).fill(0);
    for (let i = 0; i < 9; i++) coarse[i * 2] = 100;
    far.onMethodReply(
      FAR_TERRAIN_METHOD,
      JSON.stringify({
        level: 1,
        tx: 0,
        tz: 0,
        step: 4,
        size: 3,
        heights: b64(coarse),
        colors: b64(new Uint8Array(9)),
      }),
    );
    expect(at(1, 1)).toBe(Math.round(((86.875 - 60) / 32) * 255));
  });
});
