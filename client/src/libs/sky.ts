import {
  BackSide,
  Color,
  DodecahedronGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

import { DOMUtils } from "../utils";

import { CanvasBox } from "./canvas-box";
import SkyFragmentShader from "./shaders/sky/fragment.glsl";
import SkyVertexShader from "./shaders/sky/vertex.glsl";

export const STAR_COLORS = [
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#8589FF",
  "#FF8585",
];

export const SKY_CONFIGS = {
  hours: {
    0: {
      color: {
        top: new Color("#000"),
        middle: new Color("#000"),
        bottom: new Color("#000"),
      },
      skyOffset: 200,
      voidOffset: 1200,
    },
    // start of sunrise
    600: {
      color: {
        top: new Color("#7694CF"),
        middle: new Color("#B0483A"),
        bottom: new Color("#222"),
      },
      skyOffset: 100,
      voidOffset: 1200,
    },
    // end of sunrise, start of day
    700: {
      color: {
        top: new Color("#73A3FB"),
        middle: new Color("#B1CCFD"),
        bottom: new Color("#B1CCFD"),
      },
      skyOffset: 0,
      voidOffset: 1200,
    },
    // start of sunset
    1700: {
      color: {
        top: new Color("#A57A59"),
        middle: new Color("#FC5935"),
        bottom: new Color("#222"),
      },
      skyOffset: 100,
      voidOffset: 1200,
    },
    // end of sunset, back to night
    1800: {
      color: {
        top: new Color("#000"),
        middle: new Color("#000"),
        bottom: new Color("#000"),
      },
      skyOffset: 200,
      voidOffset: 1200,
    },
  },
};

export function drawSun(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement
) {
  const radius = 50;
  const sunColor = "#f8ffb5";

  const color = new Color(sunColor);

  context.save();

  // bg glow
  context.beginPath();
  let x = canvas.width / 2;
  let y = canvas.height / 2;
  const grd = context.createRadialGradient(x, y, 1, x, y, radius * 2);
  grd.addColorStop(0, DOMUtils.rgba(1, 1, 1, 0.3));
  grd.addColorStop(1, DOMUtils.rgba(1, 1, 1, 0));
  context.arc(x, y, radius * 3, 0, 2 * Math.PI, false);
  context.fillStyle = grd;
  context.fill();
  context.closePath();

  // outer sun
  context.beginPath();
  x = canvas.width / 2 - radius / 2;
  y = canvas.height / 2 - radius / 2;
  context.rect(x, y, radius, radius);
  context.fillStyle = DOMUtils.rgba(color.r, color.g, color.b, 1);
  context.fill();
  context.closePath();

  // inner sun
  context.beginPath();
  const r = radius / 1.6;
  x = canvas.width / 2 - r / 2;
  y = canvas.height / 2 - r / 2;
  context.rect(x, y, r, r);
  context.fillStyle = DOMUtils.rgba(1, 1, 1, 0.5);
  context.fill();
  context.closePath();

  context.restore();
}

export class Sky extends CanvasBox {
  public uTopColor: {
    value: Color;
  };
  public uMiddleColor: {
    value: Color;
  };
  public uBottomColor: {
    value: Color;
  };

  private newTopColor: Color;
  private newMiddleColor: Color;
  private newBottomColor: Color;

  constructor(public dimension: number = 2000, public lerpFactor = 0.01) {
    super({
      width: dimension * 0.2,
      side: BackSide,
      transparent: true,
      widthSegments: 512,
      heightSegments: 512,
      depthSegments: 512,
    });

    this.boxMaterials.forEach((m) => (m.depthWrite = false));
    this.frustumCulled = false;
    this.renderOrder = -1;

    this.createSkyShading();
  }

  update = (position: Vector3) => {
    const { uTopColor, uMiddleColor, uBottomColor } = this;

    this.position.copy(position);

    uTopColor.value.lerp(this.newTopColor, this.lerpFactor);
    uMiddleColor.value.lerp(this.newMiddleColor, this.lerpFactor);
    uBottomColor.value.lerp(this.newBottomColor, this.lerpFactor);
  };

  private createSkyShading = () => {
    const {
      color: { top, middle, bottom },
      skyOffset,
      voidOffset,
    } = SKY_CONFIGS.hours[700];

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
