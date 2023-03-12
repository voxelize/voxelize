import {
  BackSide,
  Color,
  DodecahedronGeometry,
  MathUtils,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

import { CanvasBox, CanvasBoxParams } from "./canvas-box";
import SkyFragmentShader from "./shaders/sky/fragment.glsl";
import SkyVertexShader from "./shaders/sky/vertex.glsl";

export type SkyShadingData = {
  color: {
    top: Color;
    middle: Color;
    bottom: Color;
  };
  skyOffset: number;
  voidOffset: number;
};

export type SkyParams = {
  /**
   * The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.
   */
  dimension: number;

  /**
   * The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
   * set by the `setTopColor`, `setMiddleColor`, and `setBottomColor` methods.
   */
  lerpFactor: number;

  changeSpan: number;
};

const defaultParams: SkyParams = {
  dimension: 2000,
  lerpFactor: 0.1,
  changeSpan: 0.05,
};

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
 * ![Sky](/img/docs/sky.png)
 *
 */
export class Sky extends CanvasBox {
  public params: CanvasBoxParams & SkyParams;

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

  public uSkyOffset: {
    value: number;
  };

  public uVoidOffset: {
    value: number;
  };

  public shadingData: { [progress: number]: SkyShadingData } = {};

  public ticksPerDay: number;

  private oldTopColor: Color;

  private oldMiddleColor: Color;

  private oldBottomColor: Color;

  private oldSkyOffset: number;

  private oldVoidOffset: number;

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

  private newSkyOffset: number;

  private newVoidOffset: number;

  private lastColorChangeTick = 0;

  /**
   * Create a new sky instance.
   *
   * @param dimension The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.
   * @param lerpFactor The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
   */
  constructor(params: Partial<SkyParams> = {}) {
    super({
      width:
        (params.dimension ? params.dimension : defaultParams.dimension) * 0.8,
      side: BackSide,
      transparent: true,
      widthSegments: 512,
      heightSegments: 512,
      depthSegments: 512,
    });

    this.params = {
      ...this.params,
      ...defaultParams,
      ...params,
    };

    this.boxMaterials.forEach((m) => (m.depthWrite = false));
    this.frustumCulled = false;
    this.renderOrder = -1;

    this.createSkyShading();
  }

  registerShadingData = (
    progress: number /** 0 to 1 */,
    data: {
      color: {
        top: Color;
        middle: Color;
        bottom: Color;
      };
      skyOffset: number;
      voidOffset: number;
    }
  ) => {
    if (this.ticksPerDay) {
      throw new Error(
        "Cannot register shading data after the world has been initialized."
      );
    }

    // Check to see if progress is already registered.
    if (this.shadingData[progress]) {
      console.warn(
        `Progress ${progress} is already registered. Overwriting existing data.`
      );
    }

    if (progress < 0 || progress > 1) {
      console.warn(
        `Progress ${progress} is out of range. Progress must be between 0 and 1.`
      );
      return;
    }

    if (data.skyOffset < 0 || data.skyOffset > 1) {
      console.warn(
        `Sky offset ${data.skyOffset} is out of range. Sky offset must be between 0 and 1.`
      );
      return;
    }

    if (data.voidOffset < 0 || data.voidOffset > 1) {
      console.warn(
        `Void offset ${data.voidOffset} is out of range. Void offset must be between 0 and 1.`
      );
      return;
    }

    this.shadingData[progress] = data;
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
  update = (position: Vector3, timeTick: number) => {
    if (this.ticksPerDay === undefined) {
      throw new Error("Sky ticks per day is undefined. Something went wrong.");
    }

    const flooredTimeTick = Math.floor(timeTick);
    const changeSpanTicks = this.params.changeSpan * this.ticksPerDay;
    const { uTopColor, uMiddleColor, uBottomColor } = this;

    if (
      this.shadingData[flooredTimeTick] &&
      flooredTimeTick !== this.lastColorChangeTick
    ) {
      const { color, skyOffset, voidOffset } =
        this.shadingData[flooredTimeTick];

      this.oldTopColor = this.newTopColor?.clone();
      this.oldMiddleColor = this.newMiddleColor?.clone();
      this.oldBottomColor = this.newBottomColor?.clone();
      this.oldSkyOffset = this.newSkyOffset;
      this.oldVoidOffset = this.newVoidOffset;

      this.newTopColor = color.top;
      this.newMiddleColor = color.middle;
      this.newBottomColor = color.bottom;
      this.newSkyOffset = skyOffset;
      this.newVoidOffset = voidOffset;

      this.lastColorChangeTick = flooredTimeTick;

      return;
    }

    // Calculate old and new weights by the last color change time.
    const ticksElapsedSinceLastChange =
      timeTick > this.lastColorChangeTick
        ? timeTick - this.lastColorChangeTick
        : this.ticksPerDay - this.lastColorChangeTick + timeTick;

    // Supposedly, the color should change into new weight after
    // lastColorChangeTick + changeSpanTicks ticks.
    const oldWeight = Math.min(
      1,
      ticksElapsedSinceLastChange / changeSpanTicks
    );

    // Set the colors as a blend between the old and new colors.
    if (this.oldTopColor) {
      uTopColor.value = this.oldTopColor
        .clone()
        .lerp(this.newTopColor, oldWeight);
    } else if (this.newTopColor) {
      uTopColor.value = this.newTopColor;
    }

    if (this.oldMiddleColor) {
      uMiddleColor.value = this.oldMiddleColor
        .clone()
        .lerp(this.newMiddleColor, oldWeight);
    } else if (this.newMiddleColor) {
      uMiddleColor.value = this.newMiddleColor;
    }

    if (this.oldBottomColor) {
      uBottomColor.value = this.oldBottomColor
        .clone()
        .lerp(this.newBottomColor, oldWeight);
    } else if (this.newBottomColor) {
      uBottomColor.value = this.newBottomColor;
    }

    if (this.oldSkyOffset !== undefined) {
      this.uSkyOffset.value = MathUtils.lerp(
        this.oldSkyOffset,
        this.newSkyOffset,
        oldWeight
      );
    } else {
      this.uSkyOffset.value = this.newSkyOffset;
    }

    if (this.oldVoidOffset !== undefined) {
      this.uVoidOffset.value = MathUtils.lerp(
        this.oldVoidOffset,
        this.newVoidOffset,
        oldWeight
      );
    } else {
      this.uVoidOffset.value = this.newVoidOffset;
    }

    this.rotation.z = Math.PI * 2 * (timeTick / this.ticksPerDay);

    ["top", "right", "left", "front", "back"].forEach((face) => {
      const mat = this.boxMaterials.get(face);
      if (mat) {
        // Update sky opacity to hide stars when the sun is up.
      }
    });

    this.position.copy(position);
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
        top: new Color("#222"),
        middle: new Color("#222"),
        bottom: new Color("#222"),
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
    this.uSkyOffset = {
      value: skyOffset,
    };
    this.uVoidOffset = {
      value: voidOffset,
    };

    const shadingGeometry = new DodecahedronGeometry(this.params.dimension, 2);
    const shadingMaterial = new ShaderMaterial({
      uniforms: {
        uTopColor: this.uTopColor,
        uMiddleColor: this.uMiddleColor,
        uBottomColor: this.uBottomColor,
        uSkyOffset: this.uSkyOffset,
        uVoidOffset: this.uVoidOffset,
        uExponent: { value: 0.6 },
        uExponent2: { value: 1.2 },
      },
      vertexShader: SkyVertexShader,
      fragmentShader: SkyFragmentShader,
      depthWrite: false,
      side: BackSide,
    });
    const shadingMesh = new Mesh(shadingGeometry, shadingMaterial);

    // We use attach here so that the sky shading is not affected by the box's rotation.
    this.attach(shadingMesh);
  };
}
