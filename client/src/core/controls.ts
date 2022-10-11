import { EventEmitter } from "events";

import { AABB } from "@voxelize/aabb";
import { RigidBody } from "@voxelize/physics-engine";
import { raycast } from "@voxelize/raycast";
import {
  Euler,
  Vector3,
  Group,
  Mesh,
  MeshBasicMaterial,
  Color,
  BoxGeometry,
  Quaternion,
  PerspectiveCamera,
} from "three";

import { Character } from "../libs";
import { Coords3 } from "../types";
import { ChunkUtils } from "../utils";

import { Inputs } from "./inputs";
import {
  NX_ROTATION,
  NY_ROTATION,
  NZ_ROTATION,
  PX_ROTATION,
  PY_ROTATION,
  PZ_ROTATION,
  World,
} from "./world";

const PI_2 = Math.PI / 2;
const emptyQ = new Quaternion();

function rotateY(a: number[], b: number[], c: number) {
  const bx = b[0];
  const bz = b[2];

  // translate point to the origin
  const px = a[0] - bx;
  const pz = a[2] - bz;

  const sc = Math.sin(c);
  const cc = Math.cos(c);

  // perform rotation and translate to correct position
  const out = [0, 0, 0];
  out[0] = bx + pz * sc + px * cc;
  out[1] = a[1];
  out[2] = bz + pz * cc - px * sc;

  return out;
}

/**
 * The state of which a Voxelize {@link Controls} is in.
 */
type RigidControlState = {
  /**
   * In radians, the heading y-rotation of the client. Defaults to `0`.
   */
  heading: number;

  /**
   * Whether if the client is running. Defaults to `false`.
   */
  running: boolean;

  /**
   * Whether if the client is attempting to jump, if the jump key is pressed. Defaults to `false`.
   */
  jumping: boolean;

  /**
   * Whether if the client is attempting to sprint, if the sprint key is pressed. Defaults to `false`.
   */
  sprinting: boolean;

  /**
   * Whether if the client is attempting to crouch, if the crouch key is pressed. Defaults to `false`.
   */
  crouching: boolean;

  /**
   * How many times has the client jumped. Defaults to `0`.
   */
  jumpCount: number;

  /**
   * Whether or not is the client jumping, in the air. Defaults to `false`.
   */
  isJumping: boolean;

  /**
   * The current amount of time spent in the air from jump. Defaults to `0`.
   */
  currentJumpTime: number;
};

export type { RigidControlState };

const defaultControlState: RigidControlState = {
  heading: 0,
  running: false,
  jumping: false,
  sprinting: false,
  crouching: false,

  jumpCount: 0,
  isJumping: false,
  currentJumpTime: 0,
};

/**
 * Parameters to initialize the Voxelize {@link Controls}.
 */
