import { describe, expect, it } from "vitest";

import {
  MethodOutcomeError,
  assertMethodRan,
  describeMethodFailure,
  outcomeOf,
} from "./method-outcome";

describe("method outcomes", () => {
  it("names the world and the worlds that would have run a call nothing handled", () => {
    expect(
      describeMethodFailure("sandbox:fill", {
        kind: "unhandled",
        world: "bare",
        handledBy: ["sandbox", "workshop"],
      }),
    ).toBe(
      "sandbox:fill did nothing: world 'bare' has no handler for it (worlds that handle it: sandbox, workshop)",
    );
    expect(
      describeMethodFailure("sandbox:fill", {
        kind: "unhandled",
        world: "bare",
        handledBy: [],
      }),
    ).toContain("no world on this server handles it");
    expect(
      describeMethodFailure("sandbox:fill", {
        kind: "unhandled",
        world: "bare",
        handledBy: null,
      }),
    ).toContain("the server does not say which worlds do");
  });

  it("passes on a rejection's reason", () => {
    expect(
      describeMethodFailure("sandbox:fill", {
        kind: "rejected",
        world: "sandbox",
        reason: "unknown block name 'cratee'",
      }),
    ).toBe(
      "sandbox:fill did nothing in world 'sandbox': unknown block name 'cratee'",
    );
  });

  it("throws only for calls the server said did nothing", () => {
    const sent = { isSent: true, isQueued: false };
    expect(() =>
      assertMethodRan("sandbox:fill", { ...sent, outcome: { kind: "ran" } }),
    ).not.toThrow();
    expect(() =>
      assertMethodRan("sandbox:fill", {
        ...sent,
        outcome: { kind: "unanswered", waitedMs: 5000 },
      }),
    ).not.toThrow();
    expect(() => assertMethodRan("sandbox:fill", sent)).not.toThrow();
    expect(() =>
      assertMethodRan("sandbox:hop", { isPerformedLocally: true }),
    ).not.toThrow();

    const failure = (() => {
      try {
        assertMethodRan("sandbox:fill", {
          ...sent,
          outcome: { kind: "unhandled", world: "bare", handledBy: ["sandbox"] },
        });
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(failure).toBeInstanceOf(MethodOutcomeError);
    expect((failure as MethodOutcomeError).outcome).toEqual({
      kind: "unhandled",
      world: "bare",
      handledBy: ["sandbox"],
    });
  });

  it("ignores results that only look like they carry an outcome", () => {
    expect(outcomeOf(null)).toBeNull();
    expect(outcomeOf({ outcome: "ran" })).toBeNull();
    expect(outcomeOf({ outcome: { kind: "maybe" } })).toBeNull();
    expect(outcomeOf({ outcome: { kind: "ran" } })).toEqual({ kind: "ran" });
  });
});
