import {
  BackSide,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
} from "three";

import { CanvasBox } from "../../libs/canvas-box";
import { DOMUtils } from "../../utils";

import SkyFragmentShader from "./shaders/sky/fragment.glsl";
import SkyVertexShader from "./shaders/sky/vertex.glsl";

const STAR_COLORS = [
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

const SKY_CONFIGS = {
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
        bottom: new Color("#222"),
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

class Sky extends Group {
  public box: CanvasBox;

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

  constructor(public dimension: number) {
    super();

    this.createSkyShading();
    this.createSkyBox();
  }

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

    const shadingGeometry = new SphereGeometry(this.dimension);
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

  private createSkyBox = () => {
    this.box = new CanvasBox({
      dimension: this.dimension * 0.9,
      side: BackSide,
      width: 512,
    });
    this.box.boxMaterials.forEach((m) => (m.depthWrite = false));

    const { meshes } = this.box;

    meshes.frustumCulled = false;
    meshes.renderOrder = -1;

    this.add(meshes);
  };
}

export { Sky };