export type RigidControlsParams = {
  /**
   * The mouse sensitivity. Defaults to `100`.
   */
  sensitivity: number;

  /**
   * Minimum polar angle that camera can look down to. Defaults to `Math.PI * 0.01`.
   */
  minPolarAngle: number;

  /**
   * Maximum polar angle that camera can look up to. Defaults to `Math.PI * 0.99`
   */
  maxPolarAngle: number;

  /**
   * The scale of the outline of the looking block. Defaults to `1.002`.
   */
  lookBlockScale: number;

  /**
   * The color of the outline of the looking block. Defaults to `black`.
   */
  lookBlockColor: string;

  /**
   * The interpolation factor of the looking block changing. Defaults to `1`, immediate changes.
   */
  lookBlockLerp: number;

  /**
   * Allow client to look at blocks even in ghost mode. Defaults to `false`.
   */
  lookInGhostMode: boolean;

  /**
   * The maximum distance a client can reach a block. Defaults to `32`.
   */
  reachDistance: number;

  /**
   * Initial position of the client. Defaults to `(0, 80, 10)`.
   */
  initialPosition: Coords3;

  /**
   * The interpolation factor of the client's rotation. Defaults to `0.9`.
   */
  rotationLerp: number;

  /**
   * The force upwards when a client tries to jump in water. Defaults to `0.3`.
   */
  fluidPushForce: number;

  /**
   * The interpolation factor of the client's position. Defaults to `0.9`.
   */
  positionLerp: number;

  /**
   * The width of the client's avatar. Defaults to `0.8` blocks.
   */
  bodyWidth: number;

  /**
   * The height of the client's avatar. Defaults to `1.55` blocks.
   */
  bodyHeight: number;

  /**
   * The depth of the client's avatar. Defaults to `0.8` blocks.
   */
  bodyDepth: number;

  /**
   * The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.919`.
   */
  eyeHeight: number;

  /**
   * The maximum level of speed of a client. Default is `6` .
   */
  maxSpeed: number;

  /**
   * The level of force of which the client can move at. Default is `30`.
   */
  moveForce: number;

  /**
   * The level of responsiveness of a client to movements. Default is `240`.
   */
  responsiveness: number;

  /**
   * Default running friction of a client. Defaults to `0.1`.
   */
  runningFriction: number;

  /**
   * Default standing friction of a client. Defaults to `4`.
   */
  standingFriction: number;

  /**
   * The level of speed at which a client flies at. Defaults to `40`.
   */
  flySpeed: number;

  /**
   * The level of force at which a client flies at. Defaults to `80`.
   */
  flyForce: number;

  /**
   * The level impulse of which a client flies at. Defaults to `2.5`.
   */
  flyImpulse: number;

  /**
   * The inertia of a client when they're flying. Defaults to `6`.
   */
  flyInertia: number;

  /**
   * The factor to the movement speed when sprint is applied. Defaults to `1.4`.
   */
  sprintFactor: number;

  /**
   * The factor to the movement speed when crouch is applied. Defaults to `0.6`.
   */
  crouchFactor: number;

  /**
   * Sprint factor would be on always.
   */
  alwaysSprint: boolean;

  /**
   * The factor applied to the movements of the client in air, such as while half-jump. Defaults to `0.7`.
   */
  airMoveMult: number;

  /**
   * The level of impulse at which the client jumps upwards. Defaults to `8`.
   */
  jumpImpulse: number;

  /**
   * The level of force applied to the client when jumping. Defaults to `1`.
   */
  jumpForce: number;

  /**
   * The time, in milliseconds, that a client can be jumping. Defaults to `50`ms.
   */
  jumpTime: number;

  /**
   * How many times can a client jump in the air. Defaults to `0`.
   */
  airJumps: number;

  /**
   * How tall a client can step up. Defaults to `0.5`.
   */
  stepHeight: number;
};

const defaultParams: RigidControlsParams = {
  sensitivity: 100,
  minPolarAngle: Math.PI * 0.01,
  maxPolarAngle: Math.PI * 0.99,
  lookBlockScale: 1.002,
  lookBlockLerp: 1,
  lookBlockColor: "black",
  lookInGhostMode: false,
  reachDistance: 32,
  initialPosition: [0, 80, 10],
  rotationLerp: 0.9,
  positionLerp: 1.0,

  bodyWidth: 0.8,
  bodyHeight: 1.55,
  bodyDepth: 0.8,
  eyeHeight: 0.9193548387096774,

  maxSpeed: 6,
  moveForce: 30,
  responsiveness: 240,
  runningFriction: 0.1,
  standingFriction: 4,

  flySpeed: 40,
  flyForce: 80,
  flyImpulse: 2.5,
  flyInertia: 6,

  sprintFactor: 1.4,
  crouchFactor: 0.6,
  alwaysSprint: false,
  airMoveMult: 0.7,
  fluidPushForce: 0.3,
  jumpImpulse: 8,
  jumpForce: 1,
  jumpTime: 50,
  airJumps: 0,

  stepHeight: 0.5,
};

export declare interface RigidControls {
  on(event: "lock", listener: () => void): this;
  on(event: "unlock", listener: () => void): this;
}

/**
 * Inspired by THREE.JS's PointerLockControls, the **built-in** main control of the game
 * so that the player can move freely around the world.
 *
 * ## Example
 * Printing the voxel that the client is in:
 * ```ts
 * console.log(client.controls.voxel);
 * ```
 *
 * @noInheritDoc
 * @category Core
 */
export class RigidControls extends EventEmitter {
  /**
   * Reference linking to the Voxelize camera instance.
   */
  public camera: PerspectiveCamera;

  public inputs?: Inputs<any>;

  public character?: Character;

  public domElement: HTMLElement;

  /**
   * Reference linking to the Voxelize world instance.
   */
  public world: World;

  /**
   * Parameters to initialize the Voxelize controls.
   */
  public params: RigidControlsParams;

  /**
   * A THREE.JS object, parent to the camera for pointerlock controls.
   */
  public object = new Group();

  /**
   * The state of the control, indicating things like whether or not the client is running.
   */
  public state: RigidControlState;

  /**
   * Flag indicating whether pointerlock controls have control over the cursor.
   */
  public isLocked = false;

