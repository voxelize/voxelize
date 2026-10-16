import { describe, expect, it } from "vitest";

import { WheelReader, wheelDevice } from "./scroll";

const wheel = (props: Partial<WheelEvent>) => ({
  deltaMode: 0,
  deltaX: 0,
  deltaY: 0,
  ctrlKey: false,
  metaKey: false,
  ...props,
});

describe("wheelDevice", () => {
  it("tells a notched mouse wheel from a trackpad", () => {
    // macOS Chromium and WebKit: multiples of one notch.
    expect(wheelDevice(wheel({ deltaY: 4.000244140625 }))).toBe("mouse");
    expect(wheelDevice(wheel({ deltaY: -4.000244140625 * 7 }))).toBe("mouse");
    // Shift turns a mouse wheel sideways.
    expect(wheelDevice(wheel({ deltaX: 4.000244140625 * 3 }))).toBe("mouse");
    // Windows and Linux Chromium, and Firefox counting lines.
    expect(wheelDevice(wheel({ deltaY: 100 }))).toBe("mouse");
    expect(wheelDevice(wheel({ deltaY: 3, deltaMode: 1 }))).toBe("mouse");
    // A trackpad: small or fractional steps, or both axes at once.
    expect(wheelDevice(wheel({ deltaY: 4 }))).toBe("trackpad");
    expect(wheelDevice(wheel({ deltaY: 2.5 }))).toBe("trackpad");
    expect(wheelDevice(wheel({ deltaX: 1, deltaY: 60 }))).toBe("trackpad");
    expect(wheelDevice(wheel({}))).toBeNull();
  });
});

describe("WheelReader", () => {
  it("pans with a trackpad's two fingers, the content following them", () => {
    const reader = new WheelReader();
    expect(reader.read(wheel({ deltaX: 3, deltaY: -7.5 }), 0)).toEqual({
      kind: "pan",
      dx: -3,
      dy: 7.5,
    });
  });

  it("zooms on a pinch, Cmd+scroll and a mouse wheel", () => {
    const pinch = new WheelReader().read(
      wheel({ deltaY: -10, ctrlKey: true }),
      0,
    );
    expect(pinch).toMatchObject({ kind: "zoom", device: "trackpad" });
    expect(pinch?.kind === "zoom" && pinch.factor).toBeCloseTo(
      Math.exp(-0.1),
      9,
    );
    const cmd = new WheelReader().read(wheel({ deltaY: 10, metaKey: true }), 0);
    expect(cmd?.kind === "zoom" && cmd.factor).toBeGreaterThan(1);
    const mouse = new WheelReader().read(wheel({ deltaY: 100 }), 0);
    expect(mouse).toMatchObject({ kind: "zoom", device: "mouse" });
  });

  it("keeps the device a gesture started as until it pauses", () => {
    const reader = new WheelReader();
    expect(reader.read(wheel({ deltaY: 1.5 }), 0)?.kind).toBe("pan");
    // A momentum tail can land on a notch's multiple; it stays a pan.
    expect(reader.read(wheel({ deltaY: 4.000244140625 }), 16)?.kind).toBe(
      "pan",
    );
    expect(reader.read(wheel({ deltaY: 100 }), 32)?.kind).toBe("pan");
    // After a pause, a mouse notch is a zoom again.
    expect(reader.read(wheel({ deltaY: 100 }), 1000)?.kind).toBe("zoom");
  });
});
