import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  Texture,
  UnsignedByteType,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import {
  type ChunkMaterialHost,
  forkChunkMaterial,
  makeChunkMaterial,
  setOwnFaceTexture,
} from "./chunk-materials";
import { ChunkRenderer } from "./chunk-renderer";
import type { ChunkShadingInputs } from "./shading/chunk-material";
import {
  applySurfaceCoatFace,
  createSurfaceWeatherUniforms,
  SURFACE_OPEN_LIGHT,
  SURFACE_POCK_MEAN,
  SURFACE_RESPONSE,
  SURFACE_WEATHER,
  surfaceCoatDensity,
  surfaceCoatDrift,
  surfaceCoatMean,
  surfacePocksShowing,
  surfaceWeatherHash2,
  surfaceWeatherPock,
} from "./surface-weather";
import { AtlasTexture } from "./textures";

describe("surface weather is inert at its defaults", () => {
  it("defaults every shared uniform to off", () => {
    const { uniforms } = new ChunkRenderer();
    expect(uniforms.surfaceWeather.value.toArray()).toEqual([0, 0, 0]);
    expect(uniforms.surfaceWeatherWindow.value.toArray()).toEqual([0, 0, 1, 1]);
    expect(uniforms.surfaceWeatherLine.value.toArray()).toEqual([
      0,
      0,
      SURFACE_WEATHER.lineBand,
      0,
    ]);
    expect(uniforms.surfaceWind.value.toArray()).toEqual([0, 0, 0, 0]);
    expect(uniforms.surfaceCoatColor.value).toBeInstanceOf(Color);

    const map = uniforms.surfaceWeatherMap.value as DataTexture;
    expect(map).toBeInstanceOf(DataTexture);
    expect([map.image.width, map.image.height]).toEqual([1, 1]);
    expect(Array.from(map.image.data as Uint8Array)).toEqual([0, 0, 0, 0]);
    expect(map.format).toBe(RGBAFormat);
    expect(map.type).toBe(UnsignedByteType);
    expect(map.magFilter).toBe(LinearFilter);
    expect(map.minFilter).toBe(LinearFilter);
    expect(map.wrapS).toBe(ClampToEdgeWrapping);
    expect(map.wrapT).toBe(ClampToEdgeWrapping);
  });

  it("gives every renderer its own uniforms", () => {
    const a = createSurfaceWeatherUniforms();
    const b = createSurfaceWeatherUniforms();
    expect(a.surfaceWeather).not.toBe(b.surfaceWeather);
    expect(a.surfaceWeatherMap.value).not.toBe(b.surfaceWeatherMap.value);
  });
});

const host = (renderer = new ChunkRenderer()): ChunkMaterialHost =>
  ({
    chunkRenderer: renderer,
    // Only read when a program builds, but by identity: the very nodes.
    shadingInputs: { id: 1, chunk: renderer.uniforms } as ChunkShadingInputs,
    hasCustomBlockMaterial: () => false,
    options: {
      textureUnitDimension: 16,
      chunkSize: 16,
      maxHeight: 256,
      subChunks: 8,
      swayProfileCapacity: 4,
      blockTextureFiltering: "nearest",
    },
  }) as unknown as ChunkMaterialHost;

const SHARED_NAMES = [
  "surfaceWeather",
  "surfaceWeatherMap",
  "surfaceWeatherWindow",
  "surfaceWeatherLine",
  "surfaceCoatColor",
  "surfaceWind",
] as const;

describe("surface weather reaches every chunk material", () => {
  // The unknown checker paints on a canvas, which the test runs without.
  (
    AtlasTexture as unknown as { sharedUnknownTexture: Texture }
  ).sharedUnknownTexture = new Texture();

  it("binds the renderer's uniforms by reference, and a response of its own", () => {
    const world = host();
    const a = makeChunkMaterial(world);
    const b = makeChunkMaterial(world);
    for (const name of SHARED_NAMES) {
      expect(a.shading.chunk[name], name).toBe(
        world.chunkRenderer.uniforms[name],
      );
      expect(b.shading.chunk[name], name).toBe(
        world.chunkRenderer.uniforms[name],
      );
    }
    expect(a.surfaceResponse).toBe(SURFACE_RESPONSE.solid);
    expect(a.surfaceOpenLight.toArray()).toEqual([...SURFACE_OPEN_LIGHT.solid]);
    expect(a.surfaceOpenLight).not.toBe(b.surfaceOpenLight);
  });

  it("opens a see-through block's faces at its own voxel's light", () => {
    // A canopy's top leaves carry 13 of 15 under open sky, a block deeper 11.
    const [from, to] = SURFACE_OPEN_LIGHT.seeThrough;
    expect(from).toBeLessThan(13 / 15);
    expect(to).toBeLessThanOrEqual(13 / 15);
    expect(from).toBeGreaterThan(11 / 15);
    // A solid face under an eave (14 of 15) only partly opens.
    const [solidFrom, solidTo] = SURFACE_OPEN_LIGHT.solid;
    expect(solidFrom).toBeLessThan(14 / 15);
    expect(solidTo).toBeGreaterThan(14 / 15);
  });

  it("keeps them on a fork, response included", () => {
    const world = host();
    const material = makeChunkMaterial(world);
    material.surfaceResponse = SURFACE_RESPONSE.cutout;
    material.surfaceOpenLight.set(...SURFACE_OPEN_LIGHT.seeThrough);
    const fork = forkChunkMaterial(material);
    for (const name of SHARED_NAMES) {
      expect(fork.shading.chunk[name], name).toBe(material.shading.chunk[name]);
    }
    expect(fork.surfaceResponse).toBe(material.surfaceResponse);
    expect(fork.surfaceOpenLight.toArray()).toEqual(
      material.surfaceOpenLight.toArray(),
    );
  });

  it("keeps the weather on a face with its own texture", () => {
    const world = host();
    const material = makeChunkMaterial(world);
    const fork = forkChunkMaterial(material);
    setOwnFaceTexture(fork, new Texture());
    expect(fork.surfaceResponse).toBe(material.surfaceResponse);
    expect(fork.shading.chunk.surfaceWeather).toBe(
      world.chunkRenderer.uniforms.surfaceWeather,
    );
  });
});

