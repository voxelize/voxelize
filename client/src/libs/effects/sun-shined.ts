import { Color, Mesh, Object3D, Vector3 } from "three";

import { World } from "../../core";
import { ChunkUtils } from "../../utils";
import { NameTag } from "../nametag";
import { Shadow } from "../shadows";

const position = new Vector3();

export type SunShinedParams = {
  lerpFactor: number;
};

const defaultParams: SunShinedParams = {
  lerpFactor: 0.2,
};

export class SunShined {
  public params: SunShinedParams;

  public list: Set<Object3D> = new Set();
  public ignored: Set<any> = new Set();

  constructor(public world: World, params: Partial<SunShinedParams> = {}) {
    this.params = { ...defaultParams, ...params };

    this.ignore(Shadow);
    this.ignore(NameTag);
  }

  add = (obj: Object3D) => {
    this.list.add(obj);
  };

  remove = (obj: Object3D) => {
    this.list.delete(obj);
  };

  update = () => {
    this.list.forEach((obj) => {
      this.recursiveUpdate(obj);
    });
  };

  ignore = (...types: any[]) => {
    types.forEach((type) => {
      this.ignored.add(type);
    });
  };

  private recursiveUpdate = (obj: Object3D, color: Color | null = null) => {
    if (!obj.parent) return;

    for (const type of this.ignored) {
      if (obj instanceof type) return;
    }

    if (color === null) {
      obj.getWorldPosition(position);

      const voxel = ChunkUtils.mapWorldPosToVoxelPos(position.toArray());
      const chunk = this.world.getChunkByVoxel(...voxel);

      if (!chunk) return;

      // const vString = voxel.join(",");

      // // TODO: IN ORDER TO LERP, CANNOT DO THIS...

      // if (obj.userData[SUN_SHINED_USERDATA] === vString) {
      //   return;
      // }

      // obj.userData[SUN_SHINED_USERDATA] = vString;

      const level = this.world.getSunlightScaleByVoxel(...voxel);
      color = new Color(level, level, level);
    }

    if (obj instanceof Mesh) {
      const materials = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];
      materials.forEach((mat) => {
        if (mat && mat.color) {
          mat.color.lerp(color, this.params.lerpFactor);
        }
      });
    }

    if (obj.children.length === 0) {
      return;
    }

    obj.children.forEach((child) => {
      this.recursiveUpdate(child, color);
    });
  };
}
