import { Euler, EventDispatcher, Vector3, Group } from "three";

import { Client } from "..";

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
};

const defaultParams: ControlsParams = {
  sensitivity: 100,
  acceleration: 0.6,
  flyingInertia: 5,
};

class Controls extends EventDispatcher {
  public params: ControlsParams;

  public object = new Group();

  public isLocked = false;
  public sensitivity = 90;
  public minPolarAngle = Math.PI * 0.01;
  public maxPolarAngle = Math.PI * 0.99;

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

    this.connect();

    this.object.add(this.client.camera.threeCamera);

    client.on("initialized", () => {
      const lockCallback = () => {
        client.emit("lock");
        client.inputs.setNamespace("in-game");
      };

      const unlockCallback = () => {
        client.emit("unlock");
        client.inputs.setNamespace("menu");
      };

      this.addEventListener("lock", lockCallback);
      this.addEventListener("unlock", unlockCallback);
    });

    this.client.rendering.scene.add(this.object);

    this.setPosition(6, 6, 6);
    this.lookAt(0, 0, 0);
  }

  tick = () => {
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

  onKeyDown = ({ code }: KeyboardEvent) => {
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

  onKeyUp = ({ code }: KeyboardEvent) => {
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

  onMouseMove = (event: MouseEvent) => {
    if (this.isLocked === false) return;

    const { delta } = this.client.clock;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    _euler.setFromQuaternion(this.object.quaternion);

    _euler.y -= (movementX * this.sensitivity * delta) / 1000;
    _euler.x -= (movementY * this.sensitivity * delta) / 1000;

    _euler.x = Math.max(
      _PI_2 - this.maxPolarAngle,
      Math.min(_PI_2 - this.minPolarAngle, _euler.x)
    );

    this.object.quaternion.setFromEuler(_euler);

    this.dispatchEvent(_changeEvent);
  };

  onPointerlockChange = () => {
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

  onPointerlockError = () => {
    console.error("THREE.PointerLockControls: Unable to use Pointer Lock API");
  };

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

    this.client.container.canvas.addEventListener("click", (e) => {
      if (this.client.network?.connected) this.lock();
    });

    document.addEventListener("keydown", this.onKeyDown, false);
    document.addEventListener("keyup", this.onKeyUp, false);
  };

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

    document.removeEventListener("keydown", this.onKeyDown, false);
    document.removeEventListener("keyup", this.onKeyUp, false);
  };

  dispose = () => {
    this.disconnect();
  };

  getObject = () => {
    return this.object;
  };

  getDirection = (() => {
    const direction = new Vector3(0, 0, -1);

    return (v: Vector3) => {
      return v.copy(direction).applyQuaternion(this.object.quaternion);
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
}

export type { ControlsParams };

export { Controls };
