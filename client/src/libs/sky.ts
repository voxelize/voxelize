import {
  BackSide,
  Color,
  DodecahedronGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

import { CanvasBox } from "./canvas-box";
import SkyFragmentShader from "./shaders/sky/fragment.glsl";
import SkyVertexShader from "./shaders/sky/vertex.glsl";

/**
 * Sky consists of both a large dodecahedron used to render the 3-leveled sky gradient and a {@link CanvasBox} that renders custom sky textures (
 * for a sky box) within the dodecahedron sky.
 *
 * # Example
 * ```ts
 * // Create the sky texture.
 * const sky = new VOXELIZE.Sky();
 *
 * // Load a texture and paint it to the top of the sky.
 * world.loader.addTexture(ExampleImage, (texture) => {
 *   sky.paint("top", texture);
 * })
 *
 * // Add the sky to the scene.
 * world.add(sky);
 *
 * // Update the sky per frame.
 * sky.update(camera.position);
 * ```
 *
 * ![Sky](/img/sky.png)
 *
 */
export class Sky extends CanvasBox {
  /**
   * The top color of the sky gradient. Change this by calling {@link Sky.setTopColor}.
   */
  public uTopColor: {
    value: Color;
  };

  /**
   * The middle color of the sky gradient. Change this by calling {@link Sky.setMiddleColor}.
   */
  public uMiddleColor: {
    value: Color;
  };

  /**
   * The bottom color of the sky gradient. Change this by calling {@link Sky.setBottomColor}.
   */
  public uBottomColor: {
    value: Color;
  };

  /**
   * The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.
   */
  public dimension: number;

  /**
   * The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
   * set by the `setTopColor`, `setMiddleColor`, and `setBottomColor` methods.
   */
  public lerpFactor: number;

  /**
   * The internal new color of the top of the sky gradient.
   */
  private newTopColor: Color;

  /**
   * The internal new color of the middle of the sky gradient.
   */
  private newMiddleColor: Color;

  /**
   * The internal new color of the bottom of the sky gradient.
   */
  private newBottomColor: Color;

  /**
   * Create a new sky instance.
   *
   * @param dimension The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.
   * @param lerpFactor The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
   */
  constructor(dimension = 2000, lerpFactor = 0.01) {
    super({
      width: dimension * 0.8,
      side: BackSide,
      transparent: true,
      widthSegments: 512,
      heightSegments: 512,
      depthSegments: 512,
    });

    this.dimension = dimension;
    this.lerpFactor = lerpFactor;

    this.boxMaterials.forEach((m) => (m.depthWrite = false));
    this.frustumCulled = false;
    this.renderOrder = -1;

    this.createSkyShading();
  }

  /**
   * Set the new top color of the sky gradient. This will not affect the sky gradient immediately, but
   * will instead lerp the current color to the new color.
   *
   * @param color The new color of the top of the sky gradient.
   */
  setTopColor = (color: Color) => {
    this.newTopColor = color;
  };

  /**
   * Set the new middle color of the sky gradient. This will not affect the sky gradient immediately, but
   * will instead lerp the current color to the new color.
   *
   * @param color The new color of the middle of the sky gradient.
   */
  setMiddleColor = (color: Color) => {
    this.newMiddleColor = color;
  };

  /**
   * Set the new bottom color of the sky gradient. This will not affect the sky gradient immediately, but
   * will instead lerp the current color to the new color.
   *
   * @param color The new color of the bottom of the sky gradient.
   */
  setBottomColor = (color: Color) => {
    this.newBottomColor = color;
  };

  /**
   * Get the current top color of the sky gradient. This can be used as shader uniforms's value.
   *
   * @returns The current top color of the sky gradient.
   */
  getTopColor = () => {
    return this.uTopColor.value;
  };

  /**
   * Get the current middle color of the sky gradient. This can be used as shader uniforms's value. For instance,
   * this can be used to set the color of the fog in the world.
   *
   * @returns The current middle color of the sky gradient.
   */
  getMiddleColor = () => {
    return this.uMiddleColor.value;
  };

  /**
   * Get the current bottom color of the sky gradient. This can be used as shader uniforms's value.
   *
   * @returns The current bottom color of the sky gradient.
   */
  getBottomColor = () => {
    return this.uBottomColor.value;
  };

  /**
   * Update the position of the sky box to the camera's x/z position, and lerp the sky gradient colors.
   *
   * @param position The new position to center the sky at.
   */
  update = (position: Vector3) => {
    const { uTopColor, uMiddleColor, uBottomColor } = this;

    this.position.copy(position);

    if (this.newTopColor) {
      uTopColor.value.lerp(this.newTopColor, this.lerpFactor);
    }

    if (this.newMiddleColor) {
      uMiddleColor.value.lerp(this.newMiddleColor, this.lerpFactor);
    }

    if (this.newBottomColor) {
      uBottomColor.value.lerp(this.newBottomColor, this.lerpFactor);
    }
  };

  /**
   * Create the dodecahedron sky gradient.
   */
  private createSkyShading = () => {
    const {
      color: { top, middle, bottom },
      skyOffset,
      voidOffset,
    } = {
      color: {
        top: new Color("#73A3FB"),
        middle: new Color("#B1CCFD"),
        bottom: new Color("#B1CCFD"),
      },
      skyOffset: 0,
      voidOffset: 1200,
    };

    this.uTopColor = {
      value: new Color(top),
    };
    this.uMiddleColor = {
      value: new Color(middle),
    };
    this.uBottomColor = {
      value: new Color(bottom),
    };

    const shadingGeometry = new DodecahedronGeometry(this.dimension, 2);
    const shadingMaterial = new ShaderMaterial({
      uniforms: {
        uTopColor: this.uTopColor,
        uMiddleColor: this.uMiddleColor,
        uBottomColor: this.uBottomColor,
        uSkyOffset: { value: skyOffset },
        uVoidOffset: { value: voidOffset },
        uExponent: { value: 0.6 },
        uExponent2: { value: 1.2 },
      },
      vertexShader: SkyVertexShader,
      fragmentShader: SkyFragmentShader,
      depthWrite: false,
      side: BackSide,
    });
    const shadingMesh = new Mesh(shadingGeometry, shadingMaterial);

    this.add(shadingMesh);
  };
}
