import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  NodeMaterial,
  PerspectiveCamera,
  type Renderer,
  type Scene,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { BorrowedCasterScene, overrideStandIns } from "./shadow-casters";

const depthMaterial = () => {
  const material = new NodeMaterial();
  material.name = "depth";
  return material;
};

describe("overrideStandIns", () => {
  it("gives each kind of caster a clone of the override carrying its values", () => {
    const geometry = new BoxGeometry();
    const opaque = new MeshBasicNodeMaterial();
    const cutout = new MeshBasicNodeMaterial({ alphaTest: 0.5 });
    const glass = new MeshBasicNodeMaterial({ transparent: true });
    const root = new Group();
    // Two casters of one kind share a stand-in.
    root.add(new Mesh(geometry, opaque), new Mesh(geometry, opaque));
    root.add(new Mesh(geometry, cutout), new Mesh(geometry, glass));
    const override = depthMaterial();

    const { objects, dispose } = overrideStandIns([root], override);

    expect(objects).toHaveLength(3);
    const materials = objects.map(
      (object) => (object as Mesh).material as NodeMaterial,
    );
    for (const material of materials) {
      expect(material).not.toBe(override);
      expect(material.name).toBe("depth");
    }
    expect(materials.map((m) => m.alphaTest)).toEqual([0, 0.5, 0]);
    // three's expression as written: an opaque material without a backdrop
    // node leaves `null`, which keys apart from `false`.
    expect(materials.map((m) => m.transparent)).toEqual([null, null, true]);
    // The override itself is left as it was.
    expect(override.alphaTest).toBe(0);
    expect(override.transparent).toBe(false);
    dispose();
  });

  it("leaves out what no depth pass draws", () => {
    const geometry = new BoxGeometry();
    const skipped = new MeshBasicNodeMaterial();
    skipped.userData.skipShadow = true;
    const ownDepth = new MeshBasicNodeMaterial();
    ownDepth.allowOverride = false;
    const hidden = new Mesh(geometry, new MeshBasicNodeMaterial());
    hidden.visible = false;
    const group = new Group();
    group.add(hidden);
    const { objects } = overrideStandIns(
      [new Mesh(geometry, skipped), new Mesh(geometry, ownDepth), group],
      depthMaterial(),
    );
    expect(objects).toHaveLength(0);
  });

  it("keeps a caster it is handed while that caster is hidden", () => {
    // A GPU terrain bucket hides until its culls are built.
    const bucket = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    bucket.visible = false;
    expect(overrideStandIns([bucket], depthMaterial()).objects).toHaveLength(
      1,
    );
  });
});

describe("BorrowedCasterScene.compile", () => {
  it("compiles the stand-ins without the override, and leaves the casters where they live", async () => {
    const parent = new Group();
    const caster = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    parent.add(caster);
    const borrowed = new BorrowedCasterScene();
    const seen: { children: number; override: unknown; owner: unknown }[] =
      [];
    const renderer = {
      compileAsync: async (scene: Scene) => {
        seen.push({
          children: scene.children.length,
          override: scene.overrideMaterial,
          owner: scene.children[0]?.parent,
        });
      },
    } as unknown as Renderer;

    await borrowed.compile(
      renderer,
      new PerspectiveCamera(),
      [caster],
      depthMaterial(),
    );

    expect(seen).toEqual([{ children: 1, override: null, owner: null }]);
    expect(caster.parent).toBe(parent);
    expect(borrowed.scene.children).toEqual([]);
  });
});
