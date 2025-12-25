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

    this.boxMaterials.forEach((m) => (m.depthWrite = false));
    this.frustumCulled = false;
    this.renderOrder = -1;

    this.boxLayers.forEach((layer) => {
      layer.renderOrder = -1;
      layer.frustumCulled = false;
    });

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

    ["top", "right", "left", "front", "back"].forEach((face) => {
      const mat = this.boxMaterials.get(face);
      if (mat) {
        // Update sky opacity to hide stars when the sun is up.
      }
    });

    this.position.copy(position);

    if (this.shadingData.length <= 1) {
      return;
    }

    const shadingStack: [number, SkyShadingCycleData][] = [];
    const transitionTime = this.options.transitionSpan * timePerDay;

    for (let i = 0; i < this.shadingData.length; i++) {
      const data = this.shadingData[i];
      const nextData = this.shadingData[(i + 1) % this.shadingData.length];

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

        shadingStack.push([weight, data]);

        if (
          time >= startTime
            ? time < startTime + transitionTime
            : time + timePerDay < startTime + transitionTime
        ) {
          const previousData =
            this.shadingData[
              (i - 1 < 0 ? i - 1 + this.shadingData.length : i - 1) %
                this.shadingData.length
            ];

          shadingStack.push([1 - weight, previousData]);
        }

        break;
      }
    }

    const weightedTopRGB = [0, 0, 0];
    const weightedMiddleRGB = [0, 0, 0];
    const weightedBottomRGB = [0, 0, 0];
    let weightedSkyOffset = 0;
    let weightedVoidOffset = 0;

    const emptyRGB = {
      r: 0,
      g: 0,
      b: 0,
    };

    shadingStack.forEach(([weight, data]) => {
      const {
        skyOffset,
        voidOffset,
        color: { top, middle, bottom },
      } = data;

      const topColor = new Color(top);
      const middleColor = new Color(middle);
      const bottomColor = new Color(bottom);

      topColor.getRGB(emptyRGB);
      weightedTopRGB[0] += emptyRGB.r * weight;
      weightedTopRGB[1] += emptyRGB.g * weight;
      weightedTopRGB[2] += emptyRGB.b * weight;

      middleColor.getRGB(emptyRGB);
      weightedMiddleRGB[0] += emptyRGB.r * weight;
      weightedMiddleRGB[1] += emptyRGB.g * weight;
      weightedMiddleRGB[2] += emptyRGB.b * weight;

      bottomColor.getRGB(emptyRGB);
      weightedBottomRGB[0] += emptyRGB.r * weight;
      weightedBottomRGB[1] += emptyRGB.g * weight;
      weightedBottomRGB[2] += emptyRGB.b * weight;

      weightedSkyOffset += weight * skyOffset;
      weightedVoidOffset += weight * voidOffset;
    });

    this.uTopColor.value.setRGB(
      weightedTopRGB[0],
      weightedTopRGB[1],
      weightedTopRGB[2]
    );

    this.uMiddleColor.value.setRGB(
      weightedMiddleRGB[0],
      weightedMiddleRGB[1],
      weightedMiddleRGB[2]
    );

    this.uBottomColor.value.setRGB(
      weightedBottomRGB[0],
      weightedBottomRGB[1],
      weightedBottomRGB[2]
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
