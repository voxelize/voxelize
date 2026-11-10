import type { Material, Texture } from "three/webgpu";

type MapCarrier = Material & { map?: Texture | null };

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
 * callers that tint or re-shade a block mesh use. Under WebGPU the hook
 * fires only through `installMaterialRenderHooks`, which every World installs.
 *
 * With `followMap`, the display also takes up the image its source is
 * painted with later. An own-texture face starts on a placeholder and swaps
 * its map once its art is painted; a copy built before that (a torch already
 * in hand at join) would wear the placeholder forever. The display keeps
 * its own texture object, so a caller's repeat/offset (a flame strip
 * windowed to one frame) survives; only the image underneath moves, and
 * only while the display still wears the image it was built with — a map a
 * caller replaced on purpose is left alone.
 */
export function forwardDraws(
  display: Material,
  source: Material,
  options: { followMap?: boolean } = {},
) {
  const followMap = options.followMap === true;
  let worn = followMap ? (display as MapCarrier).map?.source ?? null : null;
  display.onBeforeRender = (
    renderer,
    scene,
    camera,
    geometry,
    object,
    group,
  ) => {
    if (followMap) {
      const map = (display as MapCarrier).map;
      const live = (source as MapCarrier).map?.source ?? null;
      if (map && live && worn && live !== worn && map.source === worn) {
        map.source = live;
        map.needsUpdate = true;
        worn = live;
      }
    }
    source.onBeforeRender(renderer, scene, camera, geometry, object, group);
  };
  const clone = display.clone;
  display.clone = function (this: Material) {
    const copy = clone.call(this);
    forwardDraws(copy, source, options);
    return copy;
  };
}
