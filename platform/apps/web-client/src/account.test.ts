import { describe, expect, it } from "vitest";
import { accountError, linkIntent, myReportLine } from "./account";
import { ApiError } from "./api";

describe("account links", () => {
  it("knows a reset link from a confirmation link", () => {
    expect(linkIntent("?reset=abc&email=ana%40example.com")).toEqual({ kind: "reset", token: "abc", email: "ana@example.com" });
    expect(linkIntent("?verified=1")).toEqual({ kind: "verified", ok: true });
    expect(linkIntent("?verified=0")).toEqual({ kind: "verified", ok: false });
    expect(linkIntent("?reset=abc")).toBeNull();
    expect(linkIntent("")).toBeNull();
  });
});

describe("reports", () => {
  it("tells the reporter what became of a report", () => {
    const r = { id: "1", player: "bob", category: "griefing" as const, details: "x", status: "open" as const, created_at: "" };
    expect(myReportLine(r)).toBe("bob · griefing · waiting for a moderator");
    expect(myReportLine({ ...r, status: "dismissed" })).toBe("bob · griefing · a moderator looked and took no action");
    expect(accountError(new ApiError(409, "already_reported", "raw"))).toContain("a moment ago");
  });
});
