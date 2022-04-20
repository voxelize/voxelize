import { MeshBasicMaterial, DoubleSide } from "three";

import { CanvasBox } from "./canvas-box";

type HeadParams = {
  headDimension: number;
};

class Head {
  public box: CanvasBox;

  constructor(public params: HeadParams) {
    const { headDimension } = this.params;

    this.box = new CanvasBox({
      dimension: headDimension,
      gap: 0.02,
      layers: 2,
      side: DoubleSide,
    });

    this.box.paint("all", this.drawBackground);
    this.box.paint("front", this.drawFace);
    // this.box.paint("sides", this.drawCrown, 1);

    // to fix the transparency with leaves issue
    this.mesh.renderOrder = 10000000000;
  }

  private drawBackground = (
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement
  ) => {
    context.fillStyle = "#323232";
    context.fillRect(0, 0, canvas.width, canvas.height);
  };

  private drawFace = (context: CanvasRenderingContext2D) => {
    context.fillStyle = "#E9DAC1";
    context.fillRect(1, 1, 6, 6);

    context.fillStyle = "#121013";
    context.fillRect(2, 2, 4, 4);

    context.fillStyle = "#eee";
    context.fillRect(3, 3, 2, 2);
    // // mouth
    // context.fillRect(3, 4, 1, 1);
    // context.fillRect(3, 5, 1, 1);
    // context.fillRect(4, 5, 1, 1);
    // context.fillRect(5, 5, 1, 1);
    // context.fillRect(5, 4, 1, 1);
    // // eyes
    // context.fillRect(0, 4, 1, 1);
    // context.fillRect(7, 3, 1, 1);
  };

  private drawCrown = (context: CanvasRenderingContext2D) => {
    const gold = [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [2, 1],
      [3, 0],
      [3, 2],
      [4, 0],
      [4, 2],
      [5, 1],
      [5, 2],
      [6, 2],
      [7, 0],
      [7, 1],
      [7, 2],
    ];

    const blue = [
      [1, 1],
      [6, 1],
    ];

    context.fillStyle = "#f7ea00";
    gold.forEach(([x, y]) => context.fillRect(x, y, 1, 1));

    context.fillStyle = "#51c2d5";
    blue.forEach(([x, y]) => context.fillRect(x, y, 1, 1));

    context.fillStyle = "#ff005c";
    context.fillRect(3, 1, 1, 1);
    context.fillRect(4, 1, 1, 1);
  };

  private drawHair = (material: MeshBasicMaterial) => {
    const canvas = <HTMLCanvasElement>material.map?.image;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
  };

  get mesh() {
    return this.box.meshes;
  }
}

export { Head };
