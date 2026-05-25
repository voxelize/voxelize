export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  id: number;
  at: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
};

export type LoggerOptions = {
  maxEntries?: number;
  defaultSource?: string;
};

type Listener = (entry: LogEntry) => void;

export class Logger {
  private buffer: LogEntry[] = [];
  private maxEntries: number;
  private nextId = 1;
  private readonly defaultSource: string;
  private listeners = new Set<Listener>();
  private paused = false;

  constructor(options: LoggerOptions = {}) {
    this.maxEntries = options.maxEntries ?? 500;
    this.defaultSource = options.defaultSource ?? "app";
  }

  debug = (message: string, data?: unknown, source?: string): void => {
    this.push("debug", message, data, source);
  };

  info = (message: string, data?: unknown, source?: string): void => {
    this.push("info", message, data, source);
  };

  warn = (message: string, data?: unknown, source?: string): void => {
    this.push("warn", message, data, source);
  };

  error = (message: string, data?: unknown, source?: string): void => {
    this.push("error", message, data, source);
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): readonly LogEntry[] {
    return this.buffer;
  }

  clear = (): void => {
    this.buffer = [];
    for (const listener of this.listeners) {
      listener({
        id: -1,
        at: Date.now(),
        level: "info",
        source: "logger",
        message: "__cleared__",
      });
    }
  };

  setMaxEntries(n: number): void {
    this.maxEntries = Math.max(1, Math.floor(n));
    while (this.buffer.length > this.maxEntries) this.buffer.shift();
  }

  setPaused(value: boolean): void {
    this.paused = value;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private push(
    level: LogLevel,
    message: string,
    data: unknown,
    source: string | undefined,
  ): void {
    if (this.paused) return;
    const entry: LogEntry = {
      id: this.nextId++,
      at: Date.now(),
      level,
      source: source ?? this.defaultSource,
      message,
      data,
    };
    this.buffer.push(entry);
    while (this.buffer.length > this.maxEntries) this.buffer.shift();
    for (const listener of this.listeners) listener(entry);
  }
}
