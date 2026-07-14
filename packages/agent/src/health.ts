// Health semantics: the agent is healthy only when the whole chain is live —
// browser process alive, DevTools connection up, page open, in-page bridge
// ready, and (when obtainable) the world snapshot reporting ready. A stale
// daemon whose browser was killed must fail /healthz so supervisors like PM2
// restart the wrapper instead of trusting a listener that can no longer do
// anything. The evaluation is pure so it can be tested without a browser.

export type AgentWorldHealth = {
  name: string;
  /** Null when the snapshot could not be queried (see error). */
  isReady: boolean | null;
  error: string | null;
};

export type AgentHealthInput = {
  isBrowserConnected: boolean;
  /** Null when the browser process handle is unavailable (remote browsers). */
  isBrowserProcessAlive: boolean | null;
  browserPid: number | null;
  isPageOpen: boolean;
  isBridgeReady: boolean;
  bridgeError: string | null;
  unexpectedDisconnectReason: string | null;
  world: AgentWorldHealth;
};

export type AgentHealth = {
  isHealthy: boolean;
  /** Empty when healthy; human-readable failure causes otherwise. */
  reasons: string[];
  browser: {
    isConnected: boolean;
    isProcessAlive: boolean | null;
    pid: number | null;
  };
  page: { isOpen: boolean };
  bridge: { isReady: boolean; error: string | null };
  world: AgentWorldHealth;
};

export function evaluateAgentHealth(input: AgentHealthInput): AgentHealth {
  const reasons: string[] = [];

  if (input.unexpectedDisconnectReason) {
    reasons.push(input.unexpectedDisconnectReason);
  }
  if (!input.isBrowserConnected) {
    reasons.push("browser is not connected");
  }
  if (input.isBrowserProcessAlive === false) {
    reasons.push(
      input.browserPid === null
        ? "browser process is dead"
        : `browser process is dead (pid ${input.browserPid})`,
    );
  }
  if (!input.isPageOpen) {
    reasons.push("page is closed");
  }
  if (input.bridgeError) {
    reasons.push(`bridge failed: ${input.bridgeError}`);
  } else if (!input.isBridgeReady) {
    reasons.push("bridge is not ready");
  }
  if (input.world.error) {
    reasons.push(`world snapshot failed: ${input.world.error}`);
  } else if (input.world.isReady === false) {
    reasons.push(`world "${input.world.name}" is not ready`);
  }

  return {
    isHealthy: reasons.length === 0,
    reasons,
    browser: {
      isConnected: input.isBrowserConnected,
      isProcessAlive: input.isBrowserProcessAlive,
      pid: input.browserPid,
    },
    page: { isOpen: input.isPageOpen },
    bridge: { isReady: input.isBridgeReady, error: input.bridgeError },
    world: input.world,
  };
}
