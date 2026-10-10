---
sidebar_position: 1
---

# Order-Independent Transparency

`orderIndependentTransparency` makes a world blend every see-through surface (water, glass, the soft edges of leaves, particles, a game's own effects) by distance, whatever order it draws in.

Without it, a world sorts: objects by distance, glass faces by their centres, effects by the medium they stand in. Any sort is wrong somewhere in a voxel world, where one mesh holds a whole section's glass and a tunnel runs through a pool. The interactive walkthrough at [/oit](/oit) shows how the pass works, with a live demo.

## Client Setup

Turn it on, and render the world into a target with a depth texture:

```ts title="Client Setup"
import * as VOXELIZE from "@voxelize/core";
import { EffectComposer, RenderPass } from "postprocessing";

const world = new VOXELIZE.World({
  orderIndependentTransparency:
    VOXELIZE.defaultOrderIndependentTransparencyOptions,
});

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(world, camera));
composer.createDepthTexture();
```

Call `prepareTransparency` once a frame, before the scene renders with that camera. It installs the world's sort, draws the depth of the water in view and arms the accumulation:

```ts title="Frame Loop"
world.prepareTransparency(renderer, camera);
composer.render();
```

See the full implementation in `examples/client/src/main.ts`; `?transparency=sorted` switches it back to the sorted pipeline for comparison.

## Warming Shaders

Each blended material is wrapped with an encoder the first time the world sees it, which changes its program. Adopt materials before a warmup compiles them, and compile the texel forks it returns:

```ts title="Shader Warmup"
const forks = world.adoptOrderIndependentMaterials(materialsToWarm);
for (const fork of forks) warmScene.add(new THREE.Mesh(warmGeometry, fork));
renderer.compile(warmScene, camera);
```

## What Takes Part

| Material                                                      | Draws                               |
| ------------------------------------------------------------- | ----------------------------------- |
| Transparent, no depth write, normal or premultiplied blending | accumulated                         |
| Writes depth (cutouts, solid texels)                          | before the accumulation, with depth |
| Additive, multiply, raw or GLSL3 shaders                      | after the composite                 |
| `userData[VOXELIZE.ORDER_INDEPENDENT_KEY] = false`            | after the composite                 |

See-through blocks are split by what their textures hold: texels at or above `solidTexelAlpha` draw solid and write depth, so the lead lines of stained glass stay crisp; texels between the alpha test and that blend.

## Checking It

```ts title="Stats"
const stats = world.orderIndependent?.stats;
// opened, skipped (by reason), adopted, lateAdopted, drawnAfter
```

A render that cannot accumulate (straight to the canvas, no depth texture, a multisampled target) logs the reason once and blends in list order. A material in `lateAdopted` compiled twice; adopt it before the warmup.
