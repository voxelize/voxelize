import { describe, expect, it } from "vitest";

import {
  DEFAULT_IDLE_TTL_MS,
  IDLE_TTL_EXIT_CODE,
  resolveIdleTtlMs,
} from "./browser-lifecycle";

describe("resolveIdleTtlMs", () => {
  it("defaults to a bounded, nonzero ttl", () => {
    expect(resolveIdleTtlMs(undefined, {})).toBe(DEFAULT_IDLE_TTL_MS);
    expect(DEFAULT_IDLE_TTL_MS).toBe(30 * 60_000);
  });

  it("lets the flag beat the environment", () => {
    expect(resolveIdleTtlMs("5000", { AGENT_IDLE_TTL_MS: "9000" })).toBe(5000);
    expect(resolveIdleTtlMs(undefined, { AGENT_IDLE_TTL_MS: "9000" })).toBe(
      9000,
    );
  });

  it("treats zero as the deliberate long-lived escape hatch", () => {
    expect(resolveIdleTtlMs("0", {})).toBe(0);
    expect(resolveIdleTtlMs(undefined, { AGENT_IDLE_TTL_MS: "0" })).toBe(0);
  });

  it("falls back past an empty environment value", () => {
    expect(resolveIdleTtlMs(undefined, { AGENT_IDLE_TTL_MS: "" })).toBe(
      DEFAULT_IDLE_TTL_MS,
    );
  });

  it("rejects explicit invalid values instead of defaulting past them", () => {
    expect(() => resolveIdleTtlMs("soon", {})).toThrow(/--idle-ttl-ms/);
    expect(() => resolveIdleTtlMs("-1", {})).toThrow(/--idle-ttl-ms/);
    expect(() => resolveIdleTtlMs("1.5", {})).toThrow(/--idle-ttl-ms/);
    expect(() =>
      resolveIdleTtlMs(undefined, { AGENT_IDLE_TTL_MS: "later" }),
    ).toThrow(/AGENT_IDLE_TTL_MS/);
  });

  it("pins the idle exit code the pm2 session wiring depends on", () => {
    // scripts/agent-reap.mjs mirrors this value for --stop-exit-codes; the
    // session-port smoke asserts the end-to-end behavior.
    expect(IDLE_TTL_EXIT_CODE).toBe(66);
  });
});
