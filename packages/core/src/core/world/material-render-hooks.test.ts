import {
  BoxGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Renderer,
  Scene,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { installMaterialRenderHooks } from "./material-render-hooks";

describe("installMaterialRenderHooks", () => {
  it("calls the material's hook for each draw, before three's own path", () => {
    installMaterialRenderHooks();
    installMaterialRenderHooks(); // idempotent: one call per draw, not two

    const material = new MeshBasicNodeMaterial();
    const mesh = new Mesh(new BoxGeometry(), material);
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const seen: unknown[] = [];
    material.onBeforeRender = (_r, _s, _c, geometry, object) => {
      seen.push(object, geometry);
      throw new Error("stop before the backend");
    };

    // No GPU here: the hook fires before three touches its backend, and
    // the throw keeps the call from going further.
    expect(() =>
      Renderer.prototype.renderObject.call(
        {} as Renderer,
        mesh,
        scene,
        camera,
        mesh.geometry,
        material,
        null,
        null as never,
      ),
    ).toThrow("stop before the backend");
    expect(seen).toEqual([mesh, mesh.geometry]);
  });
});
