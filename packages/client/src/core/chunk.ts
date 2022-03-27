import { BaseChunk, BaseChunkParams, MeshData } from "@voxelize/common";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Int32BufferAttribute,
  Mesh,
} from "three";

import { Client } from "..";

class Chunk extends BaseChunk {
  public mesh: {
    opaque?: Mesh;
    transparent?: Mesh;
  } = {};

  private added = false;

  constructor(
    public client: Client,
    id: string,
    x: number,
    z: number,
    params: BaseChunkParams
  ) {
    super(id, x, z, params);
  }

  build = (data: { opaque?: MeshData; transparent?: MeshData }) => {
    ["opaque", "transparent"].forEach((type) => {
      const meshData = data[type];

      if (!meshData) return;

      const { positions, indices, uvs, aos, lights } = meshData;

      if (positions.length === 0 || indices.length === 0) {
        return;
      }

      let mesh = this.mesh[type] as Mesh;

      if (!mesh) {
        const { opaque, transparent } = this.client.registry.materials;

        mesh = new Mesh(
          new BufferGeometry(),
          type === "opaque" ? opaque : transparent
        );
        mesh.name = `${this.name}-${type}`;
      }

      const geometry = mesh.geometry;

      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("ao", new Int32BufferAttribute(aos, 1));
      geometry.setAttribute("light", new Int32BufferAttribute(lights, 1));
      geometry.setIndex(Array.from(indices));

      this.mesh[type] = mesh;
    });
  };

  addToScene = () => {
    if (this.added) return;

    const { mesh } = this.client.chunks;
    const { opaque, transparent } = this.mesh;

    if (opaque) mesh.add(opaque);
    if (transparent) mesh.add(transparent);

    this.added = true;
  };

  removeFromScene = () => {
    if (!this.added) return;

    const { mesh } = this.client.chunks;
    const { opaque, transparent } = this.mesh;

    if (opaque) mesh.remove(opaque);
    if (transparent) mesh.remove(transparent);

    this.added = false;
  };
}

export { Chunk };
