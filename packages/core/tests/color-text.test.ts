import { describe, expect, it } from "vitest";

import { ColorText } from "../src/libs/color-text";

describe("ColorText.split", () => {
  it("returns a default-color segment when splitter is empty", () => {
    const previousSplitter = ColorText.SPLITTER;
    ColorText.SPLITTER = "";
    try {
      expect(ColorText.split("hello", "blue")).toEqual([
        { color: "blue", text: "hello" },
      ]);
      expect(ColorText.split("", "blue")).toEqual([]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });

  it("keeps plain text parsing when splitter is non-empty", () => {
    const previousSplitter = ColorText.SPLITTER;
    ColorText.SPLITTER = "$";
    try {
      expect(ColorText.split("hello world", "black")).toEqual([
        { color: "black", text: "hello world" },
      ]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });

  it("short-circuits plain text when splitter does not appear", () => {
    const previousSplitter = ColorText.SPLITTER;
    ColorText.SPLITTER = "##";
    try {
      expect(ColorText.split("just plain text", "white")).toEqual([
        { color: "white", text: "just plain text" },
      ]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });
});
