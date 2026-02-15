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
export type ShadowOptions = {
  /**
   * The maximum distance from the object to the ground to cast a shadow. The shadow's scale scales inversely with distance. Defaults to `10`.
   */
  maxDistance: number;

  /**
   * The maximum radius the shadow can have. That is, the radius of the shadow when the object is on the ground. Defaults to `0.5`.
   */
  maxRadius: number;
};

const defaultOptions: ShadowOptions = {
  maxDistance: 10,
  maxRadius: 0.5,
};

/**
 * A shadow that is just a circle underneath an object that scales smaller with distance. Shadows ignore fluids.
 *
 * @noInheritDoc
 */
export class Shadow extends Mesh {
  /**
   * The options of the shadow.
   */
  public options: ShadowOptions;

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
  static readonly GEOMETRY = new CircleGeometry(defaultOptions.maxRadius, 30);

  /**
   * The y-offset of the shadow from the ground.
   */
  static readonly Y_OFFSET = 0.01;
  private static readonly DOWN_DIRECTION: [number, number, number] = [0, -1, 0];
  private worldPosition = new Vector3();
  private localPosition = new Vector3();
  private raycastOrigin: [number, number, number] = [0, 0, 0];

  /**
   * Create a shadow instance.
   *
   * @param world The world to cast shadows in.
   * @param options The options of the shadow.
   */
  constructor(public world: World, options: Partial<ShadowOptions> = {}) {
    super(Shadow.GEOMETRY, Shadow.MATERIAL);

    this.options = {
      ...defaultOptions,
      ...options,
    };

    this.rotateX(Math.PI / 2);
    this.renderOrder = -1;
  }

  /**
   * This raycasts from the shadow's parent to the ground and determines the shadow's scale by the distance.
   */
  update = () => {
    if (!this.parent) return;

    const position = this.worldPosition;
    this.parent.getWorldPosition(position);
    const raycastOrigin = this.raycastOrigin;
    raycastOrigin[0] = position.x;
    raycastOrigin[1] = position.y;
    raycastOrigin[2] = position.z;

    const { maxDistance } = this.options;

    const result = this.world.raycastVoxels(
      raycastOrigin,
      Shadow.DOWN_DIRECTION,
      maxDistance
    );

    this.visible = !!result;

    if (!result) return;

    const { point } = result;

    if (isNaN(point[0])) {
      return;
    }

    const dx = point[0] - position.x;
    const dy = point[1] - position.y;
    const dz = point[2] - position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const scale = Math.max(1 - dist / maxDistance, 0) ** 2;

    const localPosition = this.localPosition;
    localPosition.set(
      dx,
      dy + Shadow.Y_OFFSET,
      dz
    );

    this.position.copy(localPosition);
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
   * Whether shadows are enabled. When disabled, all shadows are hidden.
   */
  public enabled = true;

  /**
   * Create a shadow manager.
   *
   * @param world The world to cast shadows in.
   */
  constructor(world: World) {
    super();

    if (!world) {
      throw new Error("Shadows: world is required.");
    }

    this.world = world;
  }

  /**
   * Loops through all tracked shadows and updates them. This should be called every frame.
   * This also removes any shadows that are no longer attached to an object or whose parent
   * is no longer in the scene.
   */
  update = () => {
    const enabled = this.enabled;
    for (let i = this.length - 1; i >= 0; i--) {
      const shadow = this[i];
      if (!shadow.parent || !this.isInScene(shadow.parent)) {
        this.splice(i, 1);
        continue;
      }

      if (enabled) {
        shadow.update();
      } else {
        shadow.visible = false;
      }
    }
  };

  private isInScene(object: Object3D): boolean {
    let current: Object3D | null = object;
    while (current) {
      if (current === this.world) return true;
      current = current.parent;
    }
    return false;
  }

  /**
   * Add a shadow to an object under the shadow manager.
   *
   * @param object The object to add a shadow to.
   * @param options The options of the shadow.
   */
  add = (object: Object3D, options: Partial<ShadowOptions> = {}) => {
    const shadow = new Shadow(this.world, options);
    object.add(shadow);
    this.push(shadow);
  };

  /**
   * Remove the shadow from an object and stop tracking it.
   *
   * @param object The object to remove the shadow from.
   */
  remove = (object: Object3D) => {
    for (let i = this.length - 1; i >= 0; i--) {
      const shadow = this[i];
      if (shadow.parent === object) {
        object.remove(shadow);
        this.splice(i, 1);
      }
    }
  };
}
