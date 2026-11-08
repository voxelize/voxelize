import {
  BufferGeometry,
  Camera,
  CanvasTexture,
  Color,
  Euler,
  EventDispatcher,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Scene,
  Texture,
  Vector3,
} from "three/webgpu";

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
}

/**
 * The renderer an `onBeforeRender` / `onAfterRender` callback is handed.
 * three's typings still name it `WebGLRenderer`; every renderer here is a
 * `WebGPURenderer` (or its WebGL 2 fallback backend), a `Renderer`.
 */
export const callbackRenderer = (renderer: unknown) =>
  renderer as import("three/webgpu").Renderer;

/**
 * Tell the renderer an object, and everything under it, is gone for good.
 *
 * three's WebGPU renderer keeps a render object (bindings, pipeline state,
 * node uniforms, a listener on the material) for every drawable it has
 * drawn, in a set it only empties when the object, its material or its
 * lights fire `dispose`. Taking an object out of the scene or disposing its
 * geometry leaves all of that, and through it the object itself, alive.
 * Where the material is shared (a cached block material, a held-item copy,
 * a pooled effect material) nobody disposes it, so dropping the object
 * must fire the object's own event. This does only that: it frees nothing
 * the object shares, and an object drawn again later simply gets a fresh
 * render object.
 */
export function releaseObject(root: Object3D): void {
  root.traverse((object) =>
    (object as unknown as EventDispatcher<{ dispose: object }>).dispatchEvent({
      type: "dispose",
    }),
  );
}
