import { Engine } from "@voxelize/physics-engine";
import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";

import { RigidControls } from "./controls";
import type { World } from "./world";

/** Controls on a canvas whose document may already hold the pointer lock. */
function controlsOn(lockedTo: "this" | "other" | null) {
  const ownerDocument: { pointerLockElement: unknown } = {
    pointerLockElement: null,
  };
  const domElement = { ownerDocument } as unknown as HTMLElement;
  ownerDocument.pointerLockElement =
    lockedTo === "this" ? domElement : lockedTo === "other" ? {} : null;
  const world = {
    physics: new Engine(
      () => [],
      () => false,
      () => [],
      () => 0,
      () => 0,
      {
        gravity: [0, -24.8, 0],
        minBounceImpulse: 0,
        airDrag: 0,
        fluidDrag: 0,
        fluidDensity: 1,
      },
    ),
    options: { gravity: [0, -24.8, 0], chunkSize: 16 },
    add: () => undefined,
    getBlockAt: () => null,
    getBlockAABBsAt: () => [],
  } as unknown as World;
  return new RigidControls(new PerspectiveCamera(), domElement, world, {});
}

describe("RigidControls.adoptPointerLock", () => {
  it("takes over a lock the canvas already holds, as if it had asked", () => {
    const controls = controlsOn("this");
    let locks = 0;
    controls.on("lock", () => {
      locks += 1;
    });

    expect(controls.adoptPointerLock()).toBe(true);
    expect(controls.isLocked).toBe(true);
    expect(locks).toBe(1);
    // Already its own: no second lock event.
    expect(controls.adoptPointerLock()).toBe(true);
    expect(locks).toBe(1);
  });

  it("adopts nothing when the lock is gone or held elsewhere", () => {
    expect(controlsOn(null).adoptPointerLock()).toBe(false);
    const elsewhere = controlsOn("other");
    expect(elsewhere.adoptPointerLock()).toBe(false);
    expect(elsewhere.isLocked).toBe(false);
  });
});
