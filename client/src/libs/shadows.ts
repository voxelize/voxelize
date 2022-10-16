import { raycast } from "@voxelize/raycast";
import { World } from "core";
import {
  CircleBufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";

export type ShadowParams = {
  maxDistance: number;
  maxRadius: number;
};

const defaultParams: ShadowParams = {
  maxDistance: 10,
  maxRadius: 0.5,
};

export class Shadow extends Mesh {
  public params: ShadowParams;

  static readonly MATERIAL = new MeshBasicMaterial({
    side: DoubleSide,
    color: "rgb(0,0,0)",
    opacity: 0.3,
    depthWrite: false,
    transparent: true,
  });

  static readonly GEOMETRY = new CircleBufferGeometry(
    defaultParams.maxRadius,
    30
  );

  static readonly Y_OFFSET = 0.01;

  constructor(public world: World, params: Partial<ShadowParams> = {}) {
    super(Shadow.GEOMETRY, Shadow.MATERIAL);

    this.params = {
      ...defaultParams,
      ...params,
    };

    this.rotateX(Math.PI / 2);
    this.renderOrder = 100000000;
  }

  update = () => {
    if (!this.parent) return;

    const position = new Vector3();
    this.parent.getWorldPosition(position);

    const { maxDistance } = this.params;

    const result = raycast(
      this.world.getBlockAABBsByWorld,
      [position.x, position.y, position.z],
      [0, -1, 0],
      maxDistance
    );

    this.visible = !!result;

    if (!result) return;

    const { point } = result;

    if (isNaN(point[0])) {
      return;
    }

    const dist = Math.sqrt(
      (point[0] - position.x) ** 2 +
        (point[1] - position.y) ** 2 +
        (point[2] - position.z) ** 2
    );
    const scale = Math.max(1 - dist / maxDistance, 0) ** 2;

    const newPosition = new Vector3(
      point[0],
      point[1] + Shadow.Y_OFFSET,
      point[2]
    );
    newPosition.sub(position);

    this.position.copy(newPosition);
    this.scale.set(scale, scale, 1);
  };
}

export class Shadows extends Array<Shadow> {
  constructor(public world: World) {
    super();
  }

  update = () => {
    this.forEach((shadow) => shadow.update());
  };

  add = (object: Object3D, params: Partial<ShadowParams> = {}) => {
    const shadow = new Shadow(this.world, params);
    object.add(shadow);
    this.push(shadow);
  };
}
