import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera } from "three";

import { RigidControls } from "../src/core/controls";
import { World } from "../src/core/world";
import { Inputs } from "../src/core/inputs";
import { Perspective } from "../src/libs/perspective";

const createControls = () =>
  ({
    camera: new PerspectiveCamera(),
    object: new Group(),
    isLocked: false,
  }) as RigidControls;

type RaycastResult = { point: [number, number, number] } | null;
type RaycastFn = (
  origin: [number, number, number],
  direction: [number, number, number],
  maxDistance: number
) => RaycastResult;
const createWorld = (raycastVoxels: RaycastFn = () => null) =>
  ({
    raycastVoxels,
  }) as World;

describe("Perspective state transitions", () => {
  it("resets camera quaternion to identity when state changes", () => {
    const controls = createControls();
    const perspective = new Perspective(controls, createWorld());
    controls.camera.quaternion.set(0.4, 0.1, 0.2, 0.8).normalize();

    perspective.state = "third";

    expect(controls.camera.quaternion.x).toBeCloseTo(0);
    expect(controls.camera.quaternion.y).toBeCloseTo(0);
    expect(controls.camera.quaternion.z).toBeCloseTo(0);
    expect(controls.camera.quaternion.w).toBeCloseTo(1);
  });

  it("falls back to max distance when raycast result is non-finite", () => {
    const controls = createControls();
    const perspective = new Perspective(
      controls,
      createWorld(() => ({ point: [Number.NaN, 0, 0] })),
      { maxDistance: 6, lerpFactor: 1 }
    );
    perspective.state = "second";

    perspective.update();

    expect(controls.camera.position.z).toBeCloseTo(-6);
    expect(Number.isFinite(controls.camera.position.z)).toBe(true);
  });

  it("normalizes invalid max distance before raycasts", () => {
    const controls = createControls();
    const raycastCalls: number[] = [];
    const perspective = new Perspective(
      controls,
      createWorld((_origin, _direction, maxDistance) => {
        raycastCalls.push(maxDistance);
        return null;
      }),
      { maxDistance: Number.NaN, lerpFactor: 1 }
    );
    perspective.state = "second";

    perspective.update();

    expect(raycastCalls).toEqual([5]);
    expect(controls.camera.position.z).toBeCloseTo(-5);
  });

  it("runs all unbind callbacks even when one throws", () => {
    const controls = createControls();
    const perspective = new Perspective(controls, createWorld());
    let bindCount = 0;
    let firstUnbindCalls = 0;
    let secondUnbindCalls = 0;
    const fakeInputs = {
      bind: () => {
        bindCount += 1;
        if (bindCount === 1) {
          return () => {
            firstUnbindCalls += 1;
            throw new Error("first-unbind-failure");
          };
        }
        return () => {
          secondUnbindCalls += 1;
        };
      },
    } as Inputs;

    const disconnect = perspective.connect(fakeInputs);
    disconnect();

    expect(firstUnbindCalls).toBe(1);
    expect(secondUnbindCalls).toBe(1);
  });
});
