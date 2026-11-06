import { type DepthTexture, RenderTarget } from "three/webgpu";

/**
 * Gives a depth texture that no target renders into a sample count of its
 * own, through an owning target that is never drawn into. three gives a
 * depth texture without a target the sample count of whatever target is
 * bound when it is allocated, or when a graph that samples it builds; async
 * builds resume while a thumbnail draws into its four-sample target, so a
 * chunk graph built then declared the scene depth multisampled, and every
 * later draw of it failed bind group validation (the terrain it held never
 * drew). Returns the texture.
 */
export function ownDepthSampleCount<T extends DepthTexture>(
  texture: T,
  samples: number,
): T {
  new RenderTarget(texture.image.width, texture.image.height, {
    depthTexture: texture,
    depthBuffer: true,
    samples,
  });
  return texture;
}
