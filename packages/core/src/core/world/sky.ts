import {
  BackSide,
  Color,
  DodecahedronGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

import { CanvasBox, CanvasBoxOptions } from "../../libs/canvas-box";
import SkyFragmentShader from "../../shaders/sky/fragment.glsl?raw";
import SkyVertexShader from "../../shaders/sky/vertex.glsl?raw";

export type SkyShadingCycleData = {
  start: number;
  name: string;
  color: {
    top: Color | string;
    middle: Color | string;
    bottom: Color | string;
  };
  skyOffset: number;
  voidOffset: number;
};

export type SkyOptions = {
  /**
   * The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.
   */
  dimension: number;

  /**
   * The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
   * set by the `setTopColor`, `setMiddleColor`, and `setBottomColor` methods.
   */
  lerpFactor: number;

  transitionSpan: number;
};

const defaultOptions: SkyOptions = {
  dimension: 2000,
  lerpFactor: 0.1,
  transitionSpan: 0.05,
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
  public declare options: CanvasBoxOptions & SkyOptions;

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

  public shadingData: SkyShadingCycleData[] = [];
  private readonly weightedRgbScratch = { r: 0, g: 0, b: 0 };
  private readonly weightedTopColor = new Color();
  private readonly weightedMiddleColor = new Color();
  private readonly weightedBottomColor = new Color();

  /**
   * Create a new sky instance.
   *
   * @param dimension The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.
   * @param lerpFactor The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
   */
  constructor(options: Partial<SkyOptions> = {}) {
    super({
      width:
        (options.dimension ? options.dimension : defaultOptions.dimension) *
        0.8,
      side: BackSide,
      transparent: true,
      widthSegments: 512,
      heightSegments: 512,
      depthSegments: 512,
    });

    this.options = {
      ...this.options,
      ...defaultOptions,
      ...options,
    };

    const boxMaterials = this.boxMaterials;
    let boxMaterialEntries = boxMaterials.values();
    let boxMaterialEntry = boxMaterialEntries.next();
    while (!boxMaterialEntry.done) {
      boxMaterialEntry.value.depthWrite = false;
      boxMaterialEntry = boxMaterialEntries.next();
    }
    this.frustumCulled = false;
    this.renderOrder = -1;

    const boxLayers = this.boxLayers;
    for (let index = 0; index < boxLayers.length; index++) {
      const layer = boxLayers[index];
      layer.renderOrder = -1;
      layer.frustumCulled = false;
    }

    this.createSkyShading();
  }

  setShadingPhases = (data: SkyShadingCycleData[]) => {
    if (data.length === 0) {
      return;
    }

    if (data.length === 1) {
      const { top, middle, bottom } = data[0].color;
      const topColor = new Color(top);
      const middleColor = new Color(middle);
      const bottomColor = new Color(bottom);

      this.uTopColor.value.copy(topColor);
      this.uMiddleColor.value.copy(middleColor);
      this.uBottomColor.value.copy(bottomColor);
      this.uSkyOffset.value = data[0].skyOffset;
      this.uVoidOffset.value = data[0].voidOffset;
    }

    this.shadingData = data;

    // Sort the shading data by start

    this.shadingData.sort((a, b) => a.start - b.start);
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
  update = (position: Vector3, time: number, timePerDay: number) => {
    this.rotation.z = Math.PI * 2 * (time / timePerDay);

    this.position.copy(position);

    if (this.shadingData.length <= 1) {
      return;
    }

    let primaryWeight = 0;
    let primaryData: SkyShadingCycleData | null = null;
    let secondaryWeight = 0;
    let secondaryData: SkyShadingCycleData | null = null;
    const transitionTime = this.options.transitionSpan * timePerDay;
    const shadingData = this.shadingData;
    const shadingDataLength = shadingData.length;

    for (let i = 0; i < shadingDataLength; i++) {
      const data = shadingData[i];
      const nextData = shadingData[(i + 1) % shadingDataLength];

      const { start } = data;
      const startTime = start * timePerDay;
      const nextStartTime = nextData.start * timePerDay;

      if (
        startTime < nextStartTime
          ? time >= startTime && time < nextStartTime
          : time < nextStartTime || time >= startTime
      ) {
        const weight = Math.max(
          Math.min(
            time >= startTime
              ? (time - startTime) / transitionTime
              : (time + timePerDay - startTime) / transitionTime,
            1.0
          ),
          0.0
        );

        primaryWeight = weight;
        primaryData = data;

        if (
          time >= startTime
            ? time < startTime + transitionTime
            : time + timePerDay < startTime + transitionTime
        ) {
          const previousData =
            shadingData[
              (i - 1 < 0 ? i - 1 + shadingDataLength : i - 1) %
                shadingDataLength
            ];

          secondaryWeight = 1 - weight;
          secondaryData = previousData;
        }

        break;
      }
    }

    if (!primaryData) {
      return;
    }

    let weightedTopR = 0;
    let weightedTopG = 0;
    let weightedTopB = 0;
    let weightedMiddleR = 0;
    let weightedMiddleG = 0;
    let weightedMiddleB = 0;
    let weightedBottomR = 0;
    let weightedBottomG = 0;
    let weightedBottomB = 0;
    let weightedSkyOffset = 0;
    let weightedVoidOffset = 0;

    const rgbScratch = this.weightedRgbScratch;
    const topColor = this.weightedTopColor;
    const middleColor = this.weightedMiddleColor;
    const bottomColor = this.weightedBottomColor;
    {
      const weight = primaryWeight;
      const data = primaryData;
      const {
        skyOffset,
        voidOffset,
        color: { top, middle, bottom },
      } = data;

      topColor.set(top);
      middleColor.set(middle);
      bottomColor.set(bottom);

      topColor.getRGB(rgbScratch);
      weightedTopR += rgbScratch.r * weight;
      weightedTopG += rgbScratch.g * weight;
      weightedTopB += rgbScratch.b * weight;

      middleColor.getRGB(rgbScratch);
      weightedMiddleR += rgbScratch.r * weight;
      weightedMiddleG += rgbScratch.g * weight;
      weightedMiddleB += rgbScratch.b * weight;

      bottomColor.getRGB(rgbScratch);
      weightedBottomR += rgbScratch.r * weight;
      weightedBottomG += rgbScratch.g * weight;
      weightedBottomB += rgbScratch.b * weight;

      weightedSkyOffset += weight * skyOffset;
      weightedVoidOffset += weight * voidOffset;
    }

    if (secondaryData && secondaryWeight > 0) {
      const {
        skyOffset,
        voidOffset,
        color: { top, middle, bottom },
      } = secondaryData;

      topColor.set(top);
      middleColor.set(middle);
      bottomColor.set(bottom);

      topColor.getRGB(rgbScratch);
      weightedTopR += rgbScratch.r * secondaryWeight;
      weightedTopG += rgbScratch.g * secondaryWeight;
      weightedTopB += rgbScratch.b * secondaryWeight;

      middleColor.getRGB(rgbScratch);
      weightedMiddleR += rgbScratch.r * secondaryWeight;
      weightedMiddleG += rgbScratch.g * secondaryWeight;
      weightedMiddleB += rgbScratch.b * secondaryWeight;

      bottomColor.getRGB(rgbScratch);
      weightedBottomR += rgbScratch.r * secondaryWeight;
      weightedBottomG += rgbScratch.g * secondaryWeight;
      weightedBottomB += rgbScratch.b * secondaryWeight;

      weightedSkyOffset += secondaryWeight * skyOffset;
      weightedVoidOffset += secondaryWeight * voidOffset;
    }

    this.uTopColor.value.setRGB(weightedTopR, weightedTopG, weightedTopB);

    this.uMiddleColor.value.setRGB(
      weightedMiddleR,
      weightedMiddleG,
      weightedMiddleB
    );

    this.uBottomColor.value.setRGB(
      weightedBottomR,
      weightedBottomG,
      weightedBottomB
    );

    this.uSkyOffset.value = weightedSkyOffset;
    this.uVoidOffset.value = weightedVoidOffset;
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
        top: "#222",
        middle: "#222",
        bottom: "#222",
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

    const shadingGeometry = new DodecahedronGeometry(this.options.dimension, 2);
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
    shadingMesh.renderOrder = -1;
    shadingMesh.frustumCulled = false;

    // We use attach here so that the sky shading is not affected by the box's rotation.
    this.attach(shadingMesh);
  };
}
