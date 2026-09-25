import type { Object3D } from "three";
import { describe, expect, it } from "vitest";

import { PARTICLE_BLOOM_EXEMPT_LAYER } from "./layer";
import { ParticleSystem } from "./system";
import type { ParticleConfig, ParticleWorld } from "./types";

/** Just enough world for unlit, physics-free particles. */
function stubWorld() {
  const added: Object3D[] = [];
  const world = {
    isInitialized: true,
    add: (object: Object3D) => added.push(object),
    remove: () => {},
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
    expect(exempt).toHaveLength(1);
    expect(exempt[0].layers.isEnabled(PARTICLE_BLOOM_EXEMPT_LAYER)).toBe(true);
    expect(exempt[0].layers.isEnabled(0)).toBe(true);
    expect(exempt[0].userData.isBloomExempt).toBe(true);
  });

  it("never share a layer with a look bloom may take", () => {
    const { world } = stubWorld();
    const system = new ParticleSystem(world, { maxFlashLights: 0 });
    system.prewarm(CUBE);
    const before = layerMeshes(system).length;
    system.prewarm({ ...CUBE, isBloomExempt: true });
    expect(layerMeshes(system).length - before).toBe(1);
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
