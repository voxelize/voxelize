import { BoxGeometry, Group, Mesh, MeshBasicNodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { releaseChunkMesh } from "./chunk";

/**
 * three's WebGPU renderer frees a mesh's render object only when the mesh,
 * its material or its lights fire `dispose`. Chunk materials are shared and
 * never disposed, so a chunk mesh let go must fire its own: otherwise every
 * chunk mesh ever built stays alive behind its render object.
 */
describe("releaseChunkMesh", () => {
  it("frees the geometry, leaves the scene and tells the renderer", () => {
    const shared = new MeshBasicNodeMaterial();
    let materialDisposed = false;
    shared.addEventListener("dispose", () => {
      materialDisposed = true;
    });
    const group = new Group();
    const mesh = new Mesh(new BoxGeometry(), shared);
    const layer = new Mesh(new BoxGeometry(), shared);
    mesh.add(layer);
    group.add(mesh);

    const fired: string[] = [];
    let geometryDisposed = false;
    mesh.geometry.addEventListener("dispose", () => {
      geometryDisposed = true;
    });
    for (const [name, object] of [
      ["mesh", mesh],
      ["layer", layer],
    ] as const) {
      (object as unknown as Group).addEventListener(
        "dispose" as never,
        () => void fired.push(name),
      );
    }

    releaseChunkMesh(mesh);

    expect(geometryDisposed).toBe(true);
    expect(mesh.parent).toBeNull();
    expect(fired).toEqual(["mesh", "layer"]);
    // The shared block material is not this mesh's to dispose.
    expect(materialDisposed).toBe(false);
  });
});
