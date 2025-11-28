import * as THREE from "three";

import { Inputs } from "../core/inputs";
import { AnimationUtils } from "../utils";

import { CanvasBox } from "./canvas-box";
import { defaultArmsOptions } from "./character";

const ARM_POSITION = new THREE.Vector3(1, -1, -1);
const ARM_QUATERION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 4, 0, -Math.PI / 8)
);
const BLOCK_POSITION = new THREE.Vector3(1.4, -1.4, -2.061);
const BLOCK_QUATERNION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  -Math.PI / 4
);
const ARM_TRANSITION_DURATION = 0.2; // Duration in seconds for arm transition animation

const SWING_TIMES = [0, 0.05, 0.1, 0.15, 0.2, 0.3];

const SWING_POSITIONS_DELTA = [
  new THREE.Vector3(-0.34, 0.23, 0),
  new THREE.Vector3(0, -0.25, 0),
  new THREE.Vector3(0, -0.68, 0),
  new THREE.Vector3(0, -0.3, 0),
];

const generateSwingPositions = (initialPosition: THREE.Vector3) => {
  const positions = [];
  for (let i = 0; i < SWING_POSITIONS_DELTA.length; i++) {
    const nextPosition = (
      i === 0 ? initialPosition.clone() : positions[i - 1].clone()
    ).add(SWING_POSITIONS_DELTA[i]);
    positions.push(nextPosition);
  }
  return positions;
};

const ARM_SWING_POSITIONS = generateSwingPositions(ARM_POSITION);

const BLOCK_SWING_POSITIONS = generateSwingPositions(BLOCK_POSITION);

const SWING_QUATERNIONS = [
  new THREE.Quaternion(-0.41, -0.0746578340503426, 0.21, 0.9061274463528878),
  new THREE.Quaternion(-0.41, -0.0746578340503426, 0.52, 0.9061274463528878),
  new THREE.Quaternion(-0.41, -0.0746578340503426, 0.75, 0.9061274463528878),
  new THREE.Quaternion(
    -0.37533027751786524,
    -0.0746578340503426,
    -0.18023995550173696,
    0.9061274463528878
  ),
];

export type ArmOptions = {
  armObject?: THREE.Object3D;
  armObjectOptions: ArmObjectOptions;
  blockObjectOptions?: ArmObjectOptions;
  armColor?: string | THREE.Color;
  armTexture?: THREE.Texture;
  customObjectOptions?: Record<string, ArmObjectOptions>;
};

type ArmObjectOptions = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  swingPositions?: THREE.Vector3[];
  swingQuaternions?: THREE.Quaternion[];
  swingTimes?: number[];
};

const defaultOptions: ArmOptions = {
  armObject: undefined,
  armObjectOptions: {
    position: ARM_POSITION,
    quaternion: ARM_QUATERION,
    swingPositions: ARM_SWING_POSITIONS,
    swingQuaternions: SWING_QUATERNIONS,
    swingTimes: SWING_TIMES,
  },
  blockObjectOptions: {
    position: BLOCK_POSITION,
    quaternion: BLOCK_QUATERNION,
    swingPositions: BLOCK_SWING_POSITIONS,
    swingQuaternions: SWING_QUATERNIONS,
    swingTimes: SWING_TIMES,
  },
  armColor: defaultArmsOptions.color,
};

export class Arm extends THREE.Group {
  public options: ArmOptions;

  private mixer: THREE.AnimationMixer;

  private armSwingClip: THREE.AnimationClip;

  private blockSwingClip: THREE.AnimationClip;

  private swingAnimation: THREE.AnimationAction;

  private customSwingClips: Record<string, THREE.AnimationClip>;

  /**
   * An internal clock instance for calculating delta time.
   */
  private clock = new THREE.Clock();

  // Animation properties for the arm transition
  private isTransitioning = false;
  private transitionStartTime = 0;
  private transitionDuration = ARM_TRANSITION_DURATION;
  private transitionDirection = 0; // 0: down, 1: up
  private pendingArmObject: THREE.Object3D | undefined;
  private pendingCustomType: string | undefined;
  private initialArmY = 0;
  private targetArmY = 0;
  private currentArmObject: THREE.Object3D | null = null;

  emitSwingEvent: () => void;

