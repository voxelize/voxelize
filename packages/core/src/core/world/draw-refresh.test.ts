import { Matrix4, MeshBasicNodeMaterial, Object3D, Texture } from "three/webgpu";
import { materialReference, modelWorldMatrixInverse } from "three/tsl";
import { describe, expect, it } from "vitest";

import {
  graphInputsOf,
  markMaterialPropertyRead,
  narrowRefresh,
} from "./shading/draw-refresh";

const NONE = 0;
const SHARED = 1;
const FULL = 2;

type Fake = ReturnType<typeof setup>;

/**
 * A render object of a graph reading `chunkReveal` and `greedyFrame.value`
 * off the drawn material, the world matrix, and a texture the material
 * holds in `map` (re-pointed by a marked callback); and three's observer
 * as far as `narrowRefresh` uses it.
 */
function setup(extra: { updateNodes?: object[]; bindings?: object[] } = {}) {
  const reveal = materialReference("chunkReveal", "float") as unknown as {
    node: object;
  };
  const frame = materialReference("greedyFrame.value", "mat4") as unknown as {
    node: object;
  };
  const repoint = { updateType: "object" };
  markMaterialPropertyRead(repoint, "map");

  const material = new MeshBasicNodeMaterial() as MeshBasicNodeMaterial & {
    chunkReveal: number;
    greedyFrame: { value: Matrix4 };
  };
  material.chunkReveal = 1;
  material.greedyFrame = { value: new Matrix4() };
  material.map = new Texture();
  const object = new Object3D();
  const position = { version: 0 };
  const sampled = {
    isSampledTexture: true,
    groupNode: { shared: false },
    textureNode: { value: material.map },
  };
  const objectGroup = {
    isNodeUniformsGroup: true,
    groupNode: { shared: false },
    uniforms: [
      { nodeUniform: { node: modelWorldMatrixInverse } },
      { nodeUniform: { node: reveal } },
      { nodeUniform: { node: frame } },
    ],
  };
  const renderObject = {
    object,
    material,
    geometry: { id: 7, index: null },
    getNodeBuilderState: () => ({
      updateNodes: [
        reveal,
        frame,
        modelWorldMatrixInverse,
        repoint,
        ...(extra.updateNodes ?? []),
      ],
      updateBeforeNodes: [],
      updateAfterNodes: [],
    }),
    getBindings: () => [
      { bindings: [objectGroup, sampled, ...(extra.bindings ?? [])] },
    ],
    getAttributes: () => [position],
    _geometries: { attributes: { disposeVersion: 0 } },
  };
  const seen = new WeakSet<object>();
  let baseCalls = 0;
  const observer = narrowRefresh({
    needsRefresh: () => {
      baseCalls++;
      return FULL;
    },
    firstInitialization: (ro: unknown) => {
      if (seen.has(ro as object)) return false;
      seen.add(ro as object);
      return true;
    },
    hasDynamicInstancing: () => false,
    needsVelocity: () => false,
    getOutputTarget: () => null,
    getRenderObjectData: (() => {
      const data = { outputTarget: null, attributesDisposeVersion: 0 };
      return () => data;
    })(),
    hasDisposedAttributes: () => false,
    hasAnimation: false,
    renderId: 0,
  });
  let renderId = 0;
  const draw = (isNewRender = false) => {
    if (isNewRender) renderId++;
    return observer.needsRefresh(renderObject, { renderId, renderer: null });
  };
  return {
    material,
    object,
    position,
    sampled,
    renderObject,
    draw,
    baseCalls: () => baseCalls,
  };
}

const settle = (fake: Fake) => {
  fake.draw(true);
  return fake.draw();
};

describe("narrowRefresh", () => {
  it("knows a chunk graph's per-object inputs", () => {
    const fake = setup();
    const inputs = graphInputsOf(fake.renderObject as never);
    expect(inputs?.references.length).toBe(2);
    expect(inputs?.properties).toEqual(["map"]);
  });

  it("refreshes the first draw, then only the shared groups once a render", () => {
    const fake = setup();
    expect(fake.draw(true)).toBe(FULL);
    expect(fake.draw()).toBe(NONE);
    expect(fake.draw(true)).toBe(SHARED);
    expect(fake.draw()).toBe(NONE);
  });

  it("refreshes fully when the object moves", () => {
    const fake = setup();
    settle(fake);
    fake.object.matrixWorld.makeTranslation(1, 0, 0);
    expect(fake.draw()).toBe(FULL);
    expect(fake.draw()).toBe(NONE);
  });

  it("refreshes fully when a material value changes, in place too", () => {
    const fake = setup();
    settle(fake);
    fake.material.chunkReveal = 0.5;
    expect(fake.draw()).toBe(FULL);
    expect(fake.draw()).toBe(NONE);
    fake.material.greedyFrame.value.makeTranslation(0, 2, 0);
    expect(fake.draw()).toBe(FULL);
    expect(fake.draw()).toBe(NONE);
  });

  it("refreshes fully when a texture changes, re-pointed or rewritten", () => {
    const fake = setup();
    settle(fake);
    fake.material.map = new Texture();
    expect(fake.draw()).toBe(FULL);
    fake.sampled.textureNode.value = fake.material.map;
    expect(fake.draw()).toBe(FULL);
    expect(fake.draw()).toBe(NONE);
    fake.material.map!.needsUpdate = true;
    expect(fake.draw()).toBe(FULL);
  });

  it("refreshes fully when the geometry's attributes change", () => {
    const fake = setup();
    settle(fake);
    fake.position.version++;
    expect(fake.draw()).toBe(FULL);
    expect(fake.draw()).toBe(NONE);
  });

  it("refreshes fully when the material is rebuilt", () => {
    const fake = setup();
    settle(fake);
    fake.material.needsUpdate = true;
    expect(fake.draw()).toBe(FULL);
  });

  it("keeps three's refresh for a graph with a per-object input it cannot check", () => {
    const callback = setup({ updateNodes: [{ updateType: "object" }] });
    expect(graphInputsOf(callback.renderObject as never)).toBeNull();
    callback.draw(true);
    callback.draw();
    expect(callback.baseCalls()).toBe(2);

    const plain = setup({
      bindings: [
        {
          isNodeUniformsGroup: true,
          groupNode: { shared: false },
          uniforms: [{ nodeUniform: { node: {} } }],
        },
      ],
    });
    expect(graphInputsOf(plain.renderObject as never)).toBeNull();

    const array = setup({
      bindings: [{ isNodeUniformBuffer: true, groupNode: { shared: false } }],
    });
    expect(graphInputsOf(array.renderObject as never)).toBeNull();
  });
});
