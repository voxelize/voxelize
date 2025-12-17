import { ChunkProtocol } from "@voxelize/protocol";
import { Group, Mesh } from "three";

import { Coords2 } from "../../types";

import { RawChunk, RawChunkOptions } from "./raw-chunk";

export class Chunk extends RawChunk {
  public meshes = new Map<number, Mesh[]>();

  public added = false;
  public isDirty = false;

  public group = new Group();

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
  }
}