  constructor(options: Partial<ArmOptions> = {}) {
    super();

    this.options = {
      ...defaultOptions,
      ...options,
    };

    this.armSwingClip = AnimationUtils.generateClip(
      "armSwing",
      this.options.armObjectOptions?.swingTimes,
      this.options.armObjectOptions?.position,
      this.options.armObjectOptions?.quaternion,
      this.options.armObjectOptions?.swingPositions,
      this.options.armObjectOptions?.swingQuaternions
    );
    this.blockSwingClip = AnimationUtils.generateClip(
      "blockSwing",
      this.options.blockObjectOptions?.swingTimes,
      this.options.blockObjectOptions?.position,
      this.options.blockObjectOptions?.quaternion,
      this.options.blockObjectOptions?.swingPositions,
      this.options.blockObjectOptions?.swingQuaternions
    );

    this.customSwingClips = {};
    for (const [type, options] of Object.entries(
      this.options.customObjectOptions || {}
    )) {
      this.customSwingClips[type] = AnimationUtils.generateClip(
        `customSwing-${type}`,
        options.swingTimes ?? SWING_TIMES,
        options.position,
        options.quaternion,
        options.swingPositions ?? generateSwingPositions(options.position),
        options.swingQuaternions ?? SWING_QUATERNIONS
      );
    }

    this.setArm();
  }

  /**
   * Connect the arm to the given input manager. This will allow the arm to listen to left
   * and right clicks to play arm animations. This function returns a function that when called
   * unbinds the arm's keyboard inputs.
   *
   * @param inputs The {@link Inputs} instance to bind the arm's keyboard inputs to.
   * @param namespace The namespace to bind the arm's keyboard inputs to.
   */
  public connect = (inputs: Inputs, namespace = "*") => {
    const unbindLeftClick = inputs.click("left", this.doSwing, namespace);

    return () => {
      try {
        unbindLeftClick();
      } catch (e) {
        // Ignore.
      }
    };
  };

  /**
   * Set a new object for the arm. If `animate` is true, the transition will be animated.
   *
   * @param object New object for the arm
   * @param animate Whether to animate the transition
   */
  public setArmObject = (
    object: THREE.Object3D | undefined,
    animate: boolean,
    customType?: string
  ) => {
    if (!animate) {
      this.clear();

      if (customType) {
        this.setCustomObject(customType, object);
      } else if (!object) {
        this.setArm();
      } else {
        this.setBlock(object);
      }
    } else {
      this.pendingArmObject = object;
      this.pendingCustomType = customType;

      if (!this.isTransitioning) {
        this.isTransitioning = true;
        this.transitionStartTime = this.clock.elapsedTime;
        this.transitionDirection = 0;

        if (this.children.length > 0) {
          this.currentArmObject = this.children[0] as THREE.Object3D;
          this.initialArmY = this.currentArmObject.position.y;
          this.targetArmY = this.initialArmY - 5;
        }
      } else if (this.transitionDirection === 1) {
        this.transitionDirection = 0;
        this.transitionStartTime = this.clock.elapsedTime;

        if (this.currentArmObject) {
          this.initialArmY = this.currentArmObject.position.y;
          this.targetArmY = this.initialArmY - 5;
        }
      }
    }
  };

  private setArm = () => {
    const arm = new CanvasBox({ width: 0.5, height: 1, depth: 0.3 });

    if (this.options.armTexture) {
      const texture = this.options.armTexture;
      if (texture.image && (texture.image as HTMLImageElement).complete) {
        arm.paint("all", texture);
      } else {
        arm.paint("all", new THREE.Color(this.options.armColor));
        if (texture.image) {
          (texture.image as HTMLImageElement).onload = () => {
            arm.paint("all", texture);
          };
        }
      }
    } else {
      arm.paint("all", new THREE.Color(this.options.armColor));
    }

    arm.position.set(
      this.options.armObjectOptions?.position.x,
      this.options.armObjectOptions?.position.y,
      this.options.armObjectOptions?.position.z
    );
    arm.quaternion.multiply(this.options.armObjectOptions?.quaternion);

    this.mixer = new THREE.AnimationMixer(arm);
    this.swingAnimation = this.mixer.clipAction(this.armSwingClip);
    this.swingAnimation.setLoop(THREE.LoopOnce, 1);
    this.swingAnimation.clampWhenFinished = true;

    this.add(arm);
    this.currentArmObject = arm;
  };

  private setBlock = (object: THREE.Object3D) => {
    object.position.set(
      this.options.blockObjectOptions?.position.x,
      this.options.blockObjectOptions?.position.y,
      this.options.blockObjectOptions?.position.z
    );
    object.quaternion.multiply(this.options.blockObjectOptions?.quaternion);

    this.mixer = new THREE.AnimationMixer(object);
    this.swingAnimation = this.mixer.clipAction(this.blockSwingClip);
    this.swingAnimation.setLoop(THREE.LoopOnce, 1);
    this.swingAnimation.clampWhenFinished = true;

    this.add(object);
    this.currentArmObject = object;
  };

