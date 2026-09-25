import {
  type BufferGeometry,
  type Camera,
  type Group,
  MeshBasicMaterial,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import { forwardDraws } from "./forward-draws";

const draw = (material: MeshBasicMaterial) =>
  material.onBeforeRender(
    {} as WebGLRenderer,
    {} as Scene,
    {} as Camera,
    {} as BufferGeometry,
    {} as Object3D,
    {} as Group,
  );

describe("forwardDraws", () => {
  it("runs the source's hook, installed after the display was built", () => {
    const source = new MeshBasicMaterial();
    const display = new MeshBasicMaterial({ map: null });
    forwardDraws(display, source);
    let calls = 0;
    source.onBeforeRender = () => {
      calls++;
    };
    draw(display);
    draw(display);
    expect(calls).toBe(2);
  });

  it("keeps forwarding through clones of clones", () => {
    const source = new MeshBasicMaterial();
    const display = new MeshBasicMaterial({ color: 0x336699 });
    forwardDraws(display, source);
    const copy = display.clone().clone();
    let calls = 0;
    source.onBeforeRender = () => {
      calls++;
    };
    draw(copy);
    expect(calls).toBe(1);
    expect(copy).not.toBe(display);
    expect(copy.color.getHex()).toBe(0x336699);
    expect(copy).toBeInstanceOf(MeshBasicMaterial);
  });
});
