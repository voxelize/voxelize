import type { Object3D } from "three";
import { describe, expect, it } from "vitest";

import { PARTICLE_BLOOM_EXEMPT_LAYER, TRANSPARENT_MEDIUM_KEY } from "./layer";
import { ParticleSystem } from "./system";
import type { ParticleConfig, ParticleWorld } from "./types";

/**
 * Just enough world for unlit, physics-free particles: dry everywhere, or
 * under water below `waterBelow`.
 */
function stubWorld(waterBelow = -Infinity) {
  const added: Object3D[] = [];
  const world = {
    isInitialized: true,
    add: (object: Object3D) => added.push(object),
    remove: () => {},
    getBlockAt: () => null,
    isFluidOrWaterloggedAt: (_x: number, y: number) => y < waterBelow,
  } as unknown as ParticleWorld;
  return { world, added };
}

const CUBE: ParticleConfig = {
  blend: "normal",
  shape: "cube",
  lifetimeSec: { min: 1, max: 1 },
  size: { min: 0.1, max: 0.1 },
  sizeOverLife: { from: 1, to: 1 },
  alphaOverLife: { from: 1, to: 0 },
  palette: ["#ffffff"],
  riseAccel: 0,
  dragPerSec: 0,
  turbulence: 0,
  spinRadPerSec: 0,
};

const at = { x: 0, y: 0, z: 0 };
const still = { min: 0, max: 0 };
const camera = { getWorldQuaternion: (q: unknown) => q } as never;

function layerMeshes(system: ParticleSystem) {
  const group = (system as unknown as { group: Object3D }).group;
  return group.children.filter((child) => "isInstancedMesh" in child);
}

describe("bloom-exempt particle layers", () => {
  it("join the exempt channel as well as the main one, and say so", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, { maxFlashLights: 0 });
    system.prewarm({ ...CUBE, isBloomExempt: true });
    const exempt = system.getBloomExemptMeshes();
    // A soft layer draws through two meshes, one per medium.
    expect(exempt).toHaveLength(2);
    for (const mesh of exempt) {
      expect(mesh.layers.isEnabled(PARTICLE_BLOOM_EXEMPT_LAYER)).toBe(true);
      expect(mesh.layers.isEnabled(0)).toBe(true);
      expect(mesh.userData.isBloomExempt).toBe(true);
    }
  });

  it("never share a layer with a look bloom may take", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, { maxFlashLights: 0 });
    system.prewarm(CUBE);
    const before = layerMeshes(system).length;
    system.prewarm({ ...CUBE, isBloomExempt: true });
    expect(layerMeshes(system).length - before).toBe(2);
    for (const mesh of layerMeshes(system)) {
      if (mesh.userData.isBloomExempt) continue;
      expect(mesh.layers.isEnabled(PARTICLE_BLOOM_EXEMPT_LAYER)).toBe(false);
    }
  });

  it("use the channel the system was given", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, {
      maxFlashLights: 0,
      bloomExemptLayer: 12,
    });
    system.prewarm({ ...CUBE, isBloomExempt: true });
    const [mesh] = system.getBloomExemptMeshes();
    expect(mesh.layers.isEnabled(12)).toBe(true);
    expect(mesh.layers.isEnabled(PARTICLE_BLOOM_EXEMPT_LAYER)).toBe(false);
  });
});

describe("layer groups", () => {
  it("give a feature its own capacity, so a big burst cannot starve others", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, {
      maxFlashLights: 0,
      capacityPerLayer: 4,
    });
    const grouped = { ...CUBE, layerGroup: "big-burst" };
    system.prewarm(CUBE);
    system.prewarm(grouped);
    // Let the prewarm's throwaway particles expire first.
    system.update(1, camera);
    // The group's burst fills its own layer to the cap ...
    system.burst(grouped, { position: at, count: 10, speed: still });
    // ... and the shared layer still takes every one of its particles.
    system.burst(CUBE, { position: at, count: 3, speed: still });
    system.update(0, camera);
    const counts = layerMeshes(system).map(
      (mesh) => (mesh as unknown as { count: number }).count,
    );
    expect(counts).toContain(4);
    expect(counts).toContain(3);
  });
});

