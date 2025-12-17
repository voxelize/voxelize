import { ChunkProtocol } from "@voxelize/protocol";
import ndarray, { NdArray } from "ndarray";

import { Coords2, Coords3 } from "../../types";
import { BlockUtils } from "../../utils/block-utils";
import { ChunkUtils } from "../../utils/chunk-utils";
import { LightColor, LightUtils } from "../../utils/light-utils";

import { BlockRotation } from "./block";

export type RawChunkOptions = {
  size: number;
  maxHeight: number;
  maxLightLevel: number;
  subChunks: number;
};

export class RawChunk {
  public options: RawChunkOptions;

  public id: string;

  public name: string;

  public coords: Coords2;

  public min: Coords3;

  public max: Coords3;

  public voxels: NdArray<Uint32Array>;

  public lights: NdArray<Uint32Array>;

  constructor(id: string, coords: Coords2, options: RawChunkOptions) {
    this.id = id;
    this.name = ChunkUtils.getChunkName(coords);

    this.coords = coords;
    this.options = options;

    const { size, maxHeight } = options;

    this.voxels = ndarray([] as any, [size, maxHeight, size]);
    this.lights = ndarray([] as any, [size, maxHeight, size]);

    const [x, z] = coords;

    this.min = [x * size, 0, z * size];
    this.max = [(x + 1) * size, maxHeight, (z + 1) * size];
  }

  serialize(): [object, ArrayBuffer[]] {
    return [
      {
        id: this.id,
        x: this.coords[0],
        z: this.coords[1],
        voxels: this.voxels.data.buffer,
        lights: this.lights.data.buffer,
        options: this.options,
      },
      [
        this.voxels.data.buffer.slice(0) as ArrayBuffer,
        this.lights.data.buffer.slice(0) as ArrayBuffer,
      ],
    ];
  }

  static deserialize(data: any): RawChunk {
    const { id, x, z, voxels, lights, options } = data;

    const chunk = new RawChunk(id, [x, z], options);

    // creating typed array here ain't bad since deserialize is only used worker-side
    if (lights && lights.byteLength)
      chunk.lights.data = new Uint32Array(lights);
    if (voxels && voxels.byteLength)
      chunk.voxels.data = new Uint32Array(voxels);

    return chunk;
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

    if (lights && lights.byteLength) this.lights.data = new Uint32Array(lights);
    if (voxels && voxels.byteLength) this.voxels.data = new Uint32Array(voxels);
  }

  /**
   * Get the raw voxel value at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @returns The raw voxel value at the given voxel coordinate. If the voxel is not within
   * the chunk, this method returns `0`.
   */
  getRawValue(vx: number, vy: number, vz: number) {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.voxels.get(lx, ly, lz);
  }

  /**
   * Set the raw voxel value at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @param value The raw voxel value to set at the given voxel coordinate.
   * @returns The raw voxel value at the given voxel coordinate.
   */
  setRawValue(vx: number, vy: number, vz: number, val: number) {
    if (!this.contains(vx, vy, vz)) return 0;
    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.voxels.set(lx, ly, lz, val);
  }

  /**
   * Get the raw light value at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @returns The raw light value at the given voxel coordinate.
   */
  getRawLight(vx: number, vy: number, vz: number) {
    if (!this.contains(vx, vy, vz)) return 0;
    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.lights.get(lx, ly, lz);
  }

  /**
   * Set the raw light value at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @param level The raw light level to set at the given voxel coordinate.
   * @returns The raw light level at the given voxel coordinate.
   */
  setRawLight(vx: number, vy: number, vz: number, level: number) {
    if (!this.contains(vx, vy, vz)) return 0;
    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.lights.set(lx, ly, lz, level);
  }

  /**
   * Get the voxel type ID at a given voxel or world coordinate.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @returns The voxel type ID at the given voxel coordinate.
   */
  getVoxel(vx: number, vy: number, vz: number) {
    return BlockUtils.extractID(this.getRawValue(vx | 0, vy | 0, vz | 0));
  }

  /**
   * Set the voxel type ID at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @param id The voxel type ID to set at the given voxel coordinate.
   * @returns The voxel type ID at the given voxel coordinate.
   */
  setVoxel(vx: number, vy: number, vz: number, id: number) {
    const value = BlockUtils.insertID(0, id);
    this.setRawValue(vx, vy, vz, value);
    return id;
  }

  /**
   * Get the voxel rotation at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @returns The voxel rotation at the given voxel coordinate.
   */
  getVoxelRotation(vx: number, vy: number, vz: number) {
    if (!this.contains(vx, vy, vz)) return new BlockRotation();
    return BlockUtils.extractRotation(this.getRawValue(vx, vy, vz));
  }

  /**
   * Set the voxel rotation at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @param rotation The voxel rotation to set at the given voxel coordinate.
   */
  setVoxelRotation(
    vx: number,
    vy: number,
    vz: number,
    rotation: BlockRotation
  ) {
    const value = BlockUtils.insertRotation(
      this.getRawValue(vx, vy, vz),
      rotation
    );
    this.setRawValue(vx, vy, vz, value);
  }

