/**
 * The server's block registry, kept between joins and page loads.
 *
 * The registry is the bulk of every INIT (megabytes of block definitions
 * against kilobytes of everything else) and the same for every world of a
 * server until the server's blocks change. The server names it by a digest
 * on every INIT (`registryDigest`); a client that kept the registry text
 * from an earlier INIT sends that digest on JOIN, and an INIT answering a
 * matching digest leaves the blocks out (`registryCached: true`). The client
 * then puts its kept copy back before anything else reads the INIT, so every
 * consumer sees the same INIT either way.
 *
 * What is kept is the registry's JSON text exactly as it was received, never
 * a parsed copy: `World.initialize` mutates the block objects it is handed.
 *
 * Reading megabytes back from storage can take a while on a busy page, so
 * the JOIN never waits for it: the store also keeps the digest where it can
 * be read synchronously, the JOIN names that digest at once, and only an
 * INIT that left the registry out waits (bounded) for the read to land. The
 * read itself runs in a worker: storage answers in milliseconds, but a game
 * page's main thread is busiest exactly while it starts, and every step of
 * a main-thread read (open, match, read the body) queues behind that work.
 */

/** INIT key naming the registry the server sent or left out. */
export const INIT_REGISTRY_DIGEST_KEY = "registryDigest";

/** INIT key: `true` when the server left the registry out for a JOIN that
 * named the same digest. */
export const INIT_REGISTRY_CACHED_KEY = "registryCached";

/** INIT key on a full INIT: the registry text's length in UTF-16 units. */
export const INIT_REGISTRY_LENGTH_KEY = "registryBlocksLength";

/** The server writes the registry first, so a full INIT's text begins here;
 * the digest key follows the registry text directly. */
const INIT_BLOCKS_PREFIX = '{"blocks":';

export type CachedRegistry = {
  digest: string;
  /** `blocks` as JSON text, never parsed or mutated in place. */
  blocks: string;
};

/** A held registry's text parsed once, for the one INIT it will complete:
 * whoever builds from these objects before that INIT (the world loading its
 * registry early) builds from exactly what the INIT will carry. */
export type ParsedRegistry = {
  digest: string;
  blocks: Record<string, unknown>;
};

/** Whether `value` is a usable registry entry: a digest and non-empty text. */
export const isRegistryEntry = (value: unknown): value is CachedRegistry =>
  !!value &&
  typeof value === "object" &&
  typeof (value as CachedRegistry).digest === "string" &&
  typeof (value as CachedRegistry).blocks === "string" &&
  (value as CachedRegistry).digest.length > 0 &&
  (value as CachedRegistry).blocks.length > 0;

export type RegistryStore = {
  /**
   * The digest of the registry the store holds, read synchronously from a
   * hint written next to it. A hint can outlive its entry (storage cleared
   * in part); {@link RegistryStore.read} is the truth.
   */
  peekDigest: () => string | null;
  /** The registry kept by an earlier page load, or null. Never rejects. */
  read: () => Promise<CachedRegistry | null>;
  /** Keep this registry for the next page load, replacing the last one.
   * Resolves whether it was kept; never rejects. */
  write: (entry: CachedRegistry) => Promise<boolean>;
  /** Forget the kept registry. */
  clear: () => Promise<void>;
};

export type RegistryBackend = Omit<RegistryStore, "peekDigest">;

/**
 * The registry text inside a full INIT's JSON text, cut out without parsing
 * or re-serializing it. The server frames it as `{"blocks":<registry>,
 * "registryDigest":"<digest>",...`, so the cut is exact when the digest key
 * sits right where the length says the registry ends. Null when the text is
 * not framed that way: the caller then simply does not keep it.
 */
export function registryTextFromInit(
  initText: string,
  length: unknown,
  digest: string,
): string | null {
  if (typeof length !== "number" || !Number.isInteger(length) || length < 2) {
    return null;
  }
  if (!initText.startsWith(INIT_BLOCKS_PREFIX)) return null;
  const start = INIT_BLOCKS_PREFIX.length;
  const end = start + length;
  const marker = `,${JSON.stringify(INIT_REGISTRY_DIGEST_KEY)}:${JSON.stringify(digest)}`;
  if (
    initText.charCodeAt(start) !== 123 /* { */ ||
    initText.charCodeAt(end - 1) !== 125 /* } */ ||
    !initText.startsWith(marker, end)
  ) {
    return null;
  }
  return initText.slice(start, end);
}

export type RegistryResolution =
  /** The INIT carries its registry (spliced back in when it was left out). */
  | { kind: "ready"; keep: CachedRegistry | null }
  /** The INIT left the registry out and this client does not hold it. */
  | { kind: "missing"; digest: string };

