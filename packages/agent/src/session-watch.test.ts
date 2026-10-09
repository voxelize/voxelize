import { describe, expect, it } from "vitest";

import {
  DEFAULT_WATCH_HOLD_MS,
  MAX_WATCH_HOLD_MS,
  WATCH_BEAT_TIMEOUT_MS,
  WatchError,
  WatchLedger,
} from "./session-watch";

const MINUTE = 60_000;

function ledger() {
  let clock = 1_000_000;
  const watches = new WatchLedger({ now: () => clock });
  return {
    watches,
    advance: (ms: number) => {
      clock += ms;
    },
    at: () => clock,
  };
}

describe("WatchLedger", () => {
  it("holds a session for the hold a watcher declares, beat by beat", () => {
    const { watches, advance, at } = ledger();
    const first = watches.beat({
      watcher: "memory-runaway-catch",
      purpose: "heap climb on the render switch",
      holdMs: 40 * MINUTE,
      pid: 4242,
    });
    expect(first).toMatchObject({ isAccepted: true, isNew: true });
    expect(first.watch?.holdUntil).toBe(at() + 40 * MINUTE);

    advance(30_000);
    const second = watches.beat({ watcher: "memory-runaway-catch" });
    expect(second).toMatchObject({ isAccepted: true, isNew: false });
    expect(second.watch?.beats).toBe(2);
    expect(watches.live().map((watch) => watch.watcher)).toEqual([
      "memory-runaway-catch",
    ]);
  });

  it("defaults to a 30 minute hold and refuses one over the maximum", () => {
    const { watches, at } = ledger();
    expect(DEFAULT_WATCH_HOLD_MS).toBe(30 * MINUTE);
    expect(MAX_WATCH_HOLD_MS).toBe(120 * MINUTE);
    expect(watches.beat({ watcher: "probe" }).watch?.holdUntil).toBe(
      at() + 30 * MINUTE,
    );
    const tooLong = watches.beat({
      watcher: "greedy",
      holdMs: 3 * 60 * MINUTE,
    });
    expect(tooLong).toEqual({
      isAccepted: false,
      reason: "a 3h hold is over the 2h maximum a watch may declare",
      watch: null,
    });
  });

  it("refuses beats once the declared hold has run out; later beats cannot move it", () => {
    const { watches, advance } = ledger();
    watches.beat({ watcher: "probe", holdMs: 10 * MINUTE });
    for (let beat = 0; beat < 20; beat++) {
      advance(30_000);
      watches.beat({ watcher: "probe", holdMs: 120 * MINUTE });
    }
    advance(30_000);
    const late = watches.beat({ watcher: "probe" });
    expect(late.isAccepted).toBe(false);
    if (late.isAccepted) return;
    expect(late.reason).toMatch(
      /^watch 'probe' declared a 10m hold, which ran out at .*; its beats no longer keep the session/,
    );
  });

  it("lets a watcher that stopped beating lapse, and says so", () => {
    const { watches, advance } = ledger();
    watches.beat({ watcher: "probe", holdMs: 40 * MINUTE, pid: 77 });
    advance(WATCH_BEAT_TIMEOUT_MS + 1_000);
    expect(watches.live()).toEqual([]);
    const endings = watches.sweep();
    expect(endings).toHaveLength(1);
    expect(endings[0].reason).toBe(
      "no heartbeat for 121s (limit 120s): its watcher pid 77 is taken for gone",
    );
    expect(watches.sweep()).toEqual([]);
  });

  it("sweeps a hold that ran out, and forgets a watch its watcher ended", () => {
    const { watches, advance } = ledger();
    watches.beat({ watcher: "short", holdMs: MINUTE });
    watches.beat({ watcher: "ended", holdMs: 10 * MINUTE });
    advance(61_000);
    expect(watches.sweep().map((ending) => ending.reason)).toEqual([
      "its declared 1m hold ran out",
    ]);
    expect(watches.end("ended")?.watcher).toBe("ended");
    expect(watches.end("ended")).toBeNull();
    expect(watches.live()).toEqual([]);
  });

  it("keeps refusing a hold that ran out after a sweep, until its watcher ends it", () => {
    const { watches, advance } = ledger();
    watches.beat({ watcher: "short", holdMs: 3_000 });
    advance(4_000);
    expect(watches.sweep().map((ending) => ending.reason)).toEqual([
      "its declared 0.1m hold ran out",
    ]);
    const late = watches.beat({ watcher: "short" });
    expect(late.isAccepted).toBe(false);
    expect(watches.sweep()).toEqual([]);
    expect(watches.live()).toEqual([]);

    expect(watches.end("short")?.watcher).toBe("short");
    expect(watches.beat({ watcher: "short" })).toMatchObject({
      isAccepted: true,
      isNew: true,
    });
  });

  it("lets a watcher that lapsed pick up under the hold it declared, never a new one", () => {
    const { watches, advance, at } = ledger();
    const holdUntil = at() + 10 * MINUTE;
    watches.beat({ watcher: "probe", holdMs: 10 * MINUTE });
    advance(WATCH_BEAT_TIMEOUT_MS + 1_000);
    expect(watches.sweep()).toHaveLength(1);

    const resumed = watches.beat({ watcher: "probe", holdMs: 60 * MINUTE });
    expect(resumed).toMatchObject({ isAccepted: true, isNew: true });
    expect(resumed.watch?.holdUntil).toBe(holdUntil);
    expect(watches.live().map((watch) => watch.watcher)).toEqual(["probe"]);

    advance(10 * MINUTE);
    expect(watches.beat({ watcher: "probe" }).isAccepted).toBe(false);
  });

  it("parses what a watcher sends and refuses what it should not", () => {
    expect(
      WatchLedger.parse({
        watcher: "memory-runaway-catch",
        holdMs: 1000,
        pid: 3,
      }),
    ).toEqual({
      watcher: "memory-runaway-catch",
      purpose: undefined,
      holdMs: 1000,
      pid: 3,
    });
    expect(() => WatchLedger.parse({})).toThrow(WatchError);
    expect(() => WatchLedger.parse({ watcher: "has spaces" })).toThrow(
      /a watch needs a `watcher` name/,
    );
    expect(() => WatchLedger.parse({ watcher: "w", holdMs: -5 })).toThrow(
      /holdMs/,
    );
    expect(() =>
      WatchLedger.parse({ watcher: "w", purpose: "x".repeat(300) }),
    ).toThrow(/purpose/);
  });
});