  /**
   * Get the voxel stage at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @returns The voxel stage at the given voxel coordinate.
   */
  getVoxelStage(vx: number, vy: number, vz: number) {
    if (!this.contains(vx, vy, vz)) return 0;
    return BlockUtils.extractStage(this.getRawValue(vx, vy, vz));
  }

  /**
   * Set the voxel stage at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @param stage The voxel stage to set at the given voxel coordinate.
   * @returns The voxel stage at the given voxel coordinate.
   */
  setVoxelStage(vx: number, vy: number, vz: number, stage: number) {
    const value = BlockUtils.insertStage(this.getRawValue(vx, vy, vz), stage);
    this.setRawValue(vx, vy, vz, value);
    return stage;
  }

  /**
   * Get the red light level at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate.
   * @param vy The y voxel coordinate.
   * @param vz The z voxel coordinate.
   * @returns The red light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  getRedLight(vx: number, vy: number, vz: number) {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalRedLight(lx, ly, lz);
  }

  /**
   * Set the red light level at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @param level The red light level to set at the given voxel coordinate.
   * @returns The red light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  setRedLight(vx: number, vy: number, vz: number, level: number) {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalRedLight(lx, ly, lz, level);
  }

  /**
   * Get the green light level at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @returns The green light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  getGreenLight(vx: number, vy: number, vz: number) {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalGreenLight(lx, ly, lz);
  }

  /**
   * Set the green light level at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @param level The green light level to set at the given voxel coordinate.
   * @returns The green light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  setGreenLight(vx: number, vy: number, vz: number, level: number) {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalGreenLight(lx, ly, lz, level);
  }

  /**
   * Get the blue light level at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @returns The blue light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  getBlueLight(vx: number, vy: number, vz: number) {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalBlueLight(lx, ly, lz);
  }

  /**
   * Set the blue light level at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @param level The blue light level to set at the given voxel coordinate.
   * @returns The blue light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  setBlueLight(vx: number, vy: number, vz: number, level: number) {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalBlueLight(lx, ly, lz, level);
  }

  /**
   * Get the colored torch light level at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @param color The color of the light to get at the given voxel coordinate.
   * @returns The light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  getTorchLight(vx: number, vy: number, vz: number, color: LightColor) {
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
  }

  /**
   * Set the colored torch light level at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @param level The light level to set at the given voxel coordinate.
   * @param color The color of the light to set at the given voxel coordinate.
   * @returns The light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  setTorchLight(
    vx: number,
    vy: number,
    vz: number,
    level: number,
    color: LightColor
  ) {
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
  }

  /**
   * Get the sunlight level at a given voxel coordinate.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @returns The sunlight level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  getSunlight(vx: number, vy: number, vz: number) {
    if (!this.contains(vx, vy, vz)) {
      if (vy < 0) {
        return 0;
      }
      return this.options.maxLightLevel;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalSunlight(lx, ly, lz);
  }

  /**
   * Set the sunlight level at a given voxel coordinate.
   *
   * Note: This method is purely client-side and does not affect the actual values on the server.
   *
   * @param vx The x voxel coordinate
   * @param vy The y voxel coordinate
   * @param vz The z voxel coordinate
   * @param level The sunlight level to set at the given voxel coordinate.
   * @returns The sunlight level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.
   */
  setSunlight(vx: number, vy: number, vz: number, level: number) {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalSunlight(lx, ly, lz, level);
  }

  /**
   * Whether or not is this chunk ready to be rendered and seen in the world.
   */
  get isReady() {
    return this.lights.data.length !== 0 && this.voxels.data.length !== 0;
  }

  private getLocalRedLight(lx: number, ly: number, lz: number) {
    return LightUtils.extractRedLight(this.lights.get(lx, ly, lz));
  }

  private setLocalRedLight(lx: number, ly: number, lz: number, level: number) {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertRedLight(this.lights.get(lx, ly, lz), level)
    );
  }

  private getLocalGreenLight(lx: number, ly: number, lz: number) {
    return LightUtils.extractGreenLight(this.lights.get(lx, ly, lz));
  }

  private setLocalGreenLight(
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertGreenLight(this.lights.get(lx, ly, lz), level)
    );
  }

  private getLocalBlueLight(lx: number, ly: number, lz: number) {
    return LightUtils.extractBlueLight(this.lights.get(lx, ly, lz));
  }

  private setLocalBlueLight(lx: number, ly: number, lz: number, level: number) {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertBlueLight(this.lights.get(lx, ly, lz), level)
    );
  }

  private getLocalSunlight(lx: number, ly: number, lz: number) {
    return LightUtils.extractSunlight(this.lights.get(lx, ly, lz));
  }

  private setLocalSunlight(lx: number, ly: number, lz: number, level: number) {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertSunlight(this.lights.get(lx, ly, lz), level)
    );
  }

  private toLocal(vx: number, vy: number, vz: number) {
    const [mx, my, mz] = this.min;
    return [(vx | 0) - mx, (vy | 0) - my, (vz | 0) - mz];
  }

  private contains(vx: number, vy: number, vz: number) {
    const { size, maxHeight } = this.options;
    const [lx, ly, lz] = this.toLocal(vx, vy, vz);

    return (
      lx >= 0 && lx < size && ly >= 0 && ly < maxHeight && lz >= 0 && lz < size
    );
  }
}
