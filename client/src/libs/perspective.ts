import { raycast } from "@voxelize/raycast";
import { Vector3 } from "three";

import { RigidControls } from "../core/controls";
import { Inputs } from "../core/inputs";
import { World } from "../core/world";

export type PerspectiveParams = {
  maxDistance: number;
  blockMargin: number;
  lerpFactor: number;
};

const defaultParams: PerspectiveParams = {
  maxDistance: 5,
  blockMargin: 0.3,
  lerpFactor: 0.5,
};

export class Perspective {
  public params: PerspectiveParams;

  public controls: RigidControls;

  public world: World;

  public inputs?: Inputs<any>;

  private _state: "first" | "second" | "third" = "first";

  private firstPersonPosition = new Vector3();

  public static readonly INPUT_IDENTIFIER = "voxelize-perspective";

  constructor(
    controls: RigidControls,
    world: World,
    params: Partial<PerspectiveParams> = {}
  ) {
    this.controls = controls;
    this.world = world;

    this.params = {
      ...defaultParams,
      ...params,
    };

    this.firstPersonPosition.copy(this.controls.camera.position);

    this.state = "first";
  }

  onChangeState: (state: "first" | "second" | "third") => void;

  connect = (inputs: Inputs, namespace = "*") => {
    inputs.bind("c", this.toggle, namespace, {
      identifier: Perspective.INPUT_IDENTIFIER,
    });

    this.inputs = inputs;
  };

  toggle = () => {
    switch (this.state) {
      case "first":
        this.state = "third";
        break;
      case "second":
        this.state = "first";
        break;
      case "third":
        this.state = "second";
        break;
    }
  };

  update = () => {
    const { object, camera } = this.controls;

    if (this.controls.character) {
      if (this.state === "first" && this.controls.character.visible) {
        this.controls.character.visible = false;
      } else if (this.state !== "first" && !this.controls.character.visible) {
        this.controls.character.visible = true;
      }
    }

    const getDistance = () => {
      const dir = new Vector3();
      (this.state === "second" ? object : camera).getWorldDirection(dir);
      dir.normalize();
      dir.multiplyScalar(-1);

      const pos = new Vector3();
      object.getWorldPosition(pos);

      pos.add(dir.clone().multiplyScalar(this.params.blockMargin));

      const result = raycast(
        (vx: number, vy: number, vz: number) => {
          if (vy >= this.world.params.maxHeight || vy < 0) {
            return [];
          }

          const id = this.world.getVoxelByVoxel(vx, vy, vz);
          const rotation = this.world.getVoxelRotationByVoxel(vx, vy, vz);
          const { aabbs, isFluid } = this.world.getBlockById(id);

          return isFluid ? [] : aabbs.map((aabb) => rotation.rotateAABB(aabb));
        },
        [pos.x, pos.y, pos.z],
        [dir.x, dir.y, dir.z],
        this.params.maxDistance
      );

      if (!result) {
        return this.params.maxDistance;
      }

      return pos.distanceTo(new Vector3(...result.point));
    };

    switch (this.state) {
      case "first": {
        break;
      }
      case "second": {
        const newPos = camera.position.clone();
        newPos.z = -getDistance();
        camera.position.lerp(newPos, this.params.lerpFactor);
        camera.lookAt(object.position);
        break;
      }
      case "third": {
        const newPos = camera.position.clone();
        newPos.z = getDistance();
        camera.position.lerp(newPos, this.params.lerpFactor);
        break;
      }
    }
  };

  set state(state: "first" | "second" | "third") {
    const { camera } = this.controls;

    if (state === "first") {
      camera.position.copy(this.firstPersonPosition);
    } else {
      camera.position.set(0, 0, 0);
    }

    camera.quaternion.set(0, 0, 0, 0);

    if (state !== this._state) {
      this.onChangeState?.(state);
      this._state = state;
    }
  }

  get state() {
    return this._state;
  }
}
