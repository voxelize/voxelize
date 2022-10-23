import { Color, Mesh, Object3D, Vector3 } from "three";

import { World } from "../../core";
import { ChunkUtils } from "../../utils";
import { NameTag } from "../nametag";
import { Shadow } from "../shadows";

const position = new Vector3();

export type LightShinedParams = {
  lerpFactor: number;
};

const defaultParams: LightShinedParams = {
  lerpFactor: 0.1,
};

export class LightShined {
  public params: LightShinedParams;

  public list: Set<Object3D> = new Set();
  public ignored: Set<any> = new Set();

  constructor(public world: World, params: Partial<LightShinedParams> = {}) {
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

      color = this.world.getLightColorByVoxel(...voxel);
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
