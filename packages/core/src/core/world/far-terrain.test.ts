import { Color, Mesh, Vector3, Vector4 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_DAYLIGHT,
  FAR_TERRAIN_METHOD,
  FarTerrain,
  FarTerrainSharedUniforms,
} from "./far-terrain";
import { FarFaceLook, FarTerrainDescriptor } from "./far-terrain-tiles";
import { SHADER_LIGHTING_CHUNK_SHADERS } from "./shaders";

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

const descriptor: FarTerrainDescriptor = {
  baseStep: 8,
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

const tileReply = () => {
  const heights = new Uint8Array(9 * 2);
  for (let i = 0; i < 9; i++) heights[i * 2] = 100;
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return JSON.stringify({
    level: 0,
    tx: 0,
    tz: 0,
    step: 8,
    size: 3,
    heights: b64(heights),
    colors: b64(new Uint8Array(9)),
  });
};

const landMeshes = (far: FarTerrain) =>
  far.children.filter(
    (child): child is Mesh =>
      child instanceof Mesh && child.name.startsWith("far-terrain-0:"),
  );

const topColor = (far: FarTerrain) =>
  Array.from(
    (
      landMeshes(far)[0].geometry.getAttribute("aFarColor")
        .array as Float32Array
    ).subarray(0, 3),
  );

describe("FarTerrain materials", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds no tile until every face its materials name is readable, then paints with them", () => {
    let ready = false;
    const grass: FarFaceLook = { color: [0.05, 0.12, 0.04], isTinted: true };
    const far = new FarTerrain(shared(), {
      distance: 256,
      faceLook: (block) => (ready ? { ...grass, isTinted: block === 1 } : null),
    });
    far.configure(descriptor);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    far.update(new Vector3(8, 120, 8), world);
    expect(landMeshes(far)).toHaveLength(0);
    expect(far.stats.facesPending).toBeGreaterThan(0);

    ready = true;
    // At least one face a frame within the build budget, then the tile.
    for (let i = 0; i < 8 && landMeshes(far).length === 0; i++)
      far.update(new Vector3(8, 120, 8), world);
    expect(landMeshes(far)).toHaveLength(1);
    expect(far.stats.facesPending).toBe(0);
    // No tints on the wire: the tinted ground shows as itself.
    expect(topColor(far)).toEqual(
      [0.05, 0.12, 0.04].map((v) => expect.closeTo(v, 5)),
    );
  });

  it("paints a face that never becomes readable grey and says which", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const far = new FarTerrain(shared(), {
      distance: 256,
      faceLook: () => null,
      faceLookTimeoutMs: 0,
    });
    far.configure(descriptor);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    for (let i = 0; i < 8 && landMeshes(far).length === 0; i++)
      far.update(new Vector3(8, 120, 8), world);
    expect(landMeshes(far)).toHaveLength(1);
    expect(far.stats.facesMissing).toBeGreaterThan(0);
    expect(topColor(far)).toEqual([0.5, 0.5, 0.5]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("block 1's top face never became readable"),
    );
  });

  it("warms every face ahead of time, so no later frame reads one", async () => {
    let reads = 0;
    const far = new FarTerrain(shared(), {
      distance: 256,
      faceLook: () => {
        reads += 1;
        return { color: [0.2, 0.2, 0.2], isTinted: false };
      },
    });
    far.configure(descriptor);
    await far.warmLooks();
    const warmed = reads;
    expect(warmed).toBe(3);
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    far.update(new Vector3(8, 120, 8), world);
    expect(reads).toBe(warmed);
    expect(landMeshes(far)).toHaveLength(1);
  });

  it("falls back to the palette when the server names no materials", () => {
    const far = new FarTerrain(shared(), {
      distance: 256,
      palette: [0.2, 0.3, 0.4],
      faceLook: () => {
        throw new Error("no face is read without materials");
      },
    });
    far.configure({ ...descriptor, materials: undefined });
    far.onMethodReply(FAR_TERRAIN_METHOD, tileReply());
    far.update(new Vector3(8, 120, 8), world);
    expect(topColor(far)).toEqual(
      [0.2, 0.3, 0.4].map((v) => expect.closeTo(v, 6)),
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