describe("single-pass quads", () => {
  const materialOf = (mesh: Object3D) =>
    (mesh as unknown as { material: { forceSinglePass: boolean } }).material;

  it("draw double-sided quads in one pass, and leave cubes alone", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, { maxFlashLights: 0 });
    system.prewarm({ ...CUBE, shape: "quad" });
    system.prewarm(CUBE);
    // A plane has four corners, a box twenty-four.
    const isQuad = (mesh: Object3D) =>
      (
        mesh as unknown as {
          geometry: { attributes: { position: { count: number } } };
        }
      ).geometry.attributes.position.count === 4;
    const meshes = layerMeshes(system);
    const quad = meshes.find(isQuad);
    const cube = meshes.find((mesh) => !isQuad(mesh));
    expect(quad && materialOf(quad).forceSinglePass).toBe(true);
    expect(cube && materialOf(cube).forceSinglePass).toBe(false);
  });

  it("keep three's two-pass draw when asked (the A/B path)", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, {
      maxFlashLights: 0,
      isQuadSinglePass: false,
    });
    system.prewarm({ ...CUBE, shape: "quad" });
    for (const mesh of layerMeshes(system)) {
      expect(materialOf(mesh).forceSinglePass).toBe(false);
    }
  });
});

describe("soft layer render order", () => {
  const depthWrites = (mesh: Object3D) =>
    (mesh as unknown as { material: { depthWrite: boolean } }).material
      .depthWrite;

  it("puts soft layers at the given order and keeps cutouts at 0", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, {
      maxFlashLights: 0,
      softLayerRenderOrder: 100000.5,
    });
    system.prewarm(CUBE);
    system.prewarm({ ...CUBE, isCutout: true });
    const meshes = layerMeshes(system);
    const soft = meshes.filter((mesh) => !depthWrites(mesh));
    const cutout = meshes.filter(depthWrites);
    expect(soft.length).toBeGreaterThan(0);
    expect(cutout.length).toBeGreaterThan(0);
    for (const mesh of soft) expect(mesh.renderOrder).toBe(100000.5);
    for (const mesh of cutout) expect(mesh.renderOrder).toBe(0);
  });

  it("defaults every layer to 0", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, { maxFlashLights: 0 });
    system.prewarm(CUBE);
    system.prewarm({ ...CUBE, isCutout: true });
    for (const mesh of layerMeshes(system)) expect(mesh.renderOrder).toBe(0);
  });
});

describe("soft layers split by medium", () => {
  const countIn = (system: ParticleSystem, medium: string) =>
    layerMeshes(system)
      .filter((mesh) => mesh.userData[TRANSPARENT_MEDIUM_KEY] === medium)
      .reduce(
        (sum, mesh) => sum + (mesh as unknown as { count: number }).count,
        0,
      );

  it("draw the particles in water through a mesh of their own", () => {
    const { world } = stubWorld(0);
    const system = new ParticleSystem(world, { maxFlashLights: 0 });
    system.prewarm(CUBE);
    system.update(1, camera);
    // Mist over a pool and sparks on its bed, from one layer.
    system.burst(CUBE, {
      position: { x: 0, y: 3, z: 0 },
      count: 2,
      speed: still,
    });
    system.burst(CUBE, {
      position: { x: 0, y: -3, z: 0 },
      count: 3,
      speed: still,
    });
    system.update(0, camera);
    expect(countIn(system, "air")).toBe(2);
    expect(countIn(system, "water")).toBe(3);
  });

  it("keep a cutout layer on one mesh that names no medium", () => {
    const { world } = stubWorld(0);
    const system = new ParticleSystem(world, { maxFlashLights: 0 });
    system.prewarm({ ...CUBE, isCutout: true });
    const cutouts = layerMeshes(system).filter(
      (mesh) =>
        (mesh as unknown as { material: { depthWrite: boolean } }).material
          .depthWrite,
    );
    expect(cutouts).toHaveLength(1);
    expect(cutouts[0].userData[TRANSPARENT_MEDIUM_KEY]).toBeUndefined();
  });
});
