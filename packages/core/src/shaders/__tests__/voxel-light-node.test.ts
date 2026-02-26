import { SphereGeometry } from "three";
import { int, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { unpackVoxelLight, unpackVoxelFlags } from "../nodes/voxel-light-node";

import { createTestContext, renderWithMaterial, TestContext } from "./setup";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx?.dispose();
});

describe("unpackVoxelLight", () => {
  it("compiles with a constant packed int", () => {
    const material = new MeshBasicNodeMaterial();
    const packed = int(0xfa35);
    const lightVec = unpackVoxelLight(packed);
    material.colorNode = lightVec.xyz;

    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("compiles with sunlight channel shown as grayscale", () => {
    const material = new MeshBasicNodeMaterial();
    const packed = int(0xc000);
    const lightVec = unpackVoxelLight(packed);
    material.colorNode = vec3(lightVec.w);

    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});

describe("unpackVoxelFlags", () => {
  it("compiles and extracts flag bits", () => {
    const material = new MeshBasicNodeMaterial();
    const packed = int(0x1f0000);
    const flags = unpackVoxelFlags(packed);
    material.colorNode = vec3(flags.x.div(3.0), flags.y, flags.z);

    renderWithMaterial(ctx, new SphereGeometry(1, 8, 8), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});
