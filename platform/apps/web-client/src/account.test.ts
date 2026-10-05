import { describe, expect, it } from "vitest";
import { linkIntent } from "./account";

describe("account links", () => {
  it("knows a reset link from a confirmation link", () => {
    expect(linkIntent("?reset=abc&email=ana%40example.com")).toEqual({ kind: "reset", token: "abc", email: "ana@example.com" });
    expect(linkIntent("?verified=1")).toEqual({ kind: "verified", ok: true });
    expect(linkIntent("?verified=0")).toEqual({ kind: "verified", ok: false });
    expect(linkIntent("?reset=abc")).toBeNull();
    expect(linkIntent("")).toBeNull();
  });
});
