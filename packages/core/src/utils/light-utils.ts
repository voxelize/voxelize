import { LightUtils as TSCoreLightUtils } from "@voxelize/ts-core";

/**
 * A utility class for extracting and inserting light data from and into numbers.
 *
 * The light data is stored in the following format:
 * - Sunlight: `0x0000f000`
 * - Red light: `0x00000f00`
 * - Green light: `0x000000f0`
 * - Blue light: `0x0000000f`
 *
 * # Example
 * ```ts
 * // Insert a level 13 sunlight into zero.
 * const number = LightUtils.insertSunlight(0, 13);
 * ```
 *
 * @category Utils
 */
export class LightUtils {
  private static isSingleAxisDirection = (dx: number, dy: number, dz: number) => {
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || !Number.isInteger(dz)) {
      return false;
    }

    const nonZeroCount = [dx, dy, dz].filter((value) => value !== 0).length;
    if (nonZeroCount !== 1) {
      return false;
    }

    return Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1;
  };

  /**
   * Extract the sunlight level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted sunlight value.
   */
  static extractSunlight = (light: number) => {
    return TSCoreLightUtils.extractSunlight(light);
  };

  /**
   * Insert a sunlight level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The sunlight level to insert.
   * @returns The inserted light value.
   */
  static insertSunlight = (light: number, level: number) => {
    return TSCoreLightUtils.insertSunlight(light, level);
  };

  /**
   * Extract the red light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted red light value.
   */
  static extractRedLight = (light: number) => {
    return TSCoreLightUtils.extractRedLight(light);
  };

  /**
   * Insert a red light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The red light level to insert.
   * @returns The inserted light value.
   */
  static insertRedLight = (light: number, level: number) => {
    return TSCoreLightUtils.insertRedLight(light, level);
  };

  /**
   * Extract the green light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted green light value.
   */
  static extractGreenLight = (light: number) => {
    return TSCoreLightUtils.extractGreenLight(light);
  };

  /**
   * Insert a green light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The green light level to insert.
   * @returns The inserted light value.
   */
  static insertGreenLight = (light: number, level: number) => {
    return TSCoreLightUtils.insertGreenLight(light, level);
  };

  /**
   * Extract the blue light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted blue light value.
   */
  static extractBlueLight = (light: number) => {
    return TSCoreLightUtils.extractBlueLight(light);
  };

  /**
   * Insert a blue light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The blue light level to insert.
   * @returns The inserted light value.
   */
  static insertBlueLight = (light: number, level: number) => {
    return TSCoreLightUtils.insertBlueLight(light, level);
  };

  /**
   * Check to see if light can go "into" one block, disregarding the source.
   *
   * @param target The target block's transparency.
   * @param dx The change in x direction.
   * @param dy The change in y direction.
   * @param dz The change in z direction.
   * @returns Whether light can enter into the target block.
   */
  static canEnterInto = (
    target: boolean[],
    dx: number,
    dy: number,
    dz: number
  ) => {
    if (!LightUtils.isSingleAxisDirection(dx, dy, dz)) {
      throw new Error(
        "This isn't supposed to happen. Light neighboring direction should be on 1 axis only."
      );
    }

    const [px, py, pz, nx, ny, nz] = target;

    // Going into the NX of the target.
    if (dx === 1) {
      return nx;
    }

    // Going into the PX of the target.
    if (dx === -1) {
      return px;
    }

    // Going into the NY of the target.
    if (dy === 1) {
      return ny;
    }

    // Going into the PY of the target.
    if (dy === -1) {
      return py;
    }

    // Going into the NZ of the target.
    if (dz === 1) {
      return nz;
    }

    // Going into the PZ of the target.
    return pz;
  };

  /**
   * Check to see if light can enter from one block to another.
   *
   * @param source The source block's transparency.
   * @param target The target block's transparency.
   * @param dx The change in x direction.
   * @param dy The change in y direction.
   * @param dz The change in z direction.
   * @returns Whether light can enter from the source block to the target block.
   */
  static canEnter = (
    source: boolean[],
    target: boolean[],
    dx: number,
    dy: number,
    dz: number
  ) => {
    if (!LightUtils.isSingleAxisDirection(dx, dy, dz)) {
      throw new Error(
        "This isn't supposed to happen. Light neighboring direction should be on 1 axis only."
      );
    }

    const [spx, spy, spz, snx, sny, snz] = source;
    const [tpx, tpy, tpz, tnx, tny, tnz] = target;

    // Going from PX of source to NX of target
    if (dx === 1) {
      return spx && tnx;
    }

    // Going from NX of source to PX of target
    if (dx === -1) {
      return snx && tpx;
    }

    // Going from PY of source to NY of target
    if (dy === 1) {
      return spy && tny;
    }

    // Going from NY of source to PY of target
    if (dy === -1) {
      return sny && tpy;
    }

    // Going from PZ of source to NZ of target
    if (dz === 1) {
      return spz && tnz;
    }

    // Going from NZ of source to PZ of target
    return snz && tpz;
  };

  private constructor() {}
}

/**
 * The string representation of red light.
 */
export const RED_LIGHT = "RED";

/**
 * The string representation of green light.
 */
export const GREEN_LIGHT = "GREEN";

/**
 * The string representation of blue light.
 */
export const BLUE_LIGHT = "BLUE";

/**
 * The string representation of sunlight.
 */
export const SUNLIGHT = "SUNLIGHT";

/**
 * Sunlight or the color of torch light.
 */
export type LightColor = "RED" | "GREEN" | "BLUE" | "SUNLIGHT";
