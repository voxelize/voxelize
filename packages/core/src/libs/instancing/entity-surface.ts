import { InstancedSkinnedMaterialOptions } from "./instanced-skinned-material";

/// How a family's material reads its art: the atlas the face-UV lookup walks,
/// or the vertex colours it multiplies instead.
///
/// Every renderer of a family (the live pool, an offscreen portrait) should
/// derive these from one call. A family whose colour lives in vertex
/// attributes over a one-texel white texture renders solid white through a
/// hard-coded face-UV path; deriving both sides from the same call makes that
/// disagreement unrepresentable rather than merely unlikely.
export type EntitySurfaceOptions = Pick<
  InstancedSkinnedMaterialOptions,
  | "useFaceUV"
  | "useVertexColor"
  | "atlasGridCols"
  | "atlasGridRows"
  | "partCount"
  | "emissiveFace"
>;

type EmissiveFace = NonNullable<
  InstancedSkinnedMaterialOptions["emissiveFace"]
>;

/// Every part atlas is six face cells wide and one row per part. The row
/// count is the part count, not an independent number: an atlas sized to the
/// material's default row count samples a band of the wrong height.
export const ENTITY_ATLAS_COLS = 6;

/// A part atlas: each part's six faces in one row (paintPartFacesAtDensity).
export function atlasSurface(
  partCount: number,
  emissiveFace?: EmissiveFace,
): EntitySurfaceOptions {
  return {
    useFaceUV: true,
    atlasGridCols: ENTITY_ATLAS_COLS,
    atlasGridRows: partCount,
    partCount,
    ...(emissiveFace ? { emissiveFace } : {}),
  };
}

/// Colour carried in a `vertexColor` attribute over a white texture.
export function vertexColorSurface(partCount: number): EntitySurfaceOptions {
  return {
    useFaceUV: false,
    useVertexColor: true,
    atlasGridCols: ENTITY_ATLAS_COLS,
    atlasGridRows: partCount,
    partCount,
  };
}

/// UVs baked straight into another atlas (the world's block atlas): the
/// shader samples `uv` as given, no cell lookup.
export function blockAtlasSurface(partCount: number): EntitySurfaceOptions {
  return {
    useFaceUV: false,
    useVertexColor: false,
    atlasGridCols: ENTITY_ATLAS_COLS,
    atlasGridRows: partCount,
    partCount,
  };
}
