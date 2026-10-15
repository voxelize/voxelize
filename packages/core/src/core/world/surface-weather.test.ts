import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  Texture,
  Uniform,
  UnsignedByteType,
  Vector3,
  Vector4,
} from "three";
import { describe, expect, it, vi } from "vitest";

import {
  forkChunkMaterial,
  makeChunkShaderMaterial,
  setOwnFaceTexture,
  type ChunkMaterialHost,
} from "./chunk-materials";
import { ChunkRenderer } from "./chunk-renderer";
import { FarTerrain, type FarTerrainSharedUniforms } from "./far-terrain";
import {
  CHUNK_TEXTURE_SAMPLE_GLSL,
  createSwayTableShader,
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_CROSS_CHUNK_SHADERS,
  SHADER_LIGHTING_FLUID_CHUNK_SHADERS,
  SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS,
} from "./shaders";
import {
  applySurfaceCoatFace,
  createSurfaceWeatherUniforms,
  isTexelPuddle,
  stripSurfaceWeatherFromFragment,
  SURFACE_OPEN_LIGHT,
  SURFACE_POCK_MEAN,
  SURFACE_RESPONSE,
  SURFACE_WEATHER,
  SURFACE_WEATHER_ALBEDO_FRAGMENT,
  SURFACE_WEATHER_FAR_ALBEDO_FRAGMENT,
  SURFACE_WEATHER_FAR_SHEEN_FRAGMENT,
  SURFACE_WEATHER_LIGHT_FRAGMENT,
  SURFACE_WEATHER_TERRAIN_OPEN,
  SURFACE_WEATHER_WATER_CREST_FRAGMENT,
  SURFACE_WEATHER_WATER_RINGS_FRAGMENT,
  surfaceCoatDensity,
  surfaceCoatDrift,
  surfaceCoatMean,
  surfacePocksShowing,
  surfaceWeatherHash2,
  surfaceWeatherPock,
} from "./surface-weather";
import { AtlasTexture } from "./textures";

vi.mock("./workers/far-terrain-worker.ts?worker&inline", () => ({
  default: class {},
}));

const swayTable = createSwayTableShader(SHADER_LIGHTING_CHUNK_SHADERS, 4);

const VARIANTS: Record<string, string> = {
  opaque: SHADER_LIGHTING_CHUNK_SHADERS.fragment,
  fluid: SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment,
  seeThrough: SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS.fragment,
  cross: SHADER_LIGHTING_CROSS_CHUNK_SHADERS.fragment,
  swayTable: swayTable.fragmentShader,
};

const count = (source: string, needle: string) =>
  source.split(needle).length - 1;

/** Every statement of a pass ahead of its switch: plain constant declarations. */
const leadingStatements = (pass: string) =>
  pass
    .slice(0, pass.indexOf(SURFACE_WEATHER_TERRAIN_OPEN))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));

