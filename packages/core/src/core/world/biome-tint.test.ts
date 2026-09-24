import { describe, expect, it } from "vitest";
import { biomeTintAttribute } from "./biome-tint";

const tinted = new Uint32Array([0x80000000]);
function color(field: Uint8Array, x: number, z: number) {
  return Array.from(biomeTintAttribute(new Float32Array([x, 3, z]), tinted, field, 16).array);
}
describe("continuous regional material color", () => {
  it("shares an edge at every height and preserves intermediate colors", () => {
    const a = new Uint8Array([128,128,128, 177,120,79, 97,134,100, 113,122,147]);
    const b = new Uint8Array([...a.slice(3,6), 128,128,128, ...a.slice(9,12), 97,134,100]);
    for (let z = 0; z <= 16; z += 0.5) expect(color(a, 16, z)).toEqual(color(b, 0, z));
    expect(color(a, 8, 0)).toEqual([153,124,104]);
    expect(color(a, 8, 8)).toEqual([129,126,114]);
  });
  it("keeps untinted faces authored and falls back on worlds without the field", () => {
    const field = new Uint8Array(12).fill(128);
    expect(Array.from(biomeTintAttribute(new Float32Array([8, 3, 8]), new Uint32Array([0]), field, 16).array)).toEqual([0,0,0]);
    expect(Array.from(biomeTintAttribute(new Float32Array([8, 3, 8]), tinted, undefined, 16).array)).toEqual([0,0,0]);
    expect(color(field, 8, 8)).toEqual([128,128,128]);
  });
  it("decodes quantized, biased coordinates identically and handles plant jitter", () => {
    const field = new Uint8Array([128,128,128, 177,120,79, 97,134,100, 113,122,147]);
    const packed = biomeTintAttribute(new Uint16Array([10*256, 4*256, 7*256]), tinted, field, 16, 256, 2);
    expect(Array.from(packed.array)).toEqual(color(field, 8, 5));
    expect(color(field, -0.1, 0)).toEqual(color(field, 0, 0));
    expect(color(field, 16.1, 16)).toEqual(color(field, 16, 16));
  });
});
