import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerRegistryRead,
  CachedRegistry,
  createCacheStorageRegistryStore,
  INIT_REGISTRY_CACHED_KEY,
  INIT_REGISTRY_DIGEST_KEY,
  INIT_REGISTRY_LENGTH_KEY,
  isRegistryReadRequest,
  readRegistryInWorker,
  registryTextFromInit,
  resolveInitRegistry,
  withDigestHint,
} from "./registry-cache";

const BLOCKS_TEXT =
  '{"air":{"id":0,"faces":[]},"stone":{"id":1,"faces":[{"name":"top","range":{"startU":0,"endU":0.5}}]}}';
const DIGEST = "aaaabbbbccccdddd0000111122223333-96";

/** A full INIT's text, framed the way the server writes it. */
const fullInitText = (blocksText = BLOCKS_TEXT, digest = DIGEST) =>
  `{"blocks":${blocksText},"${INIT_REGISTRY_DIGEST_KEY}":"${digest}",` +
  `"id":"client","options":{"chunkSize":16},"${INIT_REGISTRY_LENGTH_KEY}":${blocksText.length}}`;

const cachedInit = (digest = DIGEST): Record<string, unknown> => ({
  id: "client",
  options: { chunkSize: 16 },
  [INIT_REGISTRY_DIGEST_KEY]: digest,
  [INIT_REGISTRY_CACHED_KEY]: true,
});

describe("registryTextFromInit", () => {
  it("cuts exactly the registry text out of a full INIT", () => {
    const text = fullInitText();
    expect(registryTextFromInit(text, BLOCKS_TEXT.length, DIGEST)).toBe(
      BLOCKS_TEXT,
    );
  });

  it("counts UTF-16 units, as the server reports them", () => {
    const blocks = '{"café tile":{"id":5,"glyph":"🧱"}}';
    const text = fullInitText(blocks);
    expect(registryTextFromInit(text, blocks.length, DIGEST)).toBe(blocks);
  });

  it("refuses text that is not framed the way the server frames it", () => {
    const text = fullInitText();
    const length = BLOCKS_TEXT.length;
    // Cut short at an inner brace, or past the end: the digest is not there.
    expect(registryTextFromInit(text, length - 1, DIGEST)).toBeNull();
    expect(registryTextFromInit(text, length - 2, DIGEST)).toBeNull();
    expect(registryTextFromInit(text, length + 1, DIGEST)).toBeNull();
    expect(registryTextFromInit(text, length, "another-1")).toBeNull();
    expect(registryTextFromInit(text, undefined, DIGEST)).toBeNull();
    expect(registryTextFromInit(text, String(length), DIGEST)).toBeNull();
    expect(
      registryTextFromInit(
        `{"id":"x","blocks":${BLOCKS_TEXT},"${INIT_REGISTRY_DIGEST_KEY}":"${DIGEST}"}`,
        length,
        DIGEST,
      ),
    ).toBeNull();
    expect(registryTextFromInit('{"blocks":{}', 2, DIGEST)).toBeNull();
  });
});

describe("resolveInitRegistry", () => {
  it("keeps the registry text of a full INIT and strips the length", () => {
    const text = fullInitText();
    const json = JSON.parse(text);
    const resolution = resolveInitRegistry(json, text, null);
    expect(resolution).toEqual({
      kind: "ready",
      keep: { digest: DIGEST, blocks: BLOCKS_TEXT },
    });
    expect(json.blocks.stone.id).toBe(1);
    expect(json[INIT_REGISTRY_LENGTH_KEY]).toBeUndefined();
    expect(json[INIT_REGISTRY_DIGEST_KEY]).toBe(DIGEST);
  });

  it("keeps nothing new when the full INIT names the registry already held", () => {
    const text = fullInitText();
    const held: CachedRegistry = { digest: DIGEST, blocks: BLOCKS_TEXT };
    expect(resolveInitRegistry(JSON.parse(text), text, held)).toEqual({
      kind: "ready",
      keep: null,
    });
  });

  it("replaces a held registry the server no longer serves", () => {
    const text = fullInitText();
    const held: CachedRegistry = { digest: "stale-1", blocks: "{}" };
    expect(resolveInitRegistry(JSON.parse(text), text, held)).toEqual({
      kind: "ready",
      keep: { digest: DIGEST, blocks: BLOCKS_TEXT },
    });
  });

  it("serializes the still-pristine blocks of an INIT small enough to arrive parsed", () => {
    const json = JSON.parse(fullInitText());
    const resolution = resolveInitRegistry(json, null, null);
    expect(resolution.kind).toBe("ready");
    if (resolution.kind !== "ready" || !resolution.keep)
      throw new Error("kept nothing");
    expect(JSON.parse(resolution.keep.blocks)).toEqual(JSON.parse(BLOCKS_TEXT));
  });

  it("puts a held registry back into an INIT that left it out, a fresh copy each time", () => {
    const held: CachedRegistry = { digest: DIGEST, blocks: BLOCKS_TEXT };
    const first = cachedInit();
    expect(resolveInitRegistry(first, null, held)).toEqual({
      kind: "ready",
      keep: null,
    });
    expect(first.blocks).toEqual(JSON.parse(BLOCKS_TEXT));
    expect(first[INIT_REGISTRY_CACHED_KEY]).toBeUndefined();
    expect(first[INIT_REGISTRY_DIGEST_KEY]).toBe(DIGEST);

    // Initialization mutates the blocks it is handed; the next INIT must not
    // see those mutations.
    (first.blocks as { stone: { faces: unknown[] } }).stone.faces = [];
    const second = cachedInit();
    resolveInitRegistry(second, null, held);
    expect(second.blocks).toEqual(JSON.parse(BLOCKS_TEXT));
  });

  it("reports an INIT that left out a registry this client does not hold", () => {
    expect(resolveInitRegistry(cachedInit(), null, null)).toEqual({
      kind: "missing",
      digest: DIGEST,
    });
    expect(
      resolveInitRegistry(cachedInit(), null, {
        digest: "other-1",
        blocks: BLOCKS_TEXT,
      }),
    ).toEqual({ kind: "missing", digest: DIGEST });
    expect(
      resolveInitRegistry(cachedInit(), null, {
        digest: DIGEST,
        blocks: "{not json",
      }),
    ).toEqual({ kind: "missing", digest: DIGEST });
  });

  it("leaves an INIT from a server without the handshake exactly as it came", () => {
    const json = { blocks: { stone: { id: 1 } }, id: "client", options: {} };
    const before = structuredClone(json);
    expect(resolveInitRegistry(json, null, null)).toEqual({
      kind: "ready",
      keep: null,
    });
    expect(json).toEqual(before);
  });
});

