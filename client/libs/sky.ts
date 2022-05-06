import {
  BackSide,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
} from "three";

import { CanvasBox } from "./canvas-box";
import SkyFragmentShader from "./shaders/sky/fragment.glsl";
import SkyVertexShader from "./shaders/sky/vertex.glsl";

export const hi = "hi";

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

class Sky {
  public skyBox: CanvasBox;

  public mesh = new Group();

  private topColor: Color;
  private middleColor: Color;
  private bottomColor: Color;
  private newTopColor: Color;
  private newMiddleColor: Color;
  private newBottomColor: Color;

  constructor(public dimension: number) {
    this.createSkyShading();
  }

  createSkyShading = () => {
    const {
      color: { top, middle, bottom },
      skyOffset,
      voidOffset,
    } = SKY_CONFIGS.hours[700];

    this.topColor = new Color(top);
    this.middleColor = new Color(middle);
    this.bottomColor = new Color(bottom);

    const shadingGeometry = new SphereGeometry(this.dimension);
    const shadingMaterial = new ShaderMaterial({
      uniforms: {
        topColor: { value: this.topColor },
        middleColor: { value: this.middleColor },
        bottomColor: { value: this.bottomColor },
        skyOffset: { value: skyOffset },
        voidOffset: { value: voidOffset },
        exponent: { value: 0.6 },
        exponent2: { value: 1.2 },
      },
      vertexShader: SkyVertexShader,
      fragmentShader: SkyFragmentShader,
      depthWrite: false,
      side: BackSide,
    });
    const shadingMesh = new Mesh(shadingGeometry, shadingMaterial);

    this.mesh.add(shadingMesh);
  };
}

export { Sky };
