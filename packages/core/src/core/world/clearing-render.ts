import type { Camera, Object3D, Renderer } from "three/webgpu";

/** Which attachments a {@link renderClearing} pass clears as it starts. */
export type PassClears = {
  color?: boolean;
  depth?: boolean;
  stencil?: boolean;
};

/**
 * Renders `scene` into the bound target with the clear folded into the
 * pass's load ops, the way `autoClear` does.
 *
 * On WebGPU, `renderer.clear()` is a render pass of its own and a queue
 * submission of its own (three submits every pass). Called right before a
 * render into the same target it was a second pass and a second submission
 * for the same result; the GPU process pays per submission, and a frame
 * made a few of these. Cleared values are the renderer's clear colour,
 * depth and stencil, as `clear()` used; a scene with a background would
 * draw it, so this is for scenes without one.
 */
export function renderClearing(
  renderer: Renderer,
  scene: Object3D,
  camera: Camera,
  clears: PassClears,
) {
  const { autoClear, autoClearColor, autoClearDepth, autoClearStencil } =
    renderer;
  renderer.autoClear = true;
  renderer.autoClearColor = clears.color === true;
  renderer.autoClearDepth = clears.depth === true;
  renderer.autoClearStencil = clears.stencil === true;
  try {
    renderer.render(scene, camera);
  } finally {
    renderer.autoClear = autoClear;
    renderer.autoClearColor = autoClearColor;
    renderer.autoClearDepth = autoClearDepth;
    renderer.autoClearStencil = autoClearStencil;
  }
}
