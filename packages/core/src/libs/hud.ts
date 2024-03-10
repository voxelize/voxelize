import merge from "deepmerge";
import * as THREE from "three";

import { RigidControls } from "../core/controls";
import { Inputs } from "../core/inputs";

import { ARM_COLOR } from "./character";
import { ItemSlots } from "./item-slots";

export type HudOptions = {
  visible: boolean;
};

const defaultOptions: HudOptions = {
  visible: true,
};

export class Hud {
  public options: HudOptions;

  public mesh: THREE.Mesh;

  private mixer: THREE.AnimationMixer;

  private armSwingAnimation: THREE.AnimationAction;

  constructor(options: Partial<HudOptions> = {}) {
    const { visible } = (this.options = merge(defaultOptions, options));

    const color = new THREE.Color(ARM_COLOR);
    const geometry = new THREE.BoxGeometry(0.3, 1, 0.3);
    const material = new THREE.MeshBasicMaterial({
      color,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(1, -0.8, -1);
    this.mesh.rotateX(-Math.PI / 4);
    this.mesh.rotateZ(-Math.PI / 8);
    this.mesh.visible = visible;

    this.mixer = new THREE.AnimationMixer(this.mesh);

    // Create the arm swing animation
    const pInitial = this.mesh.position;
    const pMid = this.mesh.position.clone();
    pMid.x = 0.66;
    pMid.y = -0.57;
    const pMid2 = pMid.clone();
    pMid2.y = -0.82;
    const pMid3 = pMid2.clone();
    pMid3.y = -1.5;
    const pMid4 = pInitial.clone();
    pMid4.y = -1.8;
    const positionKF = new THREE.VectorKeyframeTrack(
      ".position",
      [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      [
        pInitial.x,
        pInitial.y,
        pInitial.z,
        pMid.x,
        pMid.y,
        pMid.z,
        pMid2.x,
        pMid2.y,
        pMid2.z,
        pMid3.x,
        pMid3.y,
        pMid3.z,
        pMid4.x,
        pMid4.y,
        pMid4.z,
        pInitial.x,
        pInitial.y,
        pInitial.z,
      ]
    );
    const qInitial = this.mesh.quaternion;
    const qMid = qInitial.clone();
    qMid.x = -0.41;
    qMid.z = 0.21;
    const qMid2 = qMid.clone();
    qMid2.z = 0.52;
    const qMid3 = qMid2.clone();
    qMid3.z = 0.75;
    const qMid4 = qInitial.clone();

    const quaternionKF = new THREE.QuaternionKeyframeTrack(
      ".quaternion",
      [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      [
        qInitial.x,
        qInitial.y,
        qInitial.z,
        qInitial.w,
        qMid.x,
        qMid.y,
        qMid.z,
        qMid.w,
        qMid2.x,
        qMid2.y,
        qMid2.z,
        qMid2.w,
        qMid3.x,
        qMid3.y,
        qMid3.z,
        qMid3.w,
        qMid4.x,
        qMid4.y,
        qMid4.z,
        qMid4.w,
        qInitial.x,
        qInitial.y,
        qInitial.z,
        qInitial.w,
      ]
    );

    const clip = new THREE.AnimationClip("ArmSwing", 0.5, [
      positionKF,
      quaternionKF,
    ]);

    this.armSwingAnimation = this.mixer.clipAction(clip);
    this.armSwingAnimation.setLoop(THREE.LoopOnce, 1);
    this.armSwingAnimation.clampWhenFinished = true;
  }

  connect = (inputs: Inputs, namespace = "*") => {
    inputs.click("left", this.animate, namespace);
  };

  /**
   *
   * Update the arm's animation. Note that when a hud is attached to a control,
   * `update` is called automatically within the control's update loop.
   */
  update(delta: number) {
    this.mixer.update(delta);
  }

  animate = () => {
    if (!this.armSwingAnimation.isRunning()) {
      this.armSwingAnimation.reset();
      this.armSwingAnimation.play();
    }
  };
}
