import { Camera, Material, Object3D, Scene, WebGLRenderer } from "three";

/**
 * Draws a list of casters that live elsewhere in the scene graph, without
 * reparenting them.
 *
 * A depth pass that wants only a subset of the graph (the entities near the
 * player, the instanced pools with a creature in reach) used to move each
 * caster into a scratch scene and back. Every move fired `childremoved` and
 * `childadded` on the caster's real parent, and listeners on those events
 * (the world atmosphere driver watches the whole entity subtree) unwatched
 * and rewatched every node of every caster on every shadow refresh.
 *
 * three walks `object.children` to build its render list and never reads a
 * child's `parent` while doing so, so the scratch scene can *borrow* the
 * caster array for one render call: the casters keep their parents and
 * their world matrices, and nothing is told about a move that never
 * happened. World matrices are not recomputed here (the scene's automatic
 * update is off): the caller must have updated the graph this frame, as a
 * cascade does by rendering the whole scene first, or ask for each caster's
 * subtree to be refreshed (`refreshMatrices`), as a pass that draws casters
 * alone must when nothing walked the graph this frame.
 */
export class BorrowedCasterScene {
  readonly scene = new Scene();

  private readonly ownChildren: Object3D[];

  constructor() {
    this.scene.matrixWorldAutoUpdate = false;
    this.ownChildren = this.scene.children;
  }

  /**
   * Render `casters` with `camera` into the current render target. With an
   * override material, every material that allows overriding draws with it;
   * a material with `allowOverride === false` (an instanced pool's own
   * skinned depth material) keeps drawing itself. `refreshMatrices`
   * recomputes each caster's world matrices first, from its real parent,
   * which is what rendering the caster as its own root (or reparented into
   * a scratch scene that updates itself) used to do.
   */
  render(
    renderer: WebGLRenderer,
    camera: Camera,
    casters: Object3D[],
    overrideMaterial: Material | null,
    refreshMatrices = false,
  ): void {
    if (casters.length === 0) return;
    if (refreshMatrices) {
      for (let i = 0; i < casters.length; i++) casters[i].updateMatrixWorld();
    }
    this.scene.children = casters;
    this.scene.overrideMaterial = overrideMaterial;
    try {
      renderer.render(this.scene, camera);
    } finally {
      this.scene.children = this.ownChildren;
      this.scene.overrideMaterial = null;
    }
  }
}

type MaterialCarrier = { material?: Material | Material[] | null };

function isNonCasterMaterial(material: Material | null | undefined): boolean {
  return (
    !!material &&
    material.transparent === true &&
    material.depthWrite === false &&
    material.userData?.castsShadow !== true
  );
}

/**
 * Whether a scene-level object is a see-through effect with no business in
 * a shadow map: every material it draws with is transparent and writes no
 * depth. Rain streaks, snow, splashes, lightning, shore foam, underwater
 * light shafts, marine snow and entity fire are all built this way, and a
 * surface that does not occlude the camera does not occlude the sun either.
 *
 * Depth passes draw with an override material, which ignores the effect's
 * own transparency and custom vertex shader, so these objects used to land
 * in every cascade as opaque bind-pose quads, lines and points — a draw per
 * cascade each for nothing, and rain streaks in the sun's depth. A material
 * can opt back in with `userData.castsShadow = true`.
 *
 * Only the scene's direct children are tested: chunk meshes (whose see-through
 * buckets decide shadows per block through `skipShadow`) live under chunk
 * groups, and entity parts under entity roots, so neither is ever caught.
 */
export function isNonCasterEffect(object: Object3D): boolean {
  const { material } = object as Object3D & MaterialCarrier;
  if (!material) return false;
  if (Array.isArray(material)) {
    return material.length > 0 && material.every(isNonCasterMaterial);
  }
  return isNonCasterMaterial(material);
}
