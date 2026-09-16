import { describe, expect, it } from "vitest";

import { composeClientUrl } from "./client-url";

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
