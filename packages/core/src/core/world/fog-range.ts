/**
 * The chunk shader's fog near/far, in blocks from the camera.
 */
export type WorldFogRange = {
  near: number;
  far: number;
};

export type FogRangeInputs = {
  chunkSize: number;
  renderRadius: number;
  fogNearRenderRatio: number;
  fogFarRenderRatio: number;
  /**
   * A fixed fog distance in blocks, independent of `renderRadius`. `null`
   * or `undefined` derives fog from the render radius as before (the
   * default): fog moves every time the radius changes, so a vista capture
   * at a higher radius also pushes fog out to match. A number holds fog at
   * that distance across radius changes, clamped down to at most the
   * current render distance — there is nothing loaded past the radius to
   * fog into, so an unclamped value would just show void past the fog.
   */
  fogDistance?: number | null;
};

/**
 * Pure so a radius/ratio/override combination can be asserted without a
 * `World` instance. `World.getBaseFogRange()` is the only caller; keep them
 * in sync.
 */
export function computeFogRange({
  chunkSize,
  renderRadius,
  fogNearRenderRatio,
  fogFarRenderRatio,
  fogDistance,
}: FogRangeInputs): WorldFogRange {
  const renderDistance = renderRadius * chunkSize;

  if (fogDistance == null) {
    return {
      near: renderDistance * fogNearRenderRatio,
      far: renderDistance * fogFarRenderRatio,
    };
  }

  const far = Math.max(0, Math.min(fogDistance, renderDistance));
  const ratio =
    fogFarRenderRatio > 0 ? fogNearRenderRatio / fogFarRenderRatio : 0;

  return { near: Math.min(far, far * ratio), far };
}
