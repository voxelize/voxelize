import { describe, expect, it } from "vitest";

import {
  SESSION_META_MAX_KEYS,
  SESSION_META_MAX_VALUE_LENGTH,
  SessionMetaError,
  applySessionMetaPatch,
  normalizeSessionMeta,
  parseSessionMetaAssignments,
  parseSessionMetaEnv,
  parseSessionOriginEnv,
} from "./session-meta";

describe("normalizeSessionMeta", () => {
  it("lower-cases keys, trims values, and drops empty values", () => {
    expect(
      normalizeSessionMeta({ Label: "  butterfly roam ", purpose: "   " }),
    ).toEqual({ label: "butterfly roam" });
  });

  it("treats a missing map as empty", () => {
    expect(normalizeSessionMeta(undefined)).toEqual({});
    expect(normalizeSessionMeta(null)).toEqual({});
  });

  it("rejects keys that are not identifiers", () => {
    expect(() => normalizeSessionMeta({ "bad key": "x" })).toThrow(
      SessionMetaError,
    );
    expect(() => normalizeSessionMeta({ "1st": "x" })).toThrow(
      SessionMetaError,
    );
  });

  it("rejects non-string values instead of coercing them", () => {
    expect(() => normalizeSessionMeta({ label: 42 })).toThrow(
      /must be a string/,
    );
  });

  it("rejects values over the length limit instead of truncating", () => {
    const long = "x".repeat(SESSION_META_MAX_VALUE_LENGTH + 1);
    expect(() => normalizeSessionMeta({ purpose: long })).toThrow(
      /the limit is/,
    );
  });

  it("rejects more keys than the budget", () => {
    const input: Record<string, string> = {};
    for (let i = 0; i <= SESSION_META_MAX_KEYS; i++) input[`k${i}`] = "v";
    expect(() => normalizeSessionMeta(input)).toThrow(/keys; the limit is/);
  });
});

describe("applySessionMetaPatch", () => {
  it("merges set over current and honours unset", () => {
    const next = applySessionMetaPatch(
      { label: "old", owner: "me" },
      { set: { label: "new", tags: "a,b" }, unset: ["owner"] },
    );
    expect(next).toEqual({ label: "new", tags: "a,b" });
  });

  it("clears a key when set carries an empty value", () => {
    expect(
      applySessionMetaPatch({ label: "old" }, { set: { label: "" } }),
    ).toEqual({});
  });

  it("does not mutate the current map", () => {
    const current = { label: "x" };
    applySessionMetaPatch(current, { set: { label: "y" } });
    expect(current).toEqual({ label: "x" });
  });
});

describe("parseSessionMetaAssignments", () => {
  it("splits on the first equals sign only", () => {
    expect(parseSessionMetaAssignments(["purpose=a=b", "label="])).toEqual({
      purpose: "a=b",
      label: "",
    });
  });

  it("rejects tokens without a key", () => {
    expect(() => parseSessionMetaAssignments(["=x"])).toThrow(SessionMetaError);
    expect(() => parseSessionMetaAssignments(["nope"])).toThrow(
      /expected key=value/,
    );
  });
});

describe("env parsing", () => {
  it("reads meta json and validates it", () => {
    expect(parseSessionMetaEnv('{"label":"x"}')).toEqual({ label: "x" });
    expect(parseSessionMetaEnv(undefined)).toEqual({});
    expect(() => parseSessionMetaEnv("{not json")).toThrow(
      /must be a JSON object/,
    );
  });

  it("reads origin json and keeps only well-formed parts", () => {
    const origin = parseSessionOriginEnv(
      JSON.stringify({
        startedAt: 1700000000000,
        launcher: "admin-page",
        command: "agent session start test",
        cwd: "/repo",
        user: "dev",
        hostname: "box",
        terminal: null,
        launcherPid: 42,
        parentChain: [
          { pid: 41, command: "pnpm" },
          { pid: "x", command: "ignored" },
        ],
        cursor: { isAgent: true, conversationId: "abc", workspaceLabel: "t" },
      }),
    );
    expect(origin).toEqual({
      startedAt: 1700000000000,
      launcher: "admin-page",
      command: "agent session start test",
      cwd: "/repo",
      user: "dev",
      hostname: "box",
      terminal: null,
      launcherPid: 42,
      parentChain: [{ pid: 41, command: "pnpm" }],
      cursor: { isAgent: true, conversationId: "abc", workspaceLabel: "t" },
    });
  });

  it("refuses an origin without startedAt rather than inventing one", () => {
    expect(() => parseSessionOriginEnv('{"cwd":"/x"}')).toThrow(
      /missing an integer startedAt/,
    );
    expect(parseSessionOriginEnv(undefined)).toBeNull();
  });
});
