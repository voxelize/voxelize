import type { Material } from "three";

/**
 * Makes every draw of `display` also count as a draw of `source`: the
 * display material's `onBeforeRender` calls the source material's, read at
 * draw time, so a hook installed on the source after the display was built
 * still fires.
 *
 * A face texture that is animated lazily, from its face material's
 * `onBeforeRender` (which three.js calls only for meshes it is about to
 * draw), then also advances while a held, dropped or displayed copy of the
 * block is on screen. The forwarding survives `display.clone()`, which the
 * callers that tint or re-shade a block mesh use.
 */
export function forwardDraws(display: Material, source: Material) {
  display.onBeforeRender = (renderer, scene, camera, geometry, object, group) =>
    source.onBeforeRender(renderer, scene, camera, geometry, object, group);
  const clone = display.clone;
  display.clone = function (this: Material) {
    const copy = clone.call(this);
    forwardDraws(copy, source);
    return copy;
  };
}
