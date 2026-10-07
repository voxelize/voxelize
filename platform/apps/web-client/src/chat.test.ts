import { describe, expect, it } from "vitest";
import { chatText } from "./chat";

describe("chat lines", () => {
  it("read by channel", () => {
    expect(chatText({ channel: "public", from: "ann", body: "hi" })).toBe("ann: hi");
    expect(chatText({ channel: "whisper", from: "ann", to: "bob", body: "psst" })).toBe("ann → bob: psst");
    expect(chatText({ channel: "local", from: "ann", body: "here" })).toBe("[local] ann: here");
    expect(chatText({ channel: "guild", from: "ann", to: "SW", body: "rally" })).toBe("[SW] ann: rally");
    expect(chatText({ channel: "system", body: "Nobody to reply to." })).toBe("Nobody to reply to.");
  });
});
