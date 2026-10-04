import { describe, expect, it } from "vitest";

import { parsePrice } from "./stall";

describe("stall prices", () => {
  it("accept whole Crowns only", () => {
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice(" 25 ")).toBe(25);
    expect(parsePrice("2.5")).toBeNull();
    expect(parsePrice("-3")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("1000000001")).toBeNull();
  });
});
