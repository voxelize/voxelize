import type { Texture } from "three/webgpu";

/**
 * Partial texture uploads. three re-uploads a whole texture on
 * `needsUpdate`; a bone texture that changed a few rows, or an atlas that
 * advanced one animated tile, should write only those. These go straight to
 * the WebGPU queue (`writeTexture`, `copyExternalImageToTexture`), which
 * stages the bytes without a round trip to the GPU process.
 *
 * Each returns false when the texture is not GPU-resident yet, or the
 * renderer runs the WebGL 2 fallback: the caller then sets `needsUpdate`
 * and the next bind uploads it whole.
 */

type GpuTextureLike = object;

type GpuQueue = {
  writeTexture(
    destination: { texture: GpuTextureLike; origin: { x: number; y: number } },
    data: BufferSource,
    layout: { offset: number; bytesPerRow: number; rowsPerImage?: number },
    size: { width: number; height: number },
  ): void;
  copyExternalImageToTexture(
    source: { source: CanvasImageSource | OffscreenCanvas; flipY: boolean },
    destination: {
      texture: GpuTextureLike;
      origin: { x: number; y: number };
      premultipliedAlpha: boolean;
    },
    size: { width: number; height: number },
  ): void;
};

type WebGpuBackendLike = {
  isWebGPUBackend?: boolean;
  device?: { queue: GpuQueue } | null;
  get(object: object): { texture?: GpuTextureLike };
  textureUtils?: { generateMipmaps(texture: Texture): void };
};

/** The backend's queue and the texture's GPU copy, when both exist. */
function residentTexture(renderer: unknown, texture: Texture) {
  const backend = (renderer as { backend?: WebGpuBackendLike } | null)?.backend;
  if (!backend?.isWebGPUBackend || !backend.device) return null;
  const gpuTexture = backend.get(texture).texture;
  if (!gpuTexture) return null;
  return { backend, queue: backend.device.queue, gpuTexture };
}

/**
 * Writes rows `startRow .. startRow + rowCount` of `texture` from `data`,
 * its full CPU array (`bytesPerTexel` bytes per texel, rows `width` texels
 * wide, unflipped).
 */
export function writeTextureRows(
  renderer: unknown,
  texture: Texture,
  data: ArrayBufferView,
  width: number,
  bytesPerTexel: number,
  startRow: number,
  rowCount: number,
): boolean {
  const resident = residentTexture(renderer, texture);
  if (!resident) return false;
  const bytesPerRow = width * bytesPerTexel;
  resident.queue.writeTexture(
    { texture: resident.gpuTexture, origin: { x: 0, y: startRow } },
    data as BufferSource,
    {
      offset: startRow * bytesPerRow,
      bytesPerRow,
      rowsPerImage: rowCount,
    },
    { width, height: rowCount },
  );
  return true;
}

/**
 * Copies `image` into `texture` at texel (x, y), flipped as the texture's
 * own upload flips, its alpha premultiplied as the texture's is.
 */
export function writeTextureImage(
  renderer: unknown,
  texture: Texture,
  image: CanvasImageSource | OffscreenCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const resident = residentTexture(renderer, texture);
  if (!resident) return false;
  resident.queue.copyExternalImageToTexture(
    { source: image, flipY: texture.flipY },
    {
      texture: resident.gpuTexture,
      origin: { x, y },
      premultipliedAlpha: texture.premultiplyAlpha,
    },
    { width, height },
  );
  return true;
}

/** Rebuilds a resident texture's mip chain from its level 0. */
export function regenerateMipmaps(renderer: unknown, texture: Texture): boolean {
  const resident = residentTexture(renderer, texture);
  if (!resident?.backend.textureUtils) return false;
  resident.backend.textureUtils.generateMipmaps(texture);
  return true;
}
