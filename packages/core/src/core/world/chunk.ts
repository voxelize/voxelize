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
    let meshGroups = this.meshes.values();
    let meshGroup = meshGroups.next();
    while (!meshGroup.done) {
      const meshes = meshGroup.value;
      for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
        const subMesh = meshes[meshIndex];
        if (!subMesh) {
          continue;
        }

        subMesh.geometry?.dispose();

        const material = subMesh.material;
        if (material) {
          if (Array.isArray(material)) {
            for (let materialIndex = 0; materialIndex < material.length; materialIndex++) {
              material[materialIndex].dispose();
            }
          } else {
            material.dispose();
          }
        }

        if (subMesh.parent) {
          subMesh.parent.remove(subMesh);
        }
      }
      meshGroup = meshGroups.next();
    }

    this.meshes.clear();
  }
}