  /**
   * The physical rigid body of the client, dimensions described by:
   * - `params.bodyWidth`
   * - `params.bodyHeight`
   * - `params.bodyDepth`
   */
  public body: RigidBody;

  /**
   * The voxel at which the client is looking at.
   */
  public lookBlock: Coords3 | null = [0, 0, 0];

  /**
   * The block that a client can potentially place at.
   */
  public targetBlock: {
    /**
     * The coordinates of the potentially placeable block. Defaults to `(0, 0, 0)`.
     */
    voxel: Coords3;

    /**
     * The rotation of the block that may be placed.
     */
    rotation: number;

    /**
     * The rotation on the y-axis of the block that may be placed.
     */
    yRotation: number;
  } | null = {
    voxel: [0, 0, 0],
    rotation: PY_ROTATION,
    yRotation: 0,
  };

  private lookBlockMesh: Group;

  private movements = {
    up: false,
    down: false,
    left: false,
    right: false,
    front: false,
    back: false,
    sprint: false,
  };

  private lockCallback: () => void;
  private unlockCallback: () => void;

  private euler = new Euler(0, 0, 0, "YXZ");
  private quaternion = new Quaternion();
  private vector = new Vector3();

  private newPosition = new Vector3();
  private justUnlocked = false;

  private newLookBlockScale = new Vector3();
  private newLookBlockPosition = new Vector3();

  public static readonly INPUT_IDENTIFIER = "voxelize-rigid-controls";

  /**
   * Construct a Voxelize controls.
   *
   * @hidden
   */
  constructor(
    camera: PerspectiveCamera,
    domElement: HTMLElement,
    world: World,
    options: Partial<RigidControlsParams> = {}
  ) {
    super();

    this.camera = camera;
    this.world = world;
    this.domElement = domElement;
    this.state = defaultControlState;

    const { bodyWidth, bodyHeight, bodyDepth } = (this.params = {
      ...defaultParams,
      ...options,
    });

    this.object.add(this.camera);
    this.world.add(this.object);

    this.body = world.physics.addBody({
      aabb: new AABB(0, 0, 0, bodyWidth, bodyHeight, bodyDepth),
      onStep: (newAABB) => {
        const { positionLerp } = this.params;

        this.params.positionLerp = 0.6;
        this.body.aabb = newAABB.clone();

        const stepTimeout = setTimeout(() => {
          this.params.positionLerp = positionLerp;
          clearTimeout(stepTimeout);
        }, 500);
      },
      stepHeight: this.params.stepHeight,
    });

    this.setPosition(...this.params.initialPosition);
    this.setupLookBlock();
  }

  /**
   * Update for the camera of the game.
   *
   * @hidden
   */
  update = (delta: number) => {
    this.object.quaternion.slerp(this.quaternion, this.params.rotationLerp);
    this.object.position.lerp(this.newPosition, this.params.positionLerp);

    this.lookBlockMesh.scale.lerp(
      this.newLookBlockScale,
      this.params.lookBlockLerp
    );
    this.lookBlockMesh.position.lerp(
      this.newLookBlockPosition,
      this.params.lookBlockLerp
    );

    if (this.character) {
      const {
        x: dx,
        y: dy,
        z: dz,
      } = new Vector3(0, 0, -1)
        .applyQuaternion(this.object.getWorldQuaternion(emptyQ))
        .normalize();

      this.character.set(this.object.position.toArray(), [dx, dy, dz]);
      this.character.update();
    }

    this.moveRigidBody();
    this.updateRigidBody(delta);
    this.updateLookBlock();
  };

  /**
   * Sets up all event listeners for controls, including:
   * - Mouse move event
   * - Pointer-lock events
   * - Canvas click event
   * - Key up/down events
   * - Control lock/unlock events
   *
   * @hidden
   */
  connect = (inputs: Inputs<any>, namespace = "*") => {
    this.domElement.addEventListener("mousemove", (event: MouseEvent) => {
      this.onMouseMove(event);
    });
    this.domElement.ownerDocument.addEventListener("pointerlockchange", () => {
      this.onPointerlockChange();
    });
    this.domElement.ownerDocument.addEventListener(
      "pointerlockerror",
      this.onPointerlockError
    );

    this.domElement.addEventListener("click", this.onDocumentClick);

    [
      ["r", "sprint"],
      ["w", "front"],
      ["a", "left"],
      ["s", "back"],
      ["d", "right"],
      [" ", "up"],
      ["shift", "down"],
    ].forEach(([key, movement]) => {
      inputs.bind(
        key,
        () => {
          if (!this.isLocked) return;
          this.movements[movement] = true;
        },
        namespace,
        {
          identifier: RigidControls.INPUT_IDENTIFIER,
        }
      );

      inputs.bind(
        key,
        () => {
          if (!this.isLocked) return;
          this.movements[movement] = false;
        },
        namespace,
        { occasion: "keyup", identifier: RigidControls.INPUT_IDENTIFIER }
      );
    });

    this.inputs = inputs;
  };

