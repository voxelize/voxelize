import {
  BufferGeometry,
  Camera,
  CanvasTexture,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
} from "three";

type FlaggedThreeObject = Record<string, boolean | undefined>;

export class ThreeUtils {
  private static hasFlag(
    object: object | null | undefined,
    flag: string
  ): boolean {
    return !!(object && (object as FlaggedThreeObject)[flag]);
  }

  static isTexture(object: object | null | undefined): object is Texture {
    return this.hasFlag(object, "isTexture");
  }

  static isVector3(object: object | null | undefined): object is Vector3 {
    return this.hasFlag(object, "isVector3");
  }

  static isColor(object: object | null | undefined): object is Color {
    return this.hasFlag(object, "isColor");
  }

  static isMatrix4(object: object | null | undefined): object is Matrix4 {
    return this.hasFlag(object, "isMatrix4");
  }

  static isQuaternion(object: object | null | undefined): object is Quaternion {
    return this.hasFlag(object, "isQuaternion");
  }

  static isEuler(object: object | null | undefined): object is Euler {
    return this.hasFlag(object, "isEuler");
  }

  static isBufferGeometry(
    object: object | null | undefined
  ): object is BufferGeometry {
    return this.hasFlag(object, "isBufferGeometry");
  }

  static isMesh(object: object | null | undefined): object is Mesh {
    return this.hasFlag(object, "isMesh");
  }

  static isGroup(object: object | null | undefined): object is Group {
    return this.hasFlag(object, "isGroup");
  }

  static isScene(object: object | null | undefined): object is Scene {
    return this.hasFlag(object, "isScene");
  }

  static isCamera(object: object | null | undefined): object is Camera {
    return this.hasFlag(object, "isCamera");
  }

  static isObject3D(object: object | null | undefined): object is Object3D {
    return this.hasFlag(object, "isObject3D");
  }

  static isCanvasTexture(
    object: object | null | undefined
  ): object is CanvasTexture {
    return this.hasFlag(object, "isCanvasTexture");
  }

  static isShaderMaterial(
    object: object | null | undefined
  ): object is ShaderMaterial {
    return this.hasFlag(object, "isShaderMaterial");
  }
}
