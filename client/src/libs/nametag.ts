import { NearestFilter } from "three";

import { SpriteText } from "./sprite-text";

export class NameTag extends SpriteText {
  constructor(
    text: string,
    {
      fontFace = `monospace`,
      fontSize = 0.1,
      yOffset = 0,
      color = `#ffffff`,
      backgroundColor = "#00000077",
    }: {
      fontFace?: string;
      fontSize?: number;
      yOffset?: number;
      color?: string;
      backgroundColor?: string;
    } = {}
  ) {
    super(text, fontSize);

    this.fontFace = fontFace;
    this.position.y += yOffset;
    this.backgroundColor = backgroundColor;
    this.material.depthTest = false;
    this.renderOrder = 1000000000000;
    this.strokeColor = color;

    const image = this.material.map;

    if (image) {
      image.minFilter = NearestFilter;
      image.magFilter = NearestFilter;
    }
  }
}
