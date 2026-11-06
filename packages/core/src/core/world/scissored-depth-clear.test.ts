import { describe, expect, it } from "vitest";
import type { Material, Mesh, Renderer, RenderTarget } from "three/webgpu";

import { ScissoredDepthClear } from "./scissored-depth-clear";

// A graph built ahead (`prepare`) is reused by the draw only when both see
// the material in the same state: `QuadMesh.render` swapped a vertex node in
// for the draw alone, so the first clear built its graph again, in a frame.
describe("ScissoredDepthClear", () => {
  const makeRenderer = () => {
    const seen: { via: string; vertexNode: unknown; target: unknown }[] = [];
    let target: unknown = null;
    const vertexOf = (object: unknown) =>
      ((object as Mesh).material as Material & { vertexNode: unknown })
        .vertexNode;
    const renderer = {
      autoClear: true,
      getClearDepth: () => 1,
      getRenderTarget: () => target,
      setRenderTarget: (next: unknown) => {
        target = next;
      },
      compileAsync: (object: unknown) => {
        seen.push({ via: "compile", vertexNode: vertexOf(object), target });
        return Promise.resolve();
      },
      render: (object: unknown) => {
        seen.push({ via: "render", vertexNode: vertexOf(object), target });
      },
    } as unknown as Renderer;
    return { renderer, seen };
  };

  it("builds ahead in the state it draws in, once per renderer", async () => {
    const clear = new ScissoredDepthClear();
    const { renderer, seen } = makeRenderer();
    const twin = { id: "twin" } as unknown as RenderTarget;
    const atlas = { id: "atlas" } as unknown as RenderTarget;

    await clear.prepare(renderer, twin);
    await clear.prepare(renderer, twin);
    expect(seen.filter((s) => s.via === "compile")).toHaveLength(1);
    expect(seen[0].target).toBe(twin);
    expect(renderer.getRenderTarget()).toBeNull();

    renderer.setRenderTarget(atlas);
    clear.clear(renderer);
    const draw = seen.find((s) => s.via === "render")!;
    expect(draw.target).toBe(atlas);
    expect(draw.vertexNode).toBeTruthy();
    expect(draw.vertexNode).toBe(seen[0].vertexNode);
    expect(renderer.autoClear).toBe(true);
  });
});
