import {
  BatchedMesh,
  BoxGeometry,
  type BufferGeometry,
  type Camera,
  type Material,
  Matrix4,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { StaticBatchedMesh } from "./static-batched-mesh";

type Internals = {
  _multiDrawCount: number;
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _indirectTexture: { image: { data: Uint32Array }; version: number };
  _updateDrawParameters(
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
    drawFormat: "multiDraw" | "merged",
  ): void;
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
  const material = new MeshBasicNodeMaterial({ transparent });
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

// What three's batch node does once per drawn object per pass: build the
// draw list for that pass's camera.
const draw = (batch: BatchedMesh, view: PerspectiveCamera) => {
  const state = batch as unknown as Internals;
  state._updateDrawParameters(
    view,
    batch.geometry,
    batch.material as MeshBasicNodeMaterial,
    "multiDraw",
  );
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

  it("draws a batch its frustum holds whole, or misses, as three does", () => {
    // From high above, every box in view (perspective: an orthographic
    // pass leaves opaque sections unsorted, which three does not).
    const whole = new PerspectiveCamera(70, 1, 0.1, 2000);
    whole.position.set(0, 600, 0);
    whole.lookAt(0, 0, 0);
    whole.updateMatrixWorld(true);
    const away = camera(0, 0, 0, 0);
    away.position.set(5000, 10, 5000);
    away.lookAt(6000, 0, 6000);
    away.updateMatrixWorld(true);
    for (const transparent of [false, true]) {
      const three = make(BatchedMesh, transparent);
      const cached = make(StaticBatchedMesh, transparent);
      const all = draw(three, whole);
      expect(all.count).toBe(100);
      expect(draw(cached, whole)).toEqual(all);
      const none = draw(three, away);
      expect(none.count).toBe(0);
      expect(draw(cached, away)).toEqual(none);
      // And back to a partial view, after a section moved out of the bounds.
      for (const batch of [three, cached]) {
        batch.setMatrixAt(3, new Matrix4().makeTranslation(900, 0, 900));
      }
      expect(draw(cached, views[1])).toEqual(draw(three, views[1]));
      expect(draw(cached, whole)).toEqual(
        draw(three, whole),
      );
    }
  });

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

  it("writes only the rows its list reaches once the texture is on the GPU", () => {
    const batch = make(StaticBatchedMesh, false);
    batch.sortObjects = false;
    const texture = (batch as unknown as Internals)._indirectTexture;
    const writes: { y: number; rows: number }[] = [];
    const renderer = {
      backend: {
        isWebGPUBackend: true,
        device: {
          queue: {
            writeTexture: (
              destination: { origin: { y: number } },
              _data: unknown,
              _layout: unknown,
              size: { height: number },
            ) => writes.push({ y: destination.origin.y, rows: size.height }),
          },
        },
        get: () => ({ texture: {} }),
      },
    };
    batch.onBeforeRender(renderer as never);
    const first = draw(batch, views[0]);
    // The first list goes through three's own upload.
    const flagged = uploads(batch);
    expect(writes).toHaveLength(0);
    const second = draw(batch, views[1]);
    expect(second.order).not.toEqual(first.order);
    expect(uploads(batch)).toBe(flagged);
    const width = (texture.image as unknown as { width: number }).width;
    expect(writes).toEqual([
      { y: 0, rows: Math.max(1, Math.ceil(second.count / width)) },
    ]);
  });

  it("leaves opaque sections unsorted under an orthographic (shadow) camera", () => {
    const ortho = new OrthographicCamera(-120, 120, 120, -120, 0.1, 500);
    ortho.position.set(0, 200, 0);
    ortho.lookAt(0, 0, 0);
    ortho.updateMatrixWorld(true);
    for (const transparent of [false, true]) {
      const three = make(BatchedMesh, transparent);
      const cached = make(StaticBatchedMesh, transparent);
      const expected = draw(three, ortho as unknown as PerspectiveCamera);
      const drawn = draw(cached, ortho as unknown as PerspectiveCamera);
      // The same sections either way.
      expect([...drawn.order].sort((a, b) => a - b)).toEqual(
        [...expected.order].sort((a, b) => a - b),
      );
      if (transparent) {
        // A blended pass keeps three's order.
        expect(drawn.order).toEqual(expected.order);
      } else {
        // In instance order: nothing sorted them.
        expect(drawn.order).toEqual([...drawn.order].sort((a, b) => a - b));
      }
    }
  });

  it("leaves a shadow pass of blended sections, depth only, unsorted", () => {
    const cached = make(StaticBatchedMesh, true);
    const material = cached.material as MeshBasicNodeMaterial;
    const ortho = new OrthographicCamera(-120, 120, 120, -120, 0.1, 500);
    ortho.position.set(0, 200, 0);
    ortho.lookAt(0, 0, 0);
    ortho.updateMatrixWorld(true);
    const view = ortho as unknown as PerspectiveCamera;
    const blended = draw(cached, view);
    material.colorWrite = false;
    const depth = draw(cached, view);
    expect([...depth.order].sort((a, b) => a - b)).toEqual(
      [...blended.order].sort((a, b) => a - b),
    );
    expect(depth.order).toEqual([...depth.order].sort((a, b) => a - b));
    expect(blended.order).not.toEqual(depth.order);
  });
});
