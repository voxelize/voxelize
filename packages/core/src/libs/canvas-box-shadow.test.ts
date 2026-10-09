import {
  Box3,
  Matrix4,
  MeshBasicMaterial,
  OrthographicCamera,
  Quaternion,
  ShaderLib,
  Sphere,
  UniformsUtils,
  Vector3,
} from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createEntityShadowUniforms,
  ENTITY_SHADOW_BOUNDS_VERTEX_FUNCTIONS,
  ENTITY_SHADOW_FRAGMENT_PARS,
  shadowDepthPerBlock,
} from "../core/world/entity-shadow-uniforms";

import { CanvasBox } from "./canvas-box";
import { Character } from "./character";

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => null,
    }),
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

describe("canvas box entity shadows", () => {
  it("bias each face by its own world normal, capped at its body's bounds", () => {
    for (const mergeFaces of [false, true]) {
      const layer = new CanvasBox({ receiveShadows: true, mergeFaces })
        .boxLayers[0];
      const material = layer.atlas?.material ?? layer.materials.get("back");
      if (!material) throw new Error("missing material");
      const { vertexShader, fragmentShader } = compiled(material);

      expect(vertexShader).toContain(
        "vCanvasBoxShadowNormal = normalize(mat3(modelMatrix) * normal);",
      );
      expect(vertexShader).toContain(
        "vCanvasBoxShadowPosition = shadowWorldPos.xyz;",
      );
      expect(fragmentShader).toContain(
        "getEntityShadowAt(\n  normalize(vCanvasBoxShadowNormal),\n  vCanvasBoxShadowPosition\n)",
      );
      // An up vector here gives every face the top face's bias, and a body
      // shadows its own sun-averted side.
      expect(fragmentShader).not.toContain("getEntityShadow(vec3(");
    }
  });

  it("leaves a box that receives no shadows without the hook", () => {
    const layer = new CanvasBox({ underwaterFog: true }).boxLayers[0];
    const material = layer.materials.get("back");
    if (!material) throw new Error("missing material");
    const { vertexShader, fragmentShader } = compiled(material);
    expect(vertexShader).not.toContain("vCanvasBoxShadowNormal");
    expect(fragmentShader).not.toContain("getEntityShadow");
  });
});

describe("shadow depth per block", () => {
  it("is the reciprocal of an orthographic light's depth range", () => {
    const light = new Vector3(-0.64, 0.71, 0.29).normalize();
    const camera = new OrthographicCamera(-20, 20, 20, -20, 0.1, 252.5);
    camera.position.copy(light).multiplyScalar(52);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const matrix = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    expect(shadowDepthPerBlock(matrix, light)).toBeCloseTo(1 / 252.4, 6);
  });
});

