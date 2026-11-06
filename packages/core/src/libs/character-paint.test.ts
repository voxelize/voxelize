import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Character } from "./character";

// Painting a face gives its canvas a 2D context, and the browser finalizes
// each context on its own when the character is collected: a crowd of
// characters built and dropped cost whole-second garbage collections. A
// character built unpainted must not ask for a single context.
let contexts = 0;

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => {
        contexts += 1;
        return null;
      },
    }),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("character default paint", () => {
  it("paints its boxes as it is built, by default", () => {
    contexts = 0;
    new Character();
    expect(contexts).toBeGreaterThan(0);
  });

  it("asks for no 2D context when built unpainted, until painted", () => {
    contexts = 0;
    const character = new Character({ isPaintedOnBuild: false });
    expect(contexts).toBe(0);
    character.paintDefaultColors();
    expect(contexts).toBeGreaterThan(0);
  });
});
