import merge from "deepmerge";
import * as THREE from "three";

import { RigidControls } from "../core/controls";
import { Inputs } from "../core/inputs";

import { ItemSlots } from "./item-slots";
import { ARM_COLOR } from "./character";

export type HudOptions = {
  visible: boolean;
};

const defaultOptions: HudOptions = {
  visible: true,
};

export class Hud {
  public options: HudOptions;

  public mesh: THREE.Mesh;

  constructor(options: Partial<HudOptions> = {}) {
    const { visible } = (this.options = merge(defaultOptions, options));

    const color = new THREE.Color(ARM_COLOR);
    const geometry = new THREE.BoxGeometry(0.3, 0.6, 0.3);
    const material = new THREE.MeshBasicMaterial({
      color,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(1, -0.7, -1);
    this.mesh.rotateX(-Math.PI / 4);
    this.mesh.rotateZ(-Math.PI / 8);
    this.mesh.visible = visible;
  }

  connect = (
    inputs: Inputs,
    controls: RigidControls,
    itemSlots: ItemSlots,
    namespace = "*"
  ) => {
    controls.camera.add(this.mesh);

    inputs.click("right", this.animate, namespace);
  };

  animate = () => {};
}
