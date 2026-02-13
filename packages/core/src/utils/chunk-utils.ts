import { Coords2, Coords3 } from "../types";

/**
 * A utility class for all things related to chunks and chunk coordinates.
 *
 * # Example
 * ```ts
 * // Get the chunk coordinates of a voxel, (0, 0) with `chunkSize=16`.
 * const chunkCoords = ChunkUtils.mapVoxelToChunk([1, 10, 12]);
 * ```
 *
 * @category Utils
 */
export class ChunkUtils {
  /**
   * Convert a 2D chunk coordinate to a string representation.
   *
   * @param coords The coordinates to convert.
   * @param concat The concatenation string to use.
   * @returns The string representation of the coordinates.
   */
  static getChunkName = (coords: Coords2, concat = "|") => {
    return coords[0] + concat + coords[1];
  };

  /**
   * Convert chunk coordinates to a string representation without array allocation.
   *
   * @param cx The x-coordinate of the chunk.
   * @param cz The z-coordinate of the chunk.
   * @param concat The concatenation string to use.
   * @returns The string representation of the coordinates.
   */
  static getChunkNameAt = (cx: number, cz: number, concat = "|") => {
    return cx + concat + cz;
  };

  /**
   * Convert voxel x/z coordinates to chunk coordinates.
   *
   * @param vx The voxel x-coordinate.
   * @param vz The voxel z-coordinate.
   * @param chunkSize The horizontal dimension of a chunk.
   * @returns The mapped chunk coordinates.
   */
  static mapVoxelToChunkAt = (
    vx: number,
    vz: number,
    chunkSize: number
  ): Coords2 => {
    return [Math.floor(vx / chunkSize), Math.floor(vz / chunkSize)];
  };

  /**
   * Convert voxel x/z coordinates directly to a chunk name string.
   *
   * @param vx The voxel x-coordinate.
   * @param vz The voxel z-coordinate.
   * @param chunkSize The horizontal dimension of a chunk.
   * @param concat The concatenation string to use.
   * @returns The chunk name representation.
   */
  static getChunkNameByVoxel = (
    vx: number,
    vz: number,
    chunkSize: number,
    concat = "|"
  ) => {
    const cx = Math.floor(vx / chunkSize);
    const cz = Math.floor(vz / chunkSize);
    return ChunkUtils.getChunkNameAt(cx, cz, concat);
  };

  /**
   * Convert a 3D voxel coordinate to a string representation.
   *
   * @param coords The coordinates to convert.
   * @param concat The concatenation string to use.
   * @returns The string representation of the coordinates.
   */
  static getVoxelName = (coords: Coords3, concat = "|") => {
    return (
      Math.floor(coords[0]) +
      concat +
      Math.floor(coords[1]) +
      concat +
      Math.floor(coords[2])
    );
  };

  /**
   * Convert voxel coordinates to a string representation without array allocation.
   *
   * @param vx The voxel x-coordinate.
   * @param vy The voxel y-coordinate.
   * @param vz The voxel z-coordinate.
   * @param concat The concatenation string to use.
   * @returns The string representation of voxel coordinates.
   */
  static getVoxelNameAt = (
    vx: number,
    vy: number,
    vz: number,
    concat = "|"
  ) => {
    return (
      Math.floor(vx) + concat + Math.floor(vy) + concat + Math.floor(vz)
    );
  };

  /**
   * Given a chunk representation, parse the chunk coordinates.
   *
   * @param name The string representation of the chunk.
   * @param concat The concatenation string used.
   * @returns The parsed chunk coordinates.
   */
  static parseChunkName = (name: string, concat = "|") => {
    return ChunkUtils.parseChunkNameAt(name, concat);
  };

