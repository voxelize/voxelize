import vec3 from "gl-vec3";

import { Coords2, Coords3 } from "../types";

class ChunkUtils {
  /**
   * Given a coordinate of a chunk, return the chunk representation.
   *
   * @param {Coords2} coords
   * @param {string} [concat='|']
   * @returns
   */
  public static getChunkName = (coords: Coords2, concat = "|") => {
    return coords[0] + concat + coords[1];
  };

  /**
   * Given a coordinate of a voxel, return the voxel representation.
   *
   * @param {Coords3} coords
   * @param {string} [concat='|']
   * @returns
   */
  public static getVoxelName = (coords: Coords3, concat = "|") => {
    return coords[0] + concat + coords[1] + concat + coords[2];
  };

  /**
   * Given a chunk name, return the coordinates of the chunk
   *
   * @param {string} name
   * @param {string} [concat='|']
   * @returns
   */
  public static parseChunkName = (name: string, concat = "|") => {
    return name.split(concat).map((s: string) => parseInt(s, 10));
  };

  /**
   * Scale coordinates and floor them.
   *
   * @param {Coords3} coords
   * @param {number} factor
   * @returns
   */
  public static scaleCoordsF = (coords: Coords3, factor: number): Coords3 => {
    const result = [0, 0, 0];
    const scaled = vec3.scale(result, coords, factor);
    return <Coords3>vec3.floor(scaled, scaled);
  };

  /**
   * Map voxel position to local position in current chunk.
   *
   * @param {Coords3} worldPos
   * @param {Chunk} chunk
   * @returns {Coords3}
   */
  public static mapVoxelPosToChunkLocalPos = (
    voxelPos: Coords3,
    chunkSize: number
  ): Coords3 => {
    const [cx, cz] = ChunkUtils.mapVoxelPosToChunkPos(voxelPos, chunkSize);
    const [vx, vy, vz] = voxelPos;

    return [vx - cx * chunkSize, vy, vz - cz * chunkSize];
  };

  /**
   * Map voxel position to the current chunk position.
   *
   * @param {Coords3} worldPos
   * @param {number} chunkSize
   * @returns {Coords2}
   */
  public static mapVoxelPosToChunkPos = (
    voxelPos: Coords3,
    chunkSize: number
  ): Coords2 => {
    const coords3 = ChunkUtils.scaleCoordsF(voxelPos, 1 / chunkSize);
    return [coords3[0], coords3[2]];
  };

  /**
   * Get the voxel position of a chunk position.
   *
   * @static
   * @param {Coords2} chunkPos
   * @param {number} chunkSize
   * @memberof Helper
   */
  public static mapChunkPosToVoxelPos = (
    chunkPos: Coords2,
    chunkSize: number
  ): Coords3 => {
    const result = <Coords3>[0, 0, 0];

    vec3.copy(result, [chunkPos[0], 0, chunkPos[1]]);
    vec3.scale(result, result, chunkSize);

    return result;
  };

  /**
   * Map world position to voxel position.
   *
   * @param {Coords3} worldPos
   * @returns {Coords3}
   */
  public static mapWorldPosToVoxelPos = (worldPos: Coords3): Coords3 => {
    return ChunkUtils.scaleCoordsF(worldPos, 1);
  };
}

export { ChunkUtils };