  /**
   * Removes all event listeners for controls, including:
   * - Mouse move event
   * - Pointer-lock events
   * - Canvas click event
   * - Key up/down events
   * - Control lock/unlock events
   *
   * @hidden
   */
  disconnect = () => {
    this.domElement.removeEventListener("mousemove", (event: MouseEvent) => {
      this.onMouseMove(event);
    });
    this.domElement.ownerDocument.removeEventListener(
      "pointerlockchange",
      () => {
        this.onPointerlockChange();
      }
    );
    this.domElement.ownerDocument.removeEventListener(
      "pointerlockerror",
      this.onPointerlockError
    );

    this.domElement.removeEventListener("click", this.onDocumentClick);

    if (this.inputs) {
      ["r", "w", "a", "s", "d", " ", "shift"].forEach(([key]) => {
        this.inputs.unbind(key, { identifier: RigidControls.INPUT_IDENTIFIER });
        this.inputs.unbind(key, {
          identifier: RigidControls.INPUT_IDENTIFIER,
          occasion: "keyup",
        });
      });
    } else {
      console.warn("Controls is not connected to any inputs.");
    }
  };

  /**
   * Get the direction that the client is looking at.
   */
  getDirection = () => {
    return new Vector3(0, 0, -1)
      .applyQuaternion(this.object.quaternion)
      .normalize();
  };

  /**
   * Lock the cursor to the game, calling `requestPointerLock` on `client.container.domElement`.
   * Needs to be called within a DOM event listener callback!
   *
   * @param callback - Callback to be run once done.
   */
  lock = (callback?: () => void) => {
    this.domElement.requestPointerLock();

    if (callback) {
      this.lockCallback = callback;
    }
  };

  /**
   * Unlock the cursor from the game, calling `exitPointerLock` on `document`. Needs to be
   * called within a DOM event listener callback!
   *
   * @param callback - Callback to be run once done.
   */
  unlock = (callback?: () => void) => {
    this.domElement.ownerDocument.exitPointerLock();

    if (callback) {
      this.unlockCallback = callback;
    }
  };

  /**
   * Set the position of the client in interpolation.
   *
   * @param x - X-coordinate to be at.
   * @param y - Y-coordinate to be at.
   * @param z - Z-coordinate to be at.
   */
  setPosition = (x: number, y: number, z: number) => {
    const { eyeHeight, bodyHeight } = this.params;
    this.newPosition.set(x, y + bodyHeight * (eyeHeight - 0.5), z);

    if (this.body) {
      this.body.setPosition([x, y, z]);
    }
  };

  /**
   * Return a reference of the position of the rigid controller.
   */
  getPosition = () => {
    return this.object.position;
  };

  /**
   * Make the client look at a coordinate.
   *
   * @param x - X-coordinate to look at.
   * @param y - Y-coordinate to look at.
   * @param z - Z-coordinate to look at.
   */
  lookAt = (x: number, y: number, z: number) => {
    const vec = this.object.position
      .clone()
      .add(this.object.position.clone().sub(new Vector3(x, y, z)));
    this.object.lookAt(vec);
  };

  /**
   * Reset all of the control's movements.
   */
  resetMovements = () => {
    this.movements = {
      sprint: false,
      front: false,
      back: false,
      left: false,
      right: false,
      down: false,
      up: false,
    };
  };

  /**
   * Toggle ghost mode. Ghost mode is when a client can fly through blocks.
   */
  toggleGhostMode = () => {
    const { aabb } = this.body;
    const [px, py, pz] = this.body.getPosition();
    const { bodyWidth, bodyHeight, bodyDepth } = this.params;

    if (this.ghostMode) {
      aabb.minX = px - bodyWidth / 2;
      aabb.minY = py - bodyHeight / 2;
      aabb.minZ = pz - bodyDepth / 2;
      aabb.maxX = aabb.minX + bodyWidth;
      aabb.maxY = aabb.minY + bodyHeight;
      aabb.maxZ = aabb.minZ + bodyDepth;
      this.body.gravityMultiplier = 1;
    } else {
      const avgX = (aabb.minX + aabb.maxX) / 2;
      const avgY = (aabb.minY + aabb.maxY) / 2;
      const avgZ = (aabb.minZ + aabb.maxZ) / 2;
      aabb.minX = avgX + 1;
      aabb.maxX = avgX - 1;
      aabb.minY = avgY + 1;
      aabb.maxY = avgY - 1;
      aabb.minZ = avgZ + 1;
      aabb.maxZ = avgZ - 1;
      this.body.gravityMultiplier = 0;
    }
  };

