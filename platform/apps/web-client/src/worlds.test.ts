import { describe, expect, it } from "vitest";
import type { WorldView } from "./api";
import { baseWorld, serverOrigin, worldLine } from "./worlds";

const world = (over: Partial<WorldView>): WorldView => ({
  key: "main",
  name: "Main",
  realm: "survival",
  official: true,
  visibility: "public",
  owner: null,
  mine: false,
  online: true,
  players: 4,
  max_players: null,
  members: null,
  url: "ws://localhost:4000/ws/",
  ...over,
});

describe("worlds", () => {
  it("finds the world a dimension belongs to", () => {
    expect(baseWorld("main")).toBe("main");
    expect(baseWorld("main_underworld")).toBe("main");
    expect(baseWorld("w_abc123defg_sky")).toBe("w_abc123defg");
  });

  it("turns a game server's socket address into its origin", () => {
    expect(serverOrigin("ws://127.0.0.1:4001/ws/")).toBe("http://127.0.0.1:4001");
    expect(serverOrigin("wss://w-x.play.example/ws/")).toBe("https://w-x.play.example");
    expect(serverOrigin("javascript:alert(1)")).toBeNull();
    expect(serverOrigin("not a url")).toBeNull();
  });

  it("describes a world in a line", () => {
    expect(worldLine(world({}))).toBe("Main · 4 playing");
    const castle = world({ name: "Castle", official: false, owner: { id: "u", name: "ana" }, visibility: "friends", realm: "creative", players: 1, max_players: 20 });
    expect(worldLine(castle)).toBe("Castle · by ana · 1/20 playing · creative · friends");
    expect(worldLine(world({ online: false, players: null }))).toBe("Main · offline");
  });
});
