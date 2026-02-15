import { describe, expect, it } from "vitest";

import { findSimilar, formatSuggestion, toLowerCaseIfNeeded } from "../src/utils/string-utils";

describe("string utils", () => {
  it("lowercases only when needed", () => {
    expect(toLowerCaseIfNeeded("vox-builtin:event")).toBe("vox-builtin:event");
    expect(toLowerCaseIfNeeded("VoX-BUILTIN:Event")).toBe("vox-builtin:event");
  });

  it("handles unicode uppercase normalization", () => {
    expect(toLowerCaseIfNeeded("Äction")).toBe("äction");
    expect(toLowerCaseIfNeeded("ümlaut")).toBe("ümlaut");
  });

  it("finds similar names using split and include heuristics", () => {
    const suggestions = findSimilar("stone-brik", [
      "stone-brick",
      "grass-block",
      "stone_slab",
      "water",
    ]);
    expect(suggestions[0]).toBe("stone-brick");
    expect(suggestions).toContain("stone_slab");
  });

  it("formats fallback output when there are no suggestions", () => {
    const message = formatSuggestion([], ["a", "b", "c"]);
    expect(message).toContain("Available");
    expect(message).toContain("\"a\"");
  });
});
