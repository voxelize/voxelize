// A minimal in-page bridge for `@voxelize/agent`: enough of its
// `window.__agent__` surface to join, report readiness, move the camera and
// take pure captures, so the agent's daemon (`/healthz`, `/act`, `/sc`) can
// drive the example client headlessly. Methods the example has no use for
// throw a clear "unsupported" error instead of pretending.

import * as VOXELIZE from "@voxelize/core";
import type { EffectComposer } from "postprocessing";
import * as THREE from "three";

type Vec3 = { x: number; y: number; z: number };
type ChunkCoord = { cx: number; cz: number };
type FaceInput =
  | { target: Vec3 }
  | { yaw: number; pitch: number }
  | { direction: Vec3 };

export type AgentBridgeContext = {
  world: VOXELIZE.World;
  controls: VOXELIZE.RigidControls;
  network: VOXELIZE.Network;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  worldName: string;
  ready: Promise<void>;
};

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function installAgentBridge(ctx: AgentBridgeContext) {
  const { world, controls, network, renderer, composer } = ctx;
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  let joinGeneration = 0;
  ctx.ready.then(() => {
    joinGeneration = 1;
  });

  const chunkSize = () => world.options.chunkSize;
  const position = (): Vec3 => {
    const p = controls.object.position;
    return { x: p.x, y: p.y, z: p.z };
  };
  const facing = () => {
    const dir = controls.getDirection();
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    return { yaw, pitch, roll: 0 };
  };
  const chunkOf = (target: Vec3 | ChunkCoord): ChunkCoord =>
    "cx" in target
      ? target
      : {
          cx: Math.floor(target.x / chunkSize()),
          cz: Math.floor(target.z / chunkSize()),
        };
  const isLoaded = (c: ChunkCoord) =>
    Boolean(world.getChunkByCoords(c.cx, c.cz)?.isReady);
  const loadedList = (): ChunkCoord[] => {
    const out: ChunkCoord[] = [];
    world.chunkPipeline.forEachLoaded((chunk) => {
      out.push({ cx: chunk.coords[0], cz: chunk.coords[1] });
    });
    return out;
  };
  const unsupported = (name: string) => () => {
    throw new Error(`${name} is not supported by the voxelize example client`);
  };

  const bridge = {
    ready: ctx.ready,
    position,
    facing,
    snapshot: () => ({
      position: position(),
      facing: facing(),
      world: ctx.worldName,
      isReady: world.isInitialized,
      raycast: null,
      nearbyEntities: [],
      chunks: {
        loaded: world.chunkPipeline.loadedCount,
        pending:
          world.chunkPipeline.requestedCount +
          world.chunkPipeline.processingCount,
      },
    }),
    connection: () => ({
      isConnected: network.connected,
      isJoined: network.joined,
      isJoinPending: network.connected && !network.joined,
      isClientOutdated: false,
      joinGeneration,
      pendingCommandCount: 0,
      droppedCommandCount: 0,
      serverUrl: null,
    }),
    reconnectNow: () => false,
    teleport: async (pos: Vec3) => {
      controls.teleportToExact(pos.x, pos.y, pos.z);
      await nextFrame();
    },
    face: async (input: FaceInput) => {
      if ("target" in input) {
        const p = controls.object.position;
        controls.setDirection(
          input.target.x - p.x,
          input.target.y - p.y,
          input.target.z - p.z,
        );
      } else if ("direction" in input) {
        controls.setDirection(
          input.direction.x,
          input.direction.y,
          input.direction.z,
        );
      } else {
        const c = Math.cos(input.pitch);
        controls.setDirection(
          -Math.sin(input.yaw) * c,
          Math.sin(input.pitch),
          -Math.cos(input.yaw) * c,
        );
      }
      await nextFrame();
    },
    // A camera that holds its pose: ghost mode (no gravity, no collision).
    setFlying: async (isFlying: boolean) => {
      if (isFlying !== controls.ghostMode) controls.toggleGhostMode();
      controls.body.velocity = [0, 0, 0];
    },
    setRenderRadius: async (radius: number) => {
      world.renderRadius = radius;
      return world.renderRadius;
    },
    setFogDistance: async (blocks: number | null) => {
      world.fogDistance = blocks;
      return world.fogDistance;
    },
    captureFrame: async (opts?: { isPure?: boolean }) => {
      void opts;
      await nextFrame();
      // Draw and read back in one task, so the drawing buffer is still
      // ours (the canvas does not preserve it between frames).
      composer.render();
      return renderer.domElement.toDataURL("image/png");
    },
    chunks: {
      state: (target: Vec3 | ChunkCoord) => {
        const c = chunkOf(target);
        if (isLoaded(c)) return "loaded";
        return world.getChunkByCoords(c.cx, c.cz) ? "pending" : "unloaded";
      },
      waitFor: async (pos: Vec3, radius = 1, timeoutMs = 30000) => {
        const c = chunkOf(pos);
        const started = performance.now();
        for (;;) {
          let all = true;
          for (let dx = -radius; dx <= radius && all; dx++) {
            for (let dz = -radius; dz <= radius && all; dz++) {
              all = isLoaded({ cx: c.cx + dx, cz: c.cz + dz });
            }
          }
          if (all) return;
          if (performance.now() - started > timeoutMs) {
            throw new Error(`chunks around ${c.cx},${c.cz} did not load`);
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      loaded: loadedList,
      pending: () => [],
      list: () => loadedList().map((c) => ({ ...c, state: "loaded" })),
      waitForPaint: async (opts?: { timeoutMs?: number }) => {
        const started = performance.now();
        const timeout = opts?.timeoutMs ?? 10000;
        let quiet = 0;
        while (performance.now() - started < timeout && quiet < 2) {
          await nextFrame();
          const busy =
            world.chunkPipeline.requestedCount +
            world.chunkPipeline.processingCount;
          quiet = busy === 0 ? quiet + 1 : 0;
        }
        return {
          isSettled: quiet >= 2,
          elapsedMs: performance.now() - started,
        };
      },
    },
    setDrawThrottle: async () => ({ intervalMs: null }),
    drawThrottle: () => ({ intervalMs: null }),
    on: (event: string, cb: (data: unknown) => void) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb);
      return () => set?.delete(cb);
    },
    chat: async () => ({ ok: false, message: "no chat in the example" }),
    walk: unsupported("walk"),
    walkTo: unsupported("walkTo"),
    view: unsupported("view"),
    follow: unsupported("follow"),
    unfollow: async () => undefined,
    following: () => null,
    call: unsupported("call"),
    breakVoxel: unsupported("breakVoxel"),
    placeVoxel: unsupported("placeVoxel"),
    selectHotbar: unsupported("selectHotbar"),
    interact: unsupported("interact"),
    raycast: () => null,
    blockAt: (pos: Vec3) => {
      const id = world.getVoxelAt(pos.x, pos.y, pos.z);
      const block = world.getBlockById(id);
      return block
        ? {
            id,
            name: block.name,
            isEmpty: block.isEmpty,
            isFluid: block.isFluid,
            isPassable: block.isPassable,
            isWaterlogged: false,
            stage: 0,
            yRotation: 0,
            sunlight: 0,
            torchLight: 0,
          }
        : null;
    },
    entitiesNear: () => [],
    peers: () => [],
  };

  (window as unknown as { __agent__: typeof bridge }).__agent__ = bridge;
  return bridge;
}
