import type { Side, Texture } from "three";
import { DoubleSide, FrontSide } from "three";

/**
 * The alpha below which a see-through display copy discards a texel, the
 * same cut the chunk mesh's see-through materials use.
 */
export const DISPLAY_COPY_ALPHA_TEST = 0.1;

export type DisplayCopyMaterialOptions = {
  transparent: boolean;
  alphaTest: number;
  map: Texture | null | undefined;
  side: Side;
};

/**
 * Material options for a held, dropped or displayed copy of a block
 * (`World.makeBlockMesh`).
 *
 * The copy keeps three's default depth write, and a see-through copy
 * discards its empty texels. Without the discard, every card of a plant
 * copy writes depth across its whole rectangle, and because the copy draws
 * at render order 0, before the chunk see-through meshes, glass and other
 * see-through blocks behind the empty part of the card fail the depth test
 * and vanish. With it, only the painted pixels occlude, as they do on the
 * chunk copy of the same block.
 */
export function displayCopyMaterialOptions(
  block: { isSeeThrough: boolean },
  map: Texture | null | undefined,
): DisplayCopyMaterialOptions {
  return {
    transparent: block.isSeeThrough,
    alphaTest: block.isSeeThrough ? DISPLAY_COPY_ALPHA_TEST : 0,
    map,
    side: block.isSeeThrough ? DoubleSide : FrontSide,
  };
}
