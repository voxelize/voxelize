import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  Scene,
  Vector3,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import {
  auditLightCones,
  exemptFromLightCones,
  isLightConesCovered,
  markLightConesCovered,
  LIGHT_CONE_STRIDE,
  LIGHT_CONES,
  LightCones,
  styleLightConeScatter,
} from "./light-cones";
import { ChunkMaterial, type ChunkShadingInputs } from "./shading/chunk-material";

const LEGACY = { x: 0, y: 0, z: 0 };
const DEFAULT = {
  x: LIGHT_CONES.scatterTexelsPerBlock,
  y: LIGHT_CONES.scatterBands,
  z: LIGHT_CONES.scatterCeiling,
};
/** The banded look: four flat levels. */
const VOXEL = { ...DEFAULT, y: 4 };

describe("light cone scatter style", () => {
  it("defaults to snapped and capped, unbanded; an empty style is smooth", () => {
    expect([DEFAULT.x, DEFAULT.y, DEFAULT.z]).toEqual([16, 0, 0.3]);
    // Unbanded: a beam's glow ramps smoothly up to the ceiling.
    expect(styleLightConeScatter(0.12, DEFAULT)).toBeCloseTo(0.12, 12);
    expect(styleLightConeScatter(0.9, DEFAULT)).toBeCloseTo(DEFAULT.z, 12);
    for (const scatter of [0, 0.004, 0.05, 0.3, 1.4]) {
      expect(styleLightConeScatter(scatter, LEGACY)).toBe(scatter);
    }
  });

  it("rounds to a few flat levels capped at the ceiling", () => {
    const levels = new Set<number>();
    for (let i = 0; i <= 2000; i++) {
      levels.add(styleLightConeScatter(i / 1000, VOXEL));
    }
    // Zero plus one level per band, the top band being the ceiling.
    expect(levels.size).toBe(VOXEL.y + 1);
    expect(Math.max(...levels)).toBeCloseTo(VOXEL.z, 12);
    // A submerged beam that used to add more than its own colour is held
    // to the ceiling instead of whiting out.
    expect(styleLightConeScatter(1.4, VOXEL)).toBeCloseTo(VOXEL.z, 12);
    // The faintest tail rounds to a clean zero, not a sliver.
    expect(styleLightConeScatter(VOXEL.z / 100, VOXEL)).toBe(0);
    // A dry flashlight's few-percent shaft still lands on a visible step.
    expect(styleLightConeScatter(0.05, VOXEL)).toBeGreaterThan(0.03);
    expect(styleLightConeScatter(0.05, VOXEL)).toBeLessThan(0.1);
  });

  it("caps without banding when only the ceiling is set", () => {
    const capOnly = { x: 0, y: 0, z: 0.3 };
    expect(styleLightConeScatter(0.12, capOnly)).toBeCloseTo(0.12, 12);
    expect(styleLightConeScatter(0.9, capOnly)).toBeCloseTo(0.3, 12);
  });
});

describe("light cone coverage", () => {
  it("reports a drawn mesh whose material skips the cones", () => {
    const scene = new Scene();
    const lit = new MeshBasicNodeMaterial();
    const missed = new MeshBasicNodeMaterial({ name: "forgot" });
    const lamp = new MeshBasicNodeMaterial();
    const glow = new MeshBasicNodeMaterial({ blending: AdditiveBlending });
    markLightConesCovered(lit);
    exemptFromLightCones(lamp, "an emitter");
    for (const material of [lit, missed, lamp, glow]) {
      scene.add(new Mesh(new BoxGeometry(), material));
    }
    const hidden = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    hidden.visible = false;
    scene.add(hidden);
    const sky = new Group();
    sky.add(new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial()));
    exemptFromLightCones(sky, "the sky");
    scene.add(sky);
    const empty = new InstancedMesh(new BoxGeometry(), new MeshBasicNodeMaterial(), 4);
    empty.count = 0;
    scene.add(empty);

    const missing = auditLightCones(scene);
    expect(missing.map((entry) => entry.material)).toEqual(["forgot"]);
  });
});

describe("light cone storage", () => {
  it("packs each cone into the node's own vectors and caps the count", () => {
    const cones = new LightCones();
    const slots = cones.uniforms.cones.value;
    expect(slots).toHaveLength(LIGHT_CONES.maxCones * LIGHT_CONE_STRIDE);
    // The array node reads the very vectors the CPU writes.
    expect(cones.uniforms.cones.node.array).toBe(slots);
    const cone = {
      origin: new Vector3(1, 2, 3),
      direction: new Vector3(0, 0, -2),
      color: new Color(1, 0.5, 0.25),
      intensity: 2,
      angleDeg: 60,
      innerRatio: 0.5,
      range: 20,
      scatterStrength: 0.4,
      submersion: 3,
    };
    expect(cones.pushCone(cone)).toBe(true);
    expect(cones.uniforms.coneCount.value).toBe(1);
    expect(slots[0].toArray()).toEqual([1, 2, 3, 1]);
    expect(slots[1].toArray()).toEqual([0, 0, -1, 0]);
    expect(slots[2].toArray()).toEqual([2, 1, 0.5, 0]);
    expect(slots[3].x).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    expect(slots[3].z).toBe(20);
    for (let i = 1; i < LIGHT_CONES.maxCones; i++) cones.pushCone(cone);
    expect(cones.pushCone(cone)).toBe(false);
    expect(cones.uniforms.coneCount.value).toBe(LIGHT_CONES.maxCones);
    cones.beginFrame();
    expect(cones.uniforms.coneCount.value).toBe(0);
  });

  it("counts a chunk material, which shades with the cones, as covered", () => {
    const material = new ChunkMaterial(
      { id: 1 } as unknown as ChunkShadingInputs,
      { kind: "opaque" },
    );
    expect(isLightConesCovered(material)).toBe(true);
  });
});
