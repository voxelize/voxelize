import {
  BoxGeometry,
  Color,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  Quaternion,
  Vector3,
  Vector4,
} from "three/webgpu";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { World } from "../core";
import {
  createEntityShadowBody,
  type EntityShadowBody,
} from "../core/world/entity-shadow-uniforms";
import { isLightConesCovered, LightCones } from "../core/world/light-cones";
import { applyEntityLight } from "../core/world/shading/entity-light";
import { ownUniform } from "../core/world/shading/uniforms";

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

/** Whether `material` is the arm's set-up copy: the held shadow composed. */
const isHeldSetUp = (material: MeshBasicNodeMaterial) =>
  material.userData.heldObjectLighting === true && material.outputNode !== null;

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
    lightCones: new LightCones(),
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

/** The body the arm's own box is shaded as, checked on its materials too. */
const armBody = (arm: Arm): EntityShadowBody => {
  let box: CanvasBox | null = null;
  arm.traverse((child) => {
    if (child instanceof CanvasBox) box = child;
  });
  const found = box as CanvasBox | null;
  const body = found?.shadowBody;
  if (!found || !body) throw new Error("no shadowed arm box");
  for (const material of found.boxLayers[0].materials.values()) {
    expect(material.userData.shadowBody).toBe(body);
  }
  return body;
};