describe("registry stores", () => {
  let local: Map<string, string>;

  beforeEach(() => {
    local = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
      removeItem: (key: string) => local.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const entry: CachedRegistry = { digest: DIGEST, blocks: BLOCKS_TEXT };

  it("names a registry synchronously only once it is kept", async () => {
    let kept: CachedRegistry | null = null;
    let isWritable = true;
    const store = withDigestHint({
      read: async () => kept,
      write: async (next) => {
        if (!isWritable) return false;
        kept = next;
        return true;
      },
      clear: async () => {
        kept = null;
      },
    });
    expect(store.peekDigest()).toBeNull();

    expect(await store.write(entry)).toBe(true);
    expect(store.peekDigest()).toBe(DIGEST);

    // A failed write leaves no hint behind, not even the previous one.
    isWritable = false;
    expect(await store.write({ digest: "next-1", blocks: "{}" })).toBe(false);
    expect(store.peekDigest()).toBeNull();

    // A read puts the hint back in step with what is really kept.
    expect(await store.read()).toEqual(entry);
    expect(store.peekDigest()).toBe(DIGEST);
    kept = null;
    expect(await store.read()).toBeNull();
    expect(store.peekDigest()).toBeNull();

    isWritable = true;
    await store.write(entry);
    await store.clear();
    expect(store.peekDigest()).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it("keeps the registry text and its digest in Cache Storage", async () => {
    const responses = new Map<string, Response>();
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async (key: string) => responses.get(key)?.clone(),
        put: async (key: string, response: Response) => {
          responses.set(key, response);
        },
        delete: async (key: string) => responses.delete(key),
      }),
    });
    const store = createCacheStorageRegistryStore();
    if (!store) throw new Error("no Cache Storage store");

    expect(await store.read()).toBeNull();
    expect(await store.write(entry)).toBe(true);
    expect(await store.read()).toEqual(entry);
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("has no Cache Storage store where Cache Storage does not exist", () => {
    expect(createCacheStorageRegistryStore()).toBeNull();
  });

  it("reads the kept registry through a worker, ignoring its other traffic", async () => {
    const responses = new Map<string, Response>();
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async (key: string) => responses.get(key)?.clone(),
        put: async (key: string, response: Response) => {
          responses.set(key, response);
        },
        delete: async (key: string) => responses.delete(key),
      }),
    });
    await createCacheStorageRegistryStore()?.write(entry);

    /** A worker whose script answers registry reads like the decode worker. */
    class FakeWorker extends EventTarget {
      requests = 0;

      postMessage(data: unknown) {
        if (!isRegistryReadRequest(data)) return;
        this.requests += 1;
        // Unrelated traffic first (a decode job's answer), then the reply.
        this.dispatchEvent(new MessageEvent("message", { data: [] }));
        void answerRegistryRead((reply) =>
          this.dispatchEvent(new MessageEvent("message", { data: reply })),
        );
      }
    }
    const worker = new FakeWorker();
    expect(
      await readRegistryInWorker(worker as unknown as Worker, 1000),
    ).toEqual(entry);
    expect(worker.requests).toBe(1);
  });

  it("counts a worker that never answers as nothing kept", async () => {
    vi.useFakeTimers();
    try {
      const silent = new EventTarget() as unknown as Worker;
      (silent as unknown as { postMessage: () => void }).postMessage = () =>
        undefined;
      const read = readRegistryInWorker(silent, 500);
      await vi.advanceTimersByTimeAsync(500);
      expect(await read).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
