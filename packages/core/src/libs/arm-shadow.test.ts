import {
  BoxGeometry,
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  ShaderLib,
  UniformsUtils,
  Vector3,
  Vector4,
} from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { World } from "../core";
import {
  createEntityShadowUniforms,
  ENTITY_SHADOW_FRAGMENT_PARS,
  ENTITY_SHADOW_VERTEX_MAIN,
  ShaderLightingUniforms,
} from "../core/world/entity-shadow-uniforms";

import { Arm } from "./arm";
import { CanvasBox } from "./canvas-box";
import { LightShined } from "./effects/light-shined";

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** The shader three would compile for `material`, after its hook. */
function compiled(material: MeshBasicMaterial) {
  const shader = {
    uniforms: UniformsUtils.clone(ShaderLib.basic.uniforms),
    vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(
    shader as Parameters<MeshBasicMaterial["onBeforeCompile"]>[0],
    undefined as unknown as Parameters<MeshBasicMaterial["onBeforeCompile"]>[1],
  );
  return shader;
}

/** Just the slice of the world's lighting the arm copies. */
function lighting(): ShaderLightingUniforms {
  const u = createEntityShadowUniforms();
  return {
    shadowMap0: u.uShadowMap0,
    shadowMap1: u.uShadowMap1,
    shadowMap2: u.uShadowMap2,
    shadowMatrix0: u.uShadowMatrix0,
    shadowMatrix1: u.uShadowMatrix1,
    shadowMatrix2: u.uShadowMatrix2,
    cascadeSplit0: u.uCascadeSplit0,
    cascadeSplit1: u.uCascadeSplit1,
    cascadeSplit2: u.uCascadeSplit2,
    shadowBias: u.uShadowBias,
    shadowStrength: u.uShadowStrength,
    sunlightIntensity: u.uSunlightIntensity,
    sunDirection: u.uSunDirection,
    sunColor: u.uSunColor,
  } as unknown as ShaderLightingUniforms;
}

/** Just enough world for the light effect to sample a plain sunlit spot. */
function stubWorld(): World {
  return {
    chunkRenderer: {
      uniforms: {
        sunlightIntensity: { value: 1 },
        minLightLevel: { value: 0.1 },
        baseAmbient: { value: 0.1 },
      },
      shaderLightingUniforms: {
        sunColor: { value: new Color(1, 1, 1) },
        ambientColor: { value: new Color(0.4, 0.4, 0.4) },
        sunDirection: { value: new Vector3(0, 1, 0) },
        shadowStrength: { value: 1 },
      },
    },
    options: { maxLightLevel: 15 },
    csmRenderer: {},
    localLights: {
      options: { maskKnee: 0.25 },
      blockLightOwnership: 0,
      queryLocalLights: () => undefined,
    },
    getLightValuesAt: () => ({ red: 0, green: 0, blue: 0, sunlight: 15 }),
    measureWaterColumnAt: () => null,
    raycastVoxels: () => null,
  } as unknown as World;
}

const armUniforms = (arm: Arm) => {
  let box: CanvasBox | null = null;
  arm.traverse((child) => {
    if (child instanceof CanvasBox) box = child;
  });
  const uniforms = (box as CanvasBox | null)?.shadowUniforms;
  if (!uniforms) throw new Error("no shadowed arm box");
  return uniforms;
};

describe("first-person arm shadows", () => {
  it("are looked up where the viewmodel sits, at a hand's reach, excluding its body", () => {
    const arm = new Arm({ receiveShadows: true, shadowReach: 0.5 });
    const body = new Vector4(10, 70, -4, 1.3);
    arm.setShadowSelfBounds(body);

    const eye = new Vector3(10, 70.6, -4);
    const look = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1);
    const viewToWorld = new Matrix4().compose(eye, look, new Vector3(1, 1, 1));
    arm.updateShadowUniforms(lighting(), viewToWorld);

    const uniforms = armUniforms(arm);
    expect(uniforms.uShadowSelfBounds.value).toBe(body);
    expect(uniforms.uShadowIgnoresSelf.value).toBe(1);
    expect(uniforms.uMinOccluderDepth.value).toBe(0);
    expect(uniforms.uWorldOffset.value.length()).toBe(0);

    // A point drawn two blocks down and forward lands one block from the
    // eye, turned with the look, inside the body it belongs to.
    const drawn = new Vector3(0.8, -2, -1.6);
    const placed = drawn
      .clone()
      .applyMatrix4(uniforms.uShadowWorldMatrix.value);
    const expected = drawn
      .clone()
      .multiplyScalar(0.5)
      .applyQuaternion(look)
      .add(eye);
    expect(placed.distanceTo(expected)).toBeLessThan(1e-6);
    expect(placed.distanceTo(new Vector3(body.x, body.y, body.z))).toBeLessThan(
      body.w,
    );
  });

  it("keeps the old unrotated offset for a caller that passes a vector", () => {
    const arm = new Arm({ receiveShadows: true, minOccluderDepth: 0.04 });
    arm.updateShadowUniforms(lighting(), new Vector3(1, 2, 3));
    const uniforms = armUniforms(arm);
    expect(uniforms.uShadowIgnoresSelf.value).toBe(0);
    expect(uniforms.uShadowWorldMatrix.value.equals(new Matrix4())).toBe(true);
    expect(uniforms.uWorldOffset.value.toArray()).toEqual([1, 2, 3]);
    expect(uniforms.uMinOccluderDepth.value).toBe(0.04);
  });

  it("shades a held block like the arm, once, and through the shared lookup", () => {
    const arm = new Arm({
      receiveShadows: true,
      receiveHeldObjectShadows: true,
    });
    const block = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    arm.setArmObject(block, false);
    const material = block.material as MeshBasicMaterial;

    const { vertexShader, fragmentShader, uniforms } = compiled(material);
    expect(vertexShader).toContain(ENTITY_SHADOW_VERTEX_MAIN);
    expect(vertexShader).toContain(
      "mat3(uShadowWorldMatrix) * mat3(modelMatrix) * normal",
    );
    expect(fragmentShader).toMatch(
      /getEntityShadowAt\(\s*normalize\(vHeldShadowNormal\),\s*vHeldShadowPosition\s*\)/,
    );
    expect(fragmentShader).not.toContain("getEntityShadow(vec3(");

    // Placed, the held object reads the same exclusion as the arm.
    const body = new Vector4(0, 0, 0, 1.5);
    arm.setShadowSelfBounds(body);
    arm.updateShadowUniforms(lighting(), new Matrix4());
    expect(uniforms.uShadowSelfBounds.value).toBe(body);
    expect(uniforms.uShadowIgnoresSelf.value).toBe(1);

    // Equipped again, the material keeps the one program it was given.
    const hook = material.onBeforeCompile;
    arm.setArmObject(block, false);
    expect(block.material).toBe(material);
    expect(material.onBeforeCompile).toBe(hook);
  });

  it("never sets up a material it is handed, so every other copy keeps it", () => {
    const arm = new Arm({
      receiveShadows: true,
      receiveHeldObjectShadows: true,
    });
    // An item's cached mesh, cloned into a hand on the ground and into
    // first person, all with the one material.
    const cached = new Mesh(
      new BoxGeometry(),
      new MeshBasicMaterial({ vertexColors: true }),
    );
    const shared = cached.material;
    const elsewhere = cached.clone();
    const held = cached.clone();
    arm.setArmObject(held, false);

    expect(elsewhere.material).toBe(shared);
    expect(shared.userData.heldObjectLighting).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(shared, "onBeforeCompile"),
    ).toBe(false);
    const own = held.material as MeshBasicMaterial;
    expect(own).not.toBe(shared);
    expect(own.vertexColors).toBe(true);
    expect(compiled(own).fragmentShader).toContain("getEntityShadowAt(");

    // Every later clone from the cache shares the arm's one copy.
    const again = cached.clone();
    arm.setArmObject(again, false);
    expect(again.material).toBe(own);

    // A copy goes with its source.
    const onDispose = vi.fn();
    own.addEventListener("dispose", onDispose);
    shared.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);
    const fresh = cached.clone();
    arm.setArmObject(fresh, false);
    expect(fresh.material).not.toBe(own);
  });

  it("starts its copy clean when another effect set the source up first", () => {
    const arm = new Arm({
      receiveShadows: true,
      receiveHeldObjectShadows: true,
    });
    // What a light effect leaves: its flag and its wrapper. A clone of it
    // carries the flag without the wrapper.
    const wrapped = new MeshBasicMaterial();
    wrapped.userData.lightEffectSetup = true;
    wrapped.onBeforeCompile = (shader) => {
      shader.fragmentShader = `uniform vec3 lightEffect;\n${shader.fragmentShader}`;
    };
    const flaggedClone = wrapped.clone();
    flaggedClone.userData.heldObjectLighting = true;

    for (const source of [wrapped, flaggedClone]) {
      const held = new Mesh(new BoxGeometry(), source);
      arm.setArmObject(held, false);
      const { fragmentShader } = compiled(held.material as MeshBasicMaterial);
      expect(fragmentShader).toContain("getEntityShadowAt(");
      expect(fragmentShader).not.toContain("lightEffect");
    }
  });

  it("keeps a hook the held object was built with, under its own program key", () => {
    const arm = new Arm({
      receiveShadows: true,
      receiveHeldObjectShadows: true,
    });
    const tinted = new MeshBasicMaterial();
    tinted.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// built-tint\n${shader.fragmentShader}`;
    };
    const held = new Mesh(new BoxGeometry(), tinted);
    arm.setArmObject(held, false);
    const own = held.material as MeshBasicMaterial;
    const { fragmentShader } = compiled(own);
    expect(fragmentShader).toContain("// built-tint");
    expect(fragmentShader).toContain("getEntityShadowAt(");

    const plain = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    arm.setArmObject(plain, false);
    expect(own.customProgramCacheKey()).not.toBe(
      (plain.material as MeshBasicMaterial).customProgramCacheKey(),
    );
  });

  it("shades an item whose cached material a lit world copy shares", () => {
    const shined = new LightShined(stubWorld());
    const arm = new Arm({
      receiveShadows: true,
      receiveHeldObjectShadows: true,
    });
    new Object3D().add(arm);
    shined.add(arm);

    // A peer holds the item first, so the light effect owns its material.
    const cached = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const shared = cached.material;
    const peerHand = new Object3D();
    new Object3D().add(peerHand);
    peerHand.add(cached.clone());
    shined.add(peerHand);
    shined.update();

    const held = cached.clone();
    arm.setArmObject(held, false);
    shined.update();

    const firstPerson = compiled(held.material as MeshBasicMaterial);
    expect(firstPerson.fragmentShader).toContain("getEntityShadowAt(");
    const peerMesh = peerHand.children[0] as Mesh;
    expect(peerMesh.material).toBe(shared);
    const thirdPerson = compiled(shared);
    expect(thirdPerson.fragmentShader).toContain("lightEffect");
    expect(thirdPerson.fragmentShader).not.toContain("getEntityShadowAt(");

    const again = cached.clone();
    arm.setArmObject(again, false);
    shined.update();
    expect(again.material).toBe(held.material);
  });
});

describe("entity shadow self exclusion", () => {
  it("lets nothing inside the bounds shade a viewmodel, on any face", () => {
    expect(ENTITY_SHADOW_FRAGMENT_PARS).toContain(
      "uniform float uShadowIgnoresSelf;",
    );
    expect(ENTITY_SHADOW_FRAGMENT_PARS).toMatch(
      /uShadowIgnoresSelf > 0\.5\s*\?\s*\(selfDepth < 1e8 \? selfDepth : 0\.0\)\s*:\s*min\(slopeBias, selfDepth\)/,
    );
    expect(ENTITY_SHADOW_VERTEX_MAIN).toContain(
      "(uShadowWorldMatrix * vec4(worldPosition.xyz, 1.0)).xyz + uWorldOffset",
    );
    const fresh = createEntityShadowUniforms();
    expect(fresh.uShadowIgnoresSelf.value).toBe(0);
    expect(fresh.uShadowWorldMatrix.value.equals(new Matrix4())).toBe(true);
  });
});
