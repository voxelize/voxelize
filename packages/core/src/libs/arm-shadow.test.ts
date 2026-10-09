import {
  BoxGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderLib,
  UniformsUtils,
  Vector3,
  Vector4,
} from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createEntityShadowUniforms,
  ENTITY_SHADOW_FRAGMENT_PARS,
  ENTITY_SHADOW_VERTEX_MAIN,
  ShaderLightingUniforms,
} from "../core/world/entity-shadow-uniforms";

import { Arm } from "./arm";
import { CanvasBox } from "./canvas-box";

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
    const material = new MeshBasicMaterial();
    const block = new Mesh(new BoxGeometry(), material);
    arm.setArmObject(block, false);

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
    expect(material.onBeforeCompile).toBe(hook);
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
