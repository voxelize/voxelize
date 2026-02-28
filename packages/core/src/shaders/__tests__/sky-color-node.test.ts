import { SphereGeometry, Color, DoubleSide } from "three";
import { positionWorld, uniform } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { skyColorNode } from "../nodes/sky-color-node";

import { createTestContext, renderWithMaterial, TestContext } from "./setup";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => {
  ctx?.dispose();
});

describe("skyColorNode", () => {
  it("compiles with typical sky parameters", () => {
    const material = new MeshBasicNodeMaterial();
    material.side = DoubleSide;
    material.colorNode = skyColorNode(
      positionWorld,
      uniform(new Color(0.3, 0.5, 0.9)),
      uniform(new Color(0.7, 0.8, 0.9)),
      uniform(new Color(0.15, 0.1, 0.1)),
      uniform(0.0),
      uniform(0.0),
      uniform(1.0),
      uniform(2.0),
    );

    renderWithMaterial(ctx, new SphereGeometry(5, 16, 16), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("compiles with large sky offset values", () => {
    const material = new MeshBasicNodeMaterial();
    material.side = DoubleSide;
    material.colorNode = skyColorNode(
      positionWorld,
      uniform(new Color(0.1, 0.2, 0.6)),
      uniform(new Color(0.9, 0.85, 0.8)),
      uniform(new Color(0.05, 0.02, 0.05)),
      uniform(100.0),
      uniform(-100.0),
      uniform(1.5),
      uniform(3.0),
    );

    renderWithMaterial(ctx, new SphereGeometry(5, 16, 16), material);
    expect(ctx.renderer.info.render.calls).toBeGreaterThan(0);
  });
});
