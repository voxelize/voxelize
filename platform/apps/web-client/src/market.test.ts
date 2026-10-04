import { describe, expect, it } from "vitest";

import { sellPayload, timeLeft } from "./market";

describe("market helpers", () => {
  it("format time left", () => {
    const now = Date.parse("2026-10-04T10:00:00Z");
    expect(timeLeft("2026-10-04T09:00:00Z", now)).toBe("ended");
    expect(timeLeft("2026-10-04T10:00:20Z", now)).toBe("1m");
    expect(timeLeft("2026-10-04T13:20:00Z", now)).toBe("3h 20m");
    expect(timeLeft("2026-10-09T10:00:00Z", now)).toBe("5d");
  });

  it("validate a sale before asking the server", () => {
    const form = { slot: 2, count: 3, price: 40, kind: "fixed", buyout: null, hours: 48 };
    expect(sellPayload(form, null)).toEqual({ ok: false, reason: "Hold the stack you want to sell" });
    expect(sellPayload({ ...form, count: 9 }, { count: 5 })).toEqual({ ok: false, reason: "Sell 1 to 5" });
    expect(sellPayload({ ...form, price: 0 }, { count: 5 }).ok).toBe(false);
    expect(sellPayload({ ...form, kind: "auction", buyout: 10 }, { count: 5 }).ok).toBe(false);
    expect(sellPayload(form, { count: 5 })).toEqual({ ok: true, payload: { slot: 2, count: 3, price: 40, kind: "fixed", hours: 48 } });
    expect(sellPayload({ ...form, kind: "auction", buyout: 90 }, { count: 5 })).toEqual({
      ok: true,
      payload: { slot: 2, count: 3, price: 40, kind: "auction", hours: 48, buyout: 90 },
    });
  });
});
