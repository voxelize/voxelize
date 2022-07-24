import { NearestFilter } from "three";

import { SpriteText } from "./sprite-text";

export class NameTag extends SpriteText {
  public mesh: SpriteText;

  constructor(
    text: string,
    {
      fontFace = `monospace`,
      fontSize = 0.1,
      yOffset = 0,
      backgroundColor = "#00000077",
    }: {
      fontFace?: string;
      fontSize?: number;
      yOffset?: number;
      backgroundColor?: string;
    } = {}
  ) {
    super(text, fontSize);

    this.fontFace = fontFace;
    this.position.y += yOffset;
    this.backgroundColor = backgroundColor;
    this.material.depthTest = false;
    this.renderOrder = 10000000;

    const image = this.material.map;

    if (image) {
      image.minFilter = NearestFilter;
      image.magFilter = NearestFilter;
    }
  }
}
