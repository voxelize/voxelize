import { AABB, RigidBody } from "@voxelize/voxel-physics-engine";
import {
  Euler,
  EventDispatcher,
  Vector3,
  Group,
  Mesh,
  MeshBasicMaterial,
  Color,
  BoxBufferGeometry,
} from "three";

import { Client } from "..";
import { raycast } from "../libs";
import { Coords3 } from "../types";
import { ChunkUtils } from "../utils";

const _euler = new Euler(0, 0, 0, "YXZ");
const _vector = new Vector3();

const _changeEvent = { type: "change" };
const _lockEvent = { type: "lock" };
const _unlockEvent = { type: "unlock" };

const _PI_2 = Math.PI / 2;

const PY_ROTATION = 0;
const NY_ROTATION = 1;
const PX_ROTATION = 2;
const NX_ROTATION = 3;
const PZ_ROTATION = 4;
const NZ_ROTATION = 5;

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

type BrainStateType = {
  heading: number; // radians, heading location
  running: boolean;
  jumping: boolean;
  sprinting: boolean;
  crouching: boolean;

  // internal state
  jumpCount: number;
  isJumping: boolean;
  currentJumpTime: number;
};

const defaultBrainState: BrainStateType = {
  heading: 0,
  running: false,
  jumping: false,
  sprinting: false,
  crouching: false,

  jumpCount: 0,
  isJumping: false,
  currentJumpTime: 0,
};

type ControlsParams = {
  sensitivity: number;
  acceleration: number;
  flyingInertia: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  lookBlockScale: number;
  lookBlockColor: string;
  lookBlockLerp: number;
  reachDistance: number;
  initialPosition: Coords3;

  bodyWidth: number;
  bodyHeight: number;
  bodyDepth: number;
  eyeHeight: number;

  maxSpeed: number;
  moveForce: number;
  responsiveness: number;
  runningFriction: number;
  standingFriction: number;

  flySpeed: number;
  flyForce: number;
  flyImpulse: number;
  flyInertia: number;

  sprintFactor: number;
  airMoveMult: number;
  jumpImpulse: number;
  jumpForce: number;
  jumpTime: number; // ms
  airJumps: number;
};

const defaultParams: ControlsParams = {
  sensitivity: 100,
  acceleration: 1.6,
  flyingInertia: 5,
  minPolarAngle: Math.PI * 0.01,
  maxPolarAngle: Math.PI * 0.99,
  lookBlockScale: 1.002,
  lookBlockLerp: 1,
  lookBlockColor: "black",
  reachDistance: 32,
  initialPosition: [0, 80, 10],

  bodyWidth: 0.8,
  bodyHeight: 1.8,
  bodyDepth: 0.8,
  eyeHeight: 0.8,

  maxSpeed: 6,
  moveForce: 30,
  responsiveness: 240,
  runningFriction: 0.1,
  standingFriction: 4,

  flySpeed: 20,
  flyForce: 60,
  flyImpulse: 0.8,
  flyInertia: 3,

  sprintFactor: 1.4,
  airMoveMult: 0.7,
  jumpImpulse: 8,
  jumpForce: 1,
  jumpTime: 50,
  airJumps: Infinity,
};

/**
 * Inspired by THREE.JS's PointerLockControls, the main control of the game
 * so that the player can move freely around the world
 *
 * @class Controls
 * @extends {EventDispatcher}
 */
class Controls extends EventDispatcher {
  /**
   * An object storing parameters passed on `Controls` construction
   *
   * @type {ControlsParams}
   * @memberof Controls
   */
  public params: ControlsParams;

  /**
   * A THREE.JS object, parent to the camera for pointerlock controls
   *
   * @memberof Controls
   */
  public object = new Group();

  public state: BrainStateType = defaultBrainState;

  /**
   * Flag indicating whether pointerlock controls have control over mouse
   *
   * @memberof Controls
   */
  public isLocked = false;

  public body: RigidBody;

