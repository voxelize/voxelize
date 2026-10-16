/**
 * Wheel events read the way a design tool reads them: two fingers on a
 * trackpad pan the view under them, a pinch (which Chromium sends as a wheel
 * with Ctrl) or Cmd/Ctrl with a scroll zooms at the pointer, and a mouse's
 * notched wheel zooms. One gesture keeps the device it started as, so a
 * trackpad's momentum tail never flips into a zoom halfway.
 */

export type WheelDevice = "mouse" | "trackpad";

export type WheelGesture =
  | {
      kind: "zoom";
      /** Multiplies the view distance: above 1 pulls back. */
      factor: number;
      device: WheelDevice;
    }
  | {
      kind: "pan";
      /** CSS pixels the content moves under the fingers. */
      dx: number;
      dy: number;
    };

export type WheelLike = Pick<
  WheelEvent,
  "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "metaKey"
>;

/**
 * One notch of a mouse wheel on macOS in Chromium and WebKit, in pixels; a
 * trackpad never lands on its multiples (Mapbox GL's tell).
 */
const MAC_NOTCH = 4.000244140625;

/** A pause this long between events starts a new gesture. */
const GESTURE_GAP_MS = 300;

/** Pixels per line and per page, for wheels that count in those. */
const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;

/** Log-distance per pixel: a pinch (1:1 with the fingers), Cmd+scroll, a mouse wheel. */
const PINCH_RATE = 0.01;
const SCROLL_ZOOM_RATE = 0.004;
const MOUSE_ZOOM_RATE = 0.0015;

/** Which device a lone wheel event most likely came from; null when it carries nothing to tell by. */
export function wheelDevice(e: WheelLike): WheelDevice | null {
  if (e.deltaMode) return "mouse";
  const x = e.deltaX || 0;
  const y = e.deltaY || 0;
  // Only a trackpad scrolls both axes at once.
  if (x !== 0 && y !== 0) return "trackpad";
  const v = Math.abs(y || x);
  if (v === 0) return null;
  const notches = v / MAC_NOTCH;
  if (Math.abs(notches - Math.round(notches)) < 1e-6) return "mouse";
  // Windows and Linux Chromium: about a hundred pixels a notch.
  if (Number.isInteger(v) && v >= 50) return "mouse";
  return "trackpad";
}

export class WheelReader {
  private device: WheelDevice = "trackpad";

  private lastAt = -Infinity;

  /** What `e`, arriving at `now` ms, asks of the camera; null when it moves nothing. */
  read(e: WheelLike, now: number): WheelGesture | null {
    if (now - this.lastAt > GESTURE_GAP_MS) {
      this.device = wheelDevice(e) ?? this.device;
    }
    this.lastAt = now;
    const scale =
      e.deltaMode === 1 ? LINE_PIXELS : e.deltaMode === 2 ? PAGE_PIXELS : 1;
    const dx = (e.deltaX || 0) * scale;
    const dy = (e.deltaY || 0) * scale;
    if (!dx && !dy) return null;
    const device = this.device;
    if (e.ctrlKey || e.metaKey) {
      const rate =
        device === "mouse"
          ? MOUSE_ZOOM_RATE
          : e.ctrlKey
            ? PINCH_RATE
            : SCROLL_ZOOM_RATE;
      return { kind: "zoom", factor: Math.exp((dy || dx) * rate), device };
    }
    if (device === "mouse") {
      return {
        kind: "zoom",
        factor: Math.exp((dy || dx) * MOUSE_ZOOM_RATE),
        device,
      };
    }
    return { kind: "pan", dx: -dx, dy: -dy };
  }
}
