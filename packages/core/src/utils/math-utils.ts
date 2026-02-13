import { Matrix4, Quaternion, Vector3 } from "three";

const TWO_PI = Math.PI * 2;
const DIRECTION_LOOK_MATRIX = new Matrix4();
const DIRECTION_TARGET = new Vector3();
const DIRECTION_ORIGIN = new Vector3(0, 0, 0);
const DIRECTION_UP = new Vector3(0, 1, 0);

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
  static directionToQuaternion = (
    dx: number,
    dy: number,
    dz: number,
    target?: Quaternion
  ) => {
    const quaternion = target ?? new Quaternion();
    DIRECTION_TARGET.set(-dx, -dy, -dz);
    return quaternion.setFromRotationMatrix(
      DIRECTION_LOOK_MATRIX.lookAt(
        DIRECTION_TARGET,
        DIRECTION_ORIGIN,
        DIRECTION_UP
      )
    );
  };

  private constructor() {
    // NOTHING
  }
}
