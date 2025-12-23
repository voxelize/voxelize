import { EventEmitter } from "events";

import { AABB } from "@voxelize/aabb";
import { RigidBody } from "@voxelize/physics-engine";
import { MessageProtocol } from "@voxelize/protocol";
import {
  Clock,
  Euler,
  Group,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from "three";

import { Arm, Character } from "../libs";
import { Coords3 } from "../types";
import { ChunkUtils } from "../utils";

import { Inputs } from "./inputs";
import { NetIntercept } from "./network";
import { World } from "./world";

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
export type RigidControlState = {
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
export type RigidControlsOptions = {
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
   * Initial position of the client. Defaults to `(0, 80, 10)`.
   */
  initialPosition: Coords3;

  initialDirection: Coords3;

  /**
   * The interpolation factor of the client's rotation. Defaults to `0.9`.
   */
  rotationLerp: number;

  /**
   * The force upwards when a client tries to jump in water. Defaults to `0.3`.
   */
  fluidPushForce: number;

  /**
   * The interpolation factor of the client's position. Defaults to `1.0`.
   */
  positionLerp: number;

  /**
   * The interpolation factor when the client is auto-stepping. Defaults to `0.6`.
   */
  stepLerp: number;

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
   * The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.9193548387096774`.
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
   * Sprint factor would be on always. Defaults to `false`.
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

const defaultOptions: RigidControlsOptions = {
  sensitivity: 100,
  minPolarAngle: Math.PI * 0.01,
  maxPolarAngle: Math.PI * 0.99,
  initialPosition: [0, 80, 10],
  initialDirection: [0, 0, 0],
  rotationLerp: 0.9,
  positionLerp: 1.0,
  stepLerp: 0.6,

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
  crouchFactor: 0.45,
  alwaysSprint: false,
  airMoveMult: 0.7,
  fluidPushForce: 0.3,
  jumpImpulse: 8,
  jumpForce: 1,
  jumpTime: 50,
  airJumps: 0,

  stepHeight: 0.5,
};

/**
 * Inspired by THREE.JS's PointerLockControls, a rigid body based first person controls.
 *
 * ## Example
 * ```ts
 * // Create the controls.
 * const controls = new RigidControls(
 *   camera,
 *   renderer.domElement,
 *   world
 * );
 *
 * // Printing the voxel that the client is in.
 * console.log(controls.voxel);
 *
 * // Call the controls update function in the render loop.
 * controls.update();
 * ```
 *
 * @noInheritDoc
 * @category Core
 */
export class RigidControls extends EventEmitter implements NetIntercept {
  /**
   * Parameters to initialize the Voxelize controls.
   */
  public options: RigidControlsOptions;

  /**
   * Reference linking to the Voxelize camera instance.
   */
  public camera: PerspectiveCamera;

  /**
   * Reference linking to the Voxelize {@link Inputs} instance. You can link an inputs manager by calling
   * {@link RigidControls.connect}, which registers the keyboard inputs for the controls.
   */
  public inputs?: Inputs;

  /**
   * Reference linking to the Voxelize world instance.
   */
  public world: World;

  /**
   * A potential link to a {@link Character} instance. This can be added by
   * calling {@link RigidControls.attachCharacter} to add a mesh for 2nd and 3rd person
   * view.
   */
  public character?: Character;

  /**
   * A potential link to a {@link Arm} instance. This can be added by
   * calling {@link RigidControls.attachArm} to add a mesh for the first person
   * view.
   */
  public arm?: Arm;

  /**
   * The DOM element that pointerlock controls are applied to.
   */
  public domElement: HTMLElement;

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
   * - `options.bodyWidth`
   * - `options.bodyHeight`
   * - `options.bodyDepth`
   */
  public body: RigidBody;

  /**
   * Whether or not the client has certain movement potentials. For example, if the forward
   * key is pressed, then "front" would be `true`. Vice versa for "back".
   */
  public movements = {
    up: false,
    down: false,
    left: false,
    right: false,
    front: false,
    back: false,
    sprint: false,
  };

  /**
   * The callback to locking the pointer.
   */
  private lockCallback: () => void;

  /**
   * The callback to unlocking the pointer.
   */
  private unlockCallback: () => void;

  /**
   * An internal euler for sharing rotation calculations.
   */
  private euler = new Euler(0, 0, 0, "YXZ");

  /**
   * An internal quaternion for sharing position calculations.
   */
  private quaternion = new Quaternion();

  /**
   * An internal vector for sharing position calculations.
   */
  private vector = new Vector3();

  /**
   * The new position of the controls. This is used to lerp the position of the controls.
   */
  private newPosition = new Vector3();

  /**
   * Whether or not is the first movement back on lock. This is because Chrome has a bug where
   * movementX and movementY becomes 60+ on the first movement back.
   */
  private justUnlocked = false;

  /**
   * An internal clock instance for calculating delta time.
   */
  private clock = new Clock();

  /**
   * A list of packets that will be sent to the server.
   *
   * @hidden
   */
  public packets: MessageProtocol<any, any, any, any>[] = [];

  /**
   * The client's own peer ID. This is set when the client first connects to the server.
   */
  public ownID = "";

  /**
   * This is the identifier that is used to bind the rigid controls' keyboard inputs
   * when {@link RigidControls.connect} is called.
   */
  public static readonly INPUT_IDENTIFIER = "voxelize-rigid-controls";

  /**
   * Construct a Voxelize rigid body based first person controls. This adds a rigid body
   * to the world's physics engine, and applies movement to the camera.
   *
   * @param camera The camera to apply the controls to.
   * @param domElement The DOM element to apply the controls to.
   * @param world The world to apply the controls to.
   * @param options The options to initialize the controls with.
   */
  constructor(
    camera: PerspectiveCamera,
    domElement: HTMLElement,
    world: World,
    options: Partial<RigidControlsOptions> = {}
  ) {
    super();

    if (!camera) {
      throw new Error("RigidControls: Camera is required.");
    }

    if (!domElement) {
      throw new Error("RigidControls: DOM Element is required.");
    }

    if (!world) {
      throw new Error("RigidControls: World is required.");
    }

    this.camera = camera;
    this.world = world;
    this.domElement = domElement;
    this.state = defaultControlState;

    const { bodyWidth, bodyHeight, bodyDepth } = (this.options = {
      ...defaultOptions,
      ...options,
    });

    this.object.add(this.camera);
    this.world.add(this.object);

    this.body = world.physics.addBody({
      aabb: new AABB(0, 0, 0, bodyWidth, bodyHeight, bodyDepth),
      onStep: (newAABB) => {
        const { positionLerp, stepLerp } = this.options;

        this.options.positionLerp = stepLerp;
        this.body.aabb = newAABB.clone();

        const stepTimeout = setTimeout(() => {
          this.options.positionLerp = positionLerp;
          clearTimeout(stepTimeout);
        }, 500);
      },
      stepHeight: this.options.stepHeight,
    });

    this.reset();
  }

  onMessage = (
    message: MessageProtocol<any, any, any, [number, number, number]>
  ) => {
    switch (message.type) {
      case "INIT": {
        const { id } = message.json;
        this.ownID = id;
        break;
      }
      case "EVENT": {
        const { events } = message;

        for (const event of events) {
          switch (event.name.toLowerCase()) {
            case "vox-builtin:position": {
              this.body.setPosition(event.payload);
              this.body.velocity = [0, 0, 0];
              break;
            }

            case "vox-builtin:force": {
              const [x, y, z] = event.payload;
              this.body.applyForce([x, y, z]);
              break;
            }

            case "vox-builtin:impulse": {
              const [x, y, z] = event.payload;
              this.body.applyImpulse([x, y, z]);
              break;
            }
          }
        }

        break;
      }
    }
  };

  /**
   * An event handler for when the pointerlock is locked/unlocked.
   * The events supported so far are:
   * - `lock`: When the pointerlock is locked.
   * - `unlock`: When the pointerlock is unlocked.
   *
   * @param event The event name, either `lock` or `unlock`.
   * @param listener The listener to call when the event is emitted.
   * @returns The controls instance for chaining.
   */
  on(event: "lock" | "unlock", listener: () => void) {
    return super.on(event, listener);
  }

  /**
   * Update for the camera of the game. This should be called in the game update loop.
   * What this does is that it updates the rigid body, and then interpolates the camera's position and rotation
   * to the new position and rotation. If a character is attached, then the character is also updated.
   * If the arm is attached, then the arm is also updated.
   */
  update = () => {
    // Normalize the delta
    const delta = Math.min(0.1, this.clock.getDelta());

    this.object.quaternion.slerp(this.quaternion, this.options.rotationLerp);
    this.object.position.lerp(this.newPosition, this.options.positionLerp);

    if (this.character) {
      const {
        x: dx,
        y: dy,
        z: dz,
      } = new Vector3(0, 0, -1)
        .applyQuaternion(this.object.getWorldQuaternion(emptyQ))
        .normalize();

      const cameraPosition = this.object.position.toArray();

      this.character.set(cameraPosition, [dx, dy, dz]);
      this.character.update();
    }

    if (this.arm) this.arm.update();

    this.moveRigidBody();
    this.updateRigidBody(delta);
  };

  /**
   * Sets up all event listeners for controls, including:
   * - Mouse move event
   * - Pointer-lock events
   * - Canvas click event
   * - Key up/down events
   * - Control lock/unlock events
   *
   * This function returns a function that can be called to disconnect the controls.
   * Keep in mind that if {@link Inputs.remap} is used to remap any controls, they will
   * not be unbound when the returned function is called.
   *
   * @options inputs {@link Inputs} instance to bind the controls to.
   * @options namespace The namespace to bind the controls to.
   */
  connect = (inputs: Inputs, namespace = "*") => {
    const unbinds = [];
    const mouseMoveHandler = (event: MouseEvent) => this.onMouseMove(event);
    const pointerLockChangeHandler = (e: Event) => {
      e.preventDefault();
      this.onPointerlockChange();
    };
    const pointerLockErrorHandler = this.onPointerlockError;
    const documentClickHandler = this.onDocumentClick;

    this.domElement.addEventListener("mousemove", mouseMoveHandler);
    this.domElement.ownerDocument.addEventListener(
      "pointerlockchange",
      pointerLockChangeHandler
    );
    this.domElement.ownerDocument.addEventListener(
      "pointerlockerror",
      pointerLockErrorHandler
    );
    this.domElement.addEventListener("click", documentClickHandler);

    unbinds.push(() => {
      this.domElement.removeEventListener("mousemove", mouseMoveHandler);
      this.domElement.ownerDocument.removeEventListener(
        "pointerlockchange",
        pointerLockChangeHandler
      );
      this.domElement.ownerDocument.removeEventListener(
        "pointerlockerror",
        pointerLockErrorHandler
      );
      this.domElement.removeEventListener("click", documentClickHandler);
    });

    const keyMappings = {
      KeyW: "front",
      KeyA: "left",
      KeyS: "back",
      KeyD: "right",
      Space: "up",
      ShiftLeft: "down",
      KeyR: "sprint",
    };

    Object.entries(keyMappings).forEach(([code, movement]) => {
      unbinds.push(
        inputs.bind(
          code,
          () => {
            if (!this.isLocked) return;
            this.movements[movement] = true;
          },
          namespace,
          {
            identifier: RigidControls.INPUT_IDENTIFIER,
            occasion: "keydown",
            checkType: "code",
          }
        )
      );

      unbinds.push(
        inputs.bind(
          code,
          () => {
            if (!this.isLocked) return;
            this.movements[movement] = false;
          },
          namespace,
          {
            identifier: RigidControls.INPUT_IDENTIFIER,
            occasion: "keyup",
            checkType: "code",
          }
        )
      );
    });

    this.inputs = inputs;

    return () => {
      unbinds.forEach((unbind) => {
        try {
          unbind();
        } catch (e) {
          /// Ignore
        }
      });
    };
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
   * Lock the cursor to the game, calling `requestPointerLock` on the dom element.
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
   * Unlock the cursor from the game, calling `exitPointerLock` on the HTML document.
   * Needs to be called within a DOM event listener callback!
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
   * Teleport this rigid controls to a new voxel coordinate.
   *
   * @param vx The x voxel coordinate to teleport to.
   * @param vy The y voxel coordinate to teleport to.
   * @param vz The z voxel coordinate to teleport to.
   */
  teleport = (vx: number, vy: number, vz: number) => {
    const { bodyHeight, eyeHeight } = this.options;
    this.newPosition.set(vx + 0.5, vy + bodyHeight * eyeHeight + 1, vz + 0.5);

    if (this.body) {
      this.body.resting = [0, 0, 0];
      this.body.velocity = [0, 0, 0];
      this.body.forces = [0, 0, 0];
      this.body.impulses = [0, 0, 0];
      this.body.resting = [0, 0, 0];
      this.body.setPosition([vx + 0.5, vy + bodyHeight / 2 + 1, vz + 0.5]);
    }
  };

  /**
   * Teleport the rigid controls to the top of this voxel column.
   */
  teleportToTop = (vx?: number, vz?: number, yOffset = 0) => {
    if (vx === undefined || vz === undefined) {
      const { x, z } = this.object.position;
      const maxHeight = this.world.getMaxHeightAt(x, z);
      this.teleport(Math.floor(x), maxHeight + yOffset, Math.floor(z));
      return;
    }

    const [cx, cz] = ChunkUtils.mapVoxelToChunk(
      [vx, 0, vz],
      this.world.options.chunkSize
    );
    const chunk = this.world.getChunkByCoords(cx, cz);
    const teleport = () => {
      const maxHeight = this.world.getMaxHeightAt(vx, vz);
      this.teleport(Math.floor(vx), maxHeight + yOffset, Math.floor(vz));
    };
    if (chunk.isReady) {
      teleport();
    } else {
      this.world.addChunkInitListener([cx, cz], teleport);
    }
  };

  /**
   * Make the client look at a coordinate.
   *
   * @param x X-coordinate to look at.
   * @param y Y-coordinate to look at.
   * @param z Z-coordinate to look at.
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
    const { bodyWidth, bodyHeight, bodyDepth } = this.options;

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
   * Toggle fly mode. Fly mode is like ghost mode, but the client can't fly through blocks.
   */
  toggleFly = () => {
    if (!this.ghostMode) {
      const isFlying = this.body.gravityMultiplier === 0;

      if (!isFlying) {
        this.body.applyImpulse([0, 8, 0]);
      }

      setTimeout(() => {
        this.body.gravityMultiplier = isFlying ? 1 : 0;
      }, 100);
    }
  };

  /**
   * Reset the controls instance. This will reset the camera's position and rotation, and reset all movements.
   */
  reset = () => {
    this.teleport(...this.options.initialPosition);

    this.quaternion.setFromUnitVectors(
      new Vector3(0, 0, -1),
      new Vector3(
        this.options.initialDirection[0],
        this.options.initialDirection[1],
        this.options.initialDirection[2]
      ).normalize()
    );

    this.object.rotation.set(0, 0, 0);

    this.resetMovements();
  };

  /**
   * Move the client forward/backward by a certain distance.
   *
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
   * @param distance - Distance to move left/right by.
   */
  moveRight = (distance: number) => {
    this.vector.setFromMatrixColumn(this.object.matrix, 0);

    this.object.position.addScaledVector(this.vector, distance);
  };

  /**
   * Attach a {@link Character} to this controls instance. This can be seen in 2nd/3rd person mode.
   *
   * @param character The {@link Character} to attach to this controls instance.
   * @param newLerpFactor The new lerp factor to use for the character.
   */
  attachCharacter = (character: Character, newLerpFactor = 1) => {
    if (!(character instanceof Character)) {
      console.warn("Character not attached: not a default character.");
      return;
    }

    // Change lerp factors to one.
    character.options.positionLerp = newLerpFactor;
    // character.options.rotationLerp = newLerpFactor;

    this.options.bodyHeight = character.totalHeight;
    this.options.bodyWidth = character.body.width;
    this.options.bodyDepth = character.body.depth;
    this.options.eyeHeight = character.eyeHeight / character.totalHeight;

    this.body.aabb.maxX = this.body.aabb.minX + this.options.bodyWidth;
    this.body.aabb.maxY = this.body.aabb.minY + this.options.bodyHeight;
    this.body.aabb.maxZ = this.body.aabb.minZ + this.options.bodyDepth;

    this.character = character;
  };

  /**
   * Attach a {@link Arm} to this controls instance. This can be seen in 1st person mode.
   *
   * @param arm The {@link Arm} to attach to this controls instance.
   */
  attachArm = (arm: Arm) => {
    this.arm = arm;
    arm.getWorldPosition = (position: Vector3) => {
      position.copy(this.object.position);
      return position;
    };
    arm.emitSwingEvent = () => {
      this.character.playArmSwingAnimation();
      this.packets.push({
        type: "EVENT",
        events: [
          {
            name: "vox-builtin:arm-swing",
            payload: this.ownID,
          },
        ],
      });
    };
  };

  /**
   * Whether if the client is in ghost mode. Ghost mode means client can fly through blocks.
   */
  get ghostMode() {
    return this.body.aabb.width <= 0;
  }

  /**
   * Whether if the client is in fly mode. Fly mode means client can fly but not through blocks.
   */
  get flyMode() {
    return this.body.gravityMultiplier === 0 && !this.ghostMode;
  }

  /**
   * The voxel coordinates that the client is at. This is where the bottom of the client's body is located,
   * floored to the voxel coordinate.
   */
  get voxel() {
    const [x, y, z] = this.body.getPosition();

    return ChunkUtils.mapWorldToVoxel([
      x,
      y - this.options.bodyHeight * 0.5,
      z,
    ]);
  }

  /**
   * The 3D world coordinates that the client is at. This is where the bottom of the client's body is located.
   */
  get position() {
    const position = new Vector3(...this.body.getPosition());
    position.y -= this.options.bodyHeight * 0.5;
    return position;
  }

  /**
   * The chunk that the client is situated in.
   */
  get chunk() {
    return ChunkUtils.mapVoxelToChunk(this.voxel, this.world.options.chunkSize);
  }

  /**
   * Move the client's rigid body according to the current movement state.
   */
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
    state.sprinting = this.options.alwaysSprint ? true : sprint;

    // means landed, no more fly
    if (!this.ghostMode) {
      if (this.body.gravityMultiplier === 0 && this.body.atRestY === -1) {
        this.body.gravityMultiplier = 1;
      }
    }

    this.body.isCliffHanging = state.crouching;
  };

  /**
   * Update the rigid body by the physics engine.
   */
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
    } = this.options;

    if (this.body.gravityMultiplier) {
      // ladder climbing
      if (this.body.onClimbable) {
        const climbSpeed = 4.5;
        const slowDescentSpeed = 2.0;
        const ladderDamping = 0.8;
        const verticalSmoothing = 0.25;

        const pressingIntoLadder =
          this.body.resting[0] !== 0 || this.body.resting[2] !== 0;

        let targetVelocityY: number;
        if (this.state.jumping) {
          targetVelocityY = climbSpeed;
        } else if (pressingIntoLadder && this.body.climbableAbove) {
          targetVelocityY = climbSpeed;
        } else if (this.state.crouching || pressingIntoLadder) {
          targetVelocityY = 0;
        } else {
          targetVelocityY = -slowDescentSpeed;
        }

        this.body.velocity[1] +=
          (targetVelocityY - this.body.velocity[1]) * verticalSmoothing;

        if (!this.state.running) {
          this.body.velocity[0] *= ladderDamping;
          this.body.velocity[2] *= ladderDamping;
        }
      }

      // jumping
      const onGround = this.body.atRestY < 0;
      const canjump = onGround || this.state.jumpCount < airJumps;
      if (onGround) {
        this.state.isJumping = false;
        this.state.jumpCount = 0;
      }

      // process jump input (skip if on climbable - handled above)
      if (this.state.jumping && !this.body.onClimbable) {
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
      } else if (!this.body.onClimbable) {
        this.state.isJumping = false;
      }

      // apply movement forces if entity is moving, otherwise just friction
      let m = [0, 0, 0];
      let push = [0, 0, 0];
      if (this.state.running) {
        let speed = maxSpeed;
        // todo: add crouch/sprint modifiers if needed
        if (this.state.sprinting) speed *= sprintFactor;
        if (this.state.crouching && this.body.resting[1] === -1)
          speed *= crouchFactor;
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

        // Guard against a zero-length vector which would result in NaN / Infinity
        if (pushLen > 0) {
          push[0] /= pushLen;
          push[1] /= pushLen;
          push[2] /= pushLen;

          // No need to normalise the Y-component – it is always zero for planar movement

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
        // reduce friction when in fluid to allow water current to push
        const fluidFrictionMult = this.body.inFluid ? 0.1 : 1.0;
        this.body.friction = runningFriction * fluidFrictionMult;
      } else {
        const fluidFrictionMult = this.body.inFluid ? 0.1 : 1.0;
        this.body.friction = standingFriction * fluidFrictionMult;
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
        const pushLen = Math.sqrt(push[0] ** 2 + push[2] ** 2);

        // Guard against a zero-length vector which would result in NaN / Infinity
        if (pushLen > 0) {
          push[0] /= pushLen;
          push[2] /= pushLen;

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
        // reduce friction when in fluid to allow water current to push
        const fluidFrictionMultFly = this.body.inFluid ? 0.1 : 1.0;
        this.body.friction = runningFriction * fluidFrictionMultFly;
      } else {
        const fluidFrictionMultFly = this.body.inFluid ? 0.1 : 1.0;
        this.body.friction = standingFriction * fluidFrictionMultFly;
      }
    }

    const [x, y, z] = this.body.getPosition();
    const { eyeHeight, bodyHeight } = this.options;
    this.newPosition.set(x, y + bodyHeight * (eyeHeight - 0.5), z);
  };

  /**
   * The mouse move handler. This is active when the pointer is locked.
   */
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

    this.euler.y -= (movementX * this.options.sensitivity * 0.002) / 100;
    this.euler.x -= (movementY * this.options.sensitivity * 0.002) / 100;

    this.euler.x = Math.max(
      PI_2 - this.options.maxPolarAngle,
      Math.min(PI_2 - this.options.minPolarAngle, this.euler.x)
    );

    this.quaternion.setFromEuler(this.euler);
  };

  /**
   * When the pointer change event is fired, this will be called.
   */
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

  /**
   * This happens when you try to lock the pointer too recently.
   */
  private onPointerlockError = () => {
    console.error("VOXELIZE.RigidControls: Unable to use Pointer Lock API");
  };

  /**
   * Locks the pointer.
   */
  private onDocumentClick = () => {
    if (this.isLocked) return;
    this.lock();
  };

  /**
   * When the pointer is locked, this will be called.
   */
  private onLock = () => {
    this.emit("lock");
  };

  /**
   * When the pointer is unlocked, this will be called.
   */
  private onUnlock = () => {
    this.resetMovements();
    this.emit("unlock");
    this.justUnlocked = true;
  };
}
