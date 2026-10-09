/**
 * The far layer past the meshed chunks: the engine's own `FarTerrain` (the
 * horizon a game client draws, with its rings, seam and coverage mask),
 * fed from the viewer backend instead of a server method. Tiles also keep
 * their extra rasters for the overlays.
 */
import {
  type FarTerrainDescriptor,
  FAR_TERRAIN_METHOD,
  FarTerrain,
} from "@voxelize/core";
import type { Vector3 } from "three";

import type { ChunkLayer } from "./chunk-layer";
import { decodeBundle, decodeFarTile, type FarTileFile } from "./formats";
import type { ViewerMaterials } from "./materials";

export type FarPalette = {
  /** Linear RGB per class, flattened (class sources). */
  classes?: number[];
  water: string;
  skyTop: string;
  skySide: string;
};

export type FarSpec = { x0: number; z0: number; step: number; size: number };

const toBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
};

/** Fetches far tiles in batches and decodes them. */
export class FarTileClient {
  constructor(private readonly url: string) {}

  async fetch(specs: FarSpec[]): Promise<FarTileFile[]> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tiles: specs }),
    });
    if (!response.ok)
      throw new Error(`${response.status} ${await response.text()}`);
    const buffer = await response.arrayBuffer();
    const out: FarTileFile[] = [];
    for (const entry of decodeBundle<{ error?: string }>(buffer)) {
      if (entry.header.error) throw new Error(entry.header.error);
      out.push(decodeFarTile(buffer, entry.offset, entry.length));
    }
    return out;
  }
}

export class FarLayer {
  readonly terrain: FarTerrain;

  readonly descriptor: FarTerrainDescriptor;

  private client: FarTileClient;

  private inFlight = 0;

  private palette: number[];

  private classOf = new Map<number, number>();

  private failures = 0;

  /** Heights of recent tiles, finest last, for picking and ground-following. */
  private heights: {
    x0: number;
    z0: number;
    step: number;
    size: number;
    heights: Uint16Array;
  }[] = [];

  constructor(
    url: string,
    materials: ViewerMaterials,
    private readonly kind: "blocks" | "classes",
    palette: FarPalette,
    private readonly blockColors: () => Map<number, [number, number, number]>,
    waterSurface: number,
  ) {
    this.client = new FarTileClient(url);
    const u = materials.chunkRenderer.uniforms;
    const l = materials.chunkRenderer.shaderLightingUniforms;
    this.palette = palette.classes ? [...palette.classes] : [0.5, 0.5, 0.5];
    // Finer than a game client's horizon (8): a viewer frames its far layer
    // from above, where a coarse step reads as a mosaic.
    this.descriptor = { baseStep: 4, tileSamples: 33, levels: 4, waterSurface };
    this.terrain = new FarTerrain(
      {
        fogColor: u.fogColor,
        fogNear: u.fogNear,
        fogFar: u.fogFar,
        fogHeightOrigin: u.fogHeightOrigin,
        fogHeightDensity: u.fogHeightDensity,
        fogVerticalBlend: u.fogVerticalBlend,
        skyFogTopColor: u.skyFogTopColor,
        skyFogMiddleColor: u.skyFogMiddleColor,
        skyFogBottomColor: u.skyFogBottomColor,
        skyFogOffset: u.skyFogOffset,
        skyFogVoidOffset: u.skyFogVoidOffset,
        skyFogExponent: u.skyFogExponent,
        skyFogExponent2: u.skyFogExponent2,
        skyFogDimension: u.skyFogDimension,
        skyFogStrength: u.skyFogStrength,
        sunlightIntensity: u.sunlightIntensity,
        minLightLevel: u.minLightLevel,
        baseAmbient: u.baseAmbient,
        faceShades: u.faceShades,
        cameraSubmersion: u.cameraSubmersion,
        cameraWaterPlaneY: u.cameraWaterPlaneY,
        underwaterAmbient: u.underwaterAmbient,
        underwaterViewScale: u.underwaterViewScale,
        sunDirection: l.sunDirection,
        sunColor: l.sunColor,
        ambientColor: l.ambientColor,
        farCoverMask: u.farCoverMask,
        farCover: u.farCover,
        farSeam: u.farSeam,
      },
      {
        distance: 0,
        palette: this.palette,
        waterColor: palette.water,
        skyTopColor: palette.skyTop,
        skySideColor: palette.skySide,
        maxTilesPerRequest: 12,
        requestIntervalMs: 60,
        retryAfterMs: 15000,
        buildBudgetMs: 1.5,
      },
    );
    this.terrain.configure(this.descriptor);
  }

