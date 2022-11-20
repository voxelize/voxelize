import {
  CircleGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";

import { World } from "../core/world/index";

/**
 * Parameters to create a shadow.
 */
export type ShadowParams = {
  /**
   * The maximum distance from the object to the ground to cast a shadow. The shadow's scale scales inversely with distance. Defaults to `10`.
   */
  maxDistance: number;

  /**
   * The maximum radius the shadow can have. That is, the radius of the shadow when the object is on the ground. Defaults to `0.5`.
   */
  maxRadius: number;
};

const defaultParams: ShadowParams = {
  maxDistance: 10,
  maxRadius: 0.5,
};

/**
 * A shadow that is just a circle underneath an object that scales smaller with distance. Shadows ignore fluids.
 */
export class Shadow extends Mesh {
  /**
   * The parameters of the shadow.
   */
  public params: ShadowParams;

  /**
   * The shared material for all shadows.
   */
  static readonly MATERIAL = new MeshBasicMaterial({
    side: DoubleSide,
    color: "rgb(0,0,0)",
    opacity: 0.3,
    depthWrite: false,
    transparent: true,
  });

  /**
   * The shared geometry for all shadows.
   */
  static readonly GEOMETRY = new CircleGeometry(defaultParams.maxRadius, 30);

  /**
   * The y-offset of the shadow from the ground.
   */
  static readonly Y_OFFSET = 0.01;

  /**
   * Create a shadow instance.
   *
   * @param world The world to cast shadows in.
   * @param params The parameters of the shadow.
   */
  constructor(public world: World, params: Partial<ShadowParams> = {}) {
    super(Shadow.GEOMETRY, Shadow.MATERIAL);

    this.params = {
      ...defaultParams,
      ...params,
    };

    this.rotateX(Math.PI / 2);
    this.renderOrder = -1;
  }

  /**
   * This raycasts from the shadow's parent to the ground and determines the shadow's scale by the distance.
   */
  update = () => {
    if (!this.parent) return;

    const position = new Vector3();
    this.parent.getWorldPosition(position);

    const { maxDistance } = this.params;

    const result = this.world.raycastVoxels(
      position.toArray(),
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

/**
 * A manager for all shadows in the world. Shadows should be updated every frame.
 *
 * # Example
 * ```ts
 * // Create a shadow manager.
 * const shadows = new VOXELIZE.Shadows(world);
 *
 * // Add a shadow to an object managed by the shadow manager.
 * shadows.add(object);
 *
 * // Update the shadows every frame.
 * shadows.update();
 * ```
 *
 * @noInheritDoc
 */
export class Shadows extends Array<Shadow> {
  /**
   * The world to cast shadows in.
   */
  public world: World;

  /**
   * Create a shadow manager.
   *
   * @param world The world to cast shadows in.
   */
  constructor(world: World) {
    super();

    this.world = world;
  }

  /**
   * Loops through all tracked shadows and updates them. This should be called every frame.
   * This also removes any shadows that are no longer attached to an object.
   */
  update = () => {
    // Remove all shadows that don't have a parent.
    this.forEach((shadow, i) => {
      if (!shadow.parent) {
        this.splice(i, 1);
      }
    });

    this.forEach((shadow) => {
      shadow.update();
    });
  };

  /**
   * Add a shadow to an object under the shadow manager.
   *
   * @param object The object to add a shadow to.
   * @param params The parameters of the shadow.
   */
  add = (object: Object3D, params: Partial<ShadowParams> = {}) => {
    const shadow = new Shadow(this.world, params);
    object.add(shadow);
    this.push(shadow);
  };
}
