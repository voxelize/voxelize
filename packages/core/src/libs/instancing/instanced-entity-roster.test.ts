import assert from "node:assert/strict";

import * as THREE from "three";
import { afterEach, beforeEach, describe, it } from "vitest";

import { InstancedEntityRoster } from "./instanced-entity-roster";
import { warmNextRosterEntry, warmableRosterCount } from "./pool-warmup";

/// A pool with a roster of variants, each "baked" by marking it warm.
class FakePool extends THREE.Group {
  readonly warm = new Set<string>();
  readonly updates: number[] = [];
  isDisposed = false;
  readonly mesh: THREE.InstancedMesh;

  constructor(
    readonly variants: readonly string[],
    readonly hasBabies = false,
  ) {
    super();
    this.mesh = new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      4,
    );
    this.mesh.count = 0;
    this.add(this.mesh);
  }

  warmNextVariant(): boolean {
    return warmNextRosterEntry(
      this.variants,
      this.hasBabies,
      (type, baby) => this.warm.has(`${type}:${baby}`),
      (type, baby) => this.warm.add(`${type}:${baby}`),
    );
  }

  warmableVariantCount(): number {
    return warmableRosterCount(this.variants, this.hasBabies);
  }

  update(deltaTime: number): void {
    this.updates.push(deltaTime);
  }

  dispose(): void {
    this.isDisposed = true;
  }
}

class RendererOnlyPool extends THREE.Group {
  readonly renderers: unknown[] = [];
  update(renderer: THREE.WebGLRenderer): void {
    this.renderers.push(renderer);
  }
  dispose(): void {}
}

const frames: FrameRequestCallback[] = [];
const renderer = {} as THREE.WebGLRenderer;

beforeEach(() => {
  frames.length = 0;
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  globalThis.cancelAnimationFrame = () => {};
});

afterEach(() => {
  frames.length = 0;
});

async function drainFrames(): Promise<void> {
  for (let guard = 0; guard < 100 && frames.length > 0; guard++) {
    frames.shift()?.(0);
    await Promise.resolve();
  }
}

describe("InstancedEntityRoster", () => {
  it("warms every variant of every warmable pool in registration order", async () => {
    const roster = new InstancedEntityRoster();
    const walkers = roster.register(new FakePool(["tall", "short"], true));
    const swimmers = roster.register(new FakePool(["striped"]));
    const order: string[] = [];

    const done = roster.warm({
      budgetMs: 1000,
      before: async () => void order.push("before"),
      after: async () => void order.push("after"),
    });
    await Promise.resolve();
    await drainFrames();
    await done;

    assert.deepEqual(
      [...walkers.warm],
      ["tall:false", "tall:true", "short:false", "short:true"],
    );
    assert.deepEqual([...swimmers.warm], ["striped:false"]);
    assert.deepEqual(order, ["before", "after"]);
    assert.deepEqual(roster.readWarmupStats().variantCount, 5);
    assert.deepEqual(roster.readWarmupStats().variantTotal, 5);
    assert.equal(roster.warm({ budgetMs: 1 }), done);
  });

  it("counts a variant built on demand before the drain reached it", async () => {
    const roster = new InstancedEntityRoster();
    const pool = roster.register(new FakePool(["tall", "short"]));
    pool.warm.add("short:false");

    const done = roster.warm({ budgetMs: 1000 });
    await Promise.resolve();
    await drainFrames();
    await done;

    assert.equal(roster.readWarmupStats().variantCount, 2);
  });

  it("advances each pool with its own update signature and hides empty meshes", () => {
    const roster = new InstancedEntityRoster();
    const walkers = roster.register(new FakePool(["tall"]));
    const odd = roster.register(new RendererOnlyPool(), (_, r) =>
      odd.update(r),
    );

    roster.update(0.016, renderer);
    assert.deepEqual(walkers.updates, [0.016]);
    assert.deepEqual(odd.renderers, [renderer]);
    assert.equal(walkers.mesh.visible, false);

    walkers.mesh.count = 1;
    roster.update(0.016, renderer);
    assert.equal(walkers.mesh.visible, true);
  });

  it("disposes every pool and resolves a warmup that never got to start", async () => {
    const roster = new InstancedEntityRoster();
    const pool = roster.register(new FakePool(["tall"]));
    let release = () => {};
    const done = roster.warm({
      budgetMs: 1000,
      before: () => new Promise<void>((resolve) => (release = resolve)),
    });
    roster.dispose();
    release();
    await done;

    assert.equal(pool.isDisposed, true);
    assert.equal(pool.warm.size, 0);
    assert.deepEqual(roster.listShadowCasterPools(), [pool]);
  });
});
