import ndarray, { NdArray } from "ndarray";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Int32BufferAttribute,
  Mesh,
} from "three";
import pool from "typedarray-pool";

import { Client } from "..";
import { Coords2, Coords3, MeshData } from "../types";
import { BlockUtils, ChunkUtils, LightColor, LightUtils } from "../utils";

type ChunkParams = {
  size: number;
  maxHeight: number;
};

class Chunk {
  public mesh: {
    opaque?: Mesh;
    transparent?: Mesh;
  } = {};

  public name: string;
  public coords: Coords2;

  public min: Coords3;
  public max: Coords3;

  public voxels: NdArray<Uint32Array>;
  public heightMap: NdArray<Uint32Array>;
  public lights: NdArray<Uint32Array>;

  private added = false;

  constructor(
    public client: Client,
    public id: string,
    x: number,
    z: number,
    public params: ChunkParams
  ) {
    this.name = ChunkUtils.getChunkName([x, z]);
    this.coords = [x, z];

    const { size, maxHeight } = params;

    this.voxels = ndarray(pool.mallocUint32(size * maxHeight * size), [
      size,
      maxHeight,
      size,
    ]);

    this.heightMap = ndarray(pool.mallocUint32(size ** 2), [size, size]);

    this.lights = ndarray(pool.mallocUint32(size * maxHeight * size), [
      size,
      maxHeight,
      size,
    ]);

    this.min = [x * size, 0, z * size];
    this.max = [(x + 1) * size, maxHeight, (z + 1) * size];
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
        mesh.matrixAutoUpdate = false;
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
      geometry.computeBoundingBox();

      this.mesh[type] = mesh;
    });
  };

  addToScene = () => {
    if (this.added) return;

    const { scene } = this.client.rendering;
    const { opaque, transparent } = this.mesh;

    if (opaque) scene.add(opaque);
    if (transparent) scene.add(transparent);

    this.added = true;
  };

  removeFromScene = () => {
    const { scene } = this.client.rendering;
    const { opaque, transparent } = this.mesh;

    if (opaque) scene.remove(opaque);
    if (transparent) scene.remove(transparent);

    this.added = false;
  };

  getRawValue = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.voxels.get(lx, ly, lz);
  };

  setRawValue = (vx: number, vy: number, vz: number, val: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.voxels.set(lx, ly, lz, val);
  };

  getVoxel = (vx: number, vy: number, vz: number) => {
    return BlockUtils.extractID(this.getRawValue(vx, vy, vz));
  };

  setVoxel = (vx: number, vy: number, vz: number, id: number) => {
    const value = BlockUtils.insertId(0, id);
    this.setRawValue(vx, vy, vz, value);
    return id;
  };

  getVoxelRotation = (vx: number, vy: number, vz: number) => {
    this.assert(vx, vy, vz);
    return BlockUtils.extractRotation(this.getRawValue(vx, vy, vz));
  };

  setVoxelRotation = (vx: number, vy: number, vz: number, rotation: number) => {
    const value = BlockUtils.insertRotation(
      this.getRawValue(vx, vy, vz),
      rotation
    );
    this.setRawValue(vx, vy, vz, value);
  };

  getVoxelStage = (vx: number, vy: number, vz: number) => {
    this.assert(vx, vy, vz);
    return BlockUtils.extractStage(this.getRawValue(vx, vy, vz));
  };

  setVoxelStage = (vx: number, vy: number, vz: number, stage: number) => {
    const value = BlockUtils.insertStage(this.getRawValue(vx, vy, vz), stage);
    this.setRawValue(vx, vy, vz, value);
    return stage;
  };

  getRedLight = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalRedLight(lx, ly, lz);
  };

  setRedLight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalRedLight(lx, ly, lz, level);
  };

  getGreenLight = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalGreenLight(lx, ly, lz);
  };

  setGreenLight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalGreenLight(lx, ly, lz, level);
  };

  getBlueLight = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalBlueLight(lx, ly, lz);
  };

  setBlueLight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalBlueLight(lx, ly, lz, level);
  };

  getTorchLight = (vx: number, vy: number, vz: number, color: LightColor) => {
    switch (color) {
      case "RED":
        return this.getRedLight(vx, vy, vz);
      case "GREEN":
        return this.getGreenLight(vx, vy, vz);
      case "BLUE":
        return this.getBlueLight(vx, vy, vz);
      default:
        throw new Error("Received unknown light color...");
    }
  };

  setTorchLight = (
    vx: number,
    vy: number,
    vz: number,
    level: number,
    color: LightColor
  ) => {
    switch (color) {
      case "RED":
        return this.setRedLight(vx, vy, vz, level);
      case "GREEN":
        return this.setGreenLight(vx, vy, vz, level);
      case "BLUE":
        return this.setBlueLight(vx, vy, vz, level);
      default:
        throw new Error("Received unknown light color...");
    }
  };

  getSunlight = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalSunlight(lx, ly, lz);
  };

  setSunlight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalSunlight(lx, ly, lz, level);
  };

  getMaxHeight = (vx: number, vz: number) => {
    if (!this.contains(vx, 0, vz)) {
      return this.params.maxHeight;
    }

    const [lx, , lz] = this.toLocal(vx, 0, vz);
    return this.heightMap.get(lx, lz);
  };

  setMaxHeight = (vx: number, vz: number, height: number) => {
    this.assert(vx, 0, vz);

    const [lx, , lz] = this.toLocal(vx, 0, vz);
    return this.heightMap.set(lx, lz, height);
  };

  distTo = (vx: number, _: number, vz: number) => {
    const [mx, , mz] = this.min;

    return Math.sqrt(
      (mx + this.params.size / 2 - vx) ** 2 +
        (mz + this.params.size / 2 - vz) ** 2
    );
  };

  private getLocalRedLight = (lx: number, ly: number, lz: number) => {
    return LightUtils.extractRedLight(this.lights.get(lx, ly, lz));
  };

  private setLocalRedLight = (
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) => {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertRedLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalGreenLight = (lx: number, ly: number, lz: number) => {
    return LightUtils.extractGreenLight(this.lights.get(lx, ly, lz));
  };

  private setLocalGreenLight = (
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) => {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertGreenLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalBlueLight = (lx: number, ly: number, lz: number) => {
    return LightUtils.extractBlueLight(this.lights.get(lx, ly, lz));
  };

  private setLocalBlueLight = (
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) => {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertBlueLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalSunlight = (lx: number, ly: number, lz: number) => {
    return LightUtils.extractSunlight(this.lights.get(lx, ly, lz));
  };

  private setLocalSunlight = (
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) => {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertSunlight(this.lights.get(lx, ly, lz), level)
    );
  };

  private toLocal = (vx: number, vy: number, vz: number) => {
    const [mx, my, mz] = this.min;
    return [vx - mx, vy - my, vz - mz];
  };

  private contains = (vx: number, vy: number, vz: number) => {
    const { size, maxHeight } = this.params;
    const [lx, ly, lz] = this.toLocal(vx, vy, vz);

    return lx < size && ly >= 0 && ly < maxHeight && lz >= 0 && lz < size;
  };

  private assert = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      throw new Error(`Chunk voxel out of bounds for chunk: ${this.coords}`);
    }
  };
}

export { Chunk };
