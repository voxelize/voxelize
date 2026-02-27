import {
  BoxGeometry,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from "three";
import { float, positionLocal, vec3, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll } from "vitest";

import { skinPosition } from "../nodes/bone-sampling-node";

import { createTestContext, renderWithMaterial } from "./setup";

function makeIdentityBoneTexture(): {
  tex: DataTexture;
  width: number;
  height: number;
} {
  const bonesPerInstance = 2;
  const pixelsPerBone = 4;
  const width = bonesPerInstance * pixelsPerBone;
  const height = 1;
  const data = new Float32Array(width * height * 4);

  for (let bone = 0; bone < bonesPerInstance; bone++) {
    const base = bone * pixelsPerBone * 4;
    data[base] = 1;
    data[base + 1] = 0;
    data[base + 2] = 0;
    data[base + 3] = 0;
    data[base + 4] = 0;
    data[base + 5] = 1;
    data[base + 6] = 0;
    data[base + 7] = 0;
    data[base + 8] = 0;
    data[base + 9] = 0;
    data[base + 10] = 1;
    data[base + 11] = 0;
    data[base + 12] = 0;
    data[base + 13] = 0;
    data[base + 14] = 0;
    data[base + 15] = 1;
  }

  const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return { tex, width, height };
}

describe("skinPosition", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  afterAll(() => ctx?.dispose());

  it("compiles with identity bone matrices", async () => {
    ctx = await createTestContext();

    const { tex, width, height } = makeIdentityBoneTexture();

    const material = new MeshBasicNodeMaterial();
    const skinned = skinPosition(
      positionLocal,
      vec3(0, 0, 0),
      vec4(0, 1, 0, 0),
      vec4(0.5, 0.5, 0, 0),
      float(0),
      tex,
      float(width),
      float(height),
    );
    material.colorNode = skinned;

    const geometry = new BoxGeometry(1, 1, 1);
    expect(() => renderWithMaterial(ctx, geometry, material)).not.toThrow();
  });
});
