/**
 * A helper class for basic math operations
 *
 * @class MathUtils
 */
class MathUtils {
  /**
   * Round a number to a certain digit
   *
   * @param n - The number to round from
   * @param digits - The number of digits to round to
   *
   * @static
   * @memberof MathUtils
   */
  static round = (n: number, digits: number) => {
    return Math.round(n * 10 ** digits) / 10 ** digits;
  };
}

export { MathUtils };
