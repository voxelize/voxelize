import {
  BoxGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Sprite,
  SpriteMaterial,
} from "three";
import { describe, expect, it } from "vitest";

import {
  TRANSPARENT_CUTOUT_RENDER_ORDER,
  TRANSPARENT_FLUID_RENDER_ORDER,
  TRANSPARENT_OVER_FLUID_RENDER_ORDER,
  TRANSPARENT_RENDER_ORDER,
  TRANSPARENT_SORT,
  type TransparentMedium,
  type TransparentMediumSource,
} from "./common";

type Item = {
  object: Object3D;
  material: Material;
  renderOrder: number;
  groupOrder: number;
  z: number;
  id: number;
};

let nextId = 0;

/** A render item the way three's render list hands it to the sort. */
const item = (
  label: string,
  object: Object3D,
  material: Material,
  renderOrder: number,
  position: [number, number, number] = [0, 0, 0],
): Item => {
  object.name = label;
  object.renderOrder = renderOrder;
  object.position.set(...position);
  object.updateMatrixWorld(true);
  return {
    object,
    material,
    renderOrder,
    groupOrder: 0,
    z: 0,
    id: nextId++,
  };
};

const chunkMesh = (label: string, renderOrder: number, depthWrite = false) => {
  const material = new MeshBasicMaterial({ transparent: true, depthWrite });
  return item(
    label,
    new Mesh(new BoxGeometry(), material),
    material,
    renderOrder,
  );
};

const effect = (
  label: string,
  position: [number, number, number],
  renderOrder = 0,
) => {
  const material = new SpriteMaterial({ transparent: true, depthWrite: false });
  return item(label, new Sprite(material), material, renderOrder, position);
};

/** Water fills everything below y = 0; the camera dives when told to. */
const pool = (state: { isSubmerged: boolean }): TransparentMediumSource => ({
  isCameraSubmerged: () => state.isSubmerged,
  transparentMediumAt: (_x, y): TransparentMedium => (y < 0 ? "water" : "air"),
});

const camera = new PerspectiveCamera();
camera.position.set(0, 10, 10);
camera.updateMatrixWorld(true);

/** One sort, as the renderer runs it: its per-sort state resets after. */
const sortedLabels = async (items: Item[], media?: TransparentMediumSource) => {
  const sorted = [...items].sort(TRANSPARENT_SORT(camera, media));
  await Promise.resolve();
  return sorted.map((entry) => entry.object.name);
};

describe("TRANSPARENT_SORT", () => {
  const scene = () => [
    effect("spark", [0, 2, 0]),
    chunkMesh("lifted pane", TRANSPARENT_OVER_FLUID_RENDER_ORDER),
    chunkMesh("water", TRANSPARENT_FLUID_RENDER_ORDER),
    effect("bubble", [0, -2, 0]),
    chunkMesh("pane under water", TRANSPARENT_RENDER_ORDER),
    chunkMesh("leaves", TRANSPARENT_CUTOUT_RENDER_ORDER, true),
  ];

  it("puts a dry camera's effects in the air over the water, under the panes over it", async () => {
    expect(await sortedLabels(scene(), pool({ isSubmerged: false }))).toEqual([
      "leaves",
      "pane under water",
      "bubble",
      "water",
      "spark",
      "lifted pane",
    ]);
  });

  it("swaps the two media once the camera is under water", async () => {
    expect(await sortedLabels(scene(), pool({ isSubmerged: true }))).toEqual([
      "leaves",
      "pane under water",
      "spark",
      "water",
      "bubble",
      "lifted pane",
    ]);
  });

  it("takes a named medium over the one at the object's position", async () => {
    // An instanced pool sits at the origin whatever it draws.
    const bubbles = effect("bubble pool", [0, 5, 0]);
    bubbles.object.userData.transparentMedium = "water";
    const water = chunkMesh("water", TRANSPARENT_FLUID_RENDER_ORDER);
    expect(
      await sortedLabels([water, bubbles], pool({ isSubmerged: false })),
    ).toEqual(["bubble pool", "water"]);
  });

  it("keeps the effects' own orders among themselves", async () => {
    const glow = effect("glow", [0, 2, 0], 4);
    const body = effect("body", [0, 2, 0], 3);
    expect(
      await sortedLabels([glow, body], pool({ isSubmerged: false })),
    ).toEqual(["body", "glow"]);
  });

  it("leaves the sky and depth-writing layers where they stand", async () => {
    const sky = effect("sky", [0, 50, 0], -1);
    const solidSprite = chunkMesh("depth-writing prop", 0, true);
    const leaves = chunkMesh("leaves", TRANSPARENT_CUTOUT_RENDER_ORDER, true);
    expect(
      await sortedLabels(
        [leaves, solidSprite, sky],
        pool({ isSubmerged: false }),
      ),
    ).toEqual(["sky", "depth-writing prop", "leaves"]);
  });

  it("takes the source's order-independent band over order and medium", async () => {
    const bands = new Map<string, number>([
      ["spark", 0],
      ["water", 0],
      ["leaves", -0.75],
    ]);
    const source: TransparentMediumSource = {
      ...pool({ isSubmerged: false }),
      orderIndependentBandOf: (object) => bands.get(object.name),
    };
    const labels = await sortedLabels(
      [
        effect("spark", [0, 2, 0], 4),
        chunkMesh("water", TRANSPARENT_FLUID_RENDER_ORDER),
        chunkMesh("leaves", TRANSPARENT_CUTOUT_RENDER_ORDER, true),
        effect("sky", [0, 50, 0], -1),
      ],
      source,
    );
    expect(labels.slice(0, 2)).toEqual(["sky", "leaves"]);
    expect(labels.slice(2).sort()).toEqual(["spark", "water"]);
  });

  it("treats every effect as in the camera's air without a medium source", async () => {
    const labels = await sortedLabels(scene());
    const water = labels.indexOf("water");
    const lifted = labels.indexOf("lifted pane");
    for (const name of ["bubble", "spark"]) {
      expect(labels.indexOf(name)).toBeGreaterThan(water);
      expect(labels.indexOf(name)).toBeLessThan(lifted);
    }
  });
});
