import { DoubleSide, FrontSide, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import {
  normalsShareOneDirection,
  singlePassWhenOneFacing,
} from "./single-pass-sides";

const card = [0.7071, 0, 0.7071, 0.7071, 0, 0.7071, 0.7071, 0, 0.7071];
const twoParallelQuads = [...card, ...card];
const crossedCards = [...card, -0.7071, 0, 0.7071];

describe("normalsShareOneDirection", () => {
  it("accepts one card and parallel quads facing the same way", () => {
    expect(normalsShareOneDirection(card)).toBe(true);
    expect(normalsShareOneDirection(twoParallelQuads)).toBe(true);
  });

  it("rejects faces that point different ways", () => {
    expect(normalsShareOneDirection(crossedCards)).toBe(false);
    expect(normalsShareOneDirection([0, 1, 0, 0, -1, 0])).toBe(false);
  });

  it("rejects an empty buffer", () => {
    expect(normalsShareOneDirection([])).toBe(false);
  });
});

describe("singlePassWhenOneFacing", () => {
  it("draws a transparent double-sided card in one pass", () => {
    const material = new MeshBasicMaterial({
      transparent: true,
      side: DoubleSide,
    });
    singlePassWhenOneFacing(material, card);
    expect(material.forceSinglePass).toBe(true);
  });

  it("keeps back-then-front passes where both sides can overlap", () => {
    const material = new MeshBasicMaterial({
      transparent: true,
      side: DoubleSide,
    });
    singlePassWhenOneFacing(material, crossedCards);
    expect(material.forceSinglePass).toBe(false);
  });

  it("leaves opaque and front-sided materials alone", () => {
    const opaque = new MeshBasicMaterial({ side: DoubleSide });
    const front = new MeshBasicMaterial({ transparent: true, side: FrontSide });
    singlePassWhenOneFacing(opaque, card);
    singlePassWhenOneFacing(front, card);
    expect(opaque.forceSinglePass).toBe(false);
    expect(front.forceSinglePass).toBe(false);
  });
});
