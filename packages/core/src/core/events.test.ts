import { describe, expect, it, vi } from "vitest";

import { Events, VOXELIZE_BUILTIN_RELAY_EVENT } from "./events";

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

describe("relayed peer effects", () => {
  it("sends the effect wrapped for the server to stamp", () => {
    const events = new Events();
    events.emitRelayed("crumbs", { item: 7 }, [1, 2, 3]);
    expect(events.packets).toHaveLength(1);
    const [sent] = events.packets[0].events ?? [];
    expect(sent.name).toBe(VOXELIZE_BUILTIN_RELAY_EVENT);
    expect(JSON.parse(sent.payload as string)).toEqual({
      name: "crumbs",
      payload: { item: 7 },
      position: [1, 2, 3],
    });
  });

  it("hands a peer's effect to its listeners with the stamped sender", () => {
    const events = new Events();
    const seen: unknown[] = [];
    const handler = (payload: unknown, meta: unknown) =>
      seen.push([payload, meta]);
    events.onRelayed("Crumbs", handler);
    events.onRelayed("other", () => seen.push("wrong listener"));
    events.handle(VOXELIZE_BUILTIN_RELAY_EVENT, {
      name: "crumbs",
      payload: { item: 7 },
      senderId: "peer-1",
      position: [1, 2, 3],
    });
    expect(seen).toEqual([
      [{ item: 7 }, { senderId: "peer-1", position: [1, 2, 3] }],
    ]);

    events.offRelayed("crumbs", handler);
    events.handle(VOXELIZE_BUILTIN_RELAY_EVENT, {
      name: "crumbs",
      payload: {},
      senderId: "peer-1",
    });
    expect(seen).toHaveLength(1);
  });

  it("ignores an envelope with no server-stamped sender", () => {
    const events = new Events();
    const seen: unknown[] = [];
    events.onRelayed("crumbs", (payload) => seen.push(payload));
    events.handle(VOXELIZE_BUILTIN_RELAY_EVENT, {
      name: "crumbs",
      payload: {},
    });
    expect(seen).toEqual([]);
  });
});
