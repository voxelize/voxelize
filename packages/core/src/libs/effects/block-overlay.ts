import { Color, type PerspectiveCamera, Vector3 } from "three/webgpu";
import { mix, vec4 } from "three/tsl";

import { World } from "../../core/world";
import type { Vec4Node } from "../../core/world/shading/types";
import { ownUniform } from "../../core/world/shading/uniforms";

/**
 * The block overlay effect is used to add a color blend whenever the camera is inside certain types of blocks.
 *
 * A screen effect: `apply` takes the frame's colour node and returns it with
 * the overlay mixed in; call `update` once a frame.
 *
 * # Example
 * ```ts
 * const overlay = new VOXELIZE.BlockOverlayEffect(world, camera);
 * overlay.addOverlay("water", new THREE.Color("#5F9DF7"), 0.05);
 * // An effect of a `@voxelize/postprocessing` effect pass:
 * class Overlay extends Effect {
 *   fragment({ color }) { return overlay.apply(color); }
 *   update() { overlay.update(); }
 * }
 * ```
 *
 * ![Block overlay effect](/img/docs/overlay.png)
 *
 * @noInheritDoc
 * @category Effects
 */
export class BlockOverlayEffect {
  readonly uniforms = {
    overlay: ownUniform(new Color(0, 0, 1)),
    opacity: ownUniform(0),
  };

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
  constructor(
    public world: World,
    public camera: PerspectiveCamera,
  ) {}

  /** The frame's colour with the overlay of the block the camera is in. */
  apply(color: Vec4Node): Vec4Node {
    const { overlay, opacity } = this.uniforms;
    return vec4(mix(color.rgb, overlay, opacity), color.a);
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
      [color, opacity],
    );
  };

  /**
   * Call once a frame: follows the block the camera is in.
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
    return this.uniforms.opacity.value;
  }

  /**
   * Set the opacity of the overlay.
   */
  private set opacity(value: number) {
    this.uniforms.opacity.value = value;
  }

  /**
   * Get the current overlay color.
   */
  private get overlay() {
    return this.uniforms.overlay.value;
  }

  /**
   * Set the current overlay color.
   */
  private set overlay(value: Color) {
    this.uniforms.overlay.value.copy(value);
  }
}
