import { describe, expect, it } from "vitest";

import {
  CaptureViewport,
  CaptureViewportError,
  expectedBackingSize,
  MAX_CAPTURE_BACKING_PIXELS,
  MAX_CAPTURE_DIMENSION,
  MAX_CAPTURE_SCALE,
  parseCaptureViewportQuery,
  resolveCaptureViewport,
} from "./capture-viewport";

const current: CaptureViewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
};

describe("parseCaptureViewportQuery", () => {
  it("returns all-undefined when no fields are present", () => {
    expect(parseCaptureViewportQuery({})).toEqual({
      width: undefined,
      height: undefined,
      deviceScaleFactor: undefined,
    });
  });

  it("parses numeric strings", () => {
    expect(
      parseCaptureViewportQuery({
        width: "2560",
        height: "1440",
        scale: "1.5",
      }),
    ).toEqual({ width: 2560, height: 1440, deviceScaleFactor: 1.5 });
  });

  it("parses a subset of fields", () => {
    expect(parseCaptureViewportQuery({ scale: "3" })).toEqual({
      width: undefined,
      height: undefined,
      deviceScaleFactor: 3,
    });
  });

  it.each([
    ["width", { width: "abc" }],
    ["width", { width: "" }],
    ["width", { width: "  " }],
    ["height", { height: "12px" }],
    ["height", { height: "NaN" }],
    ["scale", { scale: "Infinity" }],
    ["scale", { scale: "1.5x" }],
  ])("rejects non-numeric %s", (field, query) => {
    expect(() => parseCaptureViewportQuery(query)).toThrowError(
      CaptureViewportError,
    );
    expect(() => parseCaptureViewportQuery(query)).toThrowError(
      new RegExp(`^${field} `),
    );
  });
});

describe("resolveCaptureViewport", () => {
  it("returns null when nothing is requested", () => {
    expect(resolveCaptureViewport({}, current)).toBeNull();
  });

  it("resolves a full request", () => {
    expect(
      resolveCaptureViewport(
        { width: 2560, height: 1440, deviceScaleFactor: 1.5 },
        current,
      ),
    ).toEqual({ width: 2560, height: 1440, deviceScaleFactor: 1.5 });
  });

  it("falls back to the current viewport for missing fields", () => {
    expect(resolveCaptureViewport({ deviceScaleFactor: 3 }, current)).toEqual({
      width: 1280,
      height: 720,
      deviceScaleFactor: 3,
    });
    expect(resolveCaptureViewport({ width: 1920 }, current)).toEqual({
      width: 1920,
      height: 720,
      deviceScaleFactor: 1,
    });
  });

  it("accepts the documented 4K example", () => {
    const viewport = resolveCaptureViewport(
      { width: 2560, height: 1440, deviceScaleFactor: 1.5 },
      current,
    );
    expect(viewport).not.toBeNull();
    expect(expectedBackingSize(viewport as CaptureViewport)).toEqual({
      width: 3840,
      height: 2160,
    });
  });

  it("accepts the maximum 8K budget exactly", () => {
    expect(
      resolveCaptureViewport(
        { width: 7680, height: 4320, deviceScaleFactor: 1 },
        current,
      ),
    ).toEqual({ width: 7680, height: 4320, deviceScaleFactor: 1 });
  });

  it.each([
    ["zero width", { width: 0 }],
    ["negative width", { width: -100 }],
    ["NaN width", { width: Number.NaN }],
    ["infinite width", { width: Number.POSITIVE_INFINITY }],
    ["fractional width", { width: 1280.5 }],
    ["oversized width", { width: MAX_CAPTURE_DIMENSION + 1 }],
    ["zero height", { height: 0 }],
    ["negative height", { height: -1 }],
    ["fractional height", { height: 719.9 }],
    ["oversized height", { height: MAX_CAPTURE_DIMENSION + 1 }],
    ["zero scale", { deviceScaleFactor: 0 }],
    ["negative scale", { deviceScaleFactor: -2 }],
    ["NaN scale", { deviceScaleFactor: Number.NaN }],
    ["oversized scale", { deviceScaleFactor: MAX_CAPTURE_SCALE + 0.01 }],
  ])("rejects %s", (_label, requested) => {
    expect(() => resolveCaptureViewport(requested, current)).toThrowError(
      CaptureViewportError,
    );
  });

  it("rejects captures whose backing pixels exceed the 8K budget", () => {
    expect(() =>
      resolveCaptureViewport(
        { width: 7680, height: 4320, deviceScaleFactor: 1.01 },
        current,
      ),
    ).toThrowError(/exceeding the maximum/);
    expect(() =>
      resolveCaptureViewport(
        { width: 5000, height: 5000, deviceScaleFactor: 1.2 },
        current,
      ),
    ).toThrowError(CaptureViewportError);
  });

  it("keeps the backing budget consistent with the exported constant", () => {
    expect(MAX_CAPTURE_BACKING_PIXELS).toBe(7680 * 4320);
  });
});

describe("expectedBackingSize", () => {
  it("floors fractional products like renderers do", () => {
    expect(
      expectedBackingSize({ width: 1111, height: 733, deviceScaleFactor: 1.5 }),
    ).toEqual({ width: 1666, height: 1099 });
  });
});