describe("character shadow self bounds", () => {
  const PARTS = [
    "head",
    "body",
    "leftArm",
    "rightArm",
    "leftLeg",
    "rightLeg",
  ] as const;

  /** The world-space corners of every part's own box, as posed. */
  const partCorners = (character: Character) => {
    character.updateMatrixWorld(true);
    const corners: Vector3[] = [];
    for (const name of PARTS) {
      for (const layer of character[name].boxLayers) {
        layer.geometry.computeBoundingBox();
        const { min, max } = layer.geometry.boundingBox as Box3;
        for (const x of [min.x, max.x]) {
          for (const y of [min.y, max.y]) {
            for (const z of [min.z, max.z]) {
              corners.push(
                new Vector3(x, y, z).applyMatrix4(layer.matrixWorld),
              );
            }
          }
        }
      }
    }
    return corners;
  };

  const sphereOf = (character: Character) => {
    const { x, y, z, w } = character.shadowSelfBounds;
    return new Sphere(new Vector3(x, y, z), w);
  };

  const holds = (character: Character) => {
    const sphere = sphereOf(character);
    return partCorners(character).every((c) => sphere.containsPoint(c));
  };

  it("binds every part to one sphere that holds the body in any pose", () => {
    const character = new Character({ receiveShadows: true });
    for (const part of [character.head, character.body, character.leftLeg]) {
      expect(part.shadowUniforms?.uShadowSelfBounds.value).toBe(
        character.shadowSelfBounds,
      );
    }

    character.position.set(-156, 88.6, 98.5);
    character.bodyGroup.rotation.y = 0.7;
    character.leftArmGroup.rotation.x = Math.PI / 2;
    character.rightArmGroup.rotation.x = -Math.PI;
    character.headGroup.rotation.set(-0.8, 0.6, 0);
    character.refreshShadowSelfBounds();
    expect(holds(character)).toBe(true);

    // Lying along the look direction, as a swimmer does.
    character.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    character.refreshShadowSelfBounds();
    expect(holds(character)).toBe(true);

    character.quaternion.copy(new Quaternion());
    character.scale.setScalar(0.5);
    character.refreshShadowSelfBounds();
    expect(holds(character)).toBe(true);
  });

  it("stays clear of a deck slab a hand above the head", () => {
    const character = new Character({ receiveShadows: true });
    character.position.set(-157.5, 88.1, 101);
    character.refreshShadowSelfBounds();
    const sphere = sphereOf(character);
    const headTop = Math.max(...partCorners(character).map((c) => c.y));
    // The deck is an upper slab, 88.5 to 89: what the sun sees of it, its
    // top, has to lie beyond the body's own bounds.
    expect(headTop).toBeLessThan(88.5);
    expect(sphere.center.y + sphere.radius).toBeLessThan(89);
  });

  it("leaves a fresh uniform set unbounded", () => {
    expect(createEntityShadowUniforms().uShadowSelfBounds.value.w).toBe(0);
  });

  it("fits an attachment that reaches past the anatomical boxes", () => {
    const character = new Character({ receiveShadows: true });
    const tail = new CanvasBox({ width: 2.4, height: 0.2, depth: 0.2 });
    tail.position.set(0, -0.2, -1.6);
    character.body.add(tail);
    const reaches = () => {
      character.updateMatrixWorld(true);
      const sphere = sphereOf(character);
      tail.boxLayers[0].geometry.computeBoundingBox();
      const { min, max } = tail.boxLayers[0].geometry.boundingBox as Box3;
      const tip = new Vector3(0, 0, min.z).applyMatrix4(
        tail.boxLayers[0].matrixWorld,
      );
      const root = new Vector3(0, 0, max.z).applyMatrix4(
        tail.boxLayers[0].matrixWorld,
      );
      return [tip, root].every((c) => sphere.containsPoint(c));
    };

    character.refreshShadowSelfBounds();
    expect(reaches()).toBe(false);

    const unfitted = character.shadowSelfBounds.w;
    character.fitShadowSelfBounds();
    expect(character.shadowSelfBounds.w).toBeGreaterThan(unfitted);
    expect(reaches()).toBe(true);
    expect(holds(character)).toBe(true);

    // Measured in the body's own frame, so it travels and scales with it.
    character.position.set(40, 70, -12);
    character.rotation.y = 1.9;
    character.scale.setScalar(1.7);
    character.refreshShadowSelfBounds();
    expect(reaches()).toBe(true);
  });
});

describe("entity shadow bounds in GLSL", () => {
  it("lets a caller pass bounds of its own, per draw or per instance", () => {
    expect(ENTITY_SHADOW_FRAGMENT_PARS).toMatch(
      /float getEntityShadowWithin\(\s*vec3 worldNormal,\s*vec3 worldPosition,\s*vec4 selfBounds\s*\)/,
    );
    // The uniform-bound form is the same rule over the body's uniform.
    expect(ENTITY_SHADOW_FRAGMENT_PARS).toContain(
      "return getEntityShadowWithin(worldNormal, worldPosition, uShadowSelfBounds);",
    );
    expect(ENTITY_SHADOW_BOUNDS_VERTEX_FUNCTIONS).toContain(
      "vec4 entityShadowBoundsToWorld(mat4 toWorld, vec4 localSphere)",
    );
  });
});
