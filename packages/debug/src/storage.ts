type StorageValue =
  | string
  | number
  | boolean
  | null
  | StorageValue[]
  | { [key: string]: StorageValue };

type StorageDocument = Record<string, StorageValue>;

export type StorageOptions = {
  key: string;
  debounceMs?: number;
  legacyKeys?: string[];
};

export class DebugStorage {
  private readonly key: string;
  private readonly debounceMs: number;
  private document: StorageDocument = {};
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(doc: Readonly<StorageDocument>) => void>();
  private isAvailable: boolean;

  constructor(options: StorageOptions) {
    this.key = options.key;
    this.debounceMs = options.debounceMs ?? 150;
    this.isAvailable = this.checkAvailable();
    this.load(options.legacyKeys ?? []);

    if (this.isAvailable && typeof window !== "undefined") {
      window.addEventListener("beforeunload", this.flush);
    }
  }

  get(path: string): StorageValue | undefined {
    const segments = path.split(".");
    let current: StorageValue | undefined = this.document;
    for (const segment of segments) {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        return undefined;
      }
      current = (current as StorageDocument)[segment];
      if (current === undefined) return undefined;
    }
    return current;
  }

  getOr<T extends StorageValue>(path: string, fallback: T): T {
    const value = this.get(path);
    return (value === undefined ? fallback : value) as T;
  }

  set(path: string, value: StorageValue): void {
    const segments = path.split(".");
    const last = segments.pop();
    if (!last) return;

    let container: StorageDocument = this.document;
    for (const segment of segments) {
      const next = container[segment];
      if (
        next === undefined ||
        next === null ||
        typeof next !== "object" ||
        Array.isArray(next)
      ) {
        container[segment] = {};
      }
      container = container[segment] as StorageDocument;
    }

    container[last] = value;
    this.scheduleWrite();
    this.notify();
  }

  delete(path: string): void {
    const segments = path.split(".");
    const last = segments.pop();
    if (!last) return;

    let container: StorageDocument = this.document;
    for (const segment of segments) {
      const next = container[segment];
      if (
        next === undefined ||
        next === null ||
        typeof next !== "object" ||
        Array.isArray(next)
      ) {
        return;
      }
      container = next as StorageDocument;
    }

    delete container[last];
    this.scheduleWrite();
    this.notify();
  }

  subscribe(listener: (doc: Readonly<StorageDocument>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): Readonly<StorageDocument> {
    return this.document;
  }

  flush = (): void => {
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.write();
  };

  private scheduleWrite(): void {
    if (!this.isAvailable) return;
    if (this.writeTimer !== null) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.write();
    }, this.debounceMs);
  }

  private write(): void {
    if (!this.isAvailable) return;
    try {
      window.localStorage.setItem(this.key, JSON.stringify(this.document));
    } catch {
      this.isAvailable = false;
    }
  }

  private load(legacyKeys: string[]): void {
    if (!this.isAvailable) return;
    let parsed: StorageDocument | null = null;

    try {
      const raw = window.localStorage.getItem(this.key);
      if (raw) parsed = JSON.parse(raw) as StorageDocument;
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      this.document = parsed;
    }

    let migrated = false;
    for (const legacy of legacyKeys) {
      try {
        const raw = window.localStorage.getItem(legacy);
        if (!raw) continue;
        const value = JSON.parse(raw) as StorageValue;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const base =
            (this.document.settings as StorageDocument | undefined) ?? {};
          this.document.settings = { ...base, ...(value as StorageDocument) };
          migrated = true;
        }
      } catch {
        // ignore corrupt legacy
      }
    }

    if (migrated) this.write();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.document);
  }

  private checkAvailable(): boolean {
    try {
      if (typeof window === "undefined" || !window.localStorage) return false;
      const probe = "__voxelize_debug_probe__";
      window.localStorage.setItem(probe, probe);
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }
}
