import { describe, it, expect } from "vitest";
import { fibonacci } from "./fibonacci";

describe("fibonacci", () => {
	it("handles base cases", () => {
		expect(fibonacci(-3 as unknown as number)).toBe(0);
		expect(fibonacci(0)).toBe(0);
		expect(fibonacci(1)).toBe(1);
	});

	it("computes small values", () => {
		expect(fibonacci(2)).toBe(1);
		expect(fibonacci(3)).toBe(2);
		expect(fibonacci(4)).toBe(3);
		expect(fibonacci(5)).toBe(5);
		expect(fibonacci(6)).toBe(8);
	});

	it("computes larger values", () => {
		expect(fibonacci(10)).toBe(55);
		expect(fibonacci(20)).toBe(6765);
	});
});
