---
sidebar_position: 2
---

# Depth of Field

`DepthOfFieldPass` blurs a frame by depth, as a lens does: what the centre of the frame looks at is sharp, and everything else blurs by how far it lies from that distance, in front of it and behind. The focus follows the eye on its own.

It is a pass of `@voxelize/postprocessing`'s composer. Disabled, it is skipped and costs nothing.

## Client Setup

The pass reads the scene's depth, so the composer needs a `ScenePass`. Put it after anti-aliasing and before bloom, so a blurred light blooms as the disc it became:

```ts title="Client Setup"
import {
  BloomEffect,
  DepthOfFieldPass,
  EffectComposer,
  EffectPass,
  FxaaEffect,
  ScenePass,
} from "@voxelize/postprocessing";

const composer = new EffectComposer(renderer);
composer.addPass(
  new ScenePass((renderer, target) => world.renderFrame(renderer, camera, target)),
);
composer.addPass(new EffectPass(new FxaaEffect()));

const depthOfField = new DepthOfFieldPass(camera);
composer.addPass(depthOfField);

composer.addPass(new EffectPass(new BloomEffect()));
```

The focus eases by the frame time, so render the composer with it:

```ts title="Frame Loop"
composer.render(delta); // seconds since the last frame
```

A composer rendered without a delta has a focus that cannot move; the pass warns once when it sees that.

## Where the Focus Comes From

Each frame the pass reads the scene's depth over a small disc at the centre of the frame (`focusSpot`), so the edge of a surface under the crosshair does not flick the focus back and forth. Near surfaces in the disc count for more than far ones (`nearPriority`): a subject holds the focus until the crosshair has all but left it. The sky is the far plane, which is as good as infinity.

The focus closes on that distance as a critically damped spring, quicker onto something near (`focusNearSeconds`) than back out to the distance (`focusFarSeconds`). It lives on the GPU, in one texel: nothing is read back to follow it.

Switching the pass on, or cutting the camera to another place, should start with the focus already there:

```ts
depthOfField.enabled = true;
depthOfField.resetFocus();
```

For a photograph, hold the focus yourself:

```ts
depthOfField.options.isAutoFocus = false;
depthOfField.options.focusDistance = 12;
```

## How Much It Blurs

Defocus is measured in dioptres (1 / distance), the unit a lens blurs by: two units and four are as far apart as four and the horizon. A pixel's blur radius is

```
strength * blurPerDioptre * max(|1 / focus - 1 / distance| - focusTolerance, 0)
```

as a share of the frame's height, capped at `maxFarBlur` behind the focus and `maxNearBlur` in front of it. So the look holds at every resolution, and:

- a focus close to the eye throws the distance soft;
- a focus `1 / focusTolerance` units out or further keeps everything behind it sharp, and softens only what stands close to the eye.

| Option | Default | What it does |
| --- | --- | --- |
| `strength` | `1` | Scale on every blur radius. |
| `blurPerDioptre` | `0.05` | Blur radius per dioptre of defocus, as a share of the frame's height. |
| `focusTolerance` | `0.04` | Dioptres left sharp on each side of the focus. |
| `maxFarBlur` / `maxNearBlur` | `0.022` / `0.028` | The largest blur behind and in front of the focus. |
| `focusNearSeconds` / `focusFarSeconds` | `0.22` / `0.32` | How fast the focus closes on a nearer and a farther subject. |
| `focusSpot` | `0.012` | Radius of the disc the focus is read over, as a share of the frame's height. |
| `nearPriority` | `0.35` | How far a near surface in the disc outweighs a far one, 0..1. |
| `minFocusDistance` | `0.75` | The nearest distance the focus closes to. |
| `highlightThreshold` / `highlightGain` | `0.75` / `3` | What counts as a light in a blur, and how much more it weighs. |
| `rings` | `3` | Rings of the blur kernel: 2, 3 or 4, for 22, 43 or 71 taps. Fixed when the pass is made. |
| `maxBlurRows` | `540` | The most rows the blur buffers have. |

Every option but `rings` can change while the pass runs, through `depthOfField.options`.

## What It Costs

The blur is gathered at a fraction of the frame's size: the frame's height divided by the smallest whole number, 2 at the least, that brings it under `maxBlurRows`. At 1080p the buffers are 960x540; at 4K they still are. A frame with the pass on draws five more full-screen quads: one texel for the focus, three at the blur buffers' size (four taps, then the kernel's 43, then four) and one at the frame's size (three taps).

## Limits

- It needs a perspective camera with a standard depth range, neither reversed nor logarithmic.
- A surface that writes no depth (blended water, glass, particles) blurs as whatever lies behind it.
- The frame is clamped to what the screen shows before the pass reads it, so `highlightGain` stands in for the brightness a light would have kept.

Read where the focus sits, for a readout or a test, with `await depthOfField.readFocus(renderer)`. See the pass in a running client in `examples/client/src/main.ts` (press K).
