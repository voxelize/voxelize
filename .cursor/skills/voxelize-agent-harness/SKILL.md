---
name: voxelize-agent-harness
description: Drive a real Voxelize client headlessly with @voxelize/agent — the daemon and its HTTP routes, the host bridge contract, the scenario SDK (runScenario, Arena, waitUntil, measureFrameRate), captures, staleness and lifecycle guarantees. Use when writing an agent-driven test or measurement, adding a daemon route or bridge observation, embedding the agent in a new host game, or debugging an agent session that will not start.
---

# Agent Harness

`@voxelize/agent` runs a real client in headless Chromium and exposes it over HTTP. Everything the agent sees is what a player sees; nothing is mocked. The host game supplies the page (its client URL), a bridge object on `window`, and a few server methods; the package supplies the daemon, the SDK and the lifecycle.

## Running a daemon

```bash
node packages/agent/dist/bin/voxelize-agent.mjs --world test --port 4099 \
  --url http://localhost:3000 [--name agent] [--auth-url <dev-login>] \
  [--idle-ttl-ms N] [--lease-minutes N] [--meta key=value] [--headed]
```

- The daemon waits for the host's bridge (`window.__agent__`), which lands after asset load and world init; the wait scales with machine load (`AGENT_READY_TIMEOUT_MS` to pin it). A broken client build never installs the bridge — read the page errors in the daemon log before raising the timeout.
- Environment: `AGENT_CACHE_DIR` (profiles and launch wrappers; default `~/.cache/voxelize-agent`), `AGENT_PROFILE_DIR`, `AGENT_EPHEMERAL_PROFILE=1` (cold cache), `AGENT_BROWSER_PRIORITY=normal` (no QoS/nice clamp — use it for A/B timing), `AGENT_CHROME_ARGS` (e.g. `--disable-gpu-vsync --disable-frame-rate-limit` for uncapped frame times), `AGENT_IDLE_TTL_MS` (0 = never expire), `AGENT_CAPTURE_DIR`.
- Lifecycle: plain detached process; the browser never outlives the daemon (a watchdog covers `kill -9`); idle expiry after the ttl; kill daemon-first. The `agent-harness` rule has the invariants.

## HTTP surface

Reads: `/me`, `/snapshot`, `/entities`, `/players`, `/block`, `/chunks`, `/memory`, `/render-stats`, `/textures`, `/block-animations`, `/status`, `/healthz`, `/meta`. Actions: `/act` (one action), `/batch` (JSONL of actions), `/wait` (daemon-side predicate polling), `/freeze` / `/thaw`, `/reconnect`, `/reset`. Captures: `/sc`, `/screenshot`, `/frame`, `/sc-burst`, `/camera/shot` + `/camera/status`, `/video/start` + `/video/status`. Profiling: `/profile`, `/mesh-transfer/*`.

- **Staleness is visible.** While the session is disconnected or rejoining, reads answer `409 world stale` with `staleForMs`; `wait` skips polls while stale. Reconnection is automatic: grace, in-page reconnect, then page reset — never a new browser.
- **Stalls answer instead of hanging.** Every page call has a timeout; a stalled one returns `503` with `retryAfterMs`, and repeats are refused rather than stacked.
- **Sends report what happened.** Method and chat actions return `{ isSent, isQueued, queuedReason }`; while disconnected they queue (bounded) and drain on rejoin, and overflow is counted in `/status`.

## The bridge contract (host side)

`src/bridge.ts` declares what the host's `window.__agent__` implements: snapshots of the player, entities, peers, blocks and chunks; actions (teleport, face, walk, place, interact, chat, method calls); captures and frame-rate measurement. Snapshot entity `metadata` is the replicated metadata blob, so tests assert on the same paths the game replicates (`metadata.moveComp.state.type`). Add an observation by extending the type here and implementing it in the host bridge; keep game-only fields out of the engine's types — the host extends them.

## Scenario SDK

```ts
import { runScenario } from "@voxelize/agent/scenario";

await runScenario({
  name: "swimmer-enters-water",
  arena: { index: 0, size: [16, 8, 16] },
  timeoutMs: 120_000,
  body: async ({ arena, agent, expect, log }) => {
    await arena.fill([0, 0, 0], [15, 1, 15], "Stone");
    await arena.waitForBlockAtRel([7, 1, 7], (b) => b?.name === "Stone");
    await arena.spawn("walker", [2.5, 3.5, 2.5], { payload: { hostOption: 1 } });
    await agent.waitUntil({
      timeoutMs: 60_000,
      until: { kind: "walker", path: "metadata.moveComp.state.type", op: "eq", value: "idle" },
    });
    log(JSON.stringify(await agent.measureFrameRate({ warmupMs: 3000, durationMs: 10_000 })));
    await agent.screenshot("walker", { isPure: true });
  },
});
```

- The arena is a slot on a deterministic grid (index → origin); its fills, spawns and wipes go through four host methods named by `DEFAULT_ARENA_METHODS` (`test:fill`, `test:spawn`, `test:despawn`, `test:announce`), remappable with `ArenaOptions.methods`. Spawned entities carry the scenario id, so `despawn` removes only this scenario's entities; teardown runs before the body and again in `finally`.
- Anything game-specific is `arena.call(method, payload)` or extra spawn fields through `SpawnOptions.payload`; the SDK never grows a game's method.
- `agent.waitUntil` is one HTTP call with daemon-side polling and a timeout that embeds the last-seen state; prefer it to sleep-then-poll. `expect.waitFor` polls client-side for conditions `/wait` cannot express.
- Bulk edits commit over server ticks: gate on `waitForBlockAtRel` (read-back), never on the send.

## Measurement honesty

- `measureFrameRate` is capped by vsync unless the browser was launched uncapped; say which.
- Keep every repro input in the script: world, arena, camera position and look target, warmup, duration, thresholds.
- A measurement on a saturated machine measures the machine; report load alongside the number, and compare before/after only under the same conditions (`AGENT_BROWSER_PRIORITY=normal` on both sides).
