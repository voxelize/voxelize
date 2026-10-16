import { protocol } from "@voxelize/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  /** Answers every decode with the next scripted batch of messages. */
  class FakeDecodeWorker extends EventTarget {
    static script: unknown[][] = [];

    static spawned: FakeDecodeWorker[] = [];

    /** While set, answers are held (a decode still running) until released. */
    static isHolding = false;

    static held: Array<() => void> = [];

    static release(): void {
      FakeDecodeWorker.held.splice(0).forEach((answer) => answer());
    }

    constructor() {
      super();
      FakeDecodeWorker.spawned.push(this);
    }

    postMessage(): void {
      const messages = FakeDecodeWorker.script.shift() ?? [];
      const answer = () =>
        this.dispatchEvent(new MessageEvent("message", { data: messages }));
      if (FakeDecodeWorker.isHolding) FakeDecodeWorker.held.push(answer);
      else queueMicrotask(answer);
    }

    terminate(): void {}
  }

  /** A socket that records what is handed to it and opens on command. */
  class FakeSocket {
    static CONNECTING = 0;

    static OPEN = 1;

    static CLOSED = 3;

    static opened: FakeSocket[] = [];

    readyState = FakeSocket.CONNECTING;

    binaryType = "blob";

    sent: Uint8Array[] = [];

    onopen: (() => void) | null = null;

    onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;

    onclose: ((event: { code: number; reason: string }) => void) | null = null;

    onerror: ((event: Event) => void) | null = null;

    constructor(readonly url: string) {
      FakeSocket.opened.push(this);
    }

    send(data: Uint8Array): void {
      this.sent.push(data);
    }

    close(): void {
      this.readyState = FakeSocket.CLOSED;
    }

    open(): void {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    }

    /** Deliver one packet; the fake worker decides what it decodes to. */
    receive(): void {
      this.onmessage?.({ data: new ArrayBuffer(1) });
    }
  }

  type Entry = { digest: string; blocks: string };
  /** Stands in for Cache Storage / IndexedDB (read through the priority
   * worker), which the test environment lacks. */
  const store = {
    kept: null as Entry | null,
    reads: 0,
    readDelayMs: 0,
    writes: [] as Entry[],
    clears: 0,
  };
  /** Stands in for localStorage, which holds the synchronous digest hint. */
  const local = new Map<string, string>();

  return { FakeDecodeWorker, FakeSocket, store, local };
});

vi.mock("./workers/decode-worker.ts?worker&inline", () => ({
  default: fakes.FakeDecodeWorker,
}));
vi.mock("../../libs/setWorkerInterval", () => ({
  setWorkerInterval: () => () => undefined,
}));
vi.mock("./registry-cache", async (importOriginal) => {
  const original = await importOriginal<typeof import("./registry-cache")>();
  const { store } = fakes;
  return {
    ...original,
    createRegistryBackend: () => ({
      read: async () => store.kept,
      write: async (entry: { digest: string; blocks: string }) => {
        store.writes.push(entry);
        store.kept = entry;
        return true;
      },
      clear: async () => {
        store.clears += 1;
        store.kept = null;
      },
    }),
    readRegistryInWorker: () => {
      store.reads += 1;
      return new Promise((resolve) =>
        setTimeout(() => resolve(store.kept), store.readDelayMs),
      );
    },
  };
});

import { Network } from "./index";

const { FakeDecodeWorker, FakeSocket, store, local } = fakes;
const HINT_KEY = "voxelize:registry-digest";

const BLOCKS_TEXT =
  '{"air":{"id":0,"faces":[]},"stone":{"id":1,"faces":[{"name":"top"}]}}';
const DIGEST = "0123456789abcdef0123456789abcdef-70";

const fullInit = (digest = DIGEST) => ({
  type: "INIT",
  json:
    `{"blocks":${BLOCKS_TEXT},"registryDigest":"${digest}",` +
    `"id":"client","options":{"chunkSize":16},"registryBlocksLength":${BLOCKS_TEXT.length}}`,
});