  /**
   * Parse a chunk name into x/z coordinates with minimal allocations.
   *
   * @param name The string representation of the chunk.
   * @param concat The concatenation string used.
   * @returns The parsed chunk coordinates as a tuple.
   */
  static parseChunkNameAt = (name: string, concat = "|"): Coords2 => {
    const separatorIndex = name.indexOf(concat);
    if (separatorIndex < 0) {
      return [ChunkUtils.parseSignedIntegerSegment(name, 0, name.length), Number.NaN];
    }

    const cx = ChunkUtils.parseSignedIntegerSegment(name, 0, separatorIndex);
    const cz = ChunkUtils.parseSignedIntegerSegment(
      name,
      separatorIndex + concat.length,
      name.length
    );

    return [cx, cz];
  };

  private static parseSignedIntegerSegment = (
    value: string,
    start: number,
    end: number
  ) => {
    let index = start;

    while (index < end) {
      const code = value.charCodeAt(index);
      if (
        code === 32 ||
        code === 9 ||
        code === 10 ||
        code === 11 ||
        code === 12 ||
        code === 13
      ) {
        index++;
      } else {
        break;
      }
    }

    let sign = 1;
    if (index < end) {
      const code = value.charCodeAt(index);
      if (code === 45) {
        sign = -1;
        index++;
      } else if (code === 43) {
        index++;
      }
    }

    let parsed = 0;
    let hasDigit = false;
    while (index < end) {
      const digit = value.charCodeAt(index) - 48;
      if (digit < 0 || digit > 9) {
        break;
      }
      hasDigit = true;
      parsed = parsed * 10 + digit;
      index++;
    }

    return hasDigit ? parsed * sign : Number.NaN;
  };

  /**
   * Scale and floor a 3D coordinate.
   *
   * @param coords The coordinates to scale and floor.
   * @param factor The factor to scale by.
   * @returns The scaled and floored coordinates.
   */
  static scaleCoordsF = (coords: Coords3, factor: number): Coords3 => {
    return [
      Math.floor(coords[0] * factor),
      Math.floor(coords[1] * factor),
      Math.floor(coords[2] * factor),
    ];
  };

  /**
   * Map a 3D voxel coordinate to the local 3D voxel coordinate in the situated chunk.
   *
   * @param voxelPos The voxel coordinate to map.
   * @param chunkSize The horizontal dimension of a chunk.
   * @returns The mapped coordinate.
   */
  static mapVoxelToChunkLocal = (
    voxelPos: Coords3,
    chunkSize: number
  ): Coords3 => {
    const [cx, cz] = ChunkUtils.mapVoxelToChunk(voxelPos, chunkSize);
    const [vx, vy, vz] = voxelPos;

    return [vx - cx * chunkSize, vy, vz - cz * chunkSize];
  };

  /**
   * Map a 3D voxel coordinate to the 2D chunk coordinate.
   *
   * @param voxelPos The voxel coordinate to map.
   * @param chunkSize  The horizontal dimension of a chunk.
   * @returns The mapped coordinate.
   */
  static mapVoxelToChunk = (voxelPos: Coords3, chunkSize: number): Coords2 => {
    return ChunkUtils.mapVoxelToChunkAt(voxelPos[0], voxelPos[2], chunkSize);
  };

  /**
   * Map a 2D chunk coordinate to the 3D voxel coordinate.
   *
   * @param chunkPos The chunk coordinate to map.
   * @param chunkSize The horizontal dimension of a chunk.
   * @returns The mapped coordinate.
   */
  static mapChunkToVoxel = (chunkPos: Coords2, chunkSize: number): Coords3 => {
    return [chunkPos[0] * chunkSize, 0, chunkPos[1] * chunkSize];
  };

  /**
   * Map a 3D world coordinate to the 3D voxel coordinate. Since a voxel is
   * exactly 1 unit in size, this is just a floor operation.
   *
   * @param worldPos The world coordinate to map.
   * @returns The mapped coordinate.
   */
  static mapWorldToVoxel = (worldPos: Coords3): Coords3 => {
    return ChunkUtils.scaleCoordsF(worldPos, 1);
  };

  private constructor() {
    // NOTHING
  }
}