describe("the far layer's coat", () => {
  it("grows from a light dusting to drifts to white ground", () => {
    expect(surfaceCoatMean(0)).toBe(0);
    expect(surfaceCoatMean(0.12)).toBeGreaterThan(0.01);
    expect(surfaceCoatMean(0.12)).toBeLessThan(0.12);
    expect(surfaceCoatMean(0.5)).toBeGreaterThan(0.35);
    expect(surfaceCoatMean(0.5)).toBeLessThan(0.65);
    expect(surfaceCoatMean(1)).toBeGreaterThan(0.95);
  });

  it("only ever grows as it builds up, so no texel flickers", () => {
    for (let i = 0; i < 4000; i++) {
      const drift = surfaceCoatDrift(i * 0.37, i * 0.53);
      let last = 0;
      for (let coat = 0; coat <= 1.0001; coat += 0.05) {
        const density = surfaceCoatDensity(coat, drift);
        expect(density).toBeGreaterThanOrEqual(last - 1e-9);
        last = density;
      }
    }
  });

  it("averages, far away, to what it covers up close", () => {
    for (const coat of [0.1, 0.25, 0.5, 0.75, 1]) {
      let sum = 0;
      let n = 0;
      for (let x = -400; x < 400; x += 0.73) {
        for (let z = -40; z < 40; z += 3.1) {
          sum += surfaceCoatDensity(coat, surfaceCoatDrift(x, z));
          n++;
        }
      }
      expect(
        Math.abs(sum / n - surfaceCoatMean(coat)),
        `coat ${coat}`,
      ).toBeLessThan(0.035);
    }
  });

  it("takes its colour from the face's texels, and keeps it while they are unreadable", () => {
    const uniforms = createSurfaceWeatherUniforms();
    const before = uniforms.surfaceCoatColor.value.clone();
    expect(applySurfaceCoatFace(uniforms, null)).toBe(false);
    expect(uniforms.surfaceCoatColor.value.equals(before)).toBe(true);
    // Two white texels, one transparent: the mean is white.
    const pixels = [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0];
    expect(applySurfaceCoatFace(uniforms, pixels)).toBe(true);
    expect(uniforms.surfaceCoatColor.value.r).toBeCloseTo(1, 5);
  });
});

describe("drop pocks", () => {
  it("show about one splash per square block at full rain, none when dry", () => {
    const chance = SURFACE_WEATHER.pockChance;
    let showing = 0;
    let samples = 0;
    const cellsPerBlock = (16 / SURFACE_WEATHER.pockCellTexels) ** 2;
    for (let t = 0; t < 40; t += 0.137) {
      for (let cx = 0; cx < 40; cx++) {
        for (let cz = 0; cz < 8; cz++) {
          if (surfacePocksShowing(cx, cz, 1000 + t, chance)) showing++;
          samples++;
        }
      }
    }
    const perBlock = (showing / samples) * cellsPerBlock;
    expect(perBlock).toBeGreaterThan(0.8);
    expect(perBlock).toBeLessThan(1.5);
    expect(surfacePocksShowing(3, 4, 1000, 0)).toBe(false);
  });

  it("average to the faint shimmer drawn once their texels are subpixel", () => {
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 30; t += 0.0173) {
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          sum += surfaceWeatherPock(x, z, 5000 + t, 1);
          n++;
        }
      }
    }
    expect(sum / n).toBeGreaterThan(SURFACE_POCK_MEAN * 0.8);
    expect(sum / n).toBeLessThan(SURFACE_POCK_MEAN * 1.2);
    // Faint: well under a hundredth of a texel's light at full rain.
    expect(SURFACE_POCK_MEAN * SURFACE_WEATHER.pockChance).toBeLessThan(0.015);
  });

  it("hash like the shader: even, and the same for the same texel", () => {
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += surfaceWeatherHash2(i, -i * 3);
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
    expect(surfaceWeatherHash2(-5.5, 7.25)).toBe(surfaceWeatherHash2(-6, 7));
  });
});
