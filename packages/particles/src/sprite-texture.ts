import { CanvasTexture, ColorManagement, SRGBColorSpace, Texture } from "three";

let cached: Texture | null = null;

export function getDefaultSpriteTexture(): Texture {
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("[@voxelize/particles] 2D canvas context unavailable");
  }

  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0.0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  if (ColorManagement.enabled) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  cached = texture;
  return texture;
}