/**
 * Make an INIT whole before anything reads it. `json` is the parsed INIT
 * payload, `initText` its JSON text when it arrived as text (large INITs do),
 * and `held` the registry this client named on JOIN, if any.
 *
 * On an INIT the server sent in full, returns the registry to keep (cut out
 * of `initText`, or serialized from the still-pristine parsed blocks when the
 * INIT was small enough to arrive parsed), or null when there is nothing new
 * to keep.
 *
 * `parsed`, when given, is `held` already parsed (ahead of the INIT, so work
 * built from it could start early): an INIT that left the registry out is
 * completed with exactly that object instead of a second parse.
 */
export function resolveInitRegistry(
  json: Record<string, unknown>,
  initText: string | null,
  held: CachedRegistry | null,
  parsed: ParsedRegistry | null = null,
): RegistryResolution {
  const digest = json[INIT_REGISTRY_DIGEST_KEY];
  if (typeof digest !== "string" || digest.length === 0) {
    return { kind: "ready", keep: null };
  }

  if (json[INIT_REGISTRY_CACHED_KEY] === true) {
    if (!held || held.digest !== digest) return { kind: "missing", digest };
    let blocks: unknown;
    try {
      blocks =
        parsed?.digest === digest ? parsed.blocks : JSON.parse(held.blocks);
    } catch {
      return { kind: "missing", digest };
    }
    if (!blocks || typeof blocks !== "object") {
      return { kind: "missing", digest };
    }
    json.blocks = blocks;
    delete json[INIT_REGISTRY_CACHED_KEY];
    return { kind: "ready", keep: null };
  }

  const length = json[INIT_REGISTRY_LENGTH_KEY];
  delete json[INIT_REGISTRY_LENGTH_KEY];
  if (held?.digest === digest) return { kind: "ready", keep: null };
  if (!json.blocks || typeof json.blocks !== "object") {
    return { kind: "ready", keep: null };
  }
  const blocks =
    initText !== null
      ? registryTextFromInit(initText, length, digest)
      : JSON.stringify(json.blocks);
  return { kind: "ready", keep: blocks ? { digest, blocks } : null };
}

const CACHE_NAME = "voxelize-registry";
const CACHE_PATH = "/__voxelize/registry";

/** The cache key, absolute: a worker started from a blob URL cannot resolve
 * a bare path, and it must find what the page wrote. */
const cacheRequest = () => {
  const origin = (globalThis as { origin?: string }).origin;
  return origin && origin !== "null"
    ? new URL(CACHE_PATH, origin).href
    : CACHE_PATH;
};
const CACHE_DIGEST_HEADER = "x-voxelize-registry-digest";

/**
 * Where the registry is kept: Cache Storage where it exists (secure
 * contexts: https and localhost; its open/match/read is the simplest and
 * cheapest path), IndexedDB elsewhere, nowhere without either. Pages and
 * workers of one origin pick the same one.
 */
export function createRegistryBackend(): RegistryBackend | null {
  return createCacheStorageRegistryStore() ?? createIndexedDbRegistryStore();
}

const REGISTRY_READ_REQUEST = "voxelize:registry-read";
const REGISTRY_READ_REPLY = "voxelize:registry";

type RegistryReadReply = {
  kind: typeof REGISTRY_READ_REPLY;
  entry: CachedRegistry | null;
};

/** Whether a worker message asks for the kept registry. */
export function isRegistryReadRequest(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { kind?: unknown }).kind === REGISTRY_READ_REQUEST
  );
}

/** Worker side: read the kept registry and post it back to the page. */
export async function answerRegistryRead(
  post: (reply: RegistryReadReply) => void,
): Promise<void> {
  let entry: CachedRegistry | null = null;
  try {
    entry = (await createRegistryBackend()?.read()) ?? null;
  } catch {
    entry = null;
  }
  post({ kind: REGISTRY_READ_REPLY, entry });
}

/**
 * Page side: read the kept registry through `worker` (one that answers
 * {@link isRegistryReadRequest} with {@link answerRegistryRead}). Resolves
 * null when it does not answer within `timeoutMs` or errors; never rejects.
 */
export function readRegistryInWorker(
  worker: Worker,
  timeoutMs: number,
): Promise<CachedRegistry | null> {
  return new Promise((resolve) => {
    let isDone = false;
    const done = (entry: CachedRegistry | null) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      resolve(entry);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Partial<RegistryReadReply> | null;
      if (
        !data ||
        typeof data !== "object" ||
        data.kind !== REGISTRY_READ_REPLY
      )
        return;
      done(isCachedRegistry(data.entry) ? data.entry : null);
    };
    const onError = () => done(null);
    const timer = setTimeout(() => done(null), timeoutMs);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    try {
      worker.postMessage({ kind: REGISTRY_READ_REQUEST });
    } catch {
      done(null);
    }
  });
}

const DIGEST_HINT_KEY = "voxelize:registry-digest";

