import {
  type BufferGeometry,
  Camera,
  InstancedMesh,
  Material,
  Mesh,
  Object3D,
  Scene,
  Renderer,
} from "three/webgpu";

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
const shadowViews = new WeakSet<Camera>();

/**
 * Marks a camera that draws shadow depth (a sun cascade, a torch's face).
 * GPU-drawn terrain keeps a packed list of its own for such views, so the
 * main view's list outlives a cascade drawn between two frames of it.
 */
export function markShadowView<T extends Camera>(camera: T): T {
  shadowViews.add(camera);
  return camera;
}

/** Whether `camera` was marked with {@link markShadowView}. */
export function isShadowView(camera: Camera): boolean {
  return shadowViews.has(camera);
}

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
    renderer: Renderer,
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
    // Into the target as it is: the casters join what the pass drew before
    // them (a cascade's whole static world). A render that cleared first
    // left a near cascade holding these casters alone, and no terrain, tree
    // or house shadowed anything near the player.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(this.scene, camera);
    } finally {
      renderer.autoClear = autoClear;
      this.scene.children = this.ownChildren;
      this.scene.overrideMaterial = null;
    }
  }

  /**
   * Build what {@link render} would draw `casters` with into the current
   * render target, for a load warmup. Not through the override itself:
   * three copies each caster's values (its position node, alpha test,
   * transparency) onto the one override material as it walks a pass, and a
   * compile builds the draws after the walk, when the override holds the
   * last caster's values, so every draw was keyed as that one. Each kind of
   * caster draws instead with a clone of the override carrying its values,
   * on a stand-in that shares its geometry and has no draw hook (a GPU
   * terrain bucket's culls its sections). Resolves once they are built.
   */
  async compile(
    renderer: Renderer,
    camera: Camera,
    casters: Object3D[],
    overrideMaterial: Material,
    ownDepthPools: Object3D[] = [],
  ): Promise<void> {
    const standIns = overrideStandIns(casters, overrideMaterial);
    const own = ownDepthStandIns(ownDepthPools);
    const objects = [...standIns.objects, ...own];
    if (objects.length === 0) return;
    this.scene.children = objects;
    try {
      await renderer.compileAsync(this.scene, camera);
    } finally {
      this.scene.children = this.ownChildren;
      standIns.dispose();
      for (const standIn of own) {
        if ((standIn as InstancedMesh).isInstancedMesh) {
          (standIn as InstancedMesh).dispose();
        }
      }
    }
  }
}

/**
 * Mark `object` as something no depth pass may ever draw, whatever it is
 * drawn with: the sky and the cloud deck occlude nothing, while a depth
 * pass draws every mesh under them as a solid. Honoured on the scene's
 * direct children (`CSMRenderer.hideNonCasters`), so any scene they are
 * added to keeps them out without registering them anywhere.
 */
export function markNeverCaster(object: Object3D): void {
  object.userData.isNeverCaster = true;
}

