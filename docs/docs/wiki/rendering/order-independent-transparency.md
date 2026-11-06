---
sidebar_position: 1
---

# Order-Independent Transparency

`orderIndependentTransparency` makes a world blend every see-through surface (water, glass, the soft edges of leaves, particles, a game's own effects) by distance, whatever order it draws in.

Without it, a world sorts: objects by distance, glass faces by their centres, effects by the medium they stand in. Any sort is wrong somewhere in a voxel world, where one mesh holds a whole section's glass and a tunnel runs through a pool. The interactive walkthrough at [/oit](/oit) shows how the pass works, with a live demo.

## Client Setup

Turn it on, and let the world draw its own frame into the composer's scene target, which carries a depth texture:

```ts title="Client Setup"
import * as VOXELIZE from "@voxelize/core";
import { EffectComposer, ScenePass } from "@voxelize/postprocessing";

const world = new VOXELIZE.World({
  orderIndependentTransparency:
    VOXELIZE.defaultOrderIndependentTransparencyOptions,
});

const composer = new EffectComposer(renderer);
composer.addPass(
  new ScenePass((renderer, target) => world.renderFrame(renderer, camera, target)),
);
```

`renderFrame` installs the world's sort, draws the depth of the water near the panes in view, draws the scene, then accumulates its blended layers against the scene's own depth and composites them. Render the shadow maps first, then the composer, once a frame:

```ts title="Frame Loop"
world.updateShaderLighting(camera, controls.object.position);
world.renderShadowMaps(renderer, shadowCasters);
composer.render();
```

See the full implementation in `examples/client/src/main.ts`; `?transparency=sorted` switches it back to the sorted pipeline for comparison.

## Warming Shaders

Each blended material is wrapped with an encoder the first time the world sees it, which changes its program. Adopt materials before a warmup compiles them, and compile the texel forks it returns:

```ts title="Shader Warmup"
const forks = world.adoptOrderIndependentMaterials(materialsToWarm);
for (const fork of forks) warmScene.add(new THREE.Mesh(warmGeometry, fork));
await renderer.compileAsync(warmScene, camera);
```

## What Takes Part

| Material                                                      | Draws                               |
| ------------------------------------------------------------- | ----------------------------------- |
| Transparent, no depth write, normal or premultiplied blending | accumulated                         |
| Writes depth (cutouts, solid texels)                          | before the accumulation, with depth |
| Additive or multiply blending, or a whole `fragmentNode`      | after the composite                 |
| `userData[VOXELIZE.ORDER_INDEPENDENT_KEY] = false`            | after the composite                 |

See-through blocks are split by what their textures hold: texels at or above `solidTexelAlpha` draw solid and write depth, so the lead lines of stained glass stay crisp; texels between the alpha test and that blend.

## Checking It

```ts title="Stats"
const stats = world.orderIndependent?.stats;
// opened, skipped (by reason), adopted, lateAdopted, drawnAfter
```

A render that cannot accumulate (straight to the canvas, no depth texture, a multisampled target) logs the reason once and blends in list order. A material in `lateAdopted` compiled twice; adopt it before the warmup.