const hint = {
  get: (): string | null => {
    try {
      return localStorage.getItem(DIGEST_HINT_KEY) || null;
    } catch {
      return null;
    }
  },
  set: (digest: string | null) => {
    try {
      if (digest) localStorage.setItem(DIGEST_HINT_KEY, digest);
      else localStorage.removeItem(DIGEST_HINT_KEY);
    } catch {
      // No synchronous hint: the JOIN then names only a registry already read.
    }
  },
};

/** A backend plus the synchronous digest hint, kept in step with it. */
export function withDigestHint(backend: RegistryBackend): RegistryStore {
  return {
    peekDigest: hint.get,
    read: async () => {
      const entry = await backend.read();
      if (hint.get() !== (entry?.digest ?? null))
        hint.set(entry?.digest ?? null);
      return entry;
    },
    write: async (entry) => {
      // Dropped first: a hint must never name a registry not (yet) kept.
      hint.set(null);
      const isKept = await backend.write(entry);
      if (isKept) hint.set(entry.digest);
      return isKept;
    },
    clear: async () => {
      hint.set(null);
      await backend.clear();
    },
  };
}

/**
 * The registry store in Cache Storage: one response holding the registry
 * text, its digest in a header. Best effort like the IndexedDB store.
 */
export function createCacheStorageRegistryStore(
  cacheName = CACHE_NAME,
): RegistryBackend | null {
  if (typeof caches === "undefined") return null;
  const open = () => caches.open(cacheName);
  return {
    read: async () => {
      try {
        const response = await (await open()).match(cacheRequest());
        const digest = response?.headers.get(CACHE_DIGEST_HEADER);
        if (!response || !digest) return null;
        const entry = { digest, blocks: await response.text() };
        return isCachedRegistry(entry) ? entry : null;
      } catch {
        return null;
      }
    },
    write: async (entry) => {
      try {
        await (
          await open()
        ).put(
          cacheRequest(),
          new Response(entry.blocks, {
            headers: {
              "content-type": "application/json",
              [CACHE_DIGEST_HEADER]: entry.digest,
            },
          }),
        );
        return true;
      } catch {
        // Best effort: the next join simply asks for the full registry.
        return false;
      }
    },
    clear: async () => {
      try {
        await (await open()).delete(cacheRequest());
      } catch {
        // Nothing kept, or nothing to keep it in.
      }
    },
  };
}

const DB_NAME = "voxelize-registry";
const DB_VERSION = 1;
const STORE_NAME = "registry";
const ENTRY_KEY = "latest";
const OPEN_TIMEOUT_MS = 5000;

const isCachedRegistry = isRegistryEntry;

/**
 * The registry store in IndexedDB: one entry, the last registry this origin
 * received. Best effort throughout: when IndexedDB is missing, blocked or
 * failing, reads answer null and writes do nothing, and a join simply asks
 * for the full registry. Returns null where IndexedDB does not exist.
 */
export function createIndexedDbRegistryStore(
  dbName = DB_NAME,
): RegistryBackend | null {
  if (typeof indexedDB === "undefined") return null;

  let opened: Promise<IDBDatabase | null> | null = null;
  const open = () => {
    opened ??= new Promise<IDBDatabase | null>((resolve) => {
      let isSettled = false;
      const settle = (db: IDBDatabase | null) => {
        if (isSettled) {
          db?.close();
          return;
        }
        isSettled = true;
        clearTimeout(timer);
        resolve(db);
      };
      const timer = setTimeout(() => settle(null), OPEN_TIMEOUT_MS);
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(dbName, DB_VERSION);
      } catch {
        settle(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Never hold up another tab's upgrade of this database.
        db.onversionchange = () => {
          db.close();
          opened = null;
        };
        settle(db);
      };
      request.onerror = () => settle(null);
      request.onblocked = () => settle(null);
    });
    return opened;
  };

  /** Runs one request in its own transaction; `fallback` on any failure. */
  const run = async <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest,
    toResult: (request: IDBRequest) => T,
    fallback: T,
  ): Promise<T> => {
    const db = await open();
    if (!db) return fallback;
    return new Promise<T>((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = body(transaction.objectStore(STORE_NAME));
        transaction.oncomplete = () => resolve(toResult(request));
        transaction.onerror = () => resolve(fallback);
        transaction.onabort = () => resolve(fallback);
      } catch {
        resolve(fallback);
      }
    });
  };

  return {
    read: async () => {
      const value = await run<unknown>(
        "readonly",
        (store) => store.get(ENTRY_KEY),
        (request) => request.result,
        null,
      );
      return isCachedRegistry(value)
        ? { digest: value.digest, blocks: value.blocks }
        : null;
    },
    write: (entry) =>
      run(
        "readwrite",
        (store) =>
          store.put(
            { digest: entry.digest, blocks: entry.blocks, savedAt: Date.now() },
            ENTRY_KEY,
          ),
        () => true,
        false,
      ),
    clear: async () => {
      await run(
        "readwrite",
        (store) => store.delete(ENTRY_KEY),
        () => undefined,
        undefined,
      );
    },
  };
}