  public lookBlock: Coords3 | null = [0, 0, 0];
  public targetBlock: {
    voxel: Coords3;
    rotation: number;
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

  constructor(public client: Client, options: Partial<ControlsParams> = {}) {
    super();

    const { bodyWidth, bodyHeight, bodyDepth } = (this.params = {
      ...defaultParams,
      ...options,
    });

    this.object.add(client.camera.threeCamera);
    client.rendering.scene.add(this.object);

    client.on("initialized", () => {
      this.setupLookBlock();
      this.setupListeners();

      this.body = client.physics.core.addBody({
        aabb: new AABB(0, 0, 0, bodyWidth, bodyHeight, bodyDepth),
      });

      this.setPosition(...this.params.initialPosition);
    });
  }

  /**
   * Update for the camera of the game, does the following:
   * - Move `controls.object` around according to input
   *
   * @memberof Controls
   */
  update = () => {
    this.moveRigidBody();
    this.updateRigidBody();
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
   * @memberof Controls
   */
  connect = () => {
    this.client.container.domElement.ownerDocument.addEventListener(
      "mousemove",
      this.onMouseMove
    );
    this.client.container.domElement.ownerDocument.addEventListener(
      "pointerlockchange",
      this.onPointerlockChange
    );
    this.client.container.domElement.ownerDocument.addEventListener(
      "pointerlockerror",
      this.onPointerlockError
    );

    this.client.container.canvas.addEventListener("click", this.onCanvasClick);

    document.addEventListener("keydown", this.onKeyDown, false);
    document.addEventListener("keyup", this.onKeyUp, false);

    this.addEventListener("lock", this.onLock);
    this.addEventListener("unlock", this.onUnlock);
  };

  /**
   * Removes all event listeners for controls, including:
   * - Mouse move event
   * - Pointer-lock events
   * - Canvas click event
   * - Key up/down events
   * - Control lock/unlock events
   *
   * @memberof Controls
   */
  disconnect = () => {
    this.client.container.domElement.ownerDocument.removeEventListener(
      "mousemove",
      this.onMouseMove
    );
    this.client.container.domElement.ownerDocument.removeEventListener(
      "pointerlockchange",
      this.onPointerlockChange
    );
    this.client.container.domElement.ownerDocument.removeEventListener(
      "pointerlockerror",
      this.onPointerlockError
    );

    this.client.container.canvas.removeEventListener(
      "click",
      this.onCanvasClick
    );

    document.removeEventListener("keydown", this.onKeyDown, false);
    document.removeEventListener("keyup", this.onKeyUp, false);

    this.removeEventListener("lock", this.onLock);
    this.removeEventListener("unlock", this.onUnlock);
  };

  /**
   * Disposal of `Controls`, disconnects all event listeners
   *
   * @memberof Controls
   */
  dispose = () => {
    this.disconnect();
  };

  getDirection = (() => {
    const v = new Vector3();
    const direction = new Vector3(0, 0, -1);

    return () => {
      return v
        .copy(direction)
        .applyQuaternion(this.object.quaternion)
        .normalize();
    };
  })();

  moveForward = (distance: number) => {
    // move forward parallel to the xz-plane
    // assumes camera.up is y-up

    _vector.setFromMatrixColumn(this.object.matrix, 0);

    _vector.crossVectors(this.object.up, _vector);

    this.object.position.addScaledVector(_vector, distance);
  };

  moveRight = (distance: number) => {
    _vector.setFromMatrixColumn(this.object.matrix, 0);

    this.object.position.addScaledVector(_vector, distance);
  };

  lock = (callback?: () => void) => {
    this.client.container.domElement.requestPointerLock();

    if (callback) {
      this.lockCallback = callback;
    }
  };

  unlock = (callback?: () => void) => {
    this.client.container.domElement.ownerDocument.exitPointerLock();

    if (callback) {
      this.unlockCallback = callback;
    }
  };

  setPosition = (x: number, y: number, z: number) => {
    const { eyeHeight, bodyHeight } = this.params;
    this.object.position.set(x, y + bodyHeight * (eyeHeight - 0.5), z);
    this.body.setPosition([x, y, z]);
  };

  lookAt = (x: number, y: number, z: number) => {
    const vec = this.object.position
      .clone()
      .add(this.object.position.clone().sub(new Vector3(x, y, z)));
    this.object.lookAt(vec);
  };

  reset = () => {
    this.setPosition(...this.params.initialPosition);
    this.object.rotation.set(0, 0, 0);
  };

  toggleGhostMode = () => {
    const { aabb } = this.body;
    const [px, py, pz] = this.position;
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

  get ghostMode() {
    return this.body.aabb.width <= 0;
  }

  get position() {
    return this.body.getPosition() as Coords3;
  }

  get voxel() {
    return ChunkUtils.mapWorldPosToVoxelPos(
      this.position,
      this.client.world.params.dimension
    );
  }

  get chunk() {
    return ChunkUtils.mapVoxelPosToChunkPos(
      this.voxel,
      this.client.world.params.chunkSize
    );
  }

  private setupLookBlock = () => {
    const { lookBlockScale, lookBlockColor } = this.params;
    const { rendering } = this.client;

    this.lookBlockMesh = new Group();

    const mat = new MeshBasicMaterial({
      color: new Color(lookBlockColor),
      opacity: 0.3,
      transparent: true,
    });

    const w = 0.01;
    const dim = lookBlockScale;
    const side = new Mesh(new BoxBufferGeometry(dim, w, w), mat);

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

        temp.position.x = ((dim - w) / 2) * i;
        temp.position.y = ((dim - w) / 2) * j;
        temp.rotation.y = Math.PI / 2;

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

    this.lookBlockMesh.frustumCulled = false;
    this.lookBlockMesh.renderOrder = 1000000;

    rendering.scene.add(this.lookBlockMesh);
  };

  private setupListeners = () => {
    const { inputs, chunks } = this.client;

    this.connect();

    inputs.click(
      "left",
      () => {
        if (!this.lookBlock) return;
        const [vx, vy, vz] = this.lookBlock;
        chunks.setVoxelByVoxel(vx, vy, vz, 0);
      },
      "in-game"
    );

    inputs.click(
      "right",
      () => {
        if (!this.targetBlock) return;
        const [vx, vy, vz] = this.targetBlock.voxel;
        chunks.setVoxelByVoxel(
          vx,
          vy,
          vz,
          this.client.registry.getBlockByName("Stone").id
        );
      },
      "in-game"
    );

    const toggleFly = () => {
      if (!this.ghostMode) {
        const isFlying = this.body.gravityMultiplier === 0;
        this.body.gravityMultiplier = isFlying ? 1 : 0;
      }
    };
    inputs.bind("f", toggleFly, "in-game");

    let lastSpace = -1;
    inputs.bind(
      "space",
      () => {
        let now = performance.now();
        if (now - lastSpace < 250) {
          toggleFly();
          now = 0;
        }
        lastSpace = now;
      },
      "in-game",
      { occasion: "keyup" }
    );

    inputs.bind("g", this.toggleGhostMode, "in-game");
  };

  private updateLookBlock = () => {
    const disableLookBlock = () => {
      this.lookBlockMesh.visible = false;
      this.lookBlock = null;
      this.targetBlock = null;
    };

    if (this.ghostMode) {
      disableLookBlock();
      return;
    }

    const { world, camera, chunks } = this.client;
    const { dimension, maxHeight } = world.params;
    const { reachDistance, lookBlockLerp } = this.params;

    const camDir = new Vector3();
    const camPos = this.object.position;
    camera.threeCamera.getWorldDirection(camDir);
    camDir.normalize();

    const point: Coords3 = [0, 0, 0];
    const normal: Coords3 = [0, 0, 0];

    const result = raycast(
      (x, y, z) => {
        const vCoords = ChunkUtils.mapWorldPosToVoxelPos([x, y, z], dimension);
        const type = chunks.getVoxelByVoxel(...vCoords);

        return y < maxHeight * dimension && type !== 0;
      },
      [camPos.x, camPos.y, camPos.z],
      [camDir.x, camDir.y, camDir.z],
      reachDistance * dimension,
      point,
      normal
    );

    // No target.
    if (!result) {
      disableLookBlock();
      return;
    }

    const flooredPoint = point.map(
      (n, i) => Math.floor(parseFloat(n.toFixed(3))) - Number(normal[i] > 0)
    );

    const [nx, ny, nz] = normal;
    const newLookBlock = ChunkUtils.mapWorldPosToVoxelPos(
      <Coords3>flooredPoint,
      world.params.dimension
    );

    // Pointing at air.
    if (this.client.chunks.getVoxelByVoxel(...newLookBlock) === 0) {
      disableLookBlock();
      return;
    }

    this.lookBlockMesh.visible = true;

    const [lbx, lby, lbz] = newLookBlock;
    this.lookBlockMesh.position.lerp(
      new Vector3(
        lbx * dimension + 0.5 * dimension,
        lby * dimension + 0.5 * dimension,
        lbz * dimension + 0.5 * dimension
      ),
      lookBlockLerp
    );

    this.lookBlock = newLookBlock;

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

    this.targetBlock = {
      voxel: [
        this.lookBlock[0] + nx,
        this.lookBlock[1] + ny,
        this.lookBlock[2] + nz,
      ],
      rotation,
      yRotation: 0,
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
    state.jumping = up ? (down ? false : true) : down ? false : false;

    // crouch to true, so far used for flying
    state.crouching = down;

    // apply sprint state change
    state.sprinting = sprint;

    // means landed, no more fly
    if (!this.ghostMode) {
      if (this.body.gravityMultiplier === 0 && this.body.atRestY === -1) {
        this.body.gravityMultiplier = 1;
      }
    }
  };

  private updateRigidBody = () => {
    const {
      airJumps,
      jumpForce,
      jumpTime,
      jumpImpulse,
      maxSpeed,
      sprintFactor,
      moveForce,
      airMoveMult,
      responsiveness,
      runningFriction,
      standingFriction,
      flyInertia,
      flyImpulse,
      flyForce,
      flySpeed,
    } = this.params;

    const { delta: dt } = this.client.clock;

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
        // if (state.crouch) speed *= state.crouchMoveMult
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
        // if (state.crouch) speed *= state.crouchMoveMult
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
    this.object.position.set(x, y + bodyHeight * (eyeHeight - 0.5), z);
  };

  private onKeyDown = ({ code }: KeyboardEvent) => {
    if (!this.isLocked) return;
    if (this.client.inputs.namespace !== "in-game") return;

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
    if (this.client.inputs.namespace !== "in-game") return;

    switch (code) {
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

    const { delta } = this.client.clock;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    _euler.setFromQuaternion(this.object.quaternion);

    _euler.y -= (movementX * this.params.sensitivity * delta) / 1000;
    _euler.x -= (movementY * this.params.sensitivity * delta) / 1000;

    _euler.x = Math.max(
      _PI_2 - this.params.maxPolarAngle,
      Math.min(_PI_2 - this.params.minPolarAngle, _euler.x)
    );

    this.object.quaternion.setFromEuler(_euler);

    this.dispatchEvent(_changeEvent);
  };

  private onPointerlockChange = () => {
    if (
      this.client.container.domElement.ownerDocument.pointerLockElement ===
      this.client.container.domElement
    ) {
      this.dispatchEvent(_lockEvent);

      if (this.lockCallback) {
        this.lockCallback();
      }

      this.isLocked = true;
    } else {
      this.dispatchEvent(_unlockEvent);

      if (this.unlockCallback) {
        this.unlockCallback();
      }

      this.isLocked = false;
    }
  };

  private onPointerlockError = () => {
    console.error("THREE.PointerLockControls: Unable to use Pointer Lock API");
  };

  private onCanvasClick = () => {
    if (this.client.network?.connected) this.lock();
  };

  private onLock = () => {
    this.client.emit("lock");
    this.client.inputs.setNamespace("in-game");
  };

  private onUnlock = () => {
    this.client.emit("unlock");
    this.client.inputs.setNamespace("menu");
  };
}

export type { ControlsParams };

export { Controls };
