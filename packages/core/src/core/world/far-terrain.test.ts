import {
  Color,
  DataTexture,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_DAYLIGHT,
  CHUNK_WATER_FRESNEL,
  FAR_TERRAIN_METHOD,
  FarBuiltTile,
  FarTerrain,
  FarTerrainSharedUniforms,
} from "./far-terrain";
import {
  buildFarLandMesh,
  buildFarSkyMesh,
  FarMeshInput,
} from "./far-terrain-mesh";
import { FarFaceLook, FarTerrainDescriptor } from "./far-terrain-tiles";
import {
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_FLUID_CHUNK_SHADERS,
} from "./shaders";

vi.mock("./workers/far-terrain-worker.ts?worker&inline", () => ({
  default: class {},
}));

const shared = (): FarTerrainSharedUniforms => ({
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
});

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
  far.children.filter(
    (child): child is Mesh =>
      child instanceof Mesh && child.name.startsWith("far-terrain-0:"),
  );

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
  it("dissolves a tile in over the fade, then draws it whole", async () => {
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
    // The frame after it lands, the tile is drawn and starts dissolving in.
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

  it("keeps splitting a tall tile after its own mesh has left", async () => {
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
    // The root is idle now and leaves; its relief must not leave with it.
    await settle(far, () => far.stats.tilesResident === 1);
    expect(far.stats.tilesResident).toBe(1);
    far.update(at, world);
    expect(asked()).toEqual([]);
    expect(far.stats.levelCounts).toEqual([1, 0]);
  });
});

describe("FarTerrain water", () => {
  it("knows how deep the sea is wherever a tile has said", async () => {
    const far = new FarTerrain(shared(), {
      distance: 256,
      buildMesh: syncBuild,
      faceLook: () => grass,
    });
    far.configure(descriptor);
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
    const water = far.children.find(
      (child): child is Mesh => child.name === "far-terrain-water",
    );
    const material = must(water).material as ShaderMaterial;
    const window = material.uniforms.uFarDepth.value as Vector4;
    const map = material.uniforms.uFarDepthMap.value as DataTexture;
    const depth = map.image.data as Uint8Array;
    const at = (x: number, z: number) =>
      depth[
        Math.floor((z - window.y) / window.z) * window.w +
          Math.floor((x - window.x) / window.z)
      ];
    expect(at(1, 1)).toBe(Math.round(((86.875 - 60) / 32) * 255));
    expect(at(41, 1)).toBe(0);
  });
});

/**
 * Names declared twice in one scope of a shader: GLSL rejects the program,
 * and three.js then draws nothing for it, which reads as a hole rather than
 * an error. vitest has no GL, so this walks the scopes by braces.
 */
const redeclared = (source: string) => {
  const scopes: Set<string>[] = [new Set()];
  const found: string[] = [];
  const token =
    /[{}]|\b(?:float|int|bool|vec[234]|ivec[234]|mat[234]|sampler2D|sampler2DArray)\s+([A-Za-z_]\w*)\s*(?=[=;[])/g;
  for (const match of source.matchAll(token)) {
    if (match[0] === "{") scopes.push(new Set());
    else if (match[0] === "}") scopes.pop();
    else {
      const scope = scopes[scopes.length - 1];
      if (scope.has(match[1])) found.push(match[1]);
      scope.add(match[1]);
    }
  }
  return found;
};

describe("far shaders", () => {
  it("declare no name twice in one scope", async () => {
    const far = new FarTerrain(shared(), {
      distance: 256,
      buildMesh: syncBuild,
      faceLook: () => grass,
    });
    far.configure(descriptor);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    await settle(far, () => landMeshes(far).length > 0);
    const water = far.children.find(
      (child): child is Mesh => child.name === "far-terrain-water",
    );
    const materials = [must(water), ...landMeshes(far)].map(
      (mesh) => mesh.material as ShaderMaterial,
    );
    expect(materials.length).toBeGreaterThan(1);
    for (const material of materials) {
      expect(redeclared(material.fragmentShader)).toEqual([]);
      expect(redeclared(material.vertexShader)).toEqual([]);
    }
  });

  it("tells a name declared twice in one scope from a nested shadow", () => {
    expect(
      redeclared("void main() { float depth = 1.0; float depth = 2.0; }"),
    ).toEqual(["depth"]);
    expect(
      redeclared("void main() { float d = 1.0; if (true) { float d = 2.0; } }"),
    ).toEqual([]);
  });
});

describe("CHUNK_WATER_FRESNEL", () => {
  it("is the chunk water's top-face Fresnel, floor and ceiling", () => {
    const fluid = SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment;
    expect(fluid).toContain(
      `float fresnelBase = mix(0.01, ${CHUNK_WATER_FRESNEL.base}, topWaterFace);`,
    );
    expect(fluid).toContain(
      `float fresnelMax = mix(0.22, ${CHUNK_WATER_FRESNEL.max}, topWaterFace);`,
    );
  });
});

describe("CHUNK_DAYLIGHT", () => {
  // The far layer lights an open face with these literals; the chunk
  // fragment must still carry every one of them where the far layer read it.
  const chunk = SHADER_LIGHTING_CHUNK_SHADERS.fragment;
  const d = CHUNK_DAYLIGHT;

  it("is the chunk fragment's open-sky daylight, term for term", () => {
    for (const literal of [
      `max(rawNdotL * ${d.sunWrap.scale} + ${d.sunWrap.bias}, 0.0)`,
      `smoothstep(${d.brightTexture.from}, ${d.brightTexture.to}, texLuma)`,
      `mix(1.0, ${d.brightTextureSun}, isBrightTex)`,
      `uAmbientColor * ${d.groundAmbient}`,
      `vec3(${d.starlight}) * sunVisibility`,
      `vec3 coolTint = vec3(${d.daylightBalance})`,
      `(totalLight * (${d.toneMap.a} * totalLight + ${d.toneMap.b}))`,
      `(totalLight * (${d.toneMap.c} * totalLight + ${d.toneMap.d}) + ${d.toneMap.e})`,
    ]) {
      expect(chunk).toContain(literal);
    }
  });
});
