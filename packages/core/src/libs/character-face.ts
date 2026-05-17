import { Color, type ColorRepresentation, MathUtils } from "three";

export interface CharacterFaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FACE_STYLE = {
  eyeRimColor: "#111722",
  eyeTopColor: "#7d8f93",
  eyeBottomColor: "#3c4f58",
  eyeLeftCenterXRatio: 0.28,
  eyeRightCenterXRatio: 0.72,
  eyeYRatio: 0.22,
  eyeWidthRatio: 0.26,
  eyeHeightRatio: 0.5,
  minEyeWidth: 4,
  minEyeHeight: 4,
} as const;

function colorToCanvasRgb(color: ColorRepresentation): string {
  const srgbColor = new Color(color).convertLinearToSRGB();
  const red = Math.round(MathUtils.clamp(srgbColor.r, 0, 1) * 255);
  const green = Math.round(MathUtils.clamp(srgbColor.g, 0, 1) * 255);
  const blue = Math.round(MathUtils.clamp(srgbColor.b, 0, 1) * 255);

  return `rgb(${red},${green},${blue})`;
}

function fillFaceRect(
  context: CanvasRenderingContext2D,
  bounds: CharacterFaceBounds,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.fillRect(bounds.x + x, bounds.y + y, width, height);
}

function fillPixelOctagon(
  context: CanvasRenderingContext2D,
  bounds: CharacterFaceBounds,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  for (let row = 0; row < height; row++) {
    const isEdgeRow = row === 0 || row === height - 1;
    const rowInset = isEdgeRow ? 1 : 0;
    const rowWidth = Math.max(1, width - rowInset * 2);

    fillFaceRect(context, bounds, x + rowInset, y + row, rowWidth, 1);
  }
}

function drawEye(
  context: CanvasRenderingContext2D,
  bounds: CharacterFaceBounds,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const innerWidth = Math.max(1, width - 2);
  const innerHeight = Math.max(1, height - 2);
  const innerX = x + 1;
  const innerY = y + 1;
  const topHeight = Math.max(1, Math.ceil(innerHeight * 0.55));
  const bottomHeight = Math.max(1, innerHeight - topHeight);

  context.fillStyle = FACE_STYLE.eyeRimColor;
  fillPixelOctagon(context, bounds, x, y, width, height);

  context.fillStyle = FACE_STYLE.eyeTopColor;
  fillPixelOctagon(context, bounds, innerX, innerY, innerWidth, topHeight);

  context.fillStyle = FACE_STYLE.eyeBottomColor;
  fillPixelOctagon(
    context,
    bounds,
    innerX,
    innerY + topHeight,
    innerWidth,
    bottomHeight,
  );
}

export function drawCharacterFace(
  context: CanvasRenderingContext2D,
  faceColor: ColorRepresentation,
  bounds: CharacterFaceBounds = {
    x: 0,
    y: 0,
    width: context.canvas.width,
    height: context.canvas.height,
  },
): void {
  const faceWidth = Math.max(1, Math.floor(bounds.width));
  const faceHeight = Math.max(1, Math.floor(bounds.height));
  const eyeWidth = Math.max(
    FACE_STYLE.minEyeWidth,
    Math.round(faceWidth * FACE_STYLE.eyeWidthRatio),
  );
  const eyeHeight = Math.max(
    FACE_STYLE.minEyeHeight,
    Math.round(faceHeight * FACE_STYLE.eyeHeightRatio),
  );
  const eyeY = Math.round(faceHeight * FACE_STYLE.eyeYRatio);
  const leftEyeX = Math.round(
    faceWidth * FACE_STYLE.eyeLeftCenterXRatio - eyeWidth / 2,
  );
  const rightEyeX = Math.round(
    faceWidth * FACE_STYLE.eyeRightCenterXRatio - eyeWidth / 2,
  );

  context.fillStyle = colorToCanvasRgb(faceColor);
  context.fillRect(bounds.x, bounds.y, faceWidth, faceHeight);

  drawEye(context, bounds, leftEyeX, eyeY, eyeWidth, eyeHeight);
  drawEye(context, bounds, rightEyeX, eyeY, eyeWidth, eyeHeight);
}
