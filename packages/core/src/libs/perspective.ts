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
        if (!this.controls?.isLocked) {
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

    const getDistance = () => {
      const dir = new Vector3();
      (this.state === "second" ? object : camera).getWorldDirection(dir);
      dir.normalize();
      dir.multiplyScalar(-1);

      const pos = new Vector3();
      object.getWorldPosition(pos);

      pos.add(dir.clone().multiplyScalar(this.options.blockMargin));

      const result = this.world.raycastVoxels(
        pos.toArray(),
        dir.toArray(),
        this.options.maxDistance,
        {
          ignoreFluids: this.options.ignoreFluids,
          ignoreSeeThrough: this.options.ignoreSeeThrough,
        }
      );

      if (!result) {
        return this.options.maxDistance;
      }

      return pos.distanceTo(new Vector3(...result.point));
    };

    switch (this.state) {
      case "first": {
        break;
      }
      case "second": {
        const newPos = camera.position.clone();
        newPos.z = -getDistance();
        camera.position.lerp(newPos, this.options.lerpFactor);
        camera.lookAt(object.position);
        break;
      }
      case "third": {
        const newPos = camera.position.clone();
        newPos.z = getDistance();
        camera.position.lerp(newPos, this.options.lerpFactor);
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

    camera.quaternion.set(0, 0, 0, 0);

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
