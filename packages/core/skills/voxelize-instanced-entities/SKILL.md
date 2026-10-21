---
name: voxelize-instanced-entities
description: Add animals, creatures, mobs, NPC bodies or any many-of-a-kind animated entity to a Voxelize game with GPU instancing - defineSkinnedFamily (box parts, named bones, animate), the server entity type and its metadata, InstancedEntityRoster warmup, lighting and shadows. Use when a Voxelize project needs a new creature or entity type, wants hundreds of moving entities cheaply, or asks how entities are rendered.
library: "@voxelize/core"
library_version: "3.0.0"
sources:
  - packages/core/src/libs/instancing/define-skinned-family.ts
  - packages/core/src/libs/instancing/instanced-entity.ts
  - packages/core/src/libs/instancing/skinned-instance-pool.ts
  - packages/core/src/libs/instancing/skinned-parts.ts
  - packages/core/src/libs/instancing/instanced-entity-roster.ts
  - examples/client/src/critters.ts
  - examples/server/worlds/shared/methods.rs
  - packages/core/src/libs/motion/stride-gait.ts
---

# Instanced entities in Voxelize

Many entities of one kind (a herd, a school, a crowd) draw as **one `InstancedMesh` per variant**, skinned on the GPU from a bone texture. A family is declared once; the engine builds geometry, paints the atlas, skins, lights per instance from the voxel light, flashes on hit, casts and receives shadows, and follows the server's entity stream.

Everything below is exported from `@voxelize/core`. The full worked example is `examples/client/src/critters.ts` (client) and the `spawn-critter` method in `examples/server/worlds/shared/methods.rs` (server) in the Voxelize repo.

## 1. Declare the family (client)

```ts
import * as VOXELIZE from "@voxelize/core";

export const critters = VOXELIZE.defineSkinnedFamily({
  type: "critter",                       // the server's entity type (etype)
  variants: ["sand", "moss"],            // first one is the default
  bones: ["body", "head", "legL", "legR"],
  parts: (variant, isBaby) => [          // one box per part; index = atlas row
    { bone: "body", size: [0.5, 0.4, 0.7], at: [0, 0.45, 0], paint: "#c9a56b" },
    { bone: "head", size: [0.32, 0.3, 0.3], at: [0, 0.7, 0.45],
      pivot: [0, 0.6, 0.3], paint: headPainter(variant) },
    { bone: "legL", size: [0.12, 0.25, 0.12], at: [-0.15, 0.125, 0],
      pivot: [-0.15, 0.25, 0], paint: "#3b2b1a" },
    { bone: "legR", size: [0.12, 0.25, 0.12], at: [0.15, 0.125, 0],
      pivot: [0.15, 0.25, 0], paint: "#3b2b1a" },
  ],
  legSwing: 0.6,                         // leg sweep at full stride
  animate: (pose) => {
    const swing = Math.sin(pose.stride) * 0.6 * pose.swing;
    pose.rotateBone("legL", swing);
    pose.rotateBone("legR", -swing);
  },
});
```

Conventions (getting these wrong is the usual bug):
- Mesh units, origin **at the feet**, **+y up, +z forward** (the way it faces). `size` is the whole body at `size = 1`; the server's `size` metadata scales it.
- A part rotates about its **`pivot`** (hip, neck, tail root). Every part on one bone shares that bone's pivot. Without a pivot it rotates about the origin.
- `paint` is a CSS colour or a `FacePainter` `(ctx, face, width, height)`; faces are `0=+x 1=-x 2=+y 3=-y 4=+z (front) 5=-z (back)`. Painters run at one texel density across parts (`density`, default 16 texels per block), so keep pixel art in texels, not fractions.
- `pose.stride` is the walk phase, advanced by distance travelled and paced from the measured legs, so feet never skate; `pose.swing` is the swing amplitude (0 at rest). `pose.time` is the world's shader clock (all clients agree) for idle motion; `pose.movement` eases 0..1 between rest and travel. Gait, head look, strikes, hit flash, death and IK feet: the `voxelize-entity-motion` skill.
- Calm idle motion reads natural; fast constant wiggle does not. Tie fast motion to `movement` or to an event in `pose.data`.
- `hasBabies: true` gives `parts(variant, true)` its own body; `config: { material, emissive, surface, hitEffectIntensity, ... }` passes anything else to the pool (see `SkinnedFamilyConfig`).

## 2. Install it (client, once)

```ts
const roster = new VOXELIZE.InstancedEntityRoster();
world.add(roster);
critters.install({ entities, roster, world, lightAt: lightShined.lightAt });

// before letting the player in: bake every variant now, not on first sight
await roster.warm({ budgetMs: 40 });

// every frame
entities.update();
roster.update(deltaTime, renderer);
world.updateShaderLighting(camera, playerPosition);
roster.updateShadowUniforms(world.chunkRenderer.shaderLightingUniforms);
world.renderShadowMaps(renderer, [...otherCasters, ...roster.listShadowCasterPools()]);
```

`lightAt` is what lights each instance like the block it stands on (`LightShined.lightAt`). Leave it out and instances render at full white. A pool holds 128 instances per variant by default (`maxPerVariant`); past that `allocate` returns -1 and warns once.

## 3. Spawn it (server, Rust)

The client only renders what the server streams. Create entities of the same type and put what the client reads into metadata (`position` and `direction` are sent for you):

```rust
world
    .create_entity(&nanoid!(), "critter")
    .with(PositionComp::new(x, y, z))
    .with(DirectionComp::default())
    .with(VariantComp::new("moss"))   // a component a system writes as metadata "variant"
    .build();
```

A metadata system copies the component in every tick (`metadata.set("variant", variant)`, see `VariantMetadataSystem` in the example) and must run before `EntitiesMetaSystem` in the dispatcher. Motion is authoritative on the server: move `PositionComp`/`DirectionComp` there, and the client damps toward it.

## 4. When you need more than `animate`

Subclass the entity for per-entity state (springs, look targets, swim state):

```ts
class Critter extends critters.Entity {
  private isSwimming = false;
  protected onData(data: CritterData) {
    super.onData(data); // keeps `pose.data` current for `animate`
    this.isSwimming = !!data.swimming;
  }
}
critters.install({ entities, roster, world, lightAt, entity: Critter });
```

Or subclass `InstancedEntity` directly with your own `SkinnedInstancePool` and `animate(time, deltaTime)` using `setBone(index, matrix)`. Override `resolveMotion` to attach to a rider, `bodyPitch`/`bodyRoll` to bank, `readVariant` if the variant lives under another key. `markHit()` flashes the instance.

## Verify

- `readLazyWorkAfterInteractive()` is empty after joining and spawning every variant: anything listed was baked mid-play (a hitch) because warmup missed it.
- Spawn a crowd (the example's `spawnCritters(x, y, z, 200)` in the console) and check the draw calls stay at one per variant (`renderer.info.render.calls`).
- Look at it in game at day and night: lit like the ground, shadows on, legs planted at rest.

## Do not

- Build a `THREE.Mesh` per entity for anything that can number in the dozens: that is what this replaces.
- Make a creature a block. Animals are entities.
- Pass `isBaby` without `hasBabies: true` and expect a different body: babies share the adult body otherwise.
