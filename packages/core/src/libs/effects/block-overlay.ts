import { Effect } from "postprocessing";
import { Color, PerspectiveCamera, Uniform, Vector3 } from "three";

import { World } from "../../core/world";
import OverlayFragmentShader from "../../shaders/effects/overlay.frag.glsl?raw";

/**
 * The block overlay effect is used to add a color blend whenever the camera is inside certain types of blocks.
 *
 * This module is dependent on the [`postprocessing`](https://github.com/pmndrs/postprocessing) package.
 *
 * # Example
 * ```ts
 * import { EffectComposer, RenderPass } from "postprocessing";
 *
 * const composer = new EffectComposer(renderer);
 * composer.addPass(new RenderPass(world, camera));
 *
 * const overlayEffect = new VOXELIZE.BlockOverlayEffect(world, camera);
 * overlayEffect.addOverlay("water", new THREE.Color("#5F9DF7"), 0.05);
 *
 * composer.addPass(
 *   new EffectPass(camera, overlayEffect)
 * );
 * ```
 *
 * ![Block overlay effect](/img/docs/overlay.png)
 *
 * @noInheritDoc
 * @category Effects
 */
export class BlockOverlayEffect extends Effect {
  /**
   * A map of block IDs to overlay colors.
   */
  private overlays: Map<number | string, [Color, number]> = new Map();

  /**
   * The old voxel ID that the camera was in.
   */
  private oldId: number;

  /**
   * Create a new block overlay effect.
   *
   * @param world The world that the effect is in.
   * @param camera The camera that the effect is applied to.
   */
  constructor(public world: World, public camera: PerspectiveCamera) {
    super("BlockOverlayEffect", OverlayFragmentShader, {
      uniforms: new Map([
        ["overlay", new Uniform(new Vector3(0, 0, 1))],
        ["opacity", new Uniform(0.0 as any)],
      ]),
    });
  }

  /**
   * Add a new overlay to a certain voxel type.
   *
   * @param idOrName The block ID or name to add an overlay for.
   * @param color The color of the overlay.
   * @param opacity The opacity of the overlay.
   */
  addOverlay = (idOrName: number | string, color: Color, opacity: number) => {
    this.overlays.set(
      typeof idOrName === "number" ? idOrName : idOrName.toLowerCase(),
      [color, opacity]
    );
  };

  /**
   * This is called by the effect composer to update the effect.
   *
   * @hidden
   */
  update = () => {
    if (!this.world.isInitialized) {
      return;
    }

    const position = new Vector3();
    this.camera.getWorldPosition(position);

    const id = this.world.getVoxelAt(position.x, position.y, position.z);

    if (this.oldId !== id) {
      this.oldId = id;
    } else {
      return;
    }

    const block = this.world.getBlockById(id);
    const entry =
      this.overlays.get(id) || this.overlays.get(block.name.toLowerCase());

    if (!entry) {
      this.opacity = 0;
    } else {
      this.overlay = entry[0];
      this.opacity = entry[1];
    }
  };

  /**
   * Get the opacity of the overlay.
   */
  private get opacity() {
    return this.uniforms.get("opacity").value;
  }

  /**
   * Set the opacity of the overlay.
   */
  private set opacity(value: number) {
    this.uniforms.get("opacity").value = value;
  }

  /**
   * Get the current overlay color.
   */
  private get overlay() {
    return this.uniforms.get("overlay").value;
  }

  /**
   * Set the current overlay color.
   */
  private set overlay(value: Color) {
    const old = this.uniforms.get("overlay").value;
    old.x = value.r;
    old.y = value.g;
    old.z = value.b;
  }
}