  /**
   * Reset the controls instance.
   *
   * @internal
   * @hidden
   */
  reset = () => {
    this.setPosition(...this.params.initialPosition);
    this.object.rotation.set(0, 0, 0);

    this.resetMovements();
  };

  /**
   * Disposal of `Controls`, disconnects all event listeners.
   *
   * @internal
   * @hidden
   */
  dispose = () => {
    this.disconnect();
  };

  /**
   * Move the client forward/backward by a certain distance.
   *
   * @internal
   * @hidden
   * @param distance - Distance to move forward by.
   */
  moveForward = (distance: number) => {
    // move forward parallel to the xz-plane
    // assumes camera.up is y-up

    this.vector.setFromMatrixColumn(this.object.matrix, 0);

    this.vector.crossVectors(this.object.up, this.vector);

    this.object.position.addScaledVector(this.vector, distance);
  };

  /**
   * Move the client left/right by a certain distance.
   *
   * @internal
   * @hidden
   * @param distance - Distance to move left/right by.
   */
  moveRight = (distance: number) => {
    this.vector.setFromMatrixColumn(this.object.matrix, 0);

    this.object.position.addScaledVector(this.vector, distance);
  };

  attachCharacter = (character: Character) => {
    this.world.add(character);
    this.character = character;
  };

  /**
   * Whether if the client is in ghost mode. Ghost mode means client can fly through blocks.
   */
  get ghostMode() {
    return this.body.aabb.width <= 0;
  }

  /**
   * The voxel coordinates that the client is on.
   */
  get voxel() {
    return ChunkUtils.mapWorldPosToVoxelPos(this.body.getPosition() as Coords3);
  }

  /**
   * The chunk that the client is situated in.
   */
  get chunk() {
    return ChunkUtils.mapVoxelPosToChunkPos(
      this.voxel,
      this.world.params.chunkSize
    );
  }

  /**
   * The block type that the client is looking at.
   */
  get lookingAt() {
    if (this.lookBlock) {
      return this.world.getBlockByVoxel(
        this.lookBlock[0],
        this.lookBlock[1],
        this.lookBlock[2]
      );
    }

    return null;
  }

