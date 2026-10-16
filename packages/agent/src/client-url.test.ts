import { describe, expect, it } from "vitest";

import {
  composeClientUrl,
  composeWorldSwitchUrl,
  worldFromPath,
} from "./client-url";

describe("composeClientUrl", () => {
  it("appends the world to a bare origin and tags the agent params", () => {
    expect(
      composeClientUrl("http://localhost:3000", "test", { agentName: "agent" }),
    ).toBe("http://localhost:3000/test?agent=true&agentName=agent");
    expect(
      composeClientUrl("http://localhost:3000/", "test", { agentName: "a" }),
    ).toBe("http://localhost:3000/test?agent=true&agentName=a");
  });

  it("keeps a share link's query so the session lands where it points", () => {
    const url = composeClientUrl(
      "http://localhost:3000/test?world=test&pos=188.5,67,9.4&look=188.5,67,7.22",
      "test",
      { agentName: "agent" },
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/test");
    expect(parsed.searchParams.get("pos")).toBe("188.5,67,9.4");
    expect(parsed.searchParams.get("look")).toBe("188.5,67,7.22");
    expect(parsed.searchParams.get("agent")).toBe("true");
  });

  it("adds capture and arm flags only when asked", () => {
    const url = new URL(
      composeClientUrl("http://localhost:3000", "dev", {
        agentName: "cam",
        isCapture: true,
        isArmVisible: true,
      }),
    );
    expect(url.searchParams.get("capture")).toBe("true");
    expect(url.searchParams.get("agentArm")).toBe("true");
  });
});

describe("composeWorldSwitchUrl", () => {
  it("swaps the world and keeps only the agent's own params", () => {
    expect(
      composeWorldSwitchUrl(
        "http://localhost:3100/world-a?agent=true&agentName=agent&pos=1,2,3&look=4,5,6",
        "world-b",
      ),
    ).toBe("http://localhost:3100/world-b?agent=true&agentName=agent");
  });

  it("keeps capture and arm flags and a path prefix", () => {
    expect(
      composeWorldSwitchUrl(
        "http://127.0.0.1:3000/play/world-a/?agent=true&agentName=cam&capture=true&agentArm=true",
        "world-b",
      ),
    ).toBe(
      "http://127.0.0.1:3000/play/world-b?agent=true&agentName=cam&capture=true&agentArm=true",
    );
  });

  it("names the world on a page served at the root", () => {
    expect(
      composeWorldSwitchUrl("http://localhost:3000/?agent=true", "test"),
    ).toBe("http://localhost:3000/test?agent=true");
  });
});

describe("worldFromPath", () => {
  it("reads the last segment, after any path prefix", () => {
    expect(worldFromPath("/world-a")).toBe("world-a");
    expect(worldFromPath("/play/world-a/")).toBe("world-a");
    expect(worldFromPath("/")).toBe("");
  });

  // A world switch waits for the page to report the world it asked for, so
  // the segment the URLs put the world in is the one the page is read by.
  it("names the world the composed URLs open, prefix or not", () => {
    for (const base of [
      "http://localhost:3000",
      "http://localhost:3000/play",
    ]) {
      const launched = composeClientUrl(base, "world-a", { agentName: "a" });
      expect(worldFromPath(new URL(launched).pathname)).toBe("world-a");
      const switched = composeWorldSwitchUrl(launched, "world-b");
      expect(worldFromPath(new URL(switched).pathname)).toBe("world-b");
    }
  });
});
