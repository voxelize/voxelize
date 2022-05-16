import { Euler, EventDispatcher, Vector3, Group } from "three";

import { Client } from "..";
import { Coords3 } from "../types";

const _euler = new Euler(0, 0, 0, "YXZ");
const _vector = new Vector3();

const _changeEvent = { type: "change" };
const _lockEvent = { type: "lock" };
const _unlockEvent = { type: "unlock" };

const _PI_2 = Math.PI / 2;

type ControlsParams = {
  sensitivity: number;
  acceleration: number;
  flyingInertia: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  initialPosition: Coords3;
};

const defaultParams: ControlsParams = {
  sensitivity: 100,
  acceleration: 1.6,
  flyingInertia: 5,
  minPolarAngle: Math.PI * 0.01,
  maxPolarAngle: Math.PI * 0.99,
  initialPosition: [0, 20, 10],
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

  /**
   * Flag indicating whether pointerlock controls have control over mouse
   *
   * @memberof Controls
   */
  public isLocked = false;

  private acc = new Vector3();
  private vel = new Vector3();
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

    this.params = { ...defaultParams, ...options };

    this.object.add(client.camera.threeCamera);
    client.rendering.scene.add(this.object);

    client.on("initialized", this.connect);

    this.setPosition(...this.params.initialPosition);
  }

  /**
   * Update for the camera of the game, does the following:
   * - Move `controls.object` around according to input
   *
   * @memberof Controls
   */
  update = () => {
    const { delta } = this.client.clock;

    const { right, left, up, down, front, back } = this.movements;
    const { acceleration, flyingInertia } = this.params;

    const movementVec = new Vector3();
    movementVec.x = Number(right) - Number(left);
    movementVec.z = Number(front) - Number(back);
    movementVec.normalize();

    const yMovement = Number(up) - Number(down);

    this.acc.x = -movementVec.x * acceleration;
    this.acc.y = yMovement * acceleration;
    this.acc.z = -movementVec.z * acceleration;

    this.vel.x -= this.vel.x * flyingInertia * delta;
    this.vel.y -= this.vel.y * flyingInertia * delta;
    this.vel.z -= this.vel.z * flyingInertia * delta;

    this.vel.add(this.acc.multiplyScalar(delta));
    this.acc.set(0, 0, 0);

    this.moveRight(-this.vel.x);
    this.moveForward(-this.vel.z);

    this.object.position.y += this.vel.y;
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
    this.object.position.set(x, y, z);
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