  private setCustomObject = (type: string, object: THREE.Object3D) => {
    const options = this.options.customObjectOptions?.[type];
    if (!options) {
      throw new Error(`No options found for custom object type: ${type}`);
    }

    object.position.set(
      options.position.x,
      options.position.y,
      options.position.z
    );
    object.quaternion.multiply(options.quaternion);

    this.mixer = new THREE.AnimationMixer(object);
    this.swingAnimation = this.mixer.clipAction(this.customSwingClips[type]);
    this.swingAnimation.setLoop(THREE.LoopOnce, 1);
    this.swingAnimation.clampWhenFinished = true;

    this.add(object);
    this.currentArmObject = object;
  };

  /**
   *
   * Update the arm's animation. Note that when a arm is attached to a control,
   * `update` is called automatically within the control's update loop.
   */
  public update() {
    // Normalize the delta
    const delta = Math.min(0.1, this.clock.getDelta());

    this.mixer.update(delta);

    // Handle arm object transition animation if active
    if (this.isTransitioning) {
      const elapsed = this.clock.elapsedTime - this.transitionStartTime;
      const progress = Math.min(elapsed / this.transitionDuration, 1);

      // Use more subtle easing functions
      // easeOutCubic for smooth movement without extreme overshooting
      const easeOutCubic = (x: number): number => {
        return 1 - Math.pow(1 - x, 3);
      };

      // easeInOutQuad for gentle acceleration and deceleration
      const easeInOutQuad = (x: number): number => {
        return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      };

      if (this.transitionDirection === 0) {
        // Moving down phase - use easeOutCubic for smooth exit
        if (this.currentArmObject) {
          const easedProgress = easeOutCubic(progress);
          const newY = THREE.MathUtils.lerp(
            this.initialArmY,
            this.targetArmY,
            easedProgress
          );
          this.currentArmObject.position.y = newY;
        }

        // When reaching the bottom, switch to the new object
        if (progress >= 1) {
          this.clear();

          // Set up the new object
          if (this.pendingCustomType) {
            this.setCustomObject(this.pendingCustomType, this.pendingArmObject);
          } else if (!this.pendingArmObject) {
            this.setArm();
          } else {
            this.setBlock(this.pendingArmObject);
          }

          // Start with the new object below the view and animate up
          if (this.children.length > 0) {
            this.currentArmObject = this.children[0] as THREE.Object3D;

            // Store the final target position (original position)
            this.targetArmY = this.currentArmObject.position.y;

            // Move the object down first (to start animation from below)
            this.currentArmObject.position.y -= 5;
            this.initialArmY = this.currentArmObject.position.y;
          }

          // Start the up animation
          this.transitionDirection = 1;
          this.transitionStartTime = this.clock.elapsedTime;
        }
      } else {
        // Moving up phase - use easeInOutQuad for natural entrance
        if (this.currentArmObject) {
          const easedProgress = easeInOutQuad(progress);
          const newY = THREE.MathUtils.lerp(
            this.initialArmY,
            this.targetArmY,
            easedProgress
          );
          this.currentArmObject.position.y = newY;
        }

        // When finished moving up, end the transition
        if (progress >= 1) {
          this.isTransitioning = false;
          this.pendingArmObject = undefined;
          this.pendingCustomType = undefined;

          // Ensure the object is exactly at its target position
          if (this.currentArmObject) {
            this.currentArmObject.position.y = this.targetArmY;
          }
        }
      }
    }
  }

  /**
   * Perform an arm swing by playing the swing animation and sending an event to the network.
   */
  public doSwing = () => {
    this.playSwingAnimation();
    if (this.emitSwingEvent) {
      this.emitSwingEvent();
    }
  };

  /**
   * Paint the arm with a texture or color. Only works when showing the empty arm (no held object).
   */
  public paintArm = (texture: THREE.Texture | THREE.Color) => {
    this.children.forEach((child) => {
      if (child instanceof CanvasBox) {
        child.paint("all", texture);

        child.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((mat) => {
                mat.needsUpdate = true;
              });
            } else {
              obj.material.needsUpdate = true;
            }
          }
        });
      }
    });
  };

  /**
   * Play the "swing" animation.
   */
  private playSwingAnimation = () => {
    if (this.swingAnimation) {
      this.swingAnimation.reset();
      this.swingAnimation.play();
    }
  };
}
