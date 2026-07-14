import { describe, expect, it } from "vitest";

import { AgentHealthInput, evaluateAgentHealth } from "./health";

function healthyInput(): AgentHealthInput {
  return {
    isBrowserConnected: true,
    isBrowserProcessAlive: true,
    browserPid: 1234,
    isPageOpen: true,
    isBridgeReady: true,
    bridgeError: null,
    unexpectedDisconnectReason: null,
    world: { name: "terrain", isReady: true, error: null },
  };
}

describe("evaluateAgentHealth", () => {
  it("reports healthy with no reasons when the whole chain is live", () => {
    const health = evaluateAgentHealth(healthyInput());
    expect(health.isHealthy).toBe(true);
    expect(health.reasons).toEqual([]);
    expect(health.browser).toEqual({
      isConnected: true,
      isProcessAlive: true,
      pid: 1234,
    });
    expect(health.page).toEqual({ isOpen: true });
    expect(health.bridge).toEqual({ isReady: true, error: null });
    expect(health.world).toEqual({
      name: "terrain",
      isReady: true,
      error: null,
    });
  });

  it("stays healthy when the process handle is unavailable (null)", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      isBrowserProcessAlive: null,
      browserPid: null,
    });
    expect(health.isHealthy).toBe(true);
  });

  it("stays healthy when the world state could not be queried but nothing failed", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      world: { name: "terrain", isReady: null, error: null },
    });
    expect(health.isHealthy).toBe(true);
  });

  it("is unhealthy when the browser is disconnected", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      isBrowserConnected: false,
    });
    expect(health.isHealthy).toBe(false);
    expect(health.reasons).toContain("browser is not connected");
  });

  it("is unhealthy when the browser process is dead, with pid detail", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      isBrowserProcessAlive: false,
    });
    expect(health.isHealthy).toBe(false);
    expect(health.reasons).toContain("browser process is dead (pid 1234)");
  });

  it("omits the pid detail when unknown", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      isBrowserProcessAlive: false,
      browserPid: null,
    });
    expect(health.reasons).toContain("browser process is dead");
  });

  it("is unhealthy when the page is closed", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      isPageOpen: false,
    });
    expect(health.isHealthy).toBe(false);
    expect(health.reasons).toContain("page is closed");
  });

  it("is unhealthy while the bridge is not yet ready", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      isBridgeReady: false,
    });
    expect(health.isHealthy).toBe(false);
    expect(health.reasons).toContain("bridge is not ready");
  });

  it("prefers the bridge error over the generic not-ready reason", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      isBridgeReady: false,
      bridgeError: "Timed out after 60000ms waiting for window.__agent__",
    });
    expect(health.reasons).toContain(
      "bridge failed: Timed out after 60000ms waiting for window.__agent__",
    );
    expect(health.reasons).not.toContain("bridge is not ready");
  });

  it("surfaces an unexpected disconnect reason", () => {
    const reason =
      "browser disconnected unexpectedly (process died or connection lost)";
    const health = evaluateAgentHealth({
      ...healthyInput(),
      unexpectedDisconnectReason: reason,
    });
    expect(health.isHealthy).toBe(false);
    expect(health.reasons).toContain(reason);
  });

  it("is unhealthy when the world snapshot failed", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      world: {
        name: "terrain",
        isReady: null,
        error: "snapshot timed out after 3000ms",
      },
    });
    expect(health.isHealthy).toBe(false);
    expect(health.reasons).toContain(
      "world snapshot failed: snapshot timed out after 3000ms",
    );
  });

  it("is unhealthy when the world reports not ready", () => {
    const health = evaluateAgentHealth({
      ...healthyInput(),
      world: { name: "terrain", isReady: false, error: null },
    });
    expect(health.isHealthy).toBe(false);
    expect(health.reasons).toContain('world "terrain" is not ready');
  });

  it("accumulates every failure reason for a fully dead browser", () => {
    const reason =
      "browser disconnected unexpectedly (process died or connection lost)";
    const health = evaluateAgentHealth({
      isBrowserConnected: false,
      isBrowserProcessAlive: false,
      browserPid: 4321,
      isPageOpen: false,
      isBridgeReady: true,
      bridgeError: null,
      unexpectedDisconnectReason: reason,
      world: { name: "terrain", isReady: null, error: null },
    });
    expect(health.isHealthy).toBe(false);
    expect(health.reasons).toEqual([
      reason,
      "browser is not connected",
      "browser process is dead (pid 4321)",
      "page is closed",
    ]);
  });
});