export function isMarkedNeverCaster(object: Object3D): boolean {
  return object.userData?.isNeverCaster === true;
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
 * depth. Rain streaks, snow, splashes, lightning, shore foam, marine snow
 * and entity fire are all built this way, and a
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

type OverrideSource = Material & {
  positionNode?: { isNode?: boolean } | null;
  alphaMap?: unknown;
  displacementMap?: unknown;
  displacementScale?: number;
  displacementBias?: number;
  transmission?: number;
  transmissionNode?: { isNode?: boolean } | null;
  backdropNode?: { isNode?: boolean } | null;
};

/** What three's `renderObject` writes onto an override before keying a draw. */
function overrideValues(source: OverrideSource) {
  return {
    ...(source.positionNode?.isNode
      ? { positionNode: source.positionNode }
      : {}),
    _alphaTest: source.alphaTest,
    alphaMap: source.alphaMap,
    displacementMap: source.displacementMap,
    displacementScale: source.displacementScale,
    displacementBias: source.displacementBias,
    transparent:
      source.transparent ||
      (source.transmission ?? 0) > 0 ||
      (source.transmissionNode && source.transmissionNode.isNode) ||
      (source.backdropNode && source.backdropNode.isNode),
  };
}

/** A geometry's vertex layout, which a draw's pipeline is keyed by. */
function layoutOf(geometry: BufferGeometry) {
  const attributes = Object.entries(geometry.attributes)
    .map(
      ([name, a]) =>
        `${name}:${a.itemSize}:${(a as { array?: object }).array?.constructor.name}:${a.normalized}`,
    )
    .join(",");
  return `${geometry.index ? "i" : "-"}|${attributes}`;
}

/**
 * One stand-in per kind of caster under `casters` (a vertex layout, an
 * object kind, the override values its material gives), each drawing with
 * a clone of `overrideMaterial` carrying those values: what a pass drawing
 * `casters` with that override builds pipelines for.
 */
export function overrideStandIns(
  casters: Object3D[],
  overrideMaterial: Material,
): { objects: Object3D[]; dispose(): void } {
  const objects: Object3D[] = [];
  const clones = new Map<string, Material>();
  const seen = new Set<string>();
  // A caster named here draws even while hidden: a GPU terrain bucket
  // stays hidden until its culls are built, and draws in every pass after.
  const visit = (object: Object3D, isNamed: boolean) => {
    if ((!object.visible && !isNamed) || isMarkedNeverCaster(object)) return;
    const mesh = object as Mesh;
    const source = mesh.material as OverrideSource | OverrideSource[] | undefined;
    if (mesh.isMesh && mesh.geometry && source && !Array.isArray(source)) {
      const isCaster =
        source.allowOverride === true && source.userData?.skipShadow !== true;
      // A batched page draws its own instance list, and a skinned mesh its
      // own bones (neither is a caster here): left to their first draw.
      const other = mesh as { isBatchedMesh?: boolean; isSkinnedMesh?: boolean };
      const kind =
        other.isBatchedMesh || other.isSkinnedMesh
          ? null
          : (mesh as InstancedMesh).isInstancedMesh
            ? "instanced"
            : "mesh";
      if (isCaster && kind) {
        const values = overrideValues(source);
        const valuesKey = [
          (values.positionNode as { id?: number } | undefined)?.id ?? "-",
          values._alphaTest > 0,
          !!values.alphaMap,
          !!values.displacementMap,
          String(values.transparent),
        ].join("|");
        const key = `${kind}|${layoutOf(mesh.geometry)}|${valuesKey}|${mesh.receiveShadow}`;
        if (!seen.has(key)) {
          seen.add(key);
          let clone = clones.get(valuesKey);
          if (!clone) {
            clone = Object.assign(overrideMaterial.clone(), values);
            clones.set(valuesKey, clone);
          }
          const standIn =
            kind === "instanced"
              ? new InstancedMesh(mesh.geometry, clone, 1)
              : new Mesh(mesh.geometry, clone);
          const colors = (mesh as InstancedMesh).instanceColor;
          // A per-instance colour is a vertex stream of its own, in the key.
          if (kind === "instanced" && colors) {
            (standIn as InstancedMesh).instanceColor = colors;
          }
          standIn.name = mesh.name;
          standIn.frustumCulled = false;
          standIn.receiveShadow = mesh.receiveShadow;
          standIn.userData = mesh.userData;
          objects.push(standIn);
        }
      }
    }
    for (const child of object.children) visit(child, false);
  };
  for (const caster of casters) visit(caster, true);
  return {
    objects,
    dispose() {
      for (const clone of clones.values()) clone.dispose();
      for (const standIn of objects) {
        if ((standIn as InstancedMesh).isInstancedMesh) {
          (standIn as InstancedMesh).dispose();
        }
      }
    },
  };
}

/**
 * One stand-in per kind of pool mesh under `pools` drawing with its own
 * depth material (`customDepthMaterial`), as a shadow frame draws a pool:
 * swapped onto that material, which no override replaces.
 */
export function ownDepthStandIns(pools: Object3D[]): Object3D[] {
  const objects: Object3D[] = [];
  const seen = new Set<string>();
  for (const pool of pools) {
    pool.traverse((child) => {
      const mesh = child as Mesh;
      const depth = mesh.customDepthMaterial;
      if (!mesh.isMesh || !mesh.geometry || !depth) return;
      const isInstanced = (mesh as InstancedMesh).isInstancedMesh === true;
      const colors = isInstanced ? (mesh as InstancedMesh).instanceColor : null;
      const key = `${depth.id}|${isInstanced}|${!!colors}|${layoutOf(mesh.geometry)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const standIn = isInstanced
        ? new InstancedMesh(mesh.geometry, depth, 1)
        : new Mesh(mesh.geometry, depth);
      if (colors) (standIn as InstancedMesh).instanceColor = colors;
      standIn.name = mesh.name;
      standIn.frustumCulled = false;
      standIn.userData = mesh.userData;
      objects.push(standIn);
    });
  }
  return objects;
}
