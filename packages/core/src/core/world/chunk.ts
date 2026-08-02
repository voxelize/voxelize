import { ChunkProtocol } from "@voxelize/protocol";
import { Group, Mesh } from "three";

import { ChunkSharedPool } from "../../libs/chunk-shared-pool";
import { Coords2 } from "../../types";

import { RawChunk, RawChunkOptions } from "./raw-chunk";

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

  constructor(id: string, coords: Coords2, options: RawChunkOptions) {
    super(id, coords, options);
  }

  setData(data: ChunkProtocol) {
    const { id, x, z } = data;

    if (this.id !== id) {
      throw new Error("Chunk id mismatch");
    }

    if (this.coords[0] !== x || this.coords[1] !== z) {
      throw new Error("Chunk coords mismatch");
    }

    const { voxels, lights } = data;

    if (lights && lights.byteLength) this.lights.data = lights;
    if (voxels && voxels.byteLength) this.voxels.data = voxels;
  }

  dispose() {
    this.meshes.forEach((mesh) => {
      mesh.forEach((subMesh) => {
        if (!subMesh) return;

        subMesh.geometry?.dispose();

        if (subMesh.material) {
          if (Array.isArray(subMesh.material)) {
            subMesh.material.forEach((mat) => mat.dispose());
          } else {
            subMesh.material.dispose();
          }
        }

        if (subMesh.parent) {
          subMesh.parent.remove(subMesh);
        }
      });
    });
    this.meshes.clear();
    ChunkSharedPool.getInstance().releaseChunk(this.name);
    this.voxels.data = new Uint32Array(0);
    this.lights.data = new Uint32Array(0);
  }
}
