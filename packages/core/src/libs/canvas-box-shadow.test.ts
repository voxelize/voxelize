import {
  Box3,
  Matrix4,
  OrthographicCamera,
  Quaternion,
  Sphere,
  Vector3,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
} from "three/webgpu";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createEntityShadowBody,
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

describe("canvas box entity shadows", () => {
  it("shade every face material of a shadowed layer, merged or not", () => {
    for (const mergeFaces of [false, true]) {
      const layer = new CanvasBox({ receiveShadows: true, mergeFaces })
        .boxLayers[0];
      expect(layer.shadowBody).not.toBeNull();
      const materials = layer.atlas
        ? [layer.atlas.material]
        : [...layer.materials.values()];
      for (const material of materials) {
        // The shadowed body colour (shading/entity-shadow.ts), biased by
        // the face's own world normal and capped at the body's bounds.
        expect(material.colorNode).not.toBeNull();
        // Its body's values reach it as data the graph reads per draw.
        expect(material.userData.shadowBody).toBe(layer.shadowBody);
      }
    }
  });

  it("shares one colour graph across every face of every box", () => {
    const a = new CanvasBox({ receiveShadows: true }).boxLayers[0];
    const b = new CanvasBox({ receiveShadows: true, width: 2 }).boxLayers[0];
    const nodes = new Set(
      [...a.materials.values(), ...b.materials.values()].map((m) => m.colorNode),
    );
    expect(nodes.size).toBe(1);
    // Each box still keeps its own body.
    expect(a.shadowBody).not.toBe(b.shadowBody);
  });

  it("points every face at the body it is handed", () => {
    const box = new CanvasBox({ receiveShadows: true });
    const body = createEntityShadowBody();
    box.setShadowBody(body);
    expect(box.shadowBody).toBe(body);
    for (const material of box.boxLayers[0].materials.values()) {
      expect(material.userData.shadowBody).toBe(body);
    }
  });

  it("leaves a box that receives no shadows without the hook", () => {
    const box = new CanvasBox();
    const layer = box.boxLayers[0];
    expect(layer.shadowBody).toBeNull();
    // Handing it a body changes nothing.
    box.setShadowBody(createEntityShadowBody());
    expect(layer.shadowBody).toBeNull();
    for (const material of layer.materials.values()) {
      expect(material.colorNode).toBeNull();
      expect(material.userData.shadowBody).toBeUndefined();
    }
  });
});

describe("shadow depth per block", () => {
  it("is the reciprocal of an orthographic light's depth range", () => {
    const light = new Vector3(-0.64, 0.71, 0.29).normalize();
    // WebGPU stores clip depth as is; WebGL maps its -1..1 to 0..1.
    for (const [system, clipToStored] of [
      [WebGPUCoordinateSystem, 1],
      [WebGLCoordinateSystem, 0.5],
    ] as const) {
      const camera = new OrthographicCamera(-20, 20, 20, -20, 0.1, 252.5);
      camera.coordinateSystem = system;
      camera.updateProjectionMatrix();
      camera.position.copy(light).multiplyScalar(52);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const matrix = new Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      expect(shadowDepthPerBlock(matrix, light, clipToStored)).toBeCloseTo(
        1 / 252.4,
        6,
      );
    }
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
    expect(character.shadowBody.selfBounds).toBe(character.shadowSelfBounds);
    for (const part of [character.head, character.body, character.leftLeg]) {
      expect(part.shadowBody).toBe(character.shadowBody);
      for (const material of part.boxLayers[0].materials.values()) {
        expect(material.userData.shadowBody).toBe(character.shadowBody);
      }
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

  // Radius 0: no bounds (a bare Vector4 would be a unit sphere at the origin).
  it("leaves a fresh body unbounded", () => {
    expect(createEntityShadowBody().selfBounds.w).toBe(0);
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
