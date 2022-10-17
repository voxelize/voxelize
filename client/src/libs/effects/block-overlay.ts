import { Effect } from "postprocessing";
import { Color, PerspectiveCamera, Uniform, Vector3 } from "three";

import { World } from "../../core/world";
import OverlayFragmentShader from "../shaders/effects/overlay.frag.glsl";

export class BlockOverlayEffect extends Effect {
  private overlays: Map<number, [Color, number]> = new Map();
  private oldId: number;

  constructor(public world: World, public camera: PerspectiveCamera) {
    super("BlockOverlayEffect", OverlayFragmentShader, {
      uniforms: new Map([
        ["overlay", new Uniform(new Vector3(0, 0, 1))],
        ["opacity", new Uniform(0.0)],
      ]),
    });
  }

  addOverlay = (id: number, color: Color, opacity: number) => {
    this.overlays.set(id, [color, opacity]);
  };

  update = () => {
    const position = new Vector3();
    this.camera.getWorldPosition(position);

    const id = this.world.getVoxelByWorld(position.x, position.y, position.z);

    if (this.oldId !== id) {
      this.oldId = id;
    } else {
      return;
    }

    const entry = this.overlays.get(id);

    if (!entry) {
      this.opacity = 0;
    } else {
      this.overlay = entry[0];
      this.opacity = entry[1];
    }
  };

  private get opacity() {
    return this.uniforms.get("opacity").value;
  }

  private set opacity(value: number) {
    this.uniforms.get("opacity").value = value;
  }

  private get overlay() {
    return this.uniforms.get("overlay").value;
  }

  private set overlay(value: Color) {
    const old = this.uniforms.get("overlay").value;
    old.x = value.r;
    old.y = value.g;
    old.z = value.b;
  }
}
