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
      expect(ColorText.split("", "white")).toEqual([]);
      expect(ColorText.split("just plain text", "white")).toEqual([
        { color: "white", text: "just plain text" },
      ]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });

  it("treats unmatched splitter tokens as plain text", () => {
    const previousSplitter = ColorText.SPLITTER;
    ColorText.SPLITTER = "$";
    try {
      expect(ColorText.split("hello$red", "black")).toEqual([
        { color: "black", text: "hello$red" },
      ]);
      expect(ColorText.split("$red", "black")).toEqual([
        { color: "black", text: "$red" },
      ]);
      expect(ColorText.split("$red$hello$blue", "black")).toEqual([
        { color: "red", text: "hello$blue" },
      ]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });

  it("parses alternating color tokens into ordered colored segments", () => {
    const previousSplitter = ColorText.SPLITTER;
    ColorText.SPLITTER = "$";
    try {
      expect(ColorText.split("$green$Hello$yellow$World", "black")).toEqual([
        { color: "green", text: "Hello" },
        { color: "yellow", text: "World" },
      ]);
      expect(ColorText.split("Lead$green$Trail", "black")).toEqual([
        { color: "black", text: "Lead" },
        { color: "green", text: "Trail" },
      ]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });

  it("keeps trailing color tokens as empty segments", () => {
    const previousSplitter = ColorText.SPLITTER;
    ColorText.SPLITTER = "$";
    try {
      expect(ColorText.split("$red$", "black")).toEqual([
        { color: "red", text: "" },
      ]);
      expect(ColorText.split("lead$red$", "black")).toEqual([
        { color: "black", text: "lead" },
        { color: "red", text: "" },
      ]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });

  it("merges adjacent segments when the active color token repeats", () => {
    const previousSplitter = ColorText.SPLITTER;
    ColorText.SPLITTER = "$";
    try {
      expect(ColorText.split("$red$Hello$red$World", "black")).toEqual([
        { color: "red", text: "HelloWorld" },
      ]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });

  it("supports multi-character splitters across matched and unmatched tokens", () => {
    const previousSplitter = ColorText.SPLITTER;
    ColorText.SPLITTER = "::";
    try {
      expect(ColorText.split("::green::Hello::yellow::World", "black")).toEqual([
        { color: "green", text: "Hello" },
        { color: "yellow", text: "World" },
      ]);
      expect(ColorText.split("lead::green::trail::blue", "black")).toEqual([
        { color: "black", text: "lead" },
        { color: "green", text: "trail::blue" },
      ]);
    } finally {
      ColorText.SPLITTER = previousSplitter;
    }
  });
});
