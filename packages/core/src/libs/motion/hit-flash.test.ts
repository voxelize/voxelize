import assert from "node:assert/strict";

import { Color } from "three";
import { test } from "vitest";

import {
  HIT_FLASH,
  HIT_FLASH_MS,
  HIT_FLASH_POP,
  HIT_FLASH_RED,
  HIT_RECOIL_MS,
  holdHitFlash,
  sampleHitFlash,
  sampleHitRecoil,
} from "./hit-flash";

test("the flash pops pale, holds red, fades, and is gone", () => {
  const color = new Color();
  assert.equal(sampleHitFlash(0, color), HIT_FLASH.popAmount);
  assert.ok(color.equals(HIT_FLASH_POP), "a near-white pop the blow lands");
  assert.equal(sampleHitFlash(HIT_FLASH.popMs + 10, color), HIT_FLASH.peak);
  assert.ok(color.equals(HIT_FLASH_RED), "then red");
  const holdEnd = HIT_FLASH.popMs + HIT_FLASH.holdMs;
  assert.equal(sampleHitFlash(holdEnd - 1, color), HIT_FLASH.peak);
  const half = sampleHitFlash(holdEnd + HIT_FLASH.fadeMs / 2, color);
  assert.ok(Math.abs(half - HIT_FLASH.peak / 2) < 1e-9, `half-faded: ${half}`);
  assert.equal(sampleHitFlash(HIT_FLASH_MS, color), 0);
  assert.equal(HIT_FLASH_MS, 290);
});

test("no flash before any hit, and none for a clock that ran backwards", () => {
  const color = new Color();
  assert.equal(sampleHitFlash(Infinity, color), 0);
  assert.equal(sampleHitFlash(-5, color), 0);
  assert.equal(sampleHitFlash(Number.NaN, color), 0);
});

test("reduced motion drops the pale pop and opens on the red", () => {
  const color = new Color();
  assert.equal(sampleHitFlash(0, color, true), HIT_FLASH.peak);
  assert.ok(color.equals(HIT_FLASH_RED));
  assert.equal(
    sampleHitFlash(HIT_FLASH.holdMs + HIT_FLASH.fadeMs, color, true),
    0,
  );
});

test("a body tipping over dead keeps the red, never the pop", () => {
  const color = new Color();
  assert.equal(holdHitFlash(color), HIT_FLASH.peak);
  assert.ok(color.equals(HIT_FLASH_RED));
});

test("the recoil leans out and comes home in 120 ms", () => {
  assert.equal(sampleHitRecoil(0), 0);
  assert.ok(Math.abs(sampleHitRecoil(HIT_RECOIL_MS / 2) - 1) < 1e-9);
  assert.equal(sampleHitRecoil(HIT_RECOIL_MS), 0);
  assert.equal(sampleHitRecoil(Infinity), 0);
  assert.equal(HIT_RECOIL_MS, 120);
});
