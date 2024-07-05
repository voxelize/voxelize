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

export class ThreeUtils {
  static isTexture(object: any): object is Texture {
    return object && object.isTexture;
  }

  static isVector3(object: any): object is Vector3 {
    return object && object.isVector3;
  }

  static isColor(object: any): object is Color {
    return object && object.isColor;
  }

  static isMatrix4(object: any): object is Matrix4 {
    return object && object.isMatrix4;
  }

  static isQuaternion(object: any): object is Quaternion {
    return object && object.isQuaternion;
  }

  static isEuler(object: any): object is Euler {
    return object && object.isEuler;
  }

  static isBufferGeometry(object: any): object is BufferGeometry {
    return object && object.isBufferGeometry;
  }

  static isMesh(object: any): object is Mesh {
    return object && object.isMesh;
  }

  static isGroup(object: any): object is Group {
    return object && object.isGroup;
  }

  static isScene(object: any): object is Scene {
    return object && object.isScene;
  }

  static isCamera(object: any): object is Camera {
    return object && object.isCamera;
  }

  static isObject3D(object: any): object is Object3D {
    return object && object.isObject3D;
  }

  static isCanvasTexture(object: any): object is CanvasTexture {
    return object && object.isCanvasTexture;
  }

  static isShaderMaterial(object: any): object is ShaderMaterial {
    return object && object.isShaderMaterial;
  }
}
