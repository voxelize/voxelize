import { Euler, PerspectiveCamera, Quaternion } from "three";

import { RigidControls, RigidControlsOptions } from "./controls";
import { World } from "./world";

/**
 * Mobile-specific rigid body controls for touch-based input.
 * Extends RigidControls but removes pointer lock and keyboard bindings,
 * instead exposing methods for joystick, jump button, and touch-look input.
 *
 * @category Core
 */
export class MobileRigidControls extends RigidControls {
  private mobileEuler = new Euler(0, 0, 0, "YXZ");
  private mobileQuaternion = new Quaternion();

  /**
   * Construct mobile rigid body controls with touch-based input.
   *
   * @param camera The camera to apply the controls to.
   * @param domElement The DOM element (not used for pointer lock on mobile).
   * @param world The world to apply the controls to.
   * @param options The options to initialize the controls with.
   */
  constructor(
    camera: PerspectiveCamera,
    domElement: HTMLElement,
    world: World,
    options: Partial<RigidControlsOptions> = {}
  ) {
    super(camera, domElement, world, options);

    this.isLocked = true;
    this.options.alwaysSprint = true;
  }

  /**
   * Set movement direction from joystick input.
   * Converts normalized joystick coordinates to movement flags.
   *
   * @param x Horizontal input [-1, 1], where -1 is left, 1 is right
   * @param y Vertical input [-1, 1], where -1 is down/back, 1 is up/front
   */
  setMovementVector = (x: number, y: number) => {
    const threshold = 0.1;

    this.movements.left = x < -threshold;
    this.movements.right = x > threshold;
    this.movements.front = y > threshold;
    this.movements.back = y < -threshold;
  };

  /**
   * Set jump state from button input.
   *
   * @param pressed Whether the jump button is currently pressed
   */
  setJumping = (pressed: boolean) => {
    this.movements.up = pressed;
  };

  /**
   * Update camera rotation from touch drag input.
   * Mimics mouse movement for looking around.
   *
   * @param deltaX Horizontal touch movement in pixels
   * @param deltaY Vertical touch movement in pixels
   */
  setLookDirection = (deltaX: number, deltaY: number) => {
    if (!this.isLocked) return;

    const PI_2 = Math.PI / 2;
    const sensitivity = (this.options.sensitivity * 0.012) / 100;

    this.mobileEuler.setFromQuaternion(this.mobileQuaternion);
    this.mobileEuler.y -= deltaX * sensitivity;
    this.mobileEuler.x -= deltaY * sensitivity;
    this.mobileEuler.x = Math.max(
      PI_2 - this.options.maxPolarAngle,
      Math.min(PI_2 - this.options.minPolarAngle, this.mobileEuler.x)
    );

    this.mobileQuaternion.setFromEuler(this.mobileEuler);

    (this as any).quaternion.copy(this.mobileQuaternion);
  };

  /**
   * Reset all movement flags to false.
   * Useful when exiting play mode or pausing.
   */
  resetMovements = () => {
    this.movements.up = false;
    this.movements.down = false;
    this.movements.left = false;
    this.movements.right = false;
    this.movements.front = false;
    this.movements.back = false;
    this.movements.sprint = false;
  };

  lock = () => {
    // No-op for mobile
  };

  unlock = () => {
    // No-op for mobile
  };

  connect = () => {
    return () => {};
  };
}
