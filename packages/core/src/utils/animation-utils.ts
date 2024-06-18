import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";

export class AnimationUtils {
  /**
   * Generates an animation clip.
   *
   * @param name Name of the clip
   * @param times Times of the clip
   * @param initialPosition Initial position
   * @param initialQuaternion Initial quaternion
   * @param midPositions Middle positions
   * @param midQuaternions Middle quaternions
   * @returns Animation clip
   */
  static generateClip(
    name: string,
    times: number[],
    initialPosition: Vector3,
    initialQuaternion: Quaternion,
    midPositions: Vector3[],
    midQuaternions: Quaternion[]
  ) {
    if (midPositions.length !== midQuaternions.length) {
      throw new Error(
        "midPositions and midQuaternions must have the same length"
      );
    }
    if (midPositions.length !== times.length - 2) {
      throw new Error("midPositions must have two less length than times");
    }

    const positionValues = [];
    const quaternionValues = [];

    positionValues.push(
      initialPosition.x,
      initialPosition.y,
      initialPosition.z
    );
    quaternionValues.push(
      initialQuaternion.x,
      initialQuaternion.y,
      initialQuaternion.z,
      initialQuaternion.w
    );

    for (let i = 0; i < midPositions.length; i++) {
      positionValues.push(
        midPositions[i].x,
        midPositions[i].y,
        midPositions[i].z
      );
      quaternionValues.push(
        midQuaternions[i].x,
        midQuaternions[i].y,
        midQuaternions[i].z,
        midQuaternions[i].w
      );
    }

    positionValues.push(
      initialPosition.x,
      initialPosition.y,
      initialPosition.z
    );
    quaternionValues.push(
      initialQuaternion.x,
      initialQuaternion.y,
      initialQuaternion.z,
      initialQuaternion.w
    );

    const positionKF = new VectorKeyframeTrack(
      ".position",
      times,
      positionValues
    );

    const quaternionKF = new QuaternionKeyframeTrack(
      ".quaternion",
      times,
      quaternionValues
    );

    return new AnimationClip(name, times[times.length - 1], [
      positionKF,
      quaternionKF,
    ]);
  }
}
