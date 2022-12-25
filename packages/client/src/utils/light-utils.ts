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
