import type {
  ParticleBlock,
  ParticleBlockFace,
  ParticleTexture,
  ParticleWorld,
  UVRegion,
} from "./types";

/**
 * Lets a particle wear a real block texture. Chunk materials keep every
 * block's art in one atlas and address it by UV range, so particles from
 * many different blocks share a single layer — one draw call — and differ
 * only by the window each instance samples.
 *
 * Faces the mesher isolates render from a per-voxel material instead of the
 * shared atlas; those have no window to hand out and resolve to null rather
 * than to somebody else's texture.
 */
export function resolveBlockFaceParticleTexture(
  world: ParticleWorld,
  block: ParticleBlock,
  face: ParticleBlockFace,
  patchFraction: number,
): ParticleTexture | null {
  if (face.isolated) return null;
  const map = world.getBlockFaceMaterial(block.id, face.name)?.map;
  if (!map) return null;
  return {
    key: `atlas:${map.uuid}`,
    map,
    region: face.range,
    patchFraction,
  };
}

/**
 * The region one particle of a textured config samples: the spawn's own
 * when it names one, else one of the texture's `variants` at random, else
 * its `region`.
 */
export function pickTextureRegion(
  texture: ParticleTexture,
  spawnRegion: UVRegion | undefined,
  random: () => number,
): UVRegion {
  if (spawnRegion) return spawnRegion;
  const variants = texture.variants;
  if (!variants || variants.length === 0) return texture.region;
  return variants[
    Math.min(variants.length - 1, Math.floor(random() * variants.length))
  ];
}
