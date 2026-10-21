---
name: voxelize-entity-motion
description: Make Voxelize entities move like living things - legs paced to the ground (StrideGait), smooth server-following (dampPosition), heads that look at targets (computeHeadLook), strike lunges (AttackMotion), hit flash and recoil, death tip-over and poof (DeathAnimation), and IK feet that step on voxel terrain (solveTwoBoneIk, GaitState/updateGait, createVoxelGroundSampler). Use when an entity's walk skates or stutters, when adding a walk, look, attack, hurt or death animation, or when legs should plant on uneven ground.
library: "@voxelize/core"
library_version: "3.0.0"
sources:
  - packages/core/src/libs/motion/stride-gait.ts
  - packages/core/src/libs/motion/damp-position.ts
  - packages/core/src/libs/motion/head-look.ts
  - packages/core/src/libs/motion/attack-motion.ts
  - packages/core/src/libs/motion/hit-flash.ts
  - packages/core/src/libs/motion/death-animation.ts
  - packages/core/src/libs/motion/ik/gait-stepper.ts
  - packages/core/src/libs/motion/ik/two-bone-ik.ts
  - examples/client/src/critters.ts
---

# Entity motion in Voxelize

Presentation only: the server decides where an entity is, whether it attacked, whether it died. These helpers turn that stream into motion that reads as alive. All are exported from `@voxelize/core` and are frame-rate independent. Pure functions take state in and give state out; the classes hold one entity's clock.

## Walking: `StrideGait`

A leg swing driven by time skates (feet slide) or stutters. `StrideGait` advances a phase by **distance travelled**, so one cycle covers one stride of ground, with cadence and swing capped by leg length.

With `defineSkinnedFamily` it is already running: read `pose.stride` and `pose.swing`, and tell it how far your legs sweep:

```ts
defineSkinnedFamily({
  ...,
  legSwing: 0.7,                       // radians at full stride
  animate: (pose) => {
    const s = Math.sin(pose.stride) * 0.7 * pose.swing;
    pose.rotateBone("legFL", s); pose.rotateBone("legBR", s);   // diagonal pairs
    pose.rotateBone("legFR", -s); pose.rotateBone("legBL", -s);
  },
});
```

Driving it yourself (an `InstancedEntity` subclass or any `Object3D`):

```ts
const gait = new StrideGait(strideGaitParamsForScale(size));
// each frame
gait.fitWalker(rig.legLength, size, 0.7);   // pace from the measured leg
gait.update(this.position, this.targetPosition);
const swing = Math.sin(gait.phase) * 0.7 * gait.swingScale;
```

`speedEstimate` is the smoothed speed in blocks per second, for exertion states.

## Following the server: `dampPosition`

`dampPosition(current, target, factorAt60)` eases `current` toward `target` at the same speed at any frame rate, and snaps on a jump past 6 blocks (a teleport, a respawn). Pair it with `shortestYawDelta(from, to)` for facing. `InstancedEntity.resolveMotion` already does both.

## Looking: `computeHeadLook`

`computeHeadLook(target | undefined, x, y, z, bodyYaw, travelYaw, smoothedYaw, smoothedPitch)` returns the head bone's yaw/pitch delta, clamped to `MAX_HEAD_YAW` / `MAX_HEAD_PITCH`, smoothed. With no target the head leads into the turn. Keep the returned `smoothedHeadYaw`/`smoothedHeadPitch` for the next frame.

## Striking: `AttackMotion`

The server bumps a counter (`attackSeq`) in metadata when the entity strikes. `motion.observe(data.attackSeq)` in `onData`; each frame `motion.update(performance.now())` returns `{ lift, lunge, bodyPitch, headPitch }` to fold into the instance matrix and head bone (windup, spring, recover). Tune with an `AttackMotionProfile` per family.

## Getting hurt: hit flash and recoil

Pooled entities flash with `markHit()`. For a rig with its own material, `sampleHitFlash(msSinceHit, color, isReducedMotion, profile?)` returns how far to mix toward `color` after lighting (a pale pop, then red that fades). `sampleHitRecoil(ms)` gives a 0..1 lean. Pass a fainter `HitFlashProfile` for bodies whose faces must stay readable.

## Dying: `DeathAnimation`

`death.start(onPoof)` when the server says the entity died; each frame read `getTipAngle()` (roll it over), `getScale(size)` (shrink at the end) and call `checkPoof(position)`, which fires `onPoof` once for the puff of particles. `DEATH_BODY_GONE_MS` is when the body is gone, for anything that waits on it.

## Feet on uneven ground: IK

For legs that must plant on steps and slopes:
- `createVoxelGroundSampler(world, maxDepth)` gives the ground height under a point (solid, non-fluid, non-passable).
- `GaitState` + `updateGait(state, profile, homes, velocity, dt, sampleGround, reach)` decides when each foot lifts and where it lands (groups alternate; laggards step at once).
- `solveTwoBoneIk(hip, footTarget, pole, limb, outKnee, outFoot)` bends a two-segment leg toward the planted foot; `solveFabrik` / `IkChain` for longer chains; `createChainBinding` / `writeChainBones` turn joint positions into bone matrices.
- Gate it by distance (`setIkCameraPosition` each frame, `isWithinIkRange(position, range)`): IK is per-frame work, and far legs read the same with the plain stride.

## Do not

- Swing legs from `time` alone: it skates at any speed but one. Use the stride phase.
- Move entities on the client to make them look right: the server owns position; the client only eases toward it.
- Run fast constant wiggles (tails, ears) at idle: slow sway reads natural; save fast motion for travel or an event.
