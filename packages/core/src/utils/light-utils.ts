/**
 * A utility class for extracting and inserting light data from and into numbers.
 *
 * The light data is stored in the following format:
 * - Sunlight: `0xff000000`
 * - Red light: `0x00ff0000`
 * - Green light: `0x0000ff00`
 * - Blue light: `0x000000ff`
 *
 * TODO-DOCS
 * For more information about lighting data, see [here](/)
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
  /**
   * Extract the sunlight level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted sunlight value.
   */
  static extractSunlight = (light: number) => {
    return (light >> 12) & 0xf;
  };

  /**
   * Insert a sunlight level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The sunlight level to insert.
   * @returns The inserted light value.
   */
  static insertSunlight = (light: number, level: number) => {
    return (light & 0xfff) | (level << 12);
  };

  /**
   * Extract the red light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted red light value.
   */
  static extractRedLight = (light: number) => {
    return (light >> 8) & 0xf;
  };

  /**
   * Insert a red light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The red light level to insert.
   * @returns The inserted light value.
   */
  static insertRedLight = (light: number, level: number) => {
    return (light & 0xf0ff) | (level << 8);
  };

  /**
   * Extract the green light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted green light value.
   */
  static extractGreenLight = (light: number) => {
    return (light >> 4) & 0xf;
  };

  /**
   * Insert a green light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The green light level to insert.
   * @returns The inserted light value.
   */
  static insertGreenLight = (light: number, level: number) => {
    return (light & 0xff0f) | (level << 4);
  };

  /**
   * Extract the blue light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted blue light value.
   */
  static extractBlueLight = (light: number) => {
    return light & 0xf;
  };

  /**
   * Insert a blue light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The blue light level to insert.
   * @returns The inserted light value.
   */
  static insertBlueLight = (light: number, level: number) => {
    return (light & 0xfff0) | level;
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
    if (Math.abs(dx + dy + dz) !== 1) {
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
    if (Math.abs(dx + dy + dz) !== 1) {
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

  private constructor() {
    // NOTHING
  }
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
