import * as THREE from "three";

import {
  BudgetedDrain,
  BudgetedWorkOutcome,
  createBudgetedDrain,
} from "./frame-budget";
import { WarmablePool, isWarmablePool } from "./pool-warmup";

/// A pool's per-frame advance. Pools whose own `update` takes other
/// arguments register with an adapter instead.
export type RosterUpdate = (
  deltaTime: number,
  renderer: THREE.WebGLRenderer,
) => void;

export type RosterPool = THREE.Object3D & { dispose(): void };

export type UpdatingRosterPool = RosterPool & {
  update(deltaTime: number, renderer: THREE.WebGLRenderer): void;
};

export interface RosterWarmupOptions {
  /// Frame time one slice of the warmup may spend baking. A variant cannot
  /// be split, so a slice always bakes at least one and ends once the
  /// accumulated cost reaches this.
  budgetMs: number;
  /// Awaited before the drain starts, e.g. the catalog of cached atlases.
  before?: () => Promise<void>;
  /// Awaited after the drain empties and before `warm` resolves, e.g. the
  /// decodes of atlases restored from a cache.
  after?: () => Promise<void>;
}

export interface RosterWarmupStats {
  variantCount: number;
  variantTotal: number;
  bakeMs: number;
}

/**
 * Owns a game's instanced entity pools: adds them to the scene, advances
 * them every frame, bakes every variant during the load phase under a frame
 * budget, and disposes them together.
 *
 * The warmup is the point. Baking a variant the first time an entity of it
 * appears converts one loading stall into a hitch every time something new
 * walks into view, so the join flow awaits {@link warm} and the player is
 * held out of the world until the whole roster is baked. Pools take part by
 * implementing {@link WarmablePool}; a pool that does not is never warmed
 * and should report its on-demand builds through `noteLazyBake`.
 */
export class InstancedEntityRoster extends THREE.Group {
  private readonly entries: {
    pool: RosterPool;
    update: RosterUpdate | null;
  }[] = [];
  private warmablePools: (THREE.Object3D & WarmablePool)[] | null = null;
  private warmupIndex = 0;
  private warmupDrain: BudgetedDrain | null = null;
  private warmup: Promise<void> | null = null;
  /// Variants the drain itself baked in the pool it is currently walking.
  /// A variant an arriving entity built on demand before the drain reached
  /// it is not in here - the drain skips it - which is why the count below
  /// is settled per pool from the pool's own roster size once it drains.
  private currentPoolBakedCount = 0;
  private drainedPoolVariantCount = 0;
  private warmupBakeMs = 0;
  protected isDisposed = false;

  /** Adds a pool whose `update(deltaTime, renderer)` advances it. */
  register<T extends UpdatingRosterPool>(pool: T): T;
  /** Adds a pool advanced by `update`, or not per frame at all when null. */
  register<T extends RosterPool>(pool: T, update: RosterUpdate | null): T;
  register<T extends RosterPool>(pool: T, update?: RosterUpdate | null): T {
    this.add(pool);
    const advance =
      update !== undefined
        ? update
        : (deltaTime: number, renderer: THREE.WebGLRenderer) =>
            (pool as unknown as UpdatingRosterPool).update(deltaTime, renderer);
    this.entries.push({ pool, update: advance });
    this.warmablePools = null;
    return pool;
  }

  /** Registered pools, in registration order. */
  get pools(): readonly RosterPool[] {
    return this.entries.map((entry) => entry.pool);
  }

  /**
   * Bakes every variant of every warmable pool, a slice per frame, and
   * resolves once the roster is complete. Calling it again returns the same
   * promise. Neither it nor its hooks' absence ever rejects on its own.
   */
  warm(options: RosterWarmupOptions): Promise<void> {
    if (this.warmup) return this.warmup;
    const ready = options.before ? options.before() : Promise.resolve();
    this.warmup = ready
      .then(
        () =>
          new Promise<void>((resolve) => {
            if (this.isDisposed) {
              // Disposed while the hook was still pending: there is no
              // roster left to bake into, and nothing waits on the answer.
              resolve();
              return;
            }
            this.warmupDrain = createBudgetedDrain(
              options.budgetMs,
              () => this.warmNextVariant(),
              resolve,
            );
            this.warmupDrain.schedule();
          }),
      )
      .then(() => (options.after ? options.after() : undefined));
    return this.warmup;
  }

  /// What the warmup actually did, so a loading log can separate the cost of
  /// baking from the wall clock it was spread over.
  readWarmupStats(): RosterWarmupStats {
    return {
      variantCount: this.drainedPoolVariantCount + this.currentPoolBakedCount,
      variantTotal: this.getWarmablePools().reduce(
        (sum, pool) => sum + pool.warmableVariantCount(),
        0,
      ),
      bakeMs: Math.round(this.warmupBakeMs),
    };
  }

  update(deltaTime: number, renderer: THREE.WebGLRenderer): void {
    for (const entry of this.entries) {
      entry.update?.(deltaTime, renderer);
    }
    this.hideEmptyInstanceMeshes();
  }

  /**
   * Every pool that is a group, for the shadow passes. Derived from the
   * scene graph rather than listed by hand: a hand list once left three
   * families out, so they only ever cast the bind-pose silhouette of the
   * generic depth material.
   */
  listShadowCasterPools(): THREE.Group[] {
    const pools: THREE.Group[] = [];
    for (const child of this.children) {
      if ((child as THREE.Group).isGroup) pools.push(child as THREE.Group);
    }
    return pools;
  }

  dispose(): void {
    this.isDisposed = true;
    this.warmupDrain?.cancel();
    for (const entry of this.entries) entry.pool.dispose();
  }

  private getWarmablePools(): (THREE.Object3D & WarmablePool)[] {
    if (!this.warmablePools) {
      this.warmablePools = this.entries
        .map((entry) => entry.pool)
        .filter((pool): pool is RosterPool & WarmablePool =>
          isWarmablePool(pool),
        );
    }
    return this.warmablePools;
  }

  private warmNextVariant(): BudgetedWorkOutcome {
    const pools = this.getWarmablePools();
    while (this.warmupIndex < pools.length) {
      const pool = pools[this.warmupIndex];
      const startedAt = performance.now();
      if (pool.warmNextVariant()) {
        this.currentPoolBakedCount += 1;
        this.warmupBakeMs += performance.now() - startedAt;
        return "worked";
      }
      // Nothing left in this pool means every variant it advertises is
      // warm, including any an arriving entity built before the drain got
      // there; the meter counts the pool's roster, not the drain's bakes.
      this.drainedPoolVariantCount += pool.warmableVariantCount();
      this.currentPoolBakedCount = 0;
      this.warmupIndex += 1;
    }
    return "exhausted";
  }

  /**
   * Warmup bakes every variant so the first live spawn does not hitch, which
   * leaves many InstancedMeshes in the graph at count 0. three.js still walks
   * those for frustum culling and the shadow pass, so an empty mesh is not
   * free. Hide them until a slot is actually allocated.
   */
  private hideEmptyInstanceMeshes(): void {
    const stack: THREE.Object3D[] = [...this.children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      const instanced = node as THREE.InstancedMesh;
      if (instanced.isInstancedMesh) {
        instanced.visible = instanced.count > 0;
      }
      for (const child of node.children) stack.push(child);
    }
  }
}
