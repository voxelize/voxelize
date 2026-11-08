import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Points,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { releaseObject } from "./three-utils";

/**
 * A drawable dropped while its material is shared must fire its own
 * `dispose`, or three's WebGPU renderer keeps its render object (and the
 * drawable) for good. `releaseObject` fires it on the whole tree and frees
 * nothing the tree shares.
 */
describe("releaseObject", () => {
  it("fires dispose on every object under the root, sharing intact", () => {
    const shared = new MeshBasicNodeMaterial();
    const geometry = new BoxGeometry();
    let sharedFreed = false;
    shared.addEventListener("dispose", () => {
      sharedFreed = true;
    });
    geometry.addEventListener("dispose", () => {
      sharedFreed = true;
    });

    const root = new Group();
    const held = new Mesh(geometry, shared);
    const sparks = new Points(geometry, shared);
    root.add(held);
    held.add(sparks);

    const fired: string[] = [];
    for (const [name, object] of [
      ["root", root],
      ["held", held],
      ["sparks", sparks],
    ] as const) {
      (object as unknown as Group).addEventListener(
        "dispose" as never,
        () => void fired.push(name),
      );
    }

    releaseObject(root);

    expect(fired).toEqual(["root", "held", "sparks"]);
    expect(sharedFreed).toBe(false);
  });
});
