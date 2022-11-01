import { Matrix4, Quaternion, Vector3 } from "three";

const TWO_PI = Math.PI * 2;

/**
 * A utility class for doing math operations.
 *
 * @category Utils
 */
export class MathUtils {
  /**
   * Round a number to a given precision.
   *
   * @param n The number to round.
   * @param digits The number of digits after decimal to round to.
   * @returns The rounded number.
   */
  static round = (n: number, digits: number) => {
    return Math.round(n * 10 ** digits) / 10 ** digits;
  };

  /**
   * Normalizes an angle to be between -2PI and 2PI.
   *
   * @param angle The angle to normalize.
   * @returns The normalized angle.
   */
  static normalizeAngle = (angle: number) => {
    return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
  };

  /**
   * Convert a direction vector to a quaternion.
   *
   * @param dx X component of the direction vector.
   * @param dy Y component of the direction vector.
   * @param dz Z component of the direction vector.
   * @returns The quaternion representing the direction vector.
   */
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

  private constructor() {
    // NOTHING
  }
}