  get stats() {
    return {
      ...this.terrain.stats,
      inFlight: this.inFlight,
      failures: this.failures,
    };
  }

  /** Surface height from the finest tile holding (x, z), or null. */
  heightAt(x: number, z: number): number | null {
    let best: { step: number; y: number } | null = null;
    for (const t of this.heights) {
      const i = Math.round((x - t.x0) / t.step);
      const j = Math.round((z - t.z0) / t.step);
      if (i < 0 || j < 0 || i >= t.size || j >= t.size) continue;
      const y = t.heights[j * t.size + i];
      if (y > 0 && (!best || t.step < best.step)) best = { step: t.step, y };
    }
    return best?.y ?? null;
  }

  /** Nothing in flight and the layer has stopped asking for tiles. */
  isIdle() {
    return this.inFlight === 0 && this.quietUpdates >= 12;
  }

  private quietUpdates = 0;

  update(
    position: Vector3,
    distance: number,
    near: ChunkLayer,
    nearRadius: number,
  ) {
    this.terrain.distance = distance;
    this.terrain.update(position, {
      renderRadius: nearRadius,
      chunkSize: near.chunkSize,
      loadedGeneration: near.generation,
      forEachMeshedChunk: (callback) => near.forEachMeshed(callback),
      isChunkPending: () => false,
    });
    const packets = this.terrain.takePackets();
    this.quietUpdates = packets.length ? 0 : this.quietUpdates + 1;
    for (const packet of packets) {
      const payload = JSON.parse(
        (packet as { method?: { payload?: string } }).method?.payload ?? "{}",
      ) as { tiles?: [number, number, number][] };
      const keys = payload.tiles ?? [];
      if (keys.length) this.load(keys);
    }
  }

  private paletteIndex(material: number): number {
    if (this.kind === "classes") return Math.min(255, material);
    let index = this.classOf.get(material);
    if (index === undefined) {
      index = Math.min(255, this.classOf.size + 1);
      this.classOf.set(material, index);
      const color = this.blockColors().get(material) ?? [0.5, 0.5, 0.5];
      this.palette[index * 3] = color[0];
      this.palette[index * 3 + 1] = color[1];
      this.palette[index * 3 + 2] = color[2];
      this.terrain.setPalette(this.palette);
    }
    return index;
  }

  private async load(keys: [number, number, number][]) {
    const span = this.descriptor.tileSamples - 1;
    const specs = keys.map(([level, tx, tz]) => {
      const step = this.descriptor.baseStep << level;
      return {
        x0: tx * span * step,
        z0: tz * span * step,
        step,
        size: span + 1,
      };
    });
    this.inFlight += 1;
    try {
      const tiles = await this.client.fetch(specs);
      tiles.forEach((tile, i) => {
        const [level, tx, tz] = keys[i];
        this.heights.push({
          x0: tile.x0,
          z0: tile.z0,
          step: tile.step,
          size: tile.size,
          heights: tile.heights,
        });
        if (this.heights.length > 256) this.heights.shift();
        const colors = new Uint8Array(tile.materials.length);
        for (let s = 0; s < colors.length; s++) {
          colors[s] =
            tile.heights[s] === 0 ? 0 : this.paletteIndex(tile.materials[s]);
        }
        const heights = new Uint8Array(
          tile.heights.buffer.slice(
            tile.heights.byteOffset,
            tile.heights.byteOffset + tile.heights.byteLength,
          ),
        );
        this.terrain.onMethodReply(FAR_TERRAIN_METHOD, {
          level,
          tx,
          tz,
          step: tile.step,
          size: tile.size,
          heights: toBase64(heights),
          colors: toBase64(colors),
        });
      });
    } catch (error) {
      this.failures += 1;
      console.error(`[viewer] far tiles failed: ${(error as Error).message}`);
    } finally {
      this.inFlight -= 1;
    }
  }

  dispose() {
    this.terrain.dispose();
  }
}
