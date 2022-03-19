import { ChunkUtils, Coords3, Coords2 } from "@voxelize/common";
import ndarray, { NdArray } from "ndarray";
import pool from "typedarray-pool";
import { v4 as uuidv4 } from "uuid";

import { Blocks } from "./blocks";
import { LightColor, Lights } from "./lights";

type ChunkParams = {
  size: number;
  padding: number;
  maxHeight: number;
};

class Chunk {
  public id: string;
  public name: string;
  public coords: Coords2;

  public min: Coords3;
  public max: Coords3;
  public minInner: Coords3;
  public maxInner: Coords3;

  public voxels: NdArray<Uint32Array>;
  public heightMap: NdArray<Uint32Array>;
  public lights: NdArray<Uint32Array>;

  constructor(x: number, z: number, public params: ChunkParams) {
    this.id = uuidv4();
    this.name = ChunkUtils.getChunkName([x, z]);
    this.coords = [x, z];

    const { size, maxHeight, padding } = params;

    this.voxels = ndarray(
      pool.mallocUint32(
        (size + padding * 2) * maxHeight * (size + padding * 2)
      ),
      [size + padding * 2, maxHeight, size + padding * 2]
    );

    this.heightMap = ndarray(pool.malloc((size + padding * 2) ** 2), [
      size + padding * 2,
      size + padding * 2,
    ]);

    this.lights = ndarray(
      pool.mallocUint32(
        (size + padding * 2) * maxHeight * (size + padding * 2)
      ),
      [size + padding * 2, maxHeight, size + padding * 2]
    );

    this.minInner = [x * size, 0, z * size];
    this.min = [this.minInner[0] - padding, 0, this.minInner[2] - padding];
    this.maxInner = [(x + 1) * size, maxHeight, (z + 1) * size];
    this.max = [
      this.maxInner[0] + padding,
      maxHeight,
      this.maxInner[2] + padding,
    ];
  }

  save: () => void;
  tryLoad: () => void;

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
    return Blocks.extractID(this.getRawValue(vx, vy, vz));
  };

  setVoxel = (vx: number, vy: number, vz: number, id: number) => {
    const value = Blocks.insertID(0, id);
    this.setRawValue(vx, vy, vz, value);
    return id;
  };

  getVoxelRotation = (vx: number, vy: number, vz: number) => {
    this.assert(vx, vy, vz);
    return Blocks.extractRotation(this.getRawValue(vx, vy, vz));
  };

  setVoxelRotation = (vx: number, vy: number, vz: number, rotation: number) => {
    const value = Blocks.insertRotation(this.getRawValue(vx, vy, vz), rotation);
    this.setRawValue(vx, vy, vz, value);
  };

  getVoxelStage = (vx: number, vy: number, vz: number) => {
    this.assert(vx, vy, vz);
    return Blocks.extractStage(this.getRawValue(vx, vy, vz));
  };

  setVoxelStage = (vx: number, vy: number, vz: number, stage: number) => {
    const value = Blocks.insertStage(this.getRawValue(vx, vy, vz), stage);
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
      case LightColor.RED:
        return this.getRedLight(vx, vy, vz);
      case LightColor.GREEN:
        return this.getGreenLight(vx, vy, vz);
      case LightColor.BLUE:
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
      case LightColor.RED:
        return this.setRedLight(vx, vy, vz, level);
      case LightColor.GREEN:
        return this.setGreenLight(vx, vy, vz, level);
      case LightColor.BLUE:
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

  private getLocalRedLight = (lx: number, ly: number, lz: number) => {
    return Lights.extractRedLight(this.lights.get(lx, ly, lz));
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
      Lights.insertRedLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalGreenLight = (lx: number, ly: number, lz: number) => {
    return Lights.extractGreenLight(this.lights.get(lx, ly, lz));
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
      Lights.insertGreenLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalBlueLight = (lx: number, ly: number, lz: number) => {
    return Lights.extractBlueLight(this.lights.get(lx, ly, lz));
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
      Lights.insertBlueLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalSunlight = (lx: number, ly: number, lz: number) => {
    return Lights.extractSunlight(this.lights.get(lx, ly, lz));
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
      Lights.insertSunlight(this.lights.get(lx, ly, lz), level)
    );
  };

  private toLocal = (vx: number, vy: number, vz: number) => {
    const [mx, my, mz] = this.min;
    return [vx - mx, vy - my, vz - mz];
  };

  private contains = (vx: number, vy: number, vz: number) => {
    const { size, maxHeight, padding } = this.params;
    const [lx, ly, lz] = this.toLocal(vx, vy, vz);

    return (
      lx < size + padding * 2 &&
      ly >= 0 &&
      ly < maxHeight &&
      lz >= 0 &&
      lz < size + padding * 2
    );
  };

  private assert = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      throw new Error(`Chunk voxel out of bounds for chunk: ${this.coords}`);
    }
  };
}

export { Chunk, ChunkParams };
