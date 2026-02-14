import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera } from "three";

import { RigidControls } from "../src/core/controls";
import { World } from "../src/core/world";
import { Perspective } from "../src/libs/perspective";

const createControls = () =>
  ({
    camera: new PerspectiveCamera(),
    object: new Group(),
    isLocked: false,
  }) as RigidControls;

const createWorld = () =>
  ({
    raycastVoxels: () => null,
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
});
