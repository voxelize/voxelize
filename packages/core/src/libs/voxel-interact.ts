import { AABB } from "@voxelize/aabb";
import {
  ArrowHelper,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";

import { World } from "../core/world";
import {
  NX_ROTATION,
  NY_ROTATION,
  NZ_ROTATION,
  PX_ROTATION,
  PY_ROTATION,
  PZ_ROTATION,
  Y_ROT_MAP,
} from "../core/world/block";
import { Coords3 } from "../types";
import { ChunkUtils, MathUtils } from "../utils";

import { Arrow } from "./arrow";

/**
 * Parameters to customize the {@link VoxelInteract} instance.
 */
export type VoxelInteractOptions = {
  /**
   * The maximum distance of reach for the {@link VoxelInteract} instance. Defaults to `32`.
   */
  reachDistance: number;

  /**
   * Whether or not should the {@link VoxelInteract} instance ignore fluids when raycasting. Defaults to `true`.
   */
  ignoreFluids: boolean;

  /**
   * Whether or not should the {@link VoxelInteract} instance reverse the raycasting direction. Defaults to `false`.
   */
  inverseDirection: boolean;

  /**
   * The scale of the block highlight. Defaults to `1.002`.
   */
  highlightScale: number;

  /**
   * The type of the block highlight. Box would be a semi-transparent box, while outline would be 12 lines that outline the block's AABB union.
   * Defaults to `"box"`.
   */
  highlightType: "box" | "outline";

  /**
   * The lerping factor of the highlight. Defaults to `0.8`.
   */
  highlightLerp: number;

  /**
   * The color of the highlight. Defaults to `0xffffff`.
   */
  highlightColor: Color;

  /**
   * The opacity of the highlight. Defaults to `0.8`.
   */
  highlightOpacity: number;

  /**
   * @debug
   * Whether or not should there be arrows indicating the potential block placement's orientations. Defaults to `false`.
   */
  potentialVisuals: boolean;
};

const defaultOptions: VoxelInteractOptions = {
  reachDistance: 32,
  ignoreFluids: true,
  highlightType: "box",
  highlightScale: 1.002,
  highlightLerp: 1,
  inverseDirection: false,
  highlightColor: new Color("white"),
  highlightOpacity: 0.1,
  potentialVisuals: false,
};

/**
 * The VoxelInteract class is used to interact with voxels in the {@link World} instance. It consists of two main parts:
 *
 * - {@link VoxelInteract.potential}: The potential block placement. This is the data of a block's orientation that can be placed.
 * - {@link VoxelInteract.target}: The targeted block. This is the voxel that the camera is looking at.
 *
 * You can use these two properties to place blocks, remove blocks, and more.
 *
 * # Example
 * ```ts
 * // Create a new VoxelInteract instance.
 * const voxelInteract = new VoxelInteract(camera, world);
 *
 * // Add the voxel interact to the scene.
 * world.add(voxelInteract);
 *
 * // Set the target block to air.
 * if (voxelInteract.target) {
 *   const [vx, vy, vz] = voxelInteract.target;
 *   world.updateVoxel(vx, vy, vz, 0);
 * }
 *
 * // Update the interaction every frame.
 * voxelInteract.update();
 * ```
 *
 * ![VoxelInteract](/img/docs/voxel-interact.png)
 *
 * @noInheritDoc
 */
export class VoxelInteract extends Group {
  /**
   * Parameters to customize the {@link VoxelInteract} instance.
   */
  public options: VoxelInteractOptions;

  /**
   * Whether or not is this {@link VoxelInteract} instance currently active.
   */
  public active = true;

  /**
   * The potential orientation and location of the block placement. If no block placement is possible, this will be `null`.
   */
  public potential: {
    /**
     * The 3D coordinates of the potential block placement.
     */
    voxel: Coords3;

    /**
     * The rotation that the block placement's major axis should be facing.
     */
    rotation: number;

    /**
     * The rotation along the Y axis that the block placement's major axis should be facing.
     * This only works if rotation is {@link PY_ROTATION} or {@link NY_ROTATION}.
     */
    yRotation: number;
  } | null = {
    voxel: [0, 0, 0],
    rotation: PY_ROTATION,
    yRotation: 0,
  };

  /**
   * The targeted voxel coordinates of the block that the camera is looking at. If no block is targeted, this will be `null`.
   */
  public target: Coords3 | null = [0, 0, 0];

  /**
   * The new scale of the target for highlighting.
   */
  private newTargetScale = new Vector3();

  /**
   * The new position of the target for highlighting.
   */
  private newTargetPosition = new Vector3();

  /**
   * A Three.js group that contains the target block's highlight.
   */
  private targetGroup = new Group();

  /**
   * A Three.js group that contains the potential block placement's arrows.
   */
  private potentialGroup = new Group();

  /**
   * An arrow that points to the major axis of the potential block placement.
   */
  private potentialArrow: ArrowHelper;

  /**
   * An arrow that points to the y axis rotation of the potential block placement.
   */
  private yRotArrow: ArrowHelper;

  /**
   * Create a new VoxelInteract instance.
   *
   * @param object The object that the interactions should be raycasting from.
   * @param world The {@link World} instance that the interactions should be raycasting in.
   * @param options Parameters to customize the {@link VoxelInteract} instance.
   */
  constructor(
    public object: Object3D,
    public world: World,
    options: Partial<VoxelInteractOptions> = {}
  ) {
    super();

    if (!object) {
      throw new Error("VoxelInteract: object is required.");
    }

    if (!world) {
      throw new Error("VoxelInteract: a world is required to be operated on");
    }

    const { potentialVisuals } = (this.options = {
      ...defaultOptions,
      ...options,
    });

    this.setup();

    this.add(this.targetGroup, this.potentialGroup);
    this.potentialGroup.visible = potentialVisuals;
  }

  /**
   * Toggle on/off of this {@link VoxelInteract} instance.
   *
   * @param force Whether or not should it be a forceful toggle on/off. Defaults to `null`.
   */
  toggle = (force = null) => {
    this.active = force === null ? !this.active : force;

    this.potential = null;
    this.target = null;

    this.visible = this.active;
  };

  /**
   * Raycasts from the given object's position and direction to find the targeted voxel and potential block placement.
   * If no block is targeted, then {@link VoxelInteract.target} and {@link VoxelInteract.potential} will both be `null`.
   */
  update = () => {
    if (!this.active) return;

    const { reachDistance, highlightScale } = this.options;

    this.targetGroup.scale.lerp(
      this.newTargetScale,
      this.options.highlightLerp
    );
    this.targetGroup.position.lerp(
      this.newTargetPosition,
      this.options.highlightLerp
    );

    const objPos = new Vector3();
    const objDir = new Vector3();
    this.object.getWorldPosition(objPos);
    this.object.getWorldDirection(objDir);
    objDir.normalize();

    if (this.options.inverseDirection) {
      objDir.multiplyScalar(-1);
    }

    const result = this.world.raycastVoxels(
      objPos.toArray(),
      objDir.toArray(),
      reachDistance,
      {
        ignoreFluids: this.options.ignoreFluids,
      }
    );

    // No target.
    if (!result) {
      this.visible = false;
      this.target = null;
      this.potential = null;
      return;
    }

    const { voxel, normal } = result;

    const [nx, ny, nz] = normal;
    const newTarget = ChunkUtils.mapWorldToVoxel(<Coords3>voxel);

    // Pointing at air.
    const newLookingID = this.world.getVoxelAt(...newTarget);
    if (newLookingID === 0) {
      this.visible = false;
      this.target = null;
      this.potential = null;
      return;
    }

    this.visible = true;
    this.target = newTarget;

    const { lookingAt } = this;

    if (lookingAt && this.target) {
      const { isDynamic, dynamicFn, dynamicPatterns } = lookingAt;

      const aabbs = dynamicPatterns
        ? this.world.getBlockAABBsForDynamicPatterns(
            voxel[0],
            voxel[1],
            voxel[2],
            dynamicPatterns
          )
        : isDynamic
        ? dynamicFn(voxel as Coords3).aabbs
        : lookingAt.aabbs;

      if (!aabbs.length) return;

      const rotation = this.world.getVoxelRotationAt(...this.target);

      let union: AABB = rotation.rotateAABB(aabbs[0]);

      for (let i = 1; i < aabbs.length; i++) {
        const aabb = rotation.rotateAABB(aabbs[i]);
        union = union.union(aabb);
      }

      union.translate(this.target);

      let { width, height, depth } = union;

      width *= highlightScale;
      height *= highlightScale;
      depth *= highlightScale;

      this.newTargetScale.set(width, height, depth);
      this.newTargetPosition.set(union.minX, union.minY, union.minZ);
    }

    const targetVoxel = [
      this.target[0] + nx,
      this.target[1] + ny,
      this.target[2] + nz,
    ] as Coords3;

    // target block is look block summed with the normal
    const rotation =
      nx !== 0
        ? nx > 0
          ? PX_ROTATION
          : NX_ROTATION
        : ny !== 0
        ? ny > 0
          ? PY_ROTATION
          : NY_ROTATION
        : nz !== 0
        ? nz > 0
          ? PZ_ROTATION
          : NZ_ROTATION
        : 0;

    const yRotation = (() => {
      if (Math.abs(ny) !== 0) {
        this.yRotArrow.visible = true;

        const [vx, vy, vz] = [objPos.x, objPos.y, objPos.z];

        const [tx, ty, tz] = [
          targetVoxel[0] + 0.5,
          targetVoxel[1] + 0.5,
          targetVoxel[2] + 0.5,
        ];

        let angle =
          ny > 0 ? Math.atan2(vx - tx, vz - tz) : Math.atan2(vz - tz, vx - tx);
        if (ny < 0) angle += Math.PI / 2;
        const normalized = MathUtils.normalizeAngle(angle);

        let min = Infinity;
        let closest: number;
        let closestA: number;

        Y_ROT_MAP.forEach(([a, yRot]) => {
          if (Math.abs(normalized - a) < min) {
            min = Math.abs(normalized - a);
            closest = yRot;
            closestA = a;
          }
        });

        const x =
          ny < 0 ? Math.cos(closestA - Math.PI / 2) : Math.sin(closestA);
        const z =
          ny < 0 ? Math.sin(closestA - Math.PI / 2) : Math.cos(closestA);
        this.yRotArrow.setDirection(new Vector3(x, 0, z).normalize());
        return closest;
      }

      this.yRotArrow.visible = false;
      return 0;
    })();

    this.potential = {
      voxel: targetVoxel,
      rotation: rotation,
      yRotation,
      // lookingAt.rotatable ? closest : undefined,
    };

    if (this.potential) {
      this.potentialGroup.position.set(
        this.potential.voxel[0] + 0.5,
        this.potential.voxel[1] + 0.5,
        this.potential.voxel[2] + 0.5
      );
      this.potentialArrow.setDirection(new Vector3(nx, ny, nz));
    }
  };

  /**
   * Get the voxel ID of the targeted voxel. `null` if no voxel is targeted.
   */
  get lookingAt() {
    if (this.target) {
      return this.world.getBlockAt(
        this.target[0],
        this.target[1],
        this.target[2]
      );
    }

    return null;
  }

  /**
   * Setup the highlighter.
   */
  private setup = () => {
    const { highlightType, highlightScale, highlightColor, highlightOpacity } =
      this.options;

    const mat = new MeshBasicMaterial({
      color: new Color(highlightColor),
      opacity: highlightOpacity,
      transparent: true,
    });

    if (highlightType === "outline") {
      const w = 0.01;
      const dim = highlightScale;
      const side = new Mesh(new BoxGeometry(dim, w, w), mat);

      for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 2) {
          const temp = side.clone();

          temp.position.y = ((dim - w) / 2) * i;
          temp.position.z = ((dim - w) / 2) * j;

          this.targetGroup.add(temp);
        }
      }

      for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 2) {
          const temp = side.clone();

          temp.position.z = ((dim - w) / 2) * i;
          temp.position.x = ((dim - w) / 2) * j;
          temp.rotation.z = Math.PI / 2;

          this.targetGroup.add(temp);
        }
      }

      for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 2) {
          const temp = side.clone();

          temp.position.x = ((dim - w) / 2) * i;
          temp.position.y = ((dim - w) / 2) * j;
          temp.rotation.y = Math.PI / 2;

          this.targetGroup.add(temp);
        }
      }

      const offset = new Vector3(0.5, 0.5, 0.5);

      this.targetGroup.children.forEach((child) => {
        child.position.add(offset);
      });
    } else if (highlightType === "box") {
      const box = new Mesh(
        new BoxGeometry(highlightScale, highlightScale, highlightScale),
        mat
      );

      box.position.x += 0.5;
      box.position.y += 0.5;
      box.position.z += 0.5;

      this.targetGroup.add(box);
    } else {
      throw new Error("Invalid highlight type");
    }

    this.potentialArrow = new Arrow({ color: "red" });
    this.yRotArrow = new Arrow({ color: "green" });

    this.potentialGroup.add(this.potentialArrow, this.yRotArrow);

    this.targetGroup.frustumCulled = false;
    this.targetGroup.renderOrder = 1000000;
  };
}
