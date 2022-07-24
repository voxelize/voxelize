import { LinearFilter, Sprite, SpriteMaterial, Texture } from "three";

import { ColorText } from "./color-text";

export class SpriteText extends Sprite {
  private _text: string;
  private _textHeight: number;
  private _backgroundColor: false | string;

  private _padding = 0;
  private _borderWidth = 0;
  private _borderRadius = 0;
  private _borderColor = "white";

  private _strokeWidth = 0;
  private _strokeColor = "white";

  private _fontFace = "Arial";
  private _fontSize = 90;
  private _fontWeight = "normal";

  private _canvas = document.createElement("canvas");

  constructor(text = "", textHeight = 10) {
    super(new SpriteMaterial());

    this._text = `${text}`;
    this._textHeight = textHeight;
    this._backgroundColor = false;

    this.generate();
  }

  get text() {
    return this._text;
  }
  set text(text) {
    this._text = text;
    this.generate();
  }
  get textHeight() {
    return this._textHeight;
  }
  set textHeight(textHeight) {
    this._textHeight = textHeight;
    this.generate();
  }
  get backgroundColor() {
    return this._backgroundColor;
  }
  set backgroundColor(color) {
    this._backgroundColor = color;
    this.generate();
  }
  get padding() {
    return this._padding;
  }
  set padding(padding) {
    this._padding = padding;
    this.generate();
  }
  get borderWidth() {
    return this._borderWidth;
  }
  set borderWidth(borderWidth) {
    this._borderWidth = borderWidth;
    this.generate();
  }
  get borderRadius() {
    return this._borderRadius;
  }
  set borderRadius(borderRadius) {
    this._borderRadius = borderRadius;
    this.generate();
  }
  get borderColor() {
    return this._borderColor;
  }
  set borderColor(borderColor) {
    this._borderColor = borderColor;
    this.generate();
  }
  get fontFace() {
    return this._fontFace;
  }
  set fontFace(fontFace) {
    this._fontFace = fontFace;
    this.generate();
  }
  get fontSize() {
    return this._fontSize;
  }
  set fontSize(fontSize) {
    this._fontSize = fontSize;
    this.generate();
  }
  get fontWeight() {
    return this._fontWeight;
  }
  set fontWeight(fontWeight) {
    this._fontWeight = fontWeight;
    this.generate();
  }
  get strokeWidth() {
    return this._strokeWidth;
  }
  set strokeWidth(strokeWidth) {
    this._strokeWidth = strokeWidth;
    this.generate();
  }
  get strokeColor() {
    return this._strokeColor;
  }
  set strokeColor(strokeColor) {
    this._strokeColor = strokeColor;
    this.generate();
  }

