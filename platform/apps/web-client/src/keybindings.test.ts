import { describe, expect, it } from "vitest";
import { actionFor, conflicts, DEFAULT_KEYS, keyLabel, sanitizeKeys } from "./keybindings";

describe("key bindings", () => {
  it("defaults to the classic layout and repairs stored maps", () => {
    expect(sanitizeKeys(null)).toEqual(DEFAULT_KEYS);
    const keys = sanitizeKeys({ forward: "ArrowUp", jump: 7, drop: "Escape", sprint: "<script>" });
    expect(keys.forward).toBe("ArrowUp");
    expect(keys.jump).toBe("Space");
    expect(keys.drop).toBe("KeyQ");
    expect(keys.sprint).toBe("KeyR");
  });
  it("finds the action for a key and reports clashes", () => {
    const keys = { ...DEFAULT_KEYS, camera: "KeyE" };
    expect(actionFor(keys, "KeyW")).toBe("forward");
    expect(actionFor(keys, "KeyZ")).toBeUndefined();
    expect(conflicts(DEFAULT_KEYS)).toEqual([]);
    expect(conflicts(keys)).toEqual([["inventory", "camera"]]);
  });
  it("names keys readably", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("ShiftLeft")).toBe("Left Shift");
    expect(keyLabel("ControlRight")).toBe("Right Ctrl");
    expect(keyLabel("ArrowUp")).toBe("↑");
    expect(keyLabel("Space")).toBe("Space");
  });
});
