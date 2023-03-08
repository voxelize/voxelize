import vec3 from "gl-vec3";

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
   * Convert a 3D voxel coordinate to a string representation.
   *
   * @param coords The coordinates to convert.
   * @param concat The concatenation string to use.
   * @returns The string representation of the coordinates.
   */
  static getVoxelName = (coords: Coords3, concat = "|") => {
    return (
      (coords[0] | 0) + concat + (coords[1] | 0) + concat + (coords[2] | 0)
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
    return name.split(concat).map((s: string) => parseInt(s, 10));
  };

  /**
   * Scale and floor a 3D coordinate.
   *
   * @param coords The coordinates to scale and floor.
   * @param factor The factor to scale by.
   * @returns The scaled and floored coordinates.
   */
  static scaleCoordsF = (coords: Coords3, factor: number): Coords3 => {
    const result = [0, 0, 0];
    const scaled = vec3.scale(result, coords, factor);
    return <Coords3>vec3.floor(scaled, scaled);
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
    const coords3 = ChunkUtils.scaleCoordsF(voxelPos, 1 / chunkSize);
    return [coords3[0], coords3[2]];
  };

  /**
   * Map a 2D chunk coordinate to the 3D voxel coordinate.
   *
   * @param chunkPos The chunk coordinate to map.
   * @param chunkSize The horizontal dimension of a chunk.
   * @returns The mapped coordinate.
   */
  static mapChunkToVoxel = (chunkPos: Coords2, chunkSize: number): Coords3 => {
    const result = <Coords3>[0, 0, 0];

    vec3.copy(result, [chunkPos[0], 0, chunkPos[1]]);
    vec3.scale(result, result, chunkSize);

    return result;
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
