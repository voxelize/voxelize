import {
  BatchedMesh,
  BoxGeometry,
  Group,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import { StaticBatchedMesh } from "./static-batched-mesh";

type Internals = {
  _multiDrawCount: number;
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _indirectTexture: { image: { data: Uint32Array }; version: number };
};

/** A deterministic scatter of boxes, the same in both batches. */
const fill = (batch: BatchedMesh, boxes: number) => {
  const sizes = [1, 2, 4].map((size) =>
    batch.addGeometry(new BoxGeometry(size, size, size)),
  );
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < boxes; i++) {
    const id = batch.addInstance(sizes[i % sizes.length]);
    batch.setMatrixAt(
      id,
      new Matrix4().makeTranslation(
        (random() - 0.5) * 200,
        (random() - 0.5) * 40,
        (random() - 0.5) * 200,
      ),
    );
  }
};

const make = <T extends BatchedMesh>(
  Kind: new (...args: ConstructorParameters<typeof BatchedMesh>) => T,
  transparent: boolean,
) => {
  const material = new MeshBasicMaterial({ transparent });
  const batch = new Kind(128, 4096, 8192, material);
  fill(batch, 100);
  batch.updateMatrixWorld(true);
  return batch;
};

const camera = (x: number, z: number, lookX: number, lookZ: number) => {
  const view = new PerspectiveCamera(70, 16 / 9, 0.1, 500);
  view.position.set(x, 10, z);
  view.lookAt(lookX, 0, lookZ);
  view.updateMatrixWorld(true);
  return view;
};

const draw = (batch: BatchedMesh, view: PerspectiveCamera) => {
  batch.onBeforeRender(
    null as unknown as WebGLRenderer,
    new Scene(),
    view,
    batch.geometry,
    batch.material as MeshBasicMaterial,
    null as unknown as Group,
  );
  const state = batch as unknown as Internals;
  const count = state._multiDrawCount;
  return {
    count,
    starts: [...state._multiDrawStarts.slice(0, count)],
    counts: [...state._multiDrawCounts.slice(0, count)],
    order: [...state._indirectTexture.image.data.slice(0, count)],
  };
};

const uploads = (batch: BatchedMesh) =>
  (batch as unknown as Internals)._indirectTexture.version;

describe("StaticBatchedMesh", () => {
  const views = [
    camera(0, 0, 50, 50),
    camera(-80, 30, 0, 0),
    camera(60, -60, 60, 40),
    camera(0, 0, 0, -1),
  ];

  for (const transparent of [false, true]) {
    for (const sortObjects of [true, false]) {
      it(`draws the list three draws (${transparent ? "transparent" : "opaque"}, ${sortObjects ? "sorted" : "unsorted"})`, () => {
        const three = make(BatchedMesh, transparent);
        const cached = make(StaticBatchedMesh, transparent);
        three.sortObjects = sortObjects;
        cached.sortObjects = sortObjects;
        for (const view of views) {
          const expected = draw(three, view);
          expect(expected.count).toBeGreaterThan(0);
          expect(expected.count).toBeLessThan(100);
          expect(draw(cached, view)).toEqual(expected);
        }
      });
    }
  }

  it("follows an instance that moves, is hidden or is rewritten", () => {
    const three = make(BatchedMesh, false);
    const cached = make(StaticBatchedMesh, false);
    const view = views[0];
    expect(draw(cached, view)).toEqual(draw(three, view));
    for (const batch of [three, cached]) {
      batch.setMatrixAt(3, new Matrix4().makeTranslation(30, 0, 30));
      batch.setVisibleAt(5, false);
      batch.setGeometryAt(0, new BoxGeometry(9, 9, 9));
    }
    expect(draw(cached, view)).toEqual(draw(three, view));
  });

  it("uploads the draw list only when it changed", () => {
    const cached = make(StaticBatchedMesh, false);
    const view = views[0];
    draw(cached, view);
    const first = uploads(cached);
    draw(cached, view);
    draw(cached, view);
    expect(uploads(cached)).toBe(first);

    // Another camera (a shadow cascade) draws another list, and the main
    // camera's list must go back up after it.
    draw(cached, views[1]);
    expect(uploads(cached)).toBe(first + 1);
    draw(cached, view);
    expect(uploads(cached)).toBe(first + 2);

    cached.setVisibleAt(draw(cached, view).order[0], false);
    draw(cached, view);
    expect(uploads(cached)).toBe(first + 3);
  });
});
