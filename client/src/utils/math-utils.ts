import { Matrix4, Quaternion, Vector3 } from "three";

const TWO_PI = Math.PI * 2;

/**
 * A helper class for basic math operations
 *
 * @class MathUtils
 */
export class MathUtils {
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

  static normalizeAngle = (angle: number) => {
    return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
  };

  static directionToQuaternion = (dx: number, dy: number, dz: number) => {
    const toQuaternion = (() => {
      const m = new Matrix4();
      const q = new Quaternion();
      const zero = new Vector3(0, 0, 0);
      const one = new Vector3(0, 1, 0);

      return () => {
        return q.setFromRotationMatrix(
          m.lookAt(new Vector3(-dx, -dy, -dz), zero, one)
        );
      };
    })();

    return toQuaternion();
  };
}