const cachedInit = (digest = DIGEST) => ({
  type: "INIT",
  json: {
    id: "client",
    options: { chunkSize: 16 },
    registryDigest: digest,
    registryCached: true,
  },
});

/** The JOIN payloads a socket was handed, decoded. */
const joinsOn = (socket: InstanceType<typeof FakeSocket>) =>
  socket.sent
    .map((bytes) => protocol.Message.decode(bytes))
    .filter((message) => message.type === protocol.Message.Type.JOIN)
    .map((message) => JSON.parse(message.json) as Record<string, unknown>);

describe("Network block registry handshake", () => {
  let errors: string[];
  let logs: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    errors = [];
    logs = [];
    FakeSocket.opened = [];
    FakeDecodeWorker.script = [];
    FakeDecodeWorker.spawned = [];
    FakeDecodeWorker.isHolding = false;
    FakeDecodeWorker.held = [];
    store.kept = null;
    store.reads = 0;
    local.clear();
    store.readDelayMs = 0;
    store.writes = [];
    store.clears = 0;
    vi.stubGlobal("window", { navigator: { hardwareConcurrency: 4 } });
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
      removeItem: (key: string) => local.delete(key),
    });
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Keep `entry` as an earlier page load would have. */
  const keep = (entry: { digest: string; blocks: string }) => {
    store.kept = entry;
    local.set(HINT_KEY, entry.digest);
  };

  const openNetwork = async (
    options: ConstructorParameters<typeof Network>[0] = {},
  ) => {
    const network = new Network(options);
    const seen: Array<Record<string, unknown>> = [];
    network.register({
      onMessage: (message) => {
        if (message.type === "INIT") seen.push(structuredClone(message.json));
      },
    });
    // Without a ticket getter the socket is created synchronously.
    const connecting = network.connect("http://localhost:4000");
    const socket = FakeSocket.opened.at(-1);
    if (!socket) throw new Error("no socket");
    socket.open();
    await connecting;
    return { network, socket, seen };
  };

  /** Answer the pending JOIN with `init` and let it settle. */
  const answer = async (
    socket: InstanceType<typeof FakeSocket>,
    init: unknown,
  ) => {
    FakeDecodeWorker.script.push([init]);
    socket.receive();
    await vi.advanceTimersByTimeAsync(0);
  };

  /** Join, answer with `init`, and let everything settle. */
  const joinAnswered = async (
    network: Network,
    socket: InstanceType<typeof FakeSocket>,
    init: unknown,
  ) => {
    const joined = network.join("world");
    await answer(socket, init);
    return joined;
  };

  it("keeps the registry of a full INIT and names it on the next JOIN", async () => {
    const { network, socket, seen } = await openNetwork();
    await joinAnswered(network, socket, fullInit());

    expect(joinsOn(socket)[0].registryDigest).toBeUndefined();
    expect((seen[0].blocks as Record<string, unknown>).stone).toEqual({
      id: 1,
      faces: [{ name: "top" }],
    });
    expect(seen[0].registryDigest).toBe(DIGEST);
    expect(seen[0].registryBlocksLength).toBeUndefined();
    expect(store.writes).toEqual([{ digest: DIGEST, blocks: BLOCKS_TEXT }]);

    // A rejoin (reconnect, world switch) names the registry it holds, and an
    // INIT that leaves it out reaches every intercept whole all the same.
    await joinAnswered(network, socket, cachedInit());
    expect(joinsOn(socket)[1].registryDigest).toBe(DIGEST);
    expect(seen).toHaveLength(2);
    expect(seen[1].blocks).toEqual(seen[0].blocks);
    expect(seen[1].registryCached).toBeUndefined();
    expect(network.joinGeneration).toBe(2);
    expect(errors).toEqual([]);
  });

  it("names a kept registry on the first JOIN at once, while it still loads", async () => {
    keep({ digest: DIGEST, blocks: BLOCKS_TEXT });
    store.readDelayMs = 200;
    const { network, socket, seen } = await openNetwork();

    const joined = network.join("world");
    // The JOIN does not wait for the read.
    expect(joinsOn(socket)).toHaveLength(1);
    expect(joinsOn(socket)[0].registryDigest).toBe(DIGEST);

    // The INIT that leaves the registry out lands first and waits for it,
    // with everything behind it held.
    const intercept = {
      packets: [{ type: "METHOD", method: { name: "ping", payload: "{}" } }],
    };
    network.register(intercept as never);
    await answer(socket, cachedInit());
    expect(seen).toEqual([]);
    expect(network.isJoinPending).toBe(true);
    network.flush();
    expect(intercept.packets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200);
    await joined;
    expect(seen).toHaveLength(1);
    expect((seen[0].blocks as Record<string, unknown>).air).toEqual({
      id: 0,
      faces: [],
    });
    expect(network.isJoinPending).toBe(false);
    expect(store.writes).toEqual([]);
    expect(logs.some((line) => line.includes("INIT waited"))).toBe(true);
  });

  /** The socket a rejoin opened, opened. */
  const reopened = () => {
    const socket = FakeSocket.opened.at(-1);
    if (!socket) throw new Error("no socket");
    socket.open();
    return socket;
  };

  it("joins again without a digest when the kept registry never loads in time", async () => {
    keep({ digest: DIGEST, blocks: BLOCKS_TEXT });
    store.readDelayMs = 60_000;
    const { network, socket, seen } = await openNetwork({
      registryCacheWaitMs: 1000,
    });
    const joined = network.join("world");
    await answer(socket, cachedInit());

    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.opened).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    // A fresh socket, so the full INIT is the first thing on it.
    expect(FakeSocket.opened).toHaveLength(2);
    const fresh = reopened();
    expect(joinsOn(fresh)).toHaveLength(1);
    expect(joinsOn(fresh)[0].registryDigest).toBeUndefined();
    // The slow store is not wiped for being slow.
    expect(store.clears).toBe(0);

    await answer(fresh, fullInit());
    await joined;
    expect(seen).toHaveLength(1);
    expect(seen[0].blocks).toEqual(JSON.parse(BLOCKS_TEXT));
  });

  it("joins again on a fresh socket when an INIT leaves out a registry this client lacks", async () => {
    const { network, socket, seen } = await openNetwork();
    const joined = network.join("world");

    await answer(socket, cachedInit());
    expect(seen).toEqual([]);
    expect(network.isJoinPending).toBe(true);
    expect(
      errors.some((line) =>
        line.includes("joining again for the full registry"),
      ),
    ).toBe(true);

    // The old session goes on streaming the world it joined; none of it is
    // read, and the new socket's first packet is its INIT.
    socket.receive();
    expect(socket.onmessage).toBeNull();
    const fresh = reopened();
    expect(joinsOn(fresh)).toHaveLength(1);
    expect(joinsOn(fresh)[0].registryDigest).toBeUndefined();

    await answer(fresh, fullInit());
    await joined;
    expect(seen).toHaveLength(1);
    expect(seen[0].blocks).toEqual(JSON.parse(BLOCKS_TEXT));
    expect(network.isJoinPending).toBe(false);
  });

  it("forgets a stale hint whose registry is gone, and joins again without it", async () => {
    local.set(HINT_KEY, DIGEST);
    const { network, socket, seen } = await openNetwork();
    const joined = network.join("world");
    expect(joinsOn(socket)[0].registryDigest).toBe(DIGEST);

    await answer(socket, cachedInit());
    expect(store.clears).toBe(1);
    expect(local.has(HINT_KEY)).toBe(false);
    const fresh = reopened();
    expect(joinsOn(fresh)[0].registryDigest).toBeUndefined();

    await answer(fresh, fullInit());
    await joined;
    expect(seen).toHaveLength(1);
    expect(store.writes).toEqual([{ digest: DIGEST, blocks: BLOCKS_TEXT }]);
    expect(local.get(HINT_KEY)).toBe(DIGEST);
  });

  it("names nothing once a settled read finds the hinted registry gone", async () => {
    // The hint outlived its entry (a service worker swept Cache Storage).
    local.set(HINT_KEY, DIGEST);
    const { network, socket, seen } = await openNetwork();
    await vi.advanceTimersByTimeAsync(0);

    const joined = network.join("world");
    expect(joinsOn(socket)[0].registryDigest).toBeUndefined();
    await answer(socket, fullInit());
    await joined;
    // Answered in full on the first socket: no fresh-socket rejoin.
    expect(FakeSocket.opened).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("reads nothing more of the dropped session while the fresh socket's ticket loads", async () => {
    const tickets: Array<(ticket: string) => void> = [];
    const network = new Network();
    const seen: unknown[] = [];
    network.register({
      onMessage: (message) => {
        if (message.type === "INIT") seen.push(message.json);
      },
    });
    const connecting = network.connect("http://localhost:4000", {
      getTicket: () => new Promise<string>((resolve) => tickets.push(resolve)),
    });
    tickets.shift()?.("first");
    await vi.advanceTimersByTimeAsync(0);
    const socket = reopened();
    await connecting;

    const joined = network.join("world");
    await answer(socket, cachedInit());
    // The fresh socket waits on its ticket; the old one is let go already,
    // so nothing it still streams lands in the cleared queue.
    expect(tickets).toHaveLength(1);
    expect(FakeSocket.opened).toHaveLength(1);
    expect(socket.onmessage).toBeNull();
    expect(socket.readyState).toBe(FakeSocket.CLOSED);

    tickets.shift()?.("second");
    await vi.advanceTimersByTimeAsync(0);
    const fresh = reopened();
    expect(fresh.url).toContain("ticket=second");
    expect(joinsOn(fresh)[0].registryDigest).toBeUndefined();
    await answer(fresh, fullInit());
    await joined;
    expect(seen).toHaveLength(1);
  });

  it("drops the dropped session's decodes still running, and hands on the new session's", async () => {
    const { network, socket } = await openNetwork();
    const methods: string[] = [];
    network.register({
      onMessage: (message) => {
        if (message.type === "METHOD")
          methods.push(String(message.method?.name));
      },
    });
    await joinAnswered(network, socket, fullInit());

    // A packet of the world joined is still decoding when the next JOIN
    // goes out, and the registry that JOIN names is gone from storage.
    FakeDecodeWorker.script.push([
      { type: "METHOD", method: { name: "stale", payload: "{}" } },
    ]);
    FakeDecodeWorker.isHolding = true;
    socket.receive();
    network.sync();
    FakeDecodeWorker.isHolding = false;
    store.kept = null;
    const joined = network.join("other");
    await answer(socket, cachedInit());
    const fresh = reopened();
    await answer(fresh, fullInit());
    await joined;

    // The old decode lands after the new INIT and is not handed on; the new
    // session's stream is, not stalled behind the dropped job.
    FakeDecodeWorker.release();
    await vi.advanceTimersByTimeAsync(0);
    FakeDecodeWorker.script.push([
      { type: "METHOD", method: { name: "fresh", payload: "{}" } },
    ]);
    fresh.receive();
    network.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(methods).toEqual(["fresh"]);
  });

  it("fails the join rather than loop when the server keeps leaving the registry out", async () => {
    const { network, socket, seen } = await openNetwork();
    const joined = network.join("world");
    joined.catch(() => undefined);

    await answer(socket, cachedInit());
    await answer(reopened(), cachedInit());

    await expect(joined).rejects.toMatch(/left out block registry .* twice/);
    expect(seen).toEqual([]);
    expect(network.connected).toBe(false);
  });

  it("drops an INIT held for the registry once a newer JOIN is out", async () => {
    keep({ digest: DIGEST, blocks: BLOCKS_TEXT });
    store.readDelayMs = 500;
    const { network, socket, seen } = await openNetwork();
    void network.join("world");
    await answer(socket, cachedInit());

    // A reconnect re-sends the JOIN before the read lands.
    socket.onopen?.();
    expect(joinsOn(socket)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual([]);

    await answer(socket, cachedInit());
    expect(seen).toHaveLength(1);
    expect(seen[0].blocks).toEqual(JSON.parse(BLOCKS_TEXT));
  });

  it("forgets a kept registry the server does not recognize and keeps the new one", async () => {
    keep({ digest: "stale-2", blocks: "{}" });
    const { network, socket, seen } = await openNetwork();
    await joinAnswered(network, socket, fullInit());

    expect(joinsOn(socket)[0].registryDigest).toBe("stale-2");
    expect(seen[0].blocks).toEqual(JSON.parse(BLOCKS_TEXT));
    expect(store.writes).toEqual([{ digest: DIGEST, blocks: BLOCKS_TEXT }]);

    await joinAnswered(network, socket, cachedInit());
    expect(joinsOn(socket)[1].registryDigest).toBe(DIGEST);
  });

  it("sends no digest and keeps nothing when caching is off", async () => {
    keep({ digest: DIGEST, blocks: BLOCKS_TEXT });
    const { network, socket, seen } = await openNetwork({
      cacheRegistry: false,
    });
    await joinAnswered(network, socket, fullInit());
    await joinAnswered(network, socket, fullInit());

    expect(joinsOn(socket).map((join) => join.registryDigest)).toEqual([
      undefined,
      undefined,
    ]);
    expect(seen).toHaveLength(2);
    expect(store.writes).toEqual([]);
  });

  it("holds the registry text only until its INIT is handled", async () => {
    const held = (network: Network) =>
      (network as unknown as { registry: unknown }).registry;
    const { network, socket } = await openNetwork();
    expect(store.reads).toBe(0);
    await joinAnswered(network, socket, fullInit());
    expect(held(network)).toBeNull();

    // A rejoin reads it back for the INIT that leaves it out.
    await joinAnswered(network, socket, cachedInit());
    expect(store.reads).toBe(1);
    expect(held(network)).toBeNull();

    // A read that lands after its INIT is not kept around.
    keep({ digest: DIGEST, blocks: BLOCKS_TEXT });
    store.readDelayMs = 100;
    const late = await openNetwork();
    await joinAnswered(late.network, late.socket, fullInit());
    await vi.advanceTimersByTimeAsync(100);
    expect(held(late.network)).toBeNull();
  });

  it("never mistakes the priority worker's registry answer for the INIT", async () => {
    const { network, socket, seen } = await openNetwork();
    const joined = network.join("world");
    const priority = FakeDecodeWorker.spawned.at(-1);
    if (!priority) throw new Error("no priority worker");

    // The INIT is with the priority worker when a registry answer lands.
    FakeDecodeWorker.script.push([fullInit()]);
    socket.receive();
    priority.dispatchEvent(
      new MessageEvent("message", {
        data: { kind: "voxelize:registry", entry: null },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await joined;
    expect(seen).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("passes an INIT from a server without the handshake through untouched", async () => {
    const { network, socket, seen } = await openNetwork();
    await joinAnswered(network, socket, {
      type: "INIT",
      json: { blocks: { stone: { id: 1 } }, id: "client", options: {} },
    });
    expect(seen).toEqual([
      { blocks: { stone: { id: 1 } }, id: "client", options: {} },
    ]);
    expect(store.writes).toEqual([]);
  });
});
