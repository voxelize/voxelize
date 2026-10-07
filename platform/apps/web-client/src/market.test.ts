import { describe, expect, it } from "vitest";

import { entryLine, sellPayload, timeLeft } from "./market";

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

import { historyLine, partPrice, searchKeys } from "./market";

describe("market search, parts and prices", () => {
  const items = [
    { key: "iron_ingot", name: "Iron Ingot" },
    { key: "iron_pickaxe", name: "Iron Pickaxe" },
    { key: "coal", name: "Coal" },
  ];
  it("finds items by name or key", () => {
    expect(searchKeys(items, "iron")).toEqual(["iron_ingot", "iron_pickaxe"]);
    expect(searchKeys(items, "Iron Ingot")).toEqual(["iron_ingot"]);
    expect(searchKeys(items, "  ")).toEqual([]);
  });
  it("prices part of a stack like the server", () => {
    expect(partPrice(100, 3, 1)).toBe(34);
    expect(partPrice(66, 2, 2)).toBe(66);
    expect(partPrice(64, 64, 10)).toBe(10);
  });
  it("summarises price history", () => {
    const empty = { item: "coal", sales: [], stats: { days: 30, sales: 0, items: 0, average_unit_price: null, min_unit_price: null, max_unit_price: null } };
    expect(historyLine(empty)).toBe("No sales in 30 days");
    expect(historyLine({ ...empty, stats: { days: 30, sales: 2, items: 3, average_unit_price: 33.33, min_unit_price: 32, max_unit_price: 34 } })).toBe(
      "3 sold in 2 sales over 30 days · avg 33.33 each (32–34)",
    );
  });
});

describe("wallet statement", () => {
  it("shows money in and out with the balance after", () => {
    const e = { transaction: "t1", type: "transfer", reason: "for the wall", amount: 25, balance_after: 125, at: "2026-05-05T10:00:00Z" };
    expect(entryLine(e)).toMatch(/^\+25 CRN · transfer · for the wall — balance 125 \(/);
    expect(entryLine({ ...e, amount: -10, reason: null })).toMatch(/^-10 CRN · transfer — balance 125 \(/);
  });
});
