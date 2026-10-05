import { describe, expect, it } from "vitest";
import type { AdminPlayer } from "./api";
import { ago, designLine, playerLine, reportContext, reportLine, stateLine, tabsFor } from "./admin";
import type { AdminReport } from "./api";

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
    expect(tabsFor(["player", "moderator"])).toEqual(["players", "reports", "blueprints", "servers", "audit"]);
    expect(tabsFor(["player", "admin"])).toEqual(["players", "reports", "blueprints", "servers", "economy", "audit"]);
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

  it("sums a saved state up in a line", () => {
    expect(stateLine({ world: "main", dimension: "overworld", position: [10.3, 64, -3.5], health: 18.5, xp: 30, items: [], updated_at: "" })).toBe(
      "main · overworld at 10, 64, -3 · 18.5/20 health · 30 xp",
    );
    expect(stateLine({ world: "w_x", dimension: "sky", position: null, health: null, xp: 0, items: [], updated_at: "" })).toBe("w_x · sky · 0 xp");
  });

  it("sums a report up", () => {
    const now = Date.parse("2026-05-01T12:00:00Z");
    const r: AdminReport = {
      id: "r1",
      status: "open",
      source: "game",
      world: "main",
      category: "griefing",
      details: "broke my house",
      context: { dimension: "overworld", reporter_at: [1.2, 64, -3.7], target_at: [5, 64, 2], target_lines: ["lol", "mine now"] },
      reporter: { id: "a", username: "ana" },
      target: { id: "b", username: "bob", status: "suspended" },
      handled_by: null,
      resolution: null,
      created_at: "2026-05-01T11:55:00Z",
      handled_at: null,
      open_about_target: 3,
    };
    expect(reportLine(r, now)).toBe("bob · griefing · by ana in game (main) · 5 min ago · 3 open about bob · bob is suspended");
    expect(reportContext(r)).toBe("overworld: reporter at 1, 64, -4, bob at 5, 64, 2 · last lines: “lol” “mine now”");
    const web = { ...r, source: "web" as const, context: null, open_about_target: 1, target: { ...r.target, status: "active" }, status: "dismissed" as const, handled_by: "mod", resolution: "no evidence" };
    expect(reportLine(web, now)).toBe("bob · griefing · by ana on the web · 5 min ago · dismissed by mod: no evidence");
    expect(reportContext(web)).toBe("");
  });

  it("sums a design up for review", () => {
    const b = { id: "b1", name: "Watchtower", world: "main", size: [7, 12, 7] as [number, number, number], blocks: 310, materials: {}, creator: { id: "a", name: "ana" }, status: "in_review", price: 120, max_copies: 5, copies_sold: 0, royalty_bps: 500, mine: false, licensed: false, revision: 2 };
    expect(designLine(b)).toBe("Watchtower by ana · 7×12×7, 310 blocks · revision 2 · 120 CRN, 5 copies");
    expect(designLine({ ...b, price: null, revision: undefined })).toBe("Watchtower by ana · 7×12×7, 310 blocks · revision 1");
  });
});