describe("surface weather is inert at its defaults", () => {
  it("defaults every shared uniform to off", () => {
    const { uniforms } = new ChunkRenderer();
    expect(uniforms.surfaceWeather.value.toArray()).toEqual([0, 0, 0, 0]);
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

  it("keeps each pass behind a uniform switch, with nothing ahead of it but zeroed declarations", () => {
    for (const pass of [
      SURFACE_WEATHER_ALBEDO_FRAGMENT,
      SURFACE_WEATHER_LIGHT_FRAGMENT,
    ]) {
      expect(pass).toContain(SURFACE_WEATHER_TERRAIN_OPEN);
      for (const statement of leadingStatements(pass)) {
        expect(statement).toMatch(/^float surfaceWeather\w+ = [0-9.]+;$/);
      }
    }
    // Uniforms alone, so the branch is uniform: no varying in its test.
    expect(SURFACE_WEATHER_TERRAIN_OPEN).toMatch(
      /^if \(uSurfaceWeather != vec4\(0\.0\) && uSurfaceResponse != vec2\(0\.0\)\) \{$/,
    );
    expect(SURFACE_WEATHER_WATER_RINGS_FRAGMENT.trim()).toMatch(
      /^if \(uSurfaceWeather\.x > 0\.0\) \{/,
    );
    // The crest only ever comes from the rings.
    expect(SURFACE_WEATHER_WATER_CREST_FRAGMENT.trim()).toMatch(
      /^if \(surfaceWeatherRingCrest > 0\.0\) \{/,
    );
    expect(SURFACE_WEATHER_FAR_ALBEDO_FRAGMENT).toContain(
      "if (uSurfaceWeather != vec4(0.0)) {",
    );
    expect(SURFACE_WEATHER_FAR_SHEEN_FRAGMENT.trim()).toMatch(
      /^if \(surfaceWeatherFarWetUp > 0\.0\) \{/,
    );
  });

  it("strips out of every chunk variant whole, leaving no trace", () => {
    for (const [name, fragment] of Object.entries(VARIANTS)) {
      const stripped = stripSurfaceWeatherFromFragment(fragment);
      expect(stripped, name).not.toMatch(
        /uSurface(Weather|Coat|Response|Wind)|surfaceWeather|surfaceCoat|surfacePuddle|\bsw[A-Z]/,
      );
    }
  });

  it("compiles the ground's passes out of the fluid variant, and keeps its rings", () => {
    expect(count(VARIANTS.opaque, SURFACE_WEATHER_TERRAIN_OPEN)).toBe(2);
    expect(count(VARIANTS.seeThrough, SURFACE_WEATHER_TERRAIN_OPEN)).toBe(2);
    expect(count(VARIANTS.fluid, SURFACE_WEATHER_TERRAIN_OPEN)).toBe(0);
    expect(VARIANTS.fluid).toContain(SURFACE_WEATHER_WATER_RINGS_FRAGMENT);
    expect(VARIANTS.fluid).toContain(SURFACE_WEATHER_WATER_CREST_FRAGMENT);
  });

  it("leaves the anchors other shaders patch where they were, once each", () => {
    for (const [name, fragment] of Object.entries(VARIANTS)) {
      expect(count(fragment, "outgoingLight.rgb *= totalLight;"), name).toBe(1);
      expect(count(fragment, CHUNK_TEXTURE_SAMPLE_GLSL), name).toBe(1);
      expect(count(fragment, "void main() {"), name).toBe(1);
      // The lighting anchor comes before the weather's light pass, so a
      // patched lighting line is still lit weather.
      const lightPass = fragment.indexOf("float swNdotV");
      if (lightPass >= 0) {
        expect(
          fragment.indexOf("outgoingLight.rgb *= totalLight;"),
          name,
        ).toBeLessThan(lightPass);
      }
    }
    // Only the water's own branch opens on the fluid flag.
    expect(count(VARIANTS.fluid, "if (vIsFluid > 0.5) {")).toBe(1);
    expect(count(VARIANTS.opaque, "if (vIsFluid > 0.5) {")).toBe(0);
    expect(
      count(
        SURFACE_WEATHER_ALBEDO_FRAGMENT + SURFACE_WEATHER_LIGHT_FRAGMENT,
        "vIsFluid > 0.5",
      ),
    ).toBe(0);
  });

  it("paints no snow on the chunks: near the player it is blocks", () => {
    for (const pass of [
      SURFACE_WEATHER_ALBEDO_FRAGMENT,
      SURFACE_WEATHER_LIGHT_FRAGMENT,
    ]) {
      expect(pass).not.toMatch(/coat/i);
    }
    for (const variant of [VARIANTS.opaque, VARIANTS.swayTable]) {
      expect(variant).not.toContain("uSurfaceCoatColor");
    }
  });
});

const host = (renderer = new ChunkRenderer()): ChunkMaterialHost =>
  ({
    chunkRenderer: renderer,
    lightCones: { uniformBindings: {} },
    localLights: { uniformBindings: {} },
    swayProfileTable: new Uniform([]),
    hasCustomBlockMaterial: () => false,
    options: {
      chunkUniformsOverwrite: {},
      textureUnitDimension: 16,
      chunkSize: 16,
      maxHeight: 256,
      subChunks: 8,
      swayProfileCapacity: 4,
      blockTextureFiltering: "nearest",
    },
  }) as unknown as ChunkMaterialHost;

const SHARED_NAMES = {
  uSurfaceWeather: "surfaceWeather",
  uSurfaceWeatherMap: "surfaceWeatherMap",
  uSurfaceWeatherWindow: "surfaceWeatherWindow",
  uSurfaceWeatherLine: "surfaceWeatherLine",
  uSurfaceCoatColor: "surfaceCoatColor",
  uSurfaceWind: "surfaceWind",
} as const;

describe("surface weather reaches every chunk material", () => {
  // The unknown checker paints on a canvas, which the test runs without.
  (
    AtlasTexture as unknown as { sharedUnknownTexture: Texture }
  ).sharedUnknownTexture = new Texture();

  it("binds the renderer's uniforms by reference, and a response of its own", () => {
    const world = host();
    const a = makeChunkShaderMaterial(world);
    const b = makeChunkShaderMaterial(world);
    for (const [shaderName, name] of Object.entries(SHARED_NAMES)) {
      expect(a.uniforms[shaderName], shaderName).toBe(
        world.chunkRenderer.uniforms[name],
      );
      expect(b.uniforms[shaderName], shaderName).toBe(
        world.chunkRenderer.uniforms[name],
      );
    }
    expect(a.uniforms.uSurfaceResponse.value.toArray()).toEqual([
      ...SURFACE_RESPONSE.solid,
    ]);
    expect(a.uniforms.uSurfaceOpenLight.value.toArray()).toEqual([
      ...SURFACE_OPEN_LIGHT.solid,
    ]);
    expect(a.uniforms.uSurfaceResponse).not.toBe(b.uniforms.uSurfaceResponse);
    expect(a.uniforms.uSurfaceOpenLight).not.toBe(b.uniforms.uSurfaceOpenLight);
  });

  it("takes the host's overwrites", () => {
    const world = host();
    const surfaceWeather = { value: new Vector4(1, 0, 0, 0) };
    world.options.chunkUniformsOverwrite = { surfaceWeather };
    const material = makeChunkShaderMaterial(world);
    expect(material.uniforms.uSurfaceWeather).toBe(surfaceWeather);
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
    const material = makeChunkShaderMaterial(world);
    const fork = forkChunkMaterial(material);
    for (const shaderName of Object.keys(SHARED_NAMES)) {
      expect(fork.uniforms[shaderName], shaderName).toBe(
        material.uniforms[shaderName],
      );
    }
    expect(fork.uniforms.uSurfaceResponse).toBe(
      material.uniforms.uSurfaceResponse,
    );
    expect(fork.uniforms.uSurfaceOpenLight).toBe(
      material.uniforms.uSurfaceOpenLight,
    );
  });

  it("keeps the weather on a face with its own texture", () => {
    const world = host();
    const material = makeChunkShaderMaterial(world);
    const fork = forkChunkMaterial(material);
    setOwnFaceTexture(fork, new Texture());
    expect(fork.uniforms.uSurfaceResponse).toBe(
      material.uniforms.uSurfaceResponse,
    );
    expect(fork.uniforms.uSurfaceWeather).toBe(
      world.chunkRenderer.uniforms.surfaceWeather,
    );
  });
});

const farShared = (
  weather?: ReturnType<typeof createSurfaceWeatherUniforms>,
): FarTerrainSharedUniforms => ({
  fogColor: { value: new Color() },
  fogNear: { value: 0 },
  fogFar: { value: 1 },
  fogHeightOrigin: { value: 0 },
  fogHeightDensity: { value: 0 },
  fogVerticalBlend: { value: 0 },
  skyFogTopColor: { value: new Color() },
  skyFogMiddleColor: { value: new Color() },
  skyFogBottomColor: { value: new Color() },
  skyFogOffset: { value: 0 },
  skyFogVoidOffset: { value: 0 },
  skyFogExponent: { value: 1 },
  skyFogExponent2: { value: 1 },
  skyFogDimension: { value: 1 },
  skyFogStrength: { value: 0 },
  sunlightIntensity: { value: 1 },
  minLightLevel: { value: 0 },
  baseAmbient: { value: 0 },
  faceShades: { value: { x: 1, y: 1, z: 1, w: 1 } },
  cameraSubmersion: { value: 0 },
  cameraWaterPlaneY: { value: 0 },
  underwaterAmbient: { value: new Color() },
  underwaterViewScale: { value: 1 },
  sunDirection: { value: new Vector3(0, 1, 0) },
  sunColor: { value: new Color(1, 1, 1) },
  ambientColor: { value: new Color(1, 1, 1) },
  farCoverMask: { value: null },
  farCover: { value: new Vector4() },
  farSeam: { value: 0 },
  ...(weather
    ? {
        surfaceWeather: weather.surfaceWeather,
        surfaceWeatherMap: weather.surfaceWeatherMap,
        surfaceWeatherWindow: weather.surfaceWeatherWindow,
        surfaceWeatherLine: weather.surfaceWeatherLine,
        surfaceCoatColor: weather.surfaceCoatColor,
        surfaceWind: weather.surfaceWind,
      }
    : {}),
});

const landOf = (far: FarTerrain) =>
  (
    far as unknown as {
      landMaterial: {
        uniforms: Record<string, unknown>;
        fragmentShader: string;
      };
    }
  ).landMaterial;

describe("surface weather on the far land", () => {
  it("shares the chunks' weather by reference", () => {
    const weather = createSurfaceWeatherUniforms();
    const land = landOf(new FarTerrain(farShared(weather), { distance: 0 }));
    expect(land.uniforms.uSurfaceWeather).toBe(weather.surfaceWeather);
    expect(land.uniforms.uSurfaceWeatherMap).toBe(weather.surfaceWeatherMap);
    expect(land.uniforms.uSurfaceWeatherWindow).toBe(
      weather.surfaceWeatherWindow,
    );
    expect(land.uniforms.uSurfaceWeatherLine).toBe(weather.surfaceWeatherLine);
    expect(land.uniforms.uSurfaceCoatColor).toBe(weather.surfaceCoatColor);
    expect(land.uniforms.uSurfaceWind).toBe(weather.surfaceWind);
    expect(land.fragmentShader).toContain(SURFACE_WEATHER_FAR_ALBEDO_FRAGMENT);
    expect(land.fragmentShader).toContain(SURFACE_WEATHER_FAR_SHEEN_FRAGMENT);
  });

  it("wears none without them", () => {
    const land = landOf(new FarTerrain(farShared(), { distance: 0 }));
    const weather = land.uniforms.uSurfaceWeather as { value: Vector4 };
    expect(weather.value.toArray()).toEqual([0, 0, 0, 0]);
    expect(
      (land.uniforms.uSurfaceWeatherMap as { value: Texture }).value,
    ).toBeInstanceOf(Texture);
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

describe("puddles", () => {
  const share = (level: number) => {
    let wet = 0;
    let n = 0;
    for (let x = -600; x < 600; x += 3) {
      for (let z = -600; z < 600; z += 7) {
        if (isTexelPuddle(x, z, level)) wet++;
        n++;
      }
    }
    return wet / n;
  };

  it("stay sparse: none when dry, under a fifth of open ground when full", () => {
    expect(share(0)).toBe(0);
    const half = share(0.5);
    const full = share(1);
    expect(half).toBeLessThan(full);
    expect(full).toBeGreaterThan(0.05);
    expect(full).toBeLessThan(0.2);
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
