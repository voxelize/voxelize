import { describe, expect, it } from "vitest";
import { MENU_KEYS } from "./touch";

describe("touch menu", () => {
  it("reaches every panel a keyboard opens with a key", () => {
    const codes = MENU_KEYS.map((m) => m.code);
    for (const code of ["Enter", "KeyO", "KeyJ", "KeyH", "KeyM", "KeyG", "KeyL", "KeyB", "KeyK", "KeyT", "KeyY", "KeyV"]) {
      expect(codes).toContain(code);
    }
    expect(new Set(MENU_KEYS.map((m) => m.label)).size).toBe(MENU_KEYS.length);
  });
});
