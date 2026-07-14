import { describe, expect, it } from "vitest";

import { EntityLivenessTracker } from "./entity-liveness";

const options = {
  stalenessTimeoutSeconds: 10,
  streamSilenceGraceSeconds: 3,
};

describe("EntityLivenessTracker", () => {
  it("keeps freshly touched entities", () => {
    const tracker = new EntityLivenessTracker(options);

    tracker.touchEntity("fish", 0);
    tracker.touchStream(9);

    expect(tracker.collectStale(9.5)).toEqual([]);
  });

  it("collects entities silent past the timeout while the stream is live", () => {
    const tracker = new EntityLivenessTracker(options);

    tracker.touchEntity("fish", 0);
    tracker.touchEntity("crab", 8);
    tracker.touchStream(9);

    expect(tracker.collectStale(10)).toEqual(["fish"]);
  });

  it("suspends judgment while the whole stream is silent", () => {
    const tracker = new EntityLivenessTracker(options);

    tracker.touchEntity("fish", 0);

    expect(tracker.collectStale(20)).toEqual([]);
  });

  it("resumes judgment when the stream comes back", () => {
    const tracker = new EntityLivenessTracker(options);

    tracker.touchEntity("fish", 0);
    tracker.touchStream(30);

    expect(tracker.collectStale(31)).toEqual(["fish"]);
  });

  it("never judges before any message has arrived", () => {
    const tracker = new EntityLivenessTracker(options);

    expect(tracker.collectStale(1000)).toEqual([]);
  });

  it("forgets released entities", () => {
    const tracker = new EntityLivenessTracker(options);

    tracker.touchEntity("fish", 0);
    tracker.forget("fish");
    tracker.touchStream(11);

    expect(tracker.collectStale(12)).toEqual([]);
  });

  it("rehydrated entities restart their staleness clock", () => {
    const tracker = new EntityLivenessTracker(options);

    tracker.touchEntity("fish", 0);
    tracker.forget("fish");
    tracker.touchEntity("fish", 11);

    expect(tracker.collectStale(12)).toEqual([]);

    tracker.touchStream(20.5);

    expect(tracker.collectStale(21)).toEqual(["fish"]);
  });
});
