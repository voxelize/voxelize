---
sidebar_position: 2
---

# Depth of Field

`DepthOfFieldPass` blurs a frame by depth, as a lens does: what the centre of the frame looks at is sharp, and everything else blurs by how far it lies from that distance, in front of it and behind. The focus follows the eye on its own.

It is a thin lens with one opening, so it is a quiet effect: a look at anything a few units out leaves the whole world sharp, and the blur shows when something is close to the eye. A subject held up close throws the country behind it soft; a look past it at the hills turns the subject into a soft shape.

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

Anything drawn after the pass stays sharp. A first-person arm or a held item belongs there: it sits a fraction of a unit from the eye, where a lens focused on anything else would smear it across the frame.

## Where the Focus Comes From

Each frame the pass reads the scene's depth over a small disc at the centre of the frame (`focusSpot`), so the edge of a surface under the crosshair does not flick the focus back and forth. Near surfaces in the disc count for more than far ones (`nearPriority`): a subject holds the focus until the crosshair has all but left it. The sky is the far plane, which is as good as infinity.

That distance is smoothed for a moment (`focusSettleSeconds`), and the focus eases onto it: it starts moving at once and slows as it arrives, with no overshoot. It closes two thirds of the way in `focusNearSeconds` onto a nearer subject and in `focusFarSeconds` back out to a farther one. The defaults are slow in and quick out. The world softens gradually behind what the eye settles on, a post that crosses the crosshair during a turn barely pulls the focus, and the world is there again as soon as the eye looks up.

The focus lives on the GPU, in one texel: nothing is read back to follow it.

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

Defocus is measured in dioptres (1 / distance), the unit a lens blurs by: two units and four are as far apart as four and the horizon. A point `d` dioptres from the focus blurs to a disc whose radius, as an angle, is half the aperture times the defocus. On screen, as a share of the frame's height:

```
radius = strength * aperture / 2 * soft(d) * projection[1][1] / 2
soft(d) = sqrt(d * d + sharpZone * sharpZone) - sharpZone
```

`projection[1][1]` is `1 / tan(fov / 2)`: a narrower field of view magnifies the blur with everything else, as a longer lens does, and the look holds at every resolution. `soft` brings the blur in from nothing with no edge to where it starts; well past `sharpZone` it grows by the aperture. The radius then levels off toward `maxFarBlur` behind the focus and `maxNearBlur` in front of it, again with no corner.

With the defaults at a 70 degree field of view:

| Focus on | Blur of the horizon |
| --- | --- |
| 0.8 units | 1.35% of the frame's height (15 pixels at 1080p) |
| 2 units | 0.37% (4 pixels) |
| 3 units | 0.19% (2 pixels) |
| 5 units or further | under 0.08% (sharp to the pixel) |

It runs the same the other way: with the focus on the horizon, something 0.8 units from the eye blurs by 1.35%, and everything further than five units is sharp.

| Option | Default | What it does |
| --- | --- | --- |
| `strength` | `1` | Scale on the aperture. |
| `aperture` | `0.04` | The lens's opening, in world units. A 50 mm lens at f/1.4 opens 0.036 m. |
| `sharpZone` | `0.35` | Dioptres over which the blur comes in. |
| `maxFarBlur` / `maxNearBlur` | `0.02` / `0.025` | What the blur levels off toward behind and in front of the focus, as shares of the frame's height. |
| `focusNearSeconds` / `focusFarSeconds` | `0.75` / `0.16` | Seconds to close two thirds of the way onto a nearer and a farther subject. |
| `focusSettleSeconds` | `0.04` | Seconds the distance under the centre is smoothed over first. |
| `focusSpot` | `0.012` | Radius of the disc the focus is read over, as a share of the frame's height. |
| `nearPriority` | `0.35` | How far a near surface in the disc outweighs a far one, 0..1. |
| `minFocusDistance` | `0.3` | The nearest distance the focus closes to. |
| `highlightThreshold` / `highlightGain` | `0.75` / `0` | What counts as a light in a blur, and how much more it weighs. At 0 a blur is a plain average. |
| `rings` | `3` | Rings of the blur kernel: 2, 3 or 4, for 22, 43 or 71 taps. Fixed when the pass is made. |
| `maxBlurRows` | `540` | The most rows the blur buffers have. |

Every option but `rings` can change while the pass runs, through `depthOfField.options`. `maxNearBlur` can be lowered live but not raised past what the pass was made with, and `maxBlurRows` is read when the frame is sized.

## How It Blurs

The blur is gathered at a fraction of the frame's size, in two layers.

- **Behind the focus** each texel gathers a disc of its own radius, and a tap counts by the smaller of its radius and the texel's. Nothing sharp, and nothing in front, bleeds into the blur behind it.
- **In front of the focus** each surface spreads over what its radius reaches, sharp surfaces included, and lands over them by the share of each pixel its disc covers. Its edge softens about where the edge is, as a lens's does. What shows through its rim is filled in from the scene beside it, since what lies behind it was never drawn.

The kernel is scaled to the radius it gathers, so a small blur is sampled as densely as a large one, and each texel turns its kernel by a noise of its own so the gaps between taps fall in a different place on every texel. The last stage reads the gathered blur through four taps that close those gaps, counts each by how close its blur is to the pixel's own (read at the frame's size, so a sharp edge stays one), and puts back the frame's own detail by what stays sharp. A pixel nothing blurs is the frame's own, untouched.

## What It Costs

The blur buffers are the frame's height divided by the smallest whole number, 2 at the least, that brings it under `maxBlurRows`: half of 720p and 1080p, a quarter of 4K. A frame with the pass on draws five more full-screen quads:

| Stage | Size | Taps a texel |
| --- | --- | --- |
| focus | 1 texel | 15 depth |
| prefilter | blur buffer | 4 colour, 4 depth |
| tiles | blur buffer / 16 | the widest near blur within reach of each tile |
| gather | blur buffer | 43 behind the focus where it blurs, 43 more where something near blurs, 1 where nothing does |
| combine | frame | 2 where nothing blurs, 10 elsewhere |

A texel skips the gather's loops, and a pixel the combine's, where its blur is under a quarter of a blur texel. With the focus eight units out or further and nothing within a few units of the eye (at 70 degrees and 1080p; nearer with a wider view or fewer rows), that is the whole frame.

## Limits

- It needs a perspective camera with a standard depth range, neither reversed nor logarithmic.
- A surface that writes no depth (blended water, glass, particles) blurs as whatever lies behind it.
- The frame is clamped to what the screen shows before the pass reads it, so a blurred light is no brighter than the screen's white. `highlightGain` can stand in for the brightness it would have kept, at the cost of flattening patterned bright surfaces.
- The blur is a disc at every depth: there is no shaped aperture and no chromatic fringe.

Read where the focus sits, for a readout or a test, with `await depthOfField.readFocus(renderer)`. See the pass in a running client in `examples/client/src/main.ts` (press K).
