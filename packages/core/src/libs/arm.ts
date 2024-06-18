import * as THREE from "three";

import { Inputs } from "../core/inputs";
import { AnimationUtils } from "../utils";

import { CanvasBox } from "./canvas-box";
import { ARM_COLOR } from "./character";

const ARM_POSITION = new THREE.Vector3(1, -1, -1);
const ARM_QUATERION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 4, 0, -Math.PI / 8)
);
const BLOCK_POSITION = new THREE.Vector3(1, -1.8, -2);
const BLOCK_QUATERNION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  -Math.PI / 4
);

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
  armMesh?: THREE.Object3D;
  armPosition?: THREE.Vector3;
  armQuaternion?: THREE.Quaternion;
  blockPosition?: THREE.Vector3;
  blockQuaternion?: THREE.Quaternion;
  armColor?: string;
};

const defaultOptions: ArmOptions = {
  armMesh: undefined,
  armPosition: ARM_POSITION,
  armQuaternion: ARM_QUATERION,
  blockPosition: BLOCK_POSITION,
  blockQuaternion: BLOCK_QUATERNION,
  armColor: ARM_COLOR,
};

export class Arm extends THREE.Group {
  public options: ArmOptions;

  private mixer: THREE.AnimationMixer;

  private armSwingClip: THREE.AnimationClip;

  private blockSwingClip: THREE.AnimationClip;

  private swingAnimation: THREE.AnimationAction;

  private rightClickSwing = false;

  constructor(options: Partial<ArmOptions> = {}) {
    super();

    this.options = {
      ...defaultOptions,
      ...options,
    };

    this.armSwingClip = AnimationUtils.generateClip(
      "armSwing",
      SWING_TIMES,
      this.options.armPosition,
      this.options.armQuaternion,
      ARM_SWING_POSITIONS,
      SWING_QUATERNIONS
    );
    this.blockSwingClip = AnimationUtils.generateClip(
      "blockSwing",
      SWING_TIMES,
      this.options.blockPosition,
      this.options.blockQuaternion,
      BLOCK_SWING_POSITIONS,
      SWING_QUATERNIONS
    );
    this.setArmMesh();
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
    const unbindLeftClick = inputs.click("left", this.playSwing, namespace);
    const unbindRightClick = inputs.click(
      "right",
      () => {
        if (this.rightClickSwing) {
          this.playSwing();
        }
      },
      namespace
    );

    return () => {
      try {
        unbindLeftClick();
        unbindRightClick();
      } catch (e) {
        // Ignore.
      }
    };
  };

  /**
   * Set a new mesh for the arm. If `animate` is true, the transition will be animated.
   *
   * @param mesh New mesh for the arm
   * @param animate Whether to animate the transition
   */
  public setMesh = (mesh: THREE.Object3D | undefined, animate: boolean) => {
    if (!animate) {
      this.clear();

      if (!mesh) {
        this.setArmMesh();
      } else {
        this.setBlockMesh(mesh);
      }
    } else {
      // TODO(balta): Create animation of arm coming down and coming back up
    }
  };

  private setArmMesh = () => {
    const arm = new CanvasBox({ width: 0.3, height: 1, depth: 0.3 });
    arm.paint("all", new THREE.Color(ARM_COLOR));
    arm.position.set(ARM_POSITION.x, ARM_POSITION.y, ARM_POSITION.z);
    arm.quaternion.multiply(ARM_QUATERION);

    this.mixer = new THREE.AnimationMixer(arm);
    this.swingAnimation = this.mixer.clipAction(this.armSwingClip);
    this.swingAnimation.setLoop(THREE.LoopOnce, 1);
    this.swingAnimation.clampWhenFinished = true;

    this.rightClickSwing = false;

    this.add(arm);
  };

  private setBlockMesh = (mesh: THREE.Object3D) => {
    mesh.position.set(BLOCK_POSITION.x, BLOCK_POSITION.y, BLOCK_POSITION.z);
    mesh.quaternion.multiply(BLOCK_QUATERNION);

    this.mixer = new THREE.AnimationMixer(mesh);
    this.swingAnimation = this.mixer.clipAction(this.blockSwingClip);
    this.swingAnimation.setLoop(THREE.LoopOnce, 1);
    this.swingAnimation.clampWhenFinished = true;

    // TODO(balta): Only swing if block is placed, come up with better logic for this
    this.rightClickSwing = true;

    this.add(mesh);
  };

  /**
   *
   * Update the arm's animation. Note that when a arm is attached to a control,
   * `update` is called automatically within the control's update loop.
   */
  public update(delta: number) {
    this.mixer.update(delta);
  }

  /**
   * Play the "swing" animation.
   */
  private playSwing = () => {
    if (this.swingAnimation) {
      this.swingAnimation.reset();
      this.swingAnimation.play();
    }
  };
}
