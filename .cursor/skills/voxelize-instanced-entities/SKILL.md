---
name: voxelize-instanced-entities
description: Build instanced entity rendering on Voxelize — the InstancedEntityRoster, warmable variant pools, the budgeted load-phase warmup and late-work ledger, flat-bone GPU skinning, per-instance lighting, and texel-density painting. Use when adding an instanced pool or entity family, touching packages/core/src/libs/instancing, chasing a mid-play texture bake or frame spike from entities, or migrating a game's pools onto the engine.
---

# Instanced Entities

Many entities of one kind draw as one `THREE.InstancedMesh` per part, skinned on the GPU from a bone texture. The engine owns the machinery; a game owns its families (geometry, paint, animation, variant tables). Everything below is exported from `@voxelize/core` (`packages/core/src/libs/instancing/`).

## The pieces

| Piece | What it does |
| --- | --- |
| `InstancedEntityRoster` | A `THREE.Group` that owns a game's pools: `register(pool[, update])`, `warm({ budgetMs, before, after })`, `readWarmupStats()`, `update(dt, renderer)`, `listShadowCasterPools()`, `dispose()`. |
| `WarmablePool` | The pool contract for load-phase baking: `warmNextVariant()` bakes one unbuilt variant and reports whether there was one; `warmableVariantCount()` counts adults and babies. Helpers: `warmNextRosterEntry`, `warmableRosterCount`, `isWarmablePool`. |
| Late-work ledger | `noteLazyBake(pool, variant)` / `noteLazyWork(kind, label)` record on-demand construction; after `markPlayInteractive()` each one warns. `readLazyWork()`, `readLazyWorkAfterInteractive()`, `resetLazyWorkLedger()` (tests). |
| `createBudgetedDrain` | Runs unsplittable units a slice per frame until the budget is spent (checked after each unit), survives hidden tabs through `setHiddenTabTicker`, stops after 5 consecutive throws. |
| `BoneTextureManager` | Flat bones in a half-float data texture: slot allocation, per-bone matrices, dirty-range uploads. |
| `writeInstanceMatrix` / `writeInstanceColor` | Compare before writing, so idle instances never re-upload an unchanged buffer. |
| `TexelDensity` + `paintPartFacesAtDensity`, `faceTexelSize`, `partAtlasCellSize`, `faceWorldSize`, `texelsForBlocks` | Paint every face of every part at one texels-per-block, nearest-upscaled into a uniform atlas cell. |

## Building a pool

1. Geometry: one box per part with a bone index and a `pivotOffset` per vertex; bones are flat (see the `entity-lighting` rule for chaining attached parts).
2. Texture: a per-variant part atlas painted through `paintPartFacesAtDensity` with the roster's one `TexelDensity`. Paint all six faces; seed every random choice.
3. Implement `WarmablePool` with `warmNextRosterEntry(types, hasBabies, isWarm, bake)`. The build-on-demand path must call `noteLazyBake(poolName, variant)`; a pool without `warmNextVariant` is silently excluded from warmup and bakes mid-play.
4. Per frame: write instance matrices and bone matrices through the change-detecting writers; light each instance with the entity light path (`composeEntityLight`) into a per-instance light attribute, only when the sample changed.
5. Register it: `roster.register(pool)`; a pool whose `update` takes other arguments registers with an adapter, `roster.register(pool, (dt, r) => pool.update(r))`.

## The load phase

```ts
const roster = new InstancedEntityRoster();
roster.register(createWalkerPool(200));
scene.add(roster);

setHiddenTabTicker(setWorkerInterval);
await roster.warm({
  budgetMs: 60,
  before: () => atlasCache.readCatalog(),
  after: () => atlasCache.awaitRestores(),
});
markPlayInteractive();
```

The join awaits `warm`; the player is not let in until it resolves. Budget: a variant costs milliseconds and cannot be split, and the warmup runs behind a loading overlay whose frame only has to move a meter, so tens of milliseconds per slice is right; a small budget stretches under a second of work over seconds of wall clock. `readWarmupStats()` separates the bake cost from the wall clock for the loading log.

## Verifying

- `readLazyWorkAfterInteractive()` is empty after a join and after spawning every family: anything there is a pool the warmup missed.
- Frame rate: the agent's `measureFrameRate({ warmupMs, durationMs })` from a fixed pose over a busy scene, with the inputs kept verbatim in the test.
- Screenshots of a fixed row of families from a fixed pose, before and after any change to the pool plumbing.

## Engine and game

The engine never names a family. A game keeps: its families and variant tables, painters and art constants (its `TexelDensity`, face shades), its atlas cache (persistence, profiling), and gameplay-driven animation. Moving more of a game's pool code down is only right once the code names nothing game-specific.

## Roadmap

Designed and not yet moved, in this order, each behaviour-preserving and gated on a before/after run of the game's parity scenario (fixed row, fixed pose, frame rate, zero late bakes):

1. **The game's roster manager extends `InstancedEntityRoster`.** Its pools `register` in their existing order (warm order and update order are registration order), odd `update` signatures pass adapters, and game-only concerns (shadow-uniform toggles, a second drain for item shapes, atlas disposal) stay in the subclass around `super` calls.
2. **`InstancedSkinnedMaterial` moves down**, parameterized by the game's face-shade table and bound to the engine's shared entity shadow and fog uniform blocks.
3. **`SkinnedInstancePool` and its family config move down**, with the texture source injected (`acquireTexture(family, variant, isBaby)`) so the game's atlas store stays in the game. A new land family is then a config row plus painters, with allocation, skinning, hit flash, lighting and shadows from the engine.
