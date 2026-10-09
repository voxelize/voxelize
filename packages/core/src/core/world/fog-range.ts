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
   * current reach — there is nothing drawn past the loaded chunks (or past
   * the far layer, when there is one) to fog into, so an unclamped value
   * would just show void past the fog.
   */
  fogDistance?: number | null;
  /**
   * How far the far-terrain layer draws past the viewer, in blocks; 0 or
   * absent when it is off. When it reaches past the loaded chunks, fog
   * closes at its edge instead of inside the loaded disc.
   */
  farTerrainDistance?: number;
  /**
   * With the far layer on, the fraction of the render distance where fog
   * starts. Defaults to `0.6`.
   */
  farTerrainFogNearRatio?: number;
  /**
   * With the far layer on, where fog closes as a multiple of its reach.
   * Past 1 the far layer's last stretch stays partly clear and the layer
   * thins into the haze itself (`FarTerrainOptions.edgeBand`). Defaults to
   * `1`, fog closing at the reach.
   */
  farTerrainFogFarRatio?: number;
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
  farTerrainDistance = 0,
  farTerrainFogNearRatio = 0.6,
  farTerrainFogFarRatio = 1,
}: FogRangeInputs): WorldFogRange {
  const renderDistance = renderRadius * chunkSize;
  const hasFarLayer = farTerrainDistance > renderDistance;
  const reach = hasFarLayer ? farTerrainDistance : renderDistance;

  if (fogDistance == null) {
    if (hasFarLayer) {
      // Loaded terrain stays nearly clear to its edge; the far layer takes
      // the haze and dissolves at its own edge.
      return {
        near: renderDistance * farTerrainFogNearRatio,
        far: farTerrainDistance * Math.max(1, farTerrainFogFarRatio),
      };
    }
    return {
      near: renderDistance * fogNearRenderRatio,
      far: renderDistance * fogFarRenderRatio,
    };
  }

  const far = Math.max(0, Math.min(fogDistance, reach));
  const ratio = hasFarLayer
    ? (renderDistance * farTerrainFogNearRatio) /
      Math.max(farTerrainDistance, 1)
    : fogFarRenderRatio > 0
      ? fogNearRenderRatio / fogFarRenderRatio
      : 0;

  return { near: Math.min(far, far * ratio), far };
}
