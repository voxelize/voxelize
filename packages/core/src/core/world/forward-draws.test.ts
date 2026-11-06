import {
  type BufferGeometry,
  type Camera,
  type Group,
  MeshBasicNodeMaterial,
  type Object3D,
  type Scene,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { forwardDraws } from "./forward-draws";

const draw = (material: MeshBasicNodeMaterial) =>
  material.onBeforeRender(
    {} as Parameters<MeshBasicNodeMaterial["onBeforeRender"]>[0],
    {} as Scene,
    {} as Camera,
    {} as BufferGeometry,
    {} as Object3D,
    {} as Group,
  );

describe("forwardDraws", () => {
  it("runs the source's hook, installed after the display was built", () => {
    const source = new MeshBasicNodeMaterial();
    const display = new MeshBasicNodeMaterial({ map: null });
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
    const source = new MeshBasicNodeMaterial();
    const display = new MeshBasicNodeMaterial({ color: 0x336699 });
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
    expect(copy).toBeInstanceOf(MeshBasicNodeMaterial);
  });
});
