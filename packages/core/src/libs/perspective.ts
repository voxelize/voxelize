import { Timer, Vector3 } from "three";

import { RigidControls } from "../core/controls";
import { Inputs } from "../core/inputs";
import { World } from "../core/world";

/**
 * The frame rate the zoom lerp factors are authored at. Each factor is the
 * fraction of the remaining distance closed per frame at this rate and is
 * renormalized to the real frame time, so the camera settles at the same
 * wall-clock speed on every display.
 */
const LERP_REFERENCE_FPS = 60;

/**
 * Parameters to create a new {@link Perspective} instance.
 */
export type PerspectiveOptions = {
  /**
   * The maximum distance the camera can go from the player's center.
   * Defaults to `5`.
   */
  maxDistance: number;

  /**
   * Extra camera distance while swimming in second/third person. Defaults to `3`.
   */
  swimDistanceBonus: number;

  /**
   * The margin between the camera and any block that the camera is colliding with.
   * This prevents the camera from clipping into blocks. Defaults to `0.3`.
   */
  blockMargin: number;

  /**
   * Per-frame factor (at 60 fps) the camera closes toward a *nearer*
   * obstruction. High, so a wall swinging in behind the player never shows
   * the inside of a block. Defaults to `0.85`.
   */
  zoomInLerp: number;

  /**
   * Per-frame factor (at 60 fps) the camera eases back *out* once an
   * obstruction clears. Low on purpose: the voxel raycast behind the player
   * flips between hit and miss in discrete steps as they walk past posts,
   * trunks, and canopy gaps, and a symmetric fast lerp turned every flip
   * into a visible zoom pump. Snapping in and gliding out merges those into
   * one dip. Defaults to `0.12`.
   */
  zoomOutLerp: number;

  /**
   * Seconds the view must stay clear before the camera starts easing back
   * out. A gap in a fence or canopy shorter than this never moves the camera
   * at all, so a row of posts behind the player reads as one obstruction
   * rather than a pump per post. Defaults to `0.25`.
   */
  zoomOutDelay: number;

  /**
   * Whether or not should the camera ignore see-through block collisions. Defaults to `true`.
   */
  ignoreSeeThrough: boolean;

  /**
   * Whether or not should the camera ignore fluid block collisions. Defaults to `true`.
   */
  ignoreFluids: boolean;
};

const defaultOptions: PerspectiveOptions = {
  maxDistance: 5,
  swimDistanceBonus: 3,
  blockMargin: 0.3,
  zoomInLerp: 0.85,
  zoomOutLerp: 0.12,
  zoomOutDelay: 0.25,
  ignoreSeeThrough: true,
  ignoreFluids: true,
};

/**
 * A class that allows you to switch between first, second and third person perspectives for
 * a {@link RigidControls} instance. By default, the key to switch between perspectives is <kbd>C</kbd>.
 *
 * # Example
 * ```ts
 * // Initialize the perspective with the rigid controls.
 * const perspective = new VOXELIZE.Perspective(controls, world);
 *
 * // Bind the keyboard inputs to switch between perspectives.
 * perspective.connect(inputs, "in-game");
 *
 * // Switch to the first person perspective.
 * perspective.state = "third";
 *
 * // Update the perspective every frame.
 * perspective.update();
 * ```
 */
export class Perspective {
  /**
   * Parameters to configure the perspective.
   */
  public options: PerspectiveOptions;

  /**
   * The rigid controls that this perspective instance is attached to.
   */
  public controls: RigidControls;

  /**
   * The world that this perspective instance is working with.
   */
  public world: World;

  /**
   * The input manager that binds the perspective's keyboard inputs.
   */
  public inputs?: Inputs<any>;

  /**
   * The internal state of the perspective.
   */
  private _state: "first" | "second" | "third" = "first";

  /**
   * A cache to save the first person camera position.
   */
  private firstPersonPosition = new Vector3();

  /**
   * Frame clock for renormalizing the zoom lerps to the real frame time.
   */
  private timer = new Timer();

  /**
   * Seconds the unobstructed distance has been farther than the camera sits.
   */
  private _clearFor = 0;

  private _rayDirection = new Vector3();

  private _rayOrigin = new Vector3();

  private _hitPoint = new Vector3();

  /**
   * This is the identifier that is used to bind the perspective's keyboard inputs
   * when {@link Perspective.connect} is called.
   */
  public static readonly INPUT_IDENTIFIER = "voxelize-perspective";

  /**
   * Create a new perspective instance that is attached to the given rigid controls. The default
   * perspective is the first person perspective.
   *
   * @param controls The rigid controls that this perspective instance is attached to.
   * @param world The world that this perspective instance is working with.
   * @param options Parameters to configure the perspective.
   */
  constructor(
    controls: RigidControls,
    world: World,
    options: Partial<PerspectiveOptions> = {},
  ) {
    if (!controls) {
      throw new Error("Perspective: invalid rigid controls.");
    }

    if (!world) {
      throw new Error("Perspective: invalid world.");
    }

    this.controls = controls;
    this.world = world;

    this.options = {
      ...defaultOptions,
      ...options,
    };

    this.firstPersonPosition.copy(this.controls.camera.position);

    this.state = "first";
  }

  /**
   * A method that can be implemented and is called when the perspective's state changes.
   */
  onChangeState: (state: "first" | "second" | "third") => void;

