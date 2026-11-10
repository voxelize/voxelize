import {
  type BufferGeometry,
  type Camera,
  type Group,
  MeshBasicNodeMaterial,
  type Object3D,
  type Scene,
  Texture,
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

describe("forwardDraws followMap", () => {
  it("takes up the image the source is painted with after the copy was built", () => {
    const placeholder = new Texture();
    const source = new MeshBasicNodeMaterial({ map: placeholder });
    const display = new MeshBasicNodeMaterial({ map: placeholder });
    forwardDraws(display, source, { followMap: true });
    // A caller windows its own copy of the texture (a flame strip's frame).
    const copy = display.clone();
    copy.map = placeholder.clone();
    copy.map.repeat.y = 1 / 16;
    const before = copy.map.version;

    const painted = new Texture();
    source.map = painted;
    draw(copy);

    expect(copy.map.source).toBe(painted.source);
    expect(copy.map.repeat.y).toBe(1 / 16);
    expect(copy.map.version).toBeGreaterThan(before);
  });

  it("leaves a map the caller replaced on purpose, and is off by default", () => {
    const placeholder = new Texture();
    const source = new MeshBasicNodeMaterial({ map: placeholder });
    const tinted = new MeshBasicNodeMaterial({ map: placeholder });
    forwardDraws(tinted, source, { followMap: true });
    const own = new Texture();
    tinted.map = own;
    const plain = new MeshBasicNodeMaterial({ map: placeholder });
    forwardDraws(plain, source);

    source.map = new Texture();
    draw(tinted);
    draw(plain);

    expect(tinted.map.source).toBe(own.source);
    expect(plain.map?.source).toBe(placeholder.source);
  });
});