  private generate = () => {
    const canvas = this._canvas;
    const ctx = canvas.getContext("2d");

    const border = Array.isArray(this.borderWidth)
      ? this.borderWidth
      : [this.borderWidth, this.borderWidth]; // x,y border
    const relBorder = border.map((b) => b * this.fontSize * 0.1) as [
      number,
      number
    ]; // border in canvas units

    const borderRadius = Array.isArray(this.borderRadius)
      ? this.borderRadius
      : [
          this.borderRadius,
          this.borderRadius,
          this.borderRadius,
          this.borderRadius,
        ]; // tl tr br bl corners
    const relBorderRadius = borderRadius.map((b) => b * this.fontSize * 0.1); // border radius in canvas units

    const padding = Array.isArray(this.padding)
      ? this.padding
      : [this.padding, this.padding]; // x,y padding
    const relPadding = padding.map((p) => p * this.fontSize * 0.1) as [
      number,
      number
    ]; // padding in canvas units

    const lines = this.text.split("\n");
    const font = `${this.fontWeight} ${this.fontSize}px ${this.fontFace}`;

    ctx.font = font; // measure canvas with appropriate font
    const innerWidth = Math.max(
      ...lines.map((line) => {
        const splitted = ColorText.split(line);

        let sumLength = 0;
        splitted.forEach(
          ({ text }) => (sumLength += ctx.measureText(text).width)
        );

        return sumLength;
      })
    );
    const innerHeight = this.fontSize * lines.length;
    canvas.width = innerWidth + relBorder[0] * 2 + relPadding[0] * 2;
    canvas.height = innerHeight + relBorder[1] * 2 + relPadding[1] * 2;

    // paint border
    if (this.borderWidth) {
      ctx.strokeStyle = this.borderColor;

      if (relBorder[0]) {
        // left + right borders
        const hb = relBorder[0] / 2;
        ctx.lineWidth = relBorder[0];
        ctx.beginPath();
        ctx.moveTo(hb, relBorderRadius[0]);
        ctx.lineTo(hb, canvas.height - relBorderRadius[3]);
        ctx.moveTo(canvas.width - hb, relBorderRadius[1]);
        ctx.lineTo(canvas.width - hb, canvas.height - relBorderRadius[2]);
        ctx.stroke();
      }

      if (relBorder[1]) {
        // top + bottom borders
        const hb = relBorder[1] / 2;
        ctx.lineWidth = relBorder[1];
        ctx.beginPath();
        ctx.moveTo(Math.max(relBorder[0], relBorderRadius[0]), hb);
        ctx.lineTo(
          canvas.width - Math.max(relBorder[0], relBorderRadius[1]),
          hb
        );
        ctx.moveTo(
          Math.max(relBorder[0], relBorderRadius[3]),
          canvas.height - hb
        );
        ctx.lineTo(
          canvas.width - Math.max(relBorder[0], relBorderRadius[2]),
          canvas.height - hb
        );
        ctx.stroke();
      }

      if (this.borderRadius) {
        // strike rounded corners
        const cornerWidth = Math.max(...relBorder);
        const hb = cornerWidth / 2;
        ctx.lineWidth = cornerWidth;
        ctx.beginPath();
        [
          !!relBorderRadius[0] && [
            relBorderRadius[0],
            hb,
            hb,
            relBorderRadius[0],
          ],
          !!relBorderRadius[1] && [
            canvas.width - relBorderRadius[1],
            canvas.width - hb,
            hb,
            relBorderRadius[1],
          ],
          !!relBorderRadius[2] && [
            canvas.width - relBorderRadius[2],
            canvas.width - hb,
            canvas.height - hb,
            canvas.height - relBorderRadius[2],
          ],
          !!relBorderRadius[3] && [
            relBorderRadius[3],
            hb,
            canvas.height - hb,
            canvas.height - relBorderRadius[3],
          ],
        ]
          .filter((d) => d)
          .forEach(([x0, x1, y0, y1]) => {
            ctx.moveTo(x0, y0);
            ctx.quadraticCurveTo(x1, y0, x1, y1);
          });
        ctx.stroke();
      }
    }

    // paint background
    if (this.backgroundColor) {
      ctx.fillStyle = this.backgroundColor;
      if (!this.borderRadius) {
        ctx.fillRect(
          relBorder[0],
          relBorder[1],
          canvas.width - relBorder[0] * 2,
          canvas.height - relBorder[1] * 2
        );
      } else {
        // fill with rounded corners
        ctx.beginPath();
        ctx.moveTo(relBorder[0], relBorderRadius[0]);
        [
          [
            relBorder[0],
            relBorderRadius[0],
            canvas.width - relBorderRadius[1],
            relBorder[1],
            relBorder[1],
            relBorder[1],
          ], // t
          [
            canvas.width - relBorder[0],
            canvas.width - relBorder[0],
            canvas.width - relBorder[0],
            relBorder[1],
            relBorderRadius[1],
            canvas.height - relBorderRadius[2],
          ], // r
          [
            canvas.width - relBorder[0],
            canvas.width - relBorderRadius[2],
            relBorderRadius[3],
            canvas.height - relBorder[1],
            canvas.height - relBorder[1],
            canvas.height - relBorder[1],
          ], // b
          [
            relBorder[0],
            relBorder[0],
            relBorder[0],
            canvas.height - relBorder[1],
            canvas.height - relBorderRadius[3],
            relBorderRadius[0],
          ], // t
        ].forEach(([x0, x1, x2, y0, y1, y2]) => {
          ctx.quadraticCurveTo(x0, y0, x1, y1);
          ctx.lineTo(x2, y2);
        });
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.translate(...relBorder);
    ctx.translate(...relPadding);

    // paint text
    ctx.font = font; // Set font again after canvas is resized, as context properties are reset
    ctx.textBaseline = "bottom";

    const drawTextStroke = this.strokeWidth > 0;
    if (drawTextStroke) {
      ctx.lineWidth = (this.strokeWidth * this.fontSize) / 10;
      ctx.strokeStyle = this.strokeColor;
    }

    lines.forEach((line, index) => {
      const splitted = ColorText.split(line);

      let sumLength = 0;
      splitted.forEach(
        ({ text }) => (sumLength += ctx.measureText(text).width)
      );

      let lineX = (innerWidth - sumLength) / 2;
      const lineY = (index + 1) * this.fontSize;

      splitted.forEach(({ color, text }) => {
        ctx.fillStyle = color;
        ctx.fillText(text, lineX, lineY);
        drawTextStroke && ctx.strokeText(text, lineX, lineY);
        ctx.fillText(text, lineX, lineY);
        lineX += ctx.measureText(text).width;
      });
    });

    // Inject canvas into sprite
    if (this.material.map) this.material.map.dispose(); // gc previous texture
    const texture = (this.material.map = new Texture(canvas));
    texture.minFilter = LinearFilter;
    texture.needsUpdate = true;

    const yScale =
      this.textHeight * lines.length + border[1] * 2 + padding[1] * 2;
    this.scale.set((yScale * canvas.width) / canvas.height, yScale, 0);
  };
}
