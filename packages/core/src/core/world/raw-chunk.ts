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

export type SerializedRawChunk = {
  id: string;
  x: number;
  z: number;
  voxels: ArrayBuffer;
  lights: ArrayBuffer;
  options: RawChunkOptions;
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
  private localBuffer: Coords3 = [0, 0, 0];
  private minX = 0;
  private minY = 0;
  private minZ = 0;
  private size = 0;
  private maxHeight = 0;

  constructor(id: string, coords: Coords2, options: RawChunkOptions) {
    this.id = id;
    this.name = ChunkUtils.getChunkName(coords);

    this.coords = coords;
    this.options = options;

    const { size, maxHeight } = options;
    this.size = size;
    this.maxHeight = maxHeight;

    this.voxels = ndarray(new Uint32Array(0), [size, maxHeight, size]);
    this.lights = ndarray(new Uint32Array(0), [size, maxHeight, size]);

    const [x, z] = coords;

    this.min = [x * size, 0, z * size];
    this.max = [(x + 1) * size, maxHeight, (z + 1) * size];
    this.minX = this.min[0];
    this.minY = this.min[1];
    this.minZ = this.min[2];
  }

  serialize(): [SerializedRawChunk, ArrayBuffer[]] {
    const voxelsBuffer = RawChunk.cloneDataBuffer(this.voxels.data);
    const lightsBuffer = RawChunk.cloneDataBuffer(this.lights.data);
    return [
      {
        id: this.id,
        x: this.coords[0],
        z: this.coords[1],
        voxels: voxelsBuffer,
        lights: lightsBuffer,
        options: this.options,
      },
      [voxelsBuffer, lightsBuffer],
    ];
  }

  private static cloneDataBuffer(data: Uint32Array): ArrayBuffer {
    const buffer = data.buffer as ArrayBuffer;
    const start = data.byteOffset;
    const end = start + data.byteLength;
    return buffer.slice(start, end);
  }

  static deserialize(data: SerializedRawChunk): RawChunk {
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

    const localBuffer = this.localBuffer;
    return this.voxels.get(localBuffer[0], localBuffer[1], localBuffer[2]);
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
    const localBuffer = this.localBuffer;
    return this.voxels.set(localBuffer[0], localBuffer[1], localBuffer[2], val);
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
    const localBuffer = this.localBuffer;
    return this.lights.get(localBuffer[0], localBuffer[1], localBuffer[2]);
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
    const localBuffer = this.localBuffer;
    return this.lights.set(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2],
      level
    );
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
    return BlockUtils.extractID(this.getRawValue(vx, vy, vz));
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
    const localBuffer = this.localBuffer;
    return BlockUtils.extractRotation(
      this.voxels.get(localBuffer[0], localBuffer[1], localBuffer[2])
    );
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
    if (!this.contains(vx, vy, vz)) {
      return;
    }

    const localBuffer = this.localBuffer;
    const lx = localBuffer[0];
    const ly = localBuffer[1];
    const lz = localBuffer[2];
    const value = BlockUtils.insertRotation(this.voxels.get(lx, ly, lz), rotation);
    this.voxels.set(lx, ly, lz, value);
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
    const localBuffer = this.localBuffer;
    return BlockUtils.extractStage(
      this.voxels.get(localBuffer[0], localBuffer[1], localBuffer[2])
    );
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
    if (!this.contains(vx, vy, vz)) {
      return stage;
    }

    const localBuffer = this.localBuffer;
    const lx = localBuffer[0];
    const ly = localBuffer[1];
    const lz = localBuffer[2];
    const value = BlockUtils.insertStage(this.voxels.get(lx, ly, lz), stage);
    this.voxels.set(lx, ly, lz, value);
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

    const localBuffer = this.localBuffer;
    return this.getLocalRedLight(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2]
    );
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

    const localBuffer = this.localBuffer;
    return this.setLocalRedLight(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2],
      level
    );
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

    const localBuffer = this.localBuffer;
    return this.getLocalGreenLight(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2]
    );
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

    const localBuffer = this.localBuffer;
    return this.setLocalGreenLight(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2],
      level
    );
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

    const localBuffer = this.localBuffer;
    return this.getLocalBlueLight(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2]
    );
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

    const localBuffer = this.localBuffer;
    return this.setLocalBlueLight(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2],
      level
    );
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

    const localBuffer = this.localBuffer;
    return this.getLocalSunlight(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2]
    );
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

    const localBuffer = this.localBuffer;
    return this.setLocalSunlight(
      localBuffer[0],
      localBuffer[1],
      localBuffer[2],
      level
    );
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

  private contains(vx: number, vy: number, vz: number) {
    const lx = Math.floor(vx) - this.minX;
    const ly = Math.floor(vy) - this.minY;
    const lz = Math.floor(vz) - this.minZ;
    this.localBuffer[0] = lx;
    this.localBuffer[1] = ly;
    this.localBuffer[2] = lz;

    return (
      lx >= 0 &&
      lx < this.size &&
      ly >= 0 &&
      ly < this.maxHeight &&
      lz >= 0 &&
      lz < this.size
    );
  }
}
