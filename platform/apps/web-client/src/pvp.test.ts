import { describe, expect, it } from "vitest";
import { pickPlayer } from "./pvp";

describe("picking players", () => {
  const origin = { x: 0, y: 1.5, z: 0 };
  const ahead = { x: 0, y: 0, z: 1 };
  it("hits the nearest body in front within reach", () => {
    const players: [string, { x: number; y: number; z: number }][] = [
      ["far", { x: 0, y: 2, z: 4 }],
      ["near", { x: 0.2, y: 2, z: 2 }],
      ["behind", { x: 0, y: 2, z: -2 }],
      ["aside", { x: 3, y: 2, z: 2 }],
    ];
    expect(pickPlayer(origin, ahead, players)?.id).toBe("near");
    expect(pickPlayer(origin, ahead, players.filter(([id]) => id !== "near"))?.id).toBe("far");
    expect(pickPlayer(origin, ahead, [["out", { x: 0, y: 2, z: 9 }]])).toBeNull();
    expect(pickPlayer(origin, ahead, [["behind", { x: 0, y: 2, z: -2 }]])).toBeNull();
  });
});