describe("first-person arm shadows", () => {
  it("are looked up where the viewmodel sits, at a hand's reach, excluding its body", () => {
    const arm = new Arm({ receiveShadows: true, shadowReach: 0.5 });
    const body = new Vector4(10, 70, -4, 1.3);
    arm.setShadowSelfBounds(body);

    const eye = new Vector3(10, 70.6, -4);
    const look = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1);
    const viewToWorld = new Matrix4().compose(eye, look, new Vector3(1, 1, 1));
    arm.updateShadowBody(viewToWorld);

    const shadow = armBody(arm);
    expect(shadow).toBe(arm.shadowBody);
    expect(shadow.selfBounds).toBe(body);
    expect(shadow.ignoresSelf).toBe(1);
    expect(shadow.minOccluderDepth).toBe(0);
    expect(shadow.worldOffset.length()).toBe(0);

    // A point drawn two blocks down and forward lands one block from the
    // eye, turned with the look, inside the body it belongs to.
    const drawn = new Vector3(0.8, -2, -1.6);
    const placed = drawn
      .clone()
      .applyMatrix4(shadow.worldMatrix);
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
    arm.updateShadowBody(new Vector3(1, 2, 3));
    const shadow = armBody(arm);
    expect(shadow.ignoresSelf).toBe(0);
    expect(shadow.worldMatrix.equals(new Matrix4())).toBe(true);
    expect(shadow.worldOffset.toArray()).toEqual([1, 2, 3]);
    expect(shadow.minOccluderDepth).toBe(0.04);
  });

  it("shades a held block like the arm, once, and through the shared lookup", () => {
    const arm = new Arm({
      receiveShadows: true,
      receiveHeldObjectShadows: true,
    });
    const block = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    arm.setArmObject(block, false);
    const material = block.material as MeshBasicNodeMaterial;

    expect(isHeldSetUp(material)).toBe(true);
    const composed = material.outputNode;

    // Placed, the held object reads the same body, exclusion and all, as
    // the arm.
    expect(material.userData.shadowBody).toBe(arm.shadowBody);
    const body = new Vector4(0, 0, 0, 1.5);
    arm.setShadowSelfBounds(body);
    arm.updateShadowBody(new Matrix4());
    const shadow = material.userData.shadowBody as EntityShadowBody;
    expect(shadow.selfBounds).toBe(body);
    expect(shadow.ignoresSelf).toBe(1);

    // Another held block, of its own material, is shaded as the same body.
    const otherBlock = new Mesh(
      new BoxGeometry(),
      new MeshBasicNodeMaterial({ color: 0x336699 }),
    );
    arm.setArmObject(otherBlock, false);
    const otherMaterial = otherBlock.material as MeshBasicNodeMaterial;
    expect(otherMaterial).not.toBe(material);
    expect(otherMaterial.userData.shadowBody).toBe(arm.shadowBody);

    // Equipped again, the material keeps the one graph it was given.
    arm.setArmObject(block, false);
    expect(block.material).toBe(material);
    expect(material.outputNode).toBe(composed);
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
      new MeshBasicNodeMaterial({ vertexColors: true }),
    );
    const shared = cached.material;
    const elsewhere = cached.clone();
    const held = cached.clone();
    arm.setArmObject(held, false);

    expect(elsewhere.material).toBe(shared);
    expect(shared.userData.heldObjectLighting).toBeUndefined();
    expect(shared.outputNode).toBeNull();
    const own = held.material as MeshBasicNodeMaterial;
    expect(own).not.toBe(shared);
    expect(own.vertexColors).toBe(true);
    expect(isHeldSetUp(own)).toBe(true);

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
    // What a light effect leaves: the voxel light composed over the
    // material's own nodes. And a material that carries only a stale
    // held-lighting flag, without the graph that went with it.
    const wrapped = new MeshBasicNodeMaterial();
    applyEntityLight(
      wrapped,
      { value: new Color(1, 1, 1) },
      new LightCones().uniforms,
    );
    expect(wrapped.colorNode).not.toBeNull();
    const flagged = new MeshBasicNodeMaterial();
    flagged.userData.heldObjectLighting = true;

    for (const source of [wrapped, flagged]) {
      const held = new Mesh(new BoxGeometry(), source);
      arm.setArmObject(held, false);
      const own = held.material as MeshBasicNodeMaterial;
      expect(own).not.toBe(source);
      expect(isHeldSetUp(own)).toBe(true);
      // The copy starts from the material's own colour, not the effect's.
      expect(own.colorNode).toBeNull();
    }
  });

  it("keeps a hook the held object was built with, under its own program key", () => {
    const arm = new Arm({
      receiveShadows: true,
      receiveHeldObjectShadows: true,
    });
    const tinted = new MeshBasicNodeMaterial();
    const tint = ownUniform(new Color(0.2, 0.6, 1));
    tinted.colorNode = tint as unknown as MeshBasicNodeMaterial["colorNode"];
    const held = new Mesh(new BoxGeometry(), tinted);
    arm.setArmObject(held, false);
    const own = held.material as MeshBasicNodeMaterial;
    expect(own.colorNode).toBe(tinted.colorNode);
    expect(isHeldSetUp(own)).toBe(true);

    const plain = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    arm.setArmObject(plain, false);
    expect(plain.material).not.toBe(own);
    expect((plain.material as MeshBasicNodeMaterial).colorNode).toBeNull();
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
    const cached = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    const shared = cached.material;
    const peerHand = new Object3D();
    new Object3D().add(peerHand);
    peerHand.add(cached.clone());
    shined.add(peerHand);
    shined.update();

    const held = cached.clone();
    arm.setArmObject(held, false);
    shined.update();

    const firstPerson = held.material as MeshBasicNodeMaterial;
    expect(firstPerson).not.toBe(shared);
    expect(isHeldSetUp(firstPerson)).toBe(true);
    // The world's light effect leaves the arm's copy alone.
    expect(firstPerson.colorNode).toBeNull();
    const peerMesh = peerHand.children[0] as Mesh;
    expect(peerMesh.material).toBe(shared);
    expect(isLightConesCovered(shared)).toBe(true);
    expect(shared.colorNode).not.toBeNull();
    expect(shared.userData.heldObjectLighting).toBeUndefined();

    const again = cached.clone();
    arm.setArmObject(again, false);
    shined.update();
    expect(again.material).toBe(held.material);
  });
});

describe("entity shadow self exclusion", () => {
  it("is off, and unplaced, on a fresh body", () => {
    const fresh = createEntityShadowBody();
    expect(fresh.ignoresSelf).toBe(0);
    expect(fresh.minOccluderDepth).toBe(0);
    expect(fresh.worldMatrix.equals(new Matrix4())).toBe(true);
    expect(fresh.worldOffset.length()).toBe(0);
  });
});
