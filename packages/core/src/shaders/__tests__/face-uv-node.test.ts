import { BoxGeometry } from "three";
import { DataTexture } from "three";
import { float, normalLocal, uv, vec3, texture } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { faceUVNode } from "../nodes/face-uv-node";

import { createTestContext, renderWithMaterial } from "./setup";

describe("faceUVNode", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with 6-face atlas UV mapping on a cube", async () => {
    ctx = await createTestContext();

    const data = new Uint8Array(6 * 5 * 4);
    for (let i = 0; i < 6 * 5; i++) {
      data[i * 4] = (i * 40) % 256;
      data[i * 4 + 1] = (i * 30) % 256;
      data[i * 4 + 2] = (i * 20) % 256;
      data[i * 4 + 3] = 255;
    }
    const atlas = new DataTexture(data, 6, 5);
    atlas.needsUpdate = true;

    const material = new MeshBasicNodeMaterial();
    const finalUV = faceUVNode(uv(), normalLocal, float(0), float(6), float(5));
    material.colorNode = texture(atlas, finalUV).xyz;

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });

  it("compiles with multi-part entities", async () => {
    ctx = await createTestContext();

    const material = new MeshBasicNodeMaterial();
    const finalUV = faceUVNode(
      uv(),
      normalLocal,
      float(2),
      float(6),
      float(10),
    );
    material.colorNode = vec3(finalUV, float(0));

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
