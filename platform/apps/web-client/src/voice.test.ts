import { describe, expect, it } from "vitest";
import { initiates, peerChanges, voiceGain, VOICE_FAR, VOICE_NEAR } from "./voice";

describe("voice", () => {
  it("fades a voice with distance", () => {
    expect(voiceGain(0)).toBe(1);
    expect(voiceGain(VOICE_NEAR)).toBe(1);
    expect(voiceGain((VOICE_NEAR + VOICE_FAR) / 2)).toBeCloseTo(0.5);
    expect(voiceGain(VOICE_FAR)).toBe(0);
    expect(voiceGain(500)).toBe(0);
  });

  it("lets exactly one side of a pair start the connection", () => {
    expect(initiates("a", "b")).toBe(true);
    expect(initiates("b", "a")).toBe(false);
  });

  it("works out whom to connect to and whom to drop", () => {
    expect(peerChanges(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], drop: ["a"] });
    expect(peerChanges([], [])).toEqual({ add: [], drop: [] });
  });
});
