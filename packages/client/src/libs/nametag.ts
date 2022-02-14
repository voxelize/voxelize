import { NearestFilter } from "three";
import SpriteText from "three-spritetext";

class NameTag extends SpriteText {
  public mesh: SpriteText;

  constructor(
    text: string,
    {
      fontFace,
      fontSize,
      yOffset,
      backgroundColor,
    }: {
      fontFace: string;
      fontSize: number;
      yOffset: number;
      backgroundColor: string;
    }
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

export { NameTag };