  /**
   * Connect the perspective to the given input manager. This will bind the perspective's keyboard inputs, which
   * by default is <kbd>C</kbd> to switch between perspectives. This function returns a function that when called
   * unbinds the perspective's keyboard inputs. Keep in mind that remapping the original inputs will render this
   * function useless.
   *
   * @param inputs The {@link Inputs} instance to bind the perspective's keyboard inputs to.
   * @param namespace The namespace to bind the perspective's keyboard inputs to.
   */
  connect = (inputs: Inputs, namespace = "*") => {
    const unbindKeyC = inputs.bind(
      "KeyC",
      () => {
        if (!this.controls?.isLocked) {
          return;
        }
        this.toggle();
      },
      namespace,
      {
        identifier: Perspective.INPUT_IDENTIFIER,
        checkType: "code",
      },
    );

    // no clue why but this seems to work, f5 seems to be reversed
    const unbindF5 = inputs.bind("F5", () => this.toggle(true), namespace, {
      identifier: Perspective.INPUT_IDENTIFIER,
      checkType: "code",
    });

    this.inputs = inputs;

    return () => {
      try {
        unbindKeyC();
        unbindF5();
      } catch (e) {
        // Ignore.
      }
    };
  };

  /**
   * Toggle between the first, second and third person perspectives. The order goes from first person to
   * third person and then to second person.
   */
  toggle = (inverse = false) => {
    if (inverse) {
      switch (this.state) {
        case "first":
          this.state = "second";
          break;
        case "second":
          this.state = "third";
          break;
        case "third":
          this.state = "first";
          break;
      }
    } else {
      switch (this.state) {
        case "first":
          this.state = "third";
          break;
        case "second":
          this.state = "first";
          break;
        case "third":
          this.state = "second";
          break;
      }
    }
  };

  /**
   * This updates the perspective. Internally, if the perspective isn't in first person, it raycasts to find the closest
   * block and then ensures that the camera is not clipping into any blocks.
   */
  update = () => {
    const { object, camera } = this.controls;

    this.timer.update();
    const delta = Math.min(0.1, this.timer.getDelta());

    if (this.controls.character) {
      if (this.state === "first" && this.controls.character.visible) {
        this.controls.character.visible = false;
      } else if (this.state !== "first" && !this.controls.character.visible) {
        this.controls.character.visible = true;
      }
    }

    if (this.controls.arm) {
      if (this.state === "first" && !this.controls.arm.visible) {
        this.controls.arm.visible = true;
      } else if (this.state !== "first" && this.controls.arm.visible) {
        this.controls.arm.visible = false;
      }
    }

    switch (this.state) {
      case "first": {
        break;
      }
      case "second": {
        camera.position.z = -this.easeDistance(-camera.position.z, delta);
        camera.lookAt(object.position);
        break;
      }
      case "third": {
        camera.position.z = this.easeDistance(camera.position.z, delta);
        break;
      }
    }
  };

  /**
   * The unobstructed distance the camera may sit from the eye along the
   * current view axis: the max distance, or up to the block margin short
   * of the first solid voxel the backward raycast hits.
   */
  private getDistance = () => {
    const { object, camera } = this.controls;
    const dir = this._rayDirection;
    (this.state === "second" ? object : camera).getWorldDirection(dir);
    dir.normalize();
    dir.multiplyScalar(-1);

    const pos = this._rayOrigin;
    object.getWorldPosition(pos);
    pos.addScaledVector(dir, this.options.blockMargin);

    const maxDistance =
      this.options.maxDistance +
      (this.controls.isSwimming ? this.options.swimDistanceBonus : 0);

    const result = this.world.raycastVoxels(
      pos.toArray(),
      dir.toArray(),
      maxDistance,
      {
        ignoreFluids: this.options.ignoreFluids,
        ignoreSeeThrough: this.options.ignoreSeeThrough,
      },
    );

    if (!result) {
      return maxDistance;
    }

    const distance = pos.distanceTo(this._hitPoint.fromArray(result.point));
    // A non-finite hit would put the camera — and with it the audio listener
    // and everything else read off the camera — at NaN for good.
    return Number.isFinite(distance)
      ? Math.min(distance, maxDistance)
      : maxDistance;
  };

  /**
   * One frame of the camera distance easing toward the unobstructed
   * distance: fast when the target is nearer (an obstruction must never be
   * seen from inside); when it is farther, hold for `zoomOutDelay` and then
   * glide, so a cleared obstruction eases away instead of pumping. Both
   * factors are renormalized to `delta`.
   */
  private easeDistance = (current: number, delta: number) => {
    const target = this.getDistance();

    if (target < current) {
      this._clearFor = 0;
      return (
        current +
        (target - current) *
          this.lerpFactorForDelta(this.options.zoomInLerp, delta)
      );
    }

    this._clearFor += delta;
    if (this._clearFor < this.options.zoomOutDelay) return current;

    return (
      current +
      (target - current) *
        this.lerpFactorForDelta(this.options.zoomOutLerp, delta)
    );
  };

  private lerpFactorForDelta = (baseFactor: number, delta: number) =>
    1 - Math.pow(1 - baseFactor, delta * LERP_REFERENCE_FPS);

  /**
   * Setter for the perspective's state. This will call {@link Perspective.onChangeState} if it is implemented.
   */
  set state(state: "first" | "second" | "third") {
    const { camera } = this.controls;

    camera.quaternion.set(0, 0, 0, 0);

    if (state !== this._state) {
      this.onChangeState?.(state);
      this._state = state;
    }

    if (state === "first") {
      camera.position.copy(this.firstPersonPosition);
      return;
    }

    // Seat the camera at its unobstructed distance right away: the zoom-out
    // ease is deliberately slow, and a toggle should not spend half a second
    // pulling back from inside the player's head.
    camera.position.set(0, 0, 0);
    const distance = this.getDistance();
    camera.position.z = state === "second" ? -distance : distance;
  }

  /**
   * Getter for the perspective's state.
   */
  get state() {
    return this._state;
  }
}
