import { describe, expect, it } from "vitest";
import type { AdminPlayer } from "./api";
import { ago, playerLine, tabsFor } from "./admin";

const player = (over: Partial<AdminPlayer>): AdminPlayer => ({
  id: "p",
  username: "ana",
  status: "active",
  status_reason: null,
  roles: ["player"],
  muted_until: null,
  mute_reason: null,
  online: false,
  world: null,
  last_seen_at: null,
  ...over,
});

describe("admin panel", () => {
  it("opens only the tabs a role may use", () => {
    expect(tabsFor(["player"])).toEqual([]);
    expect(tabsFor(["player", "moderator"])).toEqual(["players", "servers", "audit"]);
    expect(tabsFor(["player", "admin"])).toEqual(["players", "servers", "economy", "audit"]);
  });

  it("says how long ago", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(ago(null, now)).toBe("never");
    expect(ago("2026-10-05T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-05T11:45:00Z", now)).toBe("15 min ago");
    expect(ago("2026-10-05T07:00:00Z", now)).toBe("5 h ago");
    expect(ago("2026-09-30T12:00:00Z", now)).toBe("5 days ago");
  });

  it("sums a player up in a line", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(playerLine(player({ online: true, world: "main" }), now)).toBe("online in main");
    expect(playerLine(player({ status: "banned", roles: ["player", "moderator"], muted_until: "2026-10-05T13:00:00Z" }), now)).toBe("seen never · muted · banned · moderator");
    expect(playerLine(player({ muted_until: "2026-10-05T11:00:00Z", last_seen_at: "2026-10-05T11:50:00Z" }), now)).toBe("seen 10 min ago");
  });
});
