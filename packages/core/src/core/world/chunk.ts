import { ChunkProtocol } from "@voxelize/transport/src/types";
import { Group, Mesh } from "three";

import { LOD } from "../../libs";
import { Coords2 } from "../../types";

import { RawChunk, RawChunkOptions } from "./raw-chunk";

export class Chunk extends RawChunk {
  // LOD -> level -> Mesh
  public meshes = new Map<number, Map<number, Mesh[]>>();

  public added = false;
  public isDirty = false;

  public lod = new LOD();
  public lodGroups: Map<number, Group> = new Map();

  constructor(id: string, coords: Coords2, options: RawChunkOptions) {
    super(id, coords, options);
    for (let i = 0; i < this.options.lodDistances.length; i++) {
      const newGroup = new Group();
      this.lodGroups.set(i, newGroup);
      this.lod.addLevel(
        newGroup,
        this.options.lodDistances[i] * this.options.size
      );
    }
    this.lod.position.set(
      this.coords[0] * this.options.size,
      0,
      this.coords[1] * this.options.size
    );
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
      mesh.forEach((subMeshMap) => {
        subMeshMap.forEach((subMesh) => {
          if (!subMesh) return;

          subMesh.geometry?.dispose();

          if (subMesh.parent) {
            subMesh.parent.remove(subMesh);
          }
        });
      });
    });
  }
}