  private setupLookBlock = () => {
    const { lookBlockScale, lookBlockColor } = this.params;

    this.lookBlockMesh = new Group();

    const mat = new MeshBasicMaterial({
      color: new Color(lookBlockColor),
      opacity: 0.3,
      transparent: true,
    });

    const w = 0.01;
    const dim = lookBlockScale;
    const side = new Mesh(new BoxGeometry(dim, w, w), mat);

    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        const temp = side.clone();

        temp.position.y = ((dim - w) / 2) * i;
        temp.position.z = ((dim - w) / 2) * j;

        this.lookBlockMesh.add(temp);
      }
    }

    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        const temp = side.clone();

        temp.position.z = ((dim - w) / 2) * i;
        temp.position.x = ((dim - w) / 2) * j;
        temp.rotation.z = Math.PI / 2;

        this.lookBlockMesh.add(temp);
      }
    }

    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        const temp = side.clone();

        temp.position.x = ((dim - w) / 2) * i;
        temp.position.y = ((dim - w) / 2) * j;
        temp.rotation.y = Math.PI / 2;

        this.lookBlockMesh.add(temp);
      }
    }

    const offset = new Vector3(0.5, 0.5, 0.5);

    this.lookBlockMesh.children.forEach((child) => {
      child.position.add(offset);
    });

    this.lookBlockMesh.frustumCulled = false;
    this.lookBlockMesh.renderOrder = 1000000;

    this.world.add(this.lookBlockMesh);
  };

  private updateLookBlock = () => {
    const disableLookBlock = () => {
      this.lookBlockMesh.visible = false;
      this.lookBlock = null;
      this.targetBlock = null;
    };

    if (!this.params.lookInGhostMode && this.ghostMode) {
      disableLookBlock();
      return;
    }

    const { maxHeight } = this.world.params;
    const { reachDistance, lookBlockScale } = this.params;

    const camDir = new Vector3();
    const camPos = this.object.position;
    this.camera.getWorldDirection(camDir);
    camDir.normalize();

    const result = raycast(
      (x, y, z) => {
        if (y >= maxHeight || y < 0) {
          return [];
        }

        const id = this.world.getVoxelByVoxel(x, y, z);
        const rotation = this.world.getVoxelRotationByVoxel(x, y, z);
        const { aabbs } = this.world.getBlockById(id);

        return aabbs.map((aabb) => rotation.rotateAABB(aabb));
      },
      [camPos.x, camPos.y, camPos.z],
      [camDir.x, camDir.y, camDir.z],
      reachDistance
    );

    // No target.
    if (!result) {
      disableLookBlock();
      return;
    }

    const { voxel, normal } = result;

    const [nx, ny, nz] = normal;
    const newLookBlock = ChunkUtils.mapWorldPosToVoxelPos(<Coords3>voxel);

    // Pointing at air.
    const newLookingID = this.world.getVoxelByVoxel(...newLookBlock);
    if (newLookingID === 0) {
      disableLookBlock();
      return;
    }

    this.lookBlockMesh.visible = true;
    this.lookBlock = newLookBlock;

    const { lookingAt } = this;

    if (lookingAt && this.lookBlock) {
      const { aabbs } = lookingAt;
      if (!aabbs.length) return;

      const rotation = this.world.getVoxelRotationByVoxel(...this.lookBlock);

      let union: AABB = rotation.rotateAABB(aabbs[0]);

      for (let i = 1; i < aabbs.length; i++) {
        const aabb = rotation.rotateAABB(aabbs[i]);
        union = union.union(aabb);
      }

      union.translate(this.lookBlock);

      let { width, height, depth } = union;

      width *= lookBlockScale;
      height *= lookBlockScale;
      depth *= lookBlockScale;

      this.newLookBlockScale.set(width, height, depth);
      this.newLookBlockPosition.set(union.minX, union.minY, union.minZ);
    }

    const targetVoxel = [
      this.lookBlock[0] + nx,
      this.lookBlock[1] + ny,
      this.lookBlock[2] + nz,
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

    // // player's voxel position
    // const [vx, vy, vz] = this.voxel;

    // // target block's voxel position
    // const [tx, ty, tz] = targetVoxel;

    // // calculate angle between vx vz and tx tz
    // const angle =
    //   vy >= ty ? Math.atan2(vz - tz, vx - tx) : Math.atan2(tz - vz, tx - vx);
    // const normalized = MathUtils.normalizeAngle(angle);

    // let min = Infinity;
    // let closest: number;

    // Y_ROT_MAP.forEach(([a, yRot]) => {
    //   if (Math.abs(normalized - a) < min) {
    //     min = Math.abs(normalized - a);
    //     closest = yRot;
    //   }
    // });

    this.targetBlock = {
      voxel: targetVoxel,
      rotation: lookingAt.rotatable ? rotation : undefined,
      yRotation: 0,
      // lookingAt.rotatable ? closest : undefined,
    };
  };

  private moveRigidBody = () => {
    const { object, state } = this;

    const { sprint, right, left, up, down, front, back } = this.movements;

    const fb = front ? (back ? 0 : 1) : back ? -1 : 0;
    const rl = left ? (right ? 0 : 1) : right ? -1 : 0;

    const vec = new Vector3();

    // get the frontwards-backwards direction vectors
    vec.setFromMatrixColumn(object.matrix, 0);
    vec.crossVectors(object.up, vec);
    const { x: forwardX, z: forwardZ } = vec;

    // get the side-ways vectors
    vec.setFromMatrixColumn(object.matrix, 0);
    const { x: sideX, z: sideZ } = vec;

    const totalX = forwardX + sideX;
    const totalZ = forwardZ + sideZ;

    let angle = Math.atan2(totalX, totalZ);

    if ((fb | rl) === 0) {
      state.running = false;

      if (state.sprinting) {
        this.movements.sprint = false;
        state.sprinting = false;
      }
    } else {
      state.running = true;
      if (fb) {
        if (fb === -1) angle += Math.PI;
        if (rl) {
          angle += (Math.PI / 4) * fb * rl;
        }
      } else {
        angle += (rl * Math.PI) / 2;
      }
      // not sure why add Math.PI / 4, but it was always off by that.
      state.heading = angle + Math.PI / 4;
    }

    // set jump as true, and brain will handle the jumping
    // state.jumping = up ? (down ? false : true) : down ? false : false;
    state.jumping = up;

    // crouch to true, so far used for flying
    state.crouching = down;

    // apply sprint state change
    state.sprinting = this.params.alwaysSprint ? true : sprint;

    // means landed, no more fly
    if (!this.ghostMode) {
      if (this.body.gravityMultiplier === 0 && this.body.atRestY === -1) {
        this.body.gravityMultiplier = 1;
      }
    }
  };

  private updateRigidBody = (dt: number) => {
    const {
      airJumps,
      jumpForce,
      jumpTime,
      jumpImpulse,
      maxSpeed,
      sprintFactor,
      crouchFactor,
      moveForce,
      airMoveMult,
      responsiveness,
      runningFriction,
      standingFriction,
      flyInertia,
      flyImpulse,
      flyForce,
      flySpeed,
      fluidPushForce,
    } = this.params;

    if (this.body.gravityMultiplier) {
      // jumping
      const onGround = this.body.atRestY < 0;
      const canjump = onGround || this.state.jumpCount < airJumps;
      if (onGround) {
        this.state.isJumping = false;
        this.state.jumpCount = 0;
      }

      // process jump input
      if (this.state.jumping) {
        if (this.state.isJumping) {
          // continue previous jump
          if (this.state.currentJumpTime > 0) {
            let jf = jumpForce;
            if (this.state.currentJumpTime < dt)
              jf *= this.state.currentJumpTime / dt;
            this.body.applyForce([0, jf, 0]);
            this.state.currentJumpTime -= dt;
          }
        } else if (canjump) {
          // start new jump
          this.state.isJumping = true;
          if (!onGround) this.state.jumpCount++;
          this.state.currentJumpTime = jumpTime;
          this.body.applyImpulse([0, jumpImpulse, 0]);
          // clear downward velocity on airjump
          if (!onGround && this.body.velocity[1] < 0) this.body.velocity[1] = 0;
        } else if (this.body.ratioInFluid > 0) {
          // apply impulse to swim
          this.body.applyImpulse([0, fluidPushForce, 0]);
        }
      } else {
        this.state.isJumping = false;
      }

      // apply movement forces if entity is moving, otherwise just friction
      let m = [0, 0, 0];
      let push = [0, 0, 0];
      if (this.state.running) {
        let speed = maxSpeed;
        // todo: add crouch/sprint modifiers if needed
        if (this.state.sprinting) speed *= sprintFactor;
        if (this.state.crouching) speed *= crouchFactor;
        m[2] = speed;

        // rotate move vector to entity's heading

        m = rotateY(m, [0, 0, 0], this.state.heading);

        // push vector to achieve desired speed & dir
        // following code to adjust 2D velocity to desired amount is patterned on Quake:
        // https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c#L275
        push = [
          m[0] - this.body.velocity[0],
          m[1] - this.body.velocity[1],
          m[2] - this.body.velocity[2],
        ];
        push[1] = 0;
        const pushLen = Math.sqrt(push[0] ** 2 + push[1] ** 2 + push[2] ** 2);

        push[0] /= pushLen;
        push[1] /= pushLen;
        push[2] /= pushLen;

        if (pushLen > 0) {
          // pushing force vector
          let canPush = moveForce;
          if (!onGround) canPush *= airMoveMult;

          // apply final force
          const pushAmt = responsiveness * pushLen;
          if (canPush > pushAmt) canPush = pushAmt;

          push[0] *= canPush;
          push[1] *= canPush;
          push[2] *= canPush;

          this.body.applyForce(push);
        }

        // different friction when not moving
        // idea from Sonic: http://info.sonicretro.org/SPG:Running
        this.body.friction = runningFriction;
      } else {
        this.body.friction = standingFriction;
      }
    } else {
      this.body.velocity[0] -= this.body.velocity[0] * flyInertia * dt;
      this.body.velocity[1] -= this.body.velocity[1] * flyInertia * dt;
      this.body.velocity[2] -= this.body.velocity[2] * flyInertia * dt;

      if (this.state.jumping) {
        this.body.applyImpulse([0, flyImpulse, 0]);
      }

      if (this.state.crouching) {
        this.body.applyImpulse([0, -flyImpulse, 0]);
      }

      // apply movement forces if entity is moving, otherwise just friction
      let m = [0, 0, 0];
      let push = [0, 0, 0];
      if (this.state.running) {
        let speed = flySpeed;
        // todo: add crouch/sprint modifiers if needed
        if (this.state.sprinting) speed *= sprintFactor;
        if (this.state.crouching) speed *= crouchFactor;
        m[2] = speed;

        // rotate move vector to entity's heading
        m = rotateY(m, [0, 0, 0], this.state.heading);

        // push vector to achieve desired speed & dir
        // following code to adjust 2D velocity to desired amount is patterned on Quake:
        // https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c#L275
        push = [
          m[0] - this.body.velocity[0],
          m[1] - this.body.velocity[1],
          m[2] - this.body.velocity[2],
        ];

        push[1] = 0;
        const pushLen = Math.sqrt(push[0] ** 2 + push[1] ** 2 + push[2] ** 2);

        push[0] /= pushLen;
        push[1] /= pushLen;
        push[2] /= pushLen;

        if (pushLen > 0) {
          // pushing force vector
          let canPush = flyForce;

          // apply final force
          const pushAmt = responsiveness * pushLen;
          if (canPush > pushAmt) canPush = pushAmt;

          push[0] *= canPush;
          push[1] *= canPush;
          push[2] *= canPush;

          this.body.applyForce(push);
        }

        // different friction when not moving
        // idea from Sonic: http://info.sonicretro.org/SPG:Running
        this.body.friction = runningFriction;
      } else {
        this.body.friction = standingFriction;
      }
    }

    const [x, y, z] = this.body.getPosition();
    const { eyeHeight, bodyHeight } = this.params;
    this.newPosition.set(x, y + bodyHeight * (eyeHeight - 0.5), z);
  };

  private onKeyDown = ({ code }: KeyboardEvent) => {
    if (!this.isLocked) return;

    switch (code) {
      case "KeyR":
        this.movements.sprint = true;

        break;
      case "ArrowUp":
      case "KeyW":
        this.movements.front = true;
        break;

      case "ArrowLeft":
      case "KeyA":
        this.movements.left = true;
        break;

      case "ArrowDown":
      case "KeyS":
        this.movements.back = true;
        break;

      case "ArrowRight":
      case "KeyD":
        this.movements.right = true;
        break;

      case "Space":
        this.movements.up = true;
        break;

      case "ShiftLeft":
        this.movements.down = true;
        break;
    }
  };

  private onKeyUp = ({ code }: KeyboardEvent) => {
    if (!this.isLocked) return;

    switch (code) {
      case "KeyR":
        this.movements.sprint = false;

        break;
      case "ArrowUp":
      case "KeyW":
        this.movements.front = false;
        break;

      case "ArrowLeft":
      case "KeyA":
        this.movements.left = false;
        break;

      case "ArrowDown":
      case "KeyS":
        this.movements.back = false;
        break;

      case "ArrowRight":
      case "KeyD":
        this.movements.right = false;
        break;

      case "Space":
        this.movements.up = false;
        break;

      case "ShiftLeft":
        this.movements.down = false;
        break;
    }
  };

  private onMouseMove = (event: MouseEvent) => {
    if (this.isLocked === false) return;

    // Skip the first movement back on lock because chrome has a bug where
    // movementX and movementY becomes 60+
    if (this.justUnlocked) {
      this.justUnlocked = false;
      return;
    }

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    this.euler.setFromQuaternion(this.quaternion);

    this.euler.y -= (movementX * this.params.sensitivity * 0.002) / 100;
    this.euler.x -= (movementY * this.params.sensitivity * 0.002) / 100;

    this.euler.x = Math.max(
      PI_2 - this.params.maxPolarAngle,
      Math.min(PI_2 - this.params.minPolarAngle, this.euler.x)
    );

    this.quaternion.setFromEuler(this.euler);
  };

  private onPointerlockChange = () => {
    if (this.domElement.ownerDocument.pointerLockElement === this.domElement) {
      this.onLock();

      if (this.lockCallback) {
        this.lockCallback();
        this.lockCallback = undefined;
      }

      this.isLocked = true;
    } else {
      this.onUnlock();

      if (this.unlockCallback) {
        this.unlockCallback();
        this.unlockCallback = undefined;
      }

      this.isLocked = false;
    }
  };

  private onPointerlockError = () => {
    console.error("THREE.PointerLockControls: Unable to use Pointer Lock API");
  };

  private onDocumentClick = () => {
    if (this.isLocked) return;
    this.lock();
  };

  private onLock = () => {
    this.emit("lock");
  };

  private onUnlock = () => {
    this.emit("unlock");
    this.justUnlocked = true;
  };
}
