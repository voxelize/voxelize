import { describe, expect, it, vi } from "vitest";

import { Events } from "./events";

describe("Events multi-handler", () => {
  it("invokes every listener registered for the same name", () => {
    const events = new Events();
    const a = vi.fn();
    const b = vi.fn();
    events.on("place-ack", a);
    events.on("place-ack", b);
    events.handle("place-ack", { ok: true });
    expect(a).toHaveBeenCalledWith({ ok: true });
    expect(b).toHaveBeenCalledWith({ ok: true });
  });

  it("off removes only the given listener", () => {
    const events = new Events();
    const a = vi.fn();
    const b = vi.fn();
    events.on("player-died", a);
    events.on("player-died", b);
    events.off("player-died", a);
    events.handle("player-died", { cause: "fall" });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ cause: "fall" });
  });

  it("does not warn or cancel a second registration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = new Events();
    events.on("game-data", () => {});
    events.on("game-data", () => {});
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
