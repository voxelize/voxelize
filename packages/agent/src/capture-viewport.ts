export type CaptureViewport = {
  width: number;
  height: number;
  deviceScaleFactor: number;
};

export type RequestedCaptureViewport = Partial<CaptureViewport>;

// 8K UHD (7680x4320) is the ceiling for a single capture. Backing pixels are
// what actually cost memory and encode time under software WebGL, so the
// combined (width*scale) x (height*scale) budget is capped rather than each
// dimension alone.
export const MAX_CAPTURE_DIMENSION = 7680;
export const MAX_CAPTURE_SCALE = 4;
export const MAX_CAPTURE_BACKING_PIXELS = 7680 * 4320;

export class CaptureViewportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureViewportError";
  }
}

function requireDimension(name: "width" | "height", value: number): number {
  if (!Number.isFinite(value)) {
    throw new CaptureViewportError(
      `${name} must be a finite number, got ${String(value)}`,
    );
  }
  if (!Number.isInteger(value)) {
    throw new CaptureViewportError(
      `${name} must be an integer number of CSS pixels, got ${value}`,
    );
  }
  if (value <= 0) {
    throw new CaptureViewportError(`${name} must be positive, got ${value}`);
  }
  if (value > MAX_CAPTURE_DIMENSION) {
    throw new CaptureViewportError(
      `${name} must be at most ${MAX_CAPTURE_DIMENSION}, got ${value}`,
    );
  }
  return value;
}

function requireScale(value: number): number {
  if (!Number.isFinite(value)) {
    throw new CaptureViewportError(
      `deviceScaleFactor must be a finite number, got ${String(value)}`,
    );
  }
  if (value <= 0) {
    throw new CaptureViewportError(
      `deviceScaleFactor must be positive, got ${value}`,
    );
  }
  if (value > MAX_CAPTURE_SCALE) {
    throw new CaptureViewportError(
      `deviceScaleFactor must be at most ${MAX_CAPTURE_SCALE}, got ${value}`,
    );
  }
  return value;
}

export function expectedBackingSize(viewport: CaptureViewport): {
  width: number;
  height: number;
} {
  // Renderers floor fractional CSS-pixel * scale products (three.js does),
  // so the expected canvas backing store is the floored product.
  return {
    width: Math.floor(viewport.width * viewport.deviceScaleFactor),
    height: Math.floor(viewport.height * viewport.deviceScaleFactor),
  };
}

export function resolveCaptureViewport(
  requested: RequestedCaptureViewport,
  current: CaptureViewport,
): CaptureViewport | null {
  // Null means "no viewport override requested": the screenshot should use
  // the page exactly as it is. Missing fields fall back to the current
  // viewport so callers can e.g. only bump the scale. Invalid values throw
  // CaptureViewportError so HTTP callers can map them to a 400.
  if (
    requested.width === undefined &&
    requested.height === undefined &&
    requested.deviceScaleFactor === undefined
  ) {
    return null;
  }

  const viewport: CaptureViewport = {
    width: requireDimension("width", requested.width ?? current.width),
    height: requireDimension("height", requested.height ?? current.height),
    deviceScaleFactor: requireScale(
      requested.deviceScaleFactor ?? current.deviceScaleFactor,
    ),
  };

  const backing = expectedBackingSize(viewport);
  const backingPixels = backing.width * backing.height;
  if (backingPixels > MAX_CAPTURE_BACKING_PIXELS) {
    throw new CaptureViewportError(
      `requested capture is ${backing.width}x${backing.height} backing pixels ` +
        `(${backingPixels}), exceeding the maximum of ${MAX_CAPTURE_BACKING_PIXELS} (8K UHD)`,
    );
  }

  return viewport;
}

function parseQueryNumber(name: string, raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new CaptureViewportError(`${name} must be a number, got ""`);
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new CaptureViewportError(`${name} must be a number, got "${raw}"`);
  }
  return value;
}

export function parseCaptureViewportQuery(query: {
  width?: string;
  height?: string;
  scale?: string;
}): RequestedCaptureViewport {
  // Only syntactic parsing happens here; range validation lives in
  // resolveCaptureViewport. Non-numeric input throws CaptureViewportError so
  // the daemon can respond with a 400 instead of silently accepting it.
  return {
    width:
      query.width !== undefined
        ? parseQueryNumber("width", query.width)
        : undefined,
    height:
      query.height !== undefined
        ? parseQueryNumber("height", query.height)
        : undefined,
    deviceScaleFactor:
      query.scale !== undefined
        ? parseQueryNumber("scale", query.scale)
        : undefined,
  };
}
