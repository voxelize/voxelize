import { Color, Mesh, Object3D, Vector3 } from "three";

import { World } from "../../core";
import { ChunkUtils } from "../../utils";
import { NameTag } from "../nametag";
import { Shadow } from "../shadows";

const position = new Vector3();

/**
 * Parameters to create a light shine effect.
 */
export type LightShinedOptions = {
  /**
   * The lerping factor of the brightness of each mesh. Defaults to `0.1`.
   */
  lerpFactor: number;
};

const defaultOptions: LightShinedOptions = {
  lerpFactor: 0.1,
};

/**
 * A class that allows mesh to dynamically change brightness based on the voxel light level at their position.
 *
 * By default, `VOXELIZE.Shadow` and `VOXELIZE.NameTag` is ignored by this effect.
 *
 * # Example
 * ```ts
 * // Create a light shined effect manager.
 * const lightShined = new VOXELIZE.LightShined();
 *
 * // Add the effect to a mesh.
 * lightShined.add(character);
 *
 * // In the render loop, update the effect.
 * lightShined.update();
 * ```
 *
 * ![Example](/img/docs/light-shined.png)
 *
 * @category Effects
 */
export class LightShined {
  /**
   * Parameters to customize the effect.
   */
  public options: LightShinedOptions;

  /**
   * A list of meshes that are effected by this effect.
   */
  public list: Set<Object3D> = new Set();

  /**
   * A list of types that are ignored by this effect.
   */
  public ignored: Set<any> = new Set();

  /**
   * Construct a light shined effect manager.
   *
   * @param world The world that the effect is applied to.
   * @param options Parameters to customize the effect.
   */
  constructor(public world: World, options: Partial<LightShinedOptions> = {}) {
    this.options = { ...defaultOptions, ...options };

    this.ignore(Shadow);
    this.ignore(NameTag);
  }

  /**
   * Add an object to be affected by this effect.
   *
   * @param obj A THREE.JS object to be shined on.
   */
  add = (obj: Object3D) => {
    this.list.add(obj);
  };

  /**
   * Remove an object from being affected by this effect
   *
   * @param obj The object to be removed from the effect.
   */
  remove = (obj: Object3D) => {
    this.list.delete(obj);
  };

  /**
   * Update the light shined effect. This fetches the light level at the position of
   * each object and recursively updates the brightness of the object.
   *
   * This should be called in the render loop.
   */
  update = () => {
    this.list.forEach((obj) => {
      this.recursiveUpdate(obj);
    });
  };

  /**
   * Ignore a certain type of object from being affected by this effect.
   *
   * @example
   * ```ts
   * // Ignore all shadows. (This is done by default)
   * lightShined.ignore(VOXELIZE.Shadow);
   * ```
   *
   * @param types A type or a list of types to be ignored by this effect.
   */
  ignore = (...types: any[]) => {
    types.forEach((type) => {
      this.ignored.add(type);
    });
  };

  private updateObject = (obj: Object3D, color: Color) => {
    for (const type of this.ignored) {
      if (obj instanceof type) return;
    }

    if (obj instanceof Mesh) {
      const materials = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];
      materials.forEach((mat) => {
        if (mat && mat.color) {
          mat.color.copy(color);
        }
      });
    }
  };

  /**
   * Recursively update an object and its children's brightness.
   */
  private recursiveUpdate = (obj: Object3D, color: Color | null = null) => {
    if (!obj.parent) return;

    for (const type of this.ignored) {
      if (obj instanceof type) return;
    }

    if (color === null) {
      obj.getWorldPosition(position);

      const voxel = ChunkUtils.mapWorldToVoxel(position.toArray());
      const chunk = this.world.getChunkByPosition(...voxel);

      if (!chunk) return;

      color = this.world.getLightColorAt(...voxel);
    }

    if (obj.userData.voxelizeLightShined) {
      const oldColor = obj.userData.voxelizeLightShined;
      const subbedColor = (oldColor as Color).sub(color);
      const colorDifference =
        subbedColor.r ** 2 + subbedColor.g ** 2 + subbedColor.b ** 2;

      if (colorDifference < 0.01) {
        return;
      }
    }

    this.updateObject(obj, color);
    obj.traverse((child) => {
      this.updateObject(child, color);
    });
  };
}
