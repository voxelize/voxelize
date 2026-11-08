import { ChunkProtocol } from "@voxelize/protocol";
import { Group, Mesh } from "three/webgpu";

import { ChunkSharedPool } from "../../libs/chunk-shared-pool";
import { Coords2 } from "../../types";
import { releaseObject } from "../../utils/three-utils";

import { RawChunk, RawChunkOptions } from "./raw-chunk";

/**
 * Let a chunk mesh go for good: its geometry freed, it taken out of the
 * scene, and the renderer told the mesh itself is gone.
 *
 * three's WebGPU renderer keeps a render object (bindings, pipeline state,
 * node uniforms, a listener on the material) for every mesh it has drawn,
 * in a set it only empties when the mesh, its material or its lights fire
 * `dispose`. Disposing the geometry alone leaves the render object, and
 * through it the mesh and its geometry, alive for as long as the page.
 * Chunk materials are the world's shared block materials and must not be
 * disposed (see {@link Chunk.dispose}), so the mesh's own `dispose` event is
 * what frees it. Without it every chunk mesh ever built stayed in memory:
 * walking leaked about 10 MB a minute, a long teleport tour 75 MB a lap.
 */
export function releaseChunkMesh(mesh: Mesh): void {
  mesh.geometry?.dispose();
  mesh.removeFromParent();
  // Its children too: the layers drawn off it (a window's lifted pane, a
  // see-through layer) share its buffers and go with it.
  releaseObject(mesh);
}

/**
 * A container whose contents never move once they are in it. It skips the
 * per-frame world-matrix walk of its own subtree, and only walks it when
 * something has been added — which is what {@link StaticGroup.updateMatrixWorld}
 * with `force` means here.
 *
 * A chunk holds one of these because a loaded disc is thousands of meshes at
 * fixed positions, and three.js has no way to say "this branch is settled": the
 * renderer walks every node of the scene every frame regardless.
 */
export class StaticGroup extends Group {
  private needsMatrixUpdate = true;

  /** Re-arms the subtree walk after geometry is added or repositioned. */
  markMatrixDirty() {
    this.needsMatrixUpdate = true;
  }

  override updateMatrixWorld(force?: boolean) {
    if (!this.needsMatrixUpdate && force !== true) return;
    this.needsMatrixUpdate = false;
    super.updateMatrixWorld(true);
  }
}

export class Chunk extends RawChunk {
  public biomeTints: Uint8Array | undefined;
  public meshes = new Map<number, Mesh[]>();

  public added = false;
  public isDirty = false;

  public group = new StaticGroup();

  /**
   * Whether this chunk's plant meshes are currently shown, or `null` when the
   * question has not been asked since its meshes last changed. Lets the
   * per-frame distance check skip chunks whose band has not moved.
   */
  public plantsShown: boolean | null = null;

  /**
   * Whether this chunk's tuft meshes ({@link Block.tufts}) are shown, or
   * `null` when it must be asked again, as {@link plantsShown} is.
   */
  public tuftsShown: boolean | null = null;

  /**
   * Bit-per-level mask of which sections the occlusion walk last left
   * visible, or `null` when it must be reapplied (fresh meshes default to
   * visible). Lets the per-frame walk skip rewriting mesh visibility for
   * chunks whose answer has not changed.
   */
  public sectionVisibleMask: number | null = null;

  constructor(id: string, coords: Coords2, options: RawChunkOptions) {
    super(id, coords, options);
  }

  /** See {@link RawChunk.setData}: adopts a new server id for the same coordinates. */
  override setData(data: ChunkProtocol): boolean {
    const { id, x, z } = data;

    if (this.coords[0] !== x || this.coords[1] !== z) {
      throw new Error("Chunk coords mismatch");
    }

    const idChanged = this.id !== id;
    this.id = id;

    const { voxels, lights } = data;

    if (data.biomeTints?.length === 12) this.biomeTints = data.biomeTints;

    if (lights && lights.byteLength) this.lights.data = lights;
    if (voxels && voxels.byteLength) this.voxels.data = voxels;

    return idChanged;
  }

  dispose() {
    this.meshes.forEach((mesh) => {
      mesh.forEach((subMesh) => {
        if (!subMesh) return;

        // The geometry is this chunk's alone. The material is not: every
        // chunk mesh wears one of the world's shared block materials
        // (`chunkRenderer.materials`), so disposing it here tore down the
        // renderer's compiled program and cached uniforms for every other
        // chunk still wearing it. The next frame then re-initialised the
        // material, and where the program had no other user left — the
        // fluid shader while only water was on screen — recompiled and
        // relinked it from source: a hitch on every chunk unload, paid
        // most often exactly where chunks churn fastest, out at sea.
        releaseChunkMesh(subMesh);
      });
    });
    this.meshes.clear();
    ChunkSharedPool.getInstance().releaseChunk(this.name);
    this.voxels.data = new Uint32Array(0);
    this.lights.data = new Uint32Array(0);
    this.biomeTints = undefined;
  }
}
