import { Vector3 } from "three";

import { RigidControls } from "../core/controls";
import { Inputs } from "../core/inputs";
import { World } from "../core/world";

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
   * The margin between the camera and any block that the camera is colliding with.
   * This prevents the camera from clipping into blocks. Defaults to `0.3`.
   */
  blockMargin: number;

  /**
   * The lerping factor for the camera's position. Defaults to `0.5`.
   */
  lerpFactor: number;

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
  blockMargin: 0.3,
  lerpFactor: 0.5,
  ignoreSeeThrough: true,
  ignoreFluids: true,
};

const normalizeNonNegativeFinite = (value: number, fallback: number) =>
  Number.isFinite(value) && value >= 0 ? value : fallback;
const normalizeFinite = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;
const areFinite3 = (x: number, y: number, z: number) =>
  Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);

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
  public inputs?: Inputs;

  /**
   * The internal state of the perspective.
   */
  private _state: "first" | "second" | "third" = "first";

  /**
   * A cache to save the first person camera position.
   */
  private firstPersonPosition = new Vector3();
  private raycastDirection = new Vector3();
  private raycastOrigin = new Vector3();
  private raycastOriginCoords: [number, number, number] = [0, 0, 0];
  private raycastDirectionCoords: [number, number, number] = [0, 0, 0];
  private targetCameraPosition = new Vector3();

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
    options: Partial<PerspectiveOptions> = {}
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
        if (!this.controls.isLocked) {
          return;
        }
        this.toggle();
      },
      namespace,
      {
        identifier: Perspective.INPUT_IDENTIFIER,
        checkType: "code",
      }
    );

    const unbindF5 = inputs.bind("F5", () => this.toggle(true), namespace, {
      identifier: Perspective.INPUT_IDENTIFIER,
      checkType: "code",
    });

    this.inputs = inputs;

    return () => {
      try {
        unbindKeyC();
      } catch {}
      try {
        unbindF5();
      } catch {}
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
  private getDistance() {
    const maxDistance = normalizeNonNegativeFinite(
      this.options.maxDistance,
      defaultOptions.maxDistance
    );
    const { object, camera } = this.controls;
    const dir = this.raycastDirection;
    (this.state === "second" ? object : camera).getWorldDirection(dir);
    dir.normalize();
    dir.multiplyScalar(-1);
    if (!areFinite3(dir.x, dir.y, dir.z)) {
      return maxDistance;
    }

    const pos = this.raycastOrigin;
    object.getWorldPosition(pos);
    const blockMargin = normalizeNonNegativeFinite(
      this.options.blockMargin,
      defaultOptions.blockMargin
    );
    pos.addScaledVector(dir, blockMargin);
    if (!areFinite3(pos.x, pos.y, pos.z)) {
      return maxDistance;
    }

    const raycastOrigin = this.raycastOriginCoords;
    raycastOrigin[0] = pos.x;
    raycastOrigin[1] = pos.y;
    raycastOrigin[2] = pos.z;

    const raycastDirection = this.raycastDirectionCoords;
    raycastDirection[0] = dir.x;
    raycastDirection[1] = dir.y;
    raycastDirection[2] = dir.z;

    const result = this.world.raycastVoxels(
      raycastOrigin,
      raycastDirection,
      maxDistance,
      {
        ignoreFluids: this.options.ignoreFluids,
        ignoreSeeThrough: this.options.ignoreSeeThrough,
      }
    );

    if (!result) {
      return maxDistance;
    }

    const dx = pos.x - result.point[0];
    const dy = pos.y - result.point[1];
    const dz = pos.z - result.point[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return normalizeNonNegativeFinite(distance, maxDistance);
  }

  update = () => {
    const { object, camera } = this.controls;
    const state = this.state;
    const lerpFactor = normalizeFinite(
      this.options.lerpFactor,
      defaultOptions.lerpFactor
    );

    const character = this.controls.character;
    if (character) {
      const shouldShowCharacter = state !== "first";
      if (character.visible !== shouldShowCharacter) {
        character.visible = shouldShowCharacter;
      }
    }

    const arm = this.controls.arm;
    if (arm) {
      const shouldShowArm = state === "first";
      if (arm.visible !== shouldShowArm) {
        arm.visible = shouldShowArm;
      }
    }

    switch (state) {
      case "first": {
        break;
      }
      case "second": {
        const newPos = this.targetCameraPosition;
        newPos.copy(camera.position);
        newPos.z = -this.getDistance();
        camera.position.lerp(newPos, lerpFactor);
        camera.lookAt(object.position);
        break;
      }
      case "third": {
        const newPos = this.targetCameraPosition;
        newPos.copy(camera.position);
        newPos.z = this.getDistance();
        camera.position.lerp(newPos, lerpFactor);
        break;
      }
    }
  };

  /**
   * Setter for the perspective's state. This will call {@link Perspective.onChangeState} if it is implemented.
   */
  set state(state: "first" | "second" | "third") {
    const { camera } = this.controls;

    if (state === "first") {
      camera.position.copy(this.firstPersonPosition);
    } else {
      camera.position.set(0, 0, 0);
    }

    camera.quaternion.identity();

    if (state !== this._state) {
      this.onChangeState?.(state);
      this._state = state;
    }
  }

  /**
   * Getter for the perspective's state.
   */
  get state() {
    return this._state;
  }
}
