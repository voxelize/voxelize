/**
 * One viewer backend process (the Rust side, `voxelize::viewer`): spawned
 * with a launch file, spoken to in JSON lines over stdin, answered on
 * stdout behind the protocol prefix. Everything else either stream carries
 * (a logger, a stage's prints) goes to the source's log file.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export const LINE_PREFIX = "@vxv ";

export type SpawnSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  op: string;
  startedAt: number;
};

export class BackendProcess {
  readonly ready: Promise<{ metaPath: string; ms: number }>;

  private child: ChildProcessWithoutNullStreams;

  private nextId = 1;

  private pending = new Map<number, Pending>();

  private log: fs.WriteStream;

  private exited: string | null = null;

  constructor(
    readonly name: string,
    spec: SpawnSpec,
    logFile: string,
  ) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    this.log = fs.createWriteStream(logFile, { flags: "a" });
    const started = Date.now();
    this.log.write(
      `\n[${new Date().toISOString()}] spawn ${spec.command} ${(spec.args ?? []).join(" ")}\n`,
    );
    this.child = spawn(spec.command, spec.args ?? [], {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
    });
    let markReady: (value: { metaPath: string; ms: number }) => void = () => {};
    let failReady: (error: Error) => void = () => {};
    this.ready = new Promise((resolve, reject) => {
      markReady = resolve;
      failReady = reject;
    });
    readline
      .createInterface({ input: this.child.stdout })
      .on("line", (line) => {
        if (!line.startsWith(LINE_PREFIX)) {
          this.log.write(`${line}\n`);
          return;
        }
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line.slice(LINE_PREFIX.length));
        } catch {
          this.log.write(`unparsable protocol line: ${line}\n`);
          return;
        }
        if (message.event === "ready") {
          markReady({
            metaPath: String(message.meta),
            ms: Date.now() - started,
          });
          return;
        }
        const id = Number(message.id);
        const entry = this.pending.get(id);
        if (!entry) {
          this.log.write(`reply to unknown request ${id}\n`);
          return;
        }
        this.pending.delete(id);
        if (message.ok === false)
          entry.reject(new Error(`${entry.op}: ${String(message.error)}`));
        else entry.resolve(message);
      });
    this.child.stderr.on("data", (chunk) => this.log.write(chunk));
    this.child.on("exit", (code, signal) => {
      this.exited = `exited (${signal ?? code})`;
      this.log.write(`[${new Date().toISOString()}] ${this.exited}\n`);
      const error = new Error(
        `backend ${this.name} ${this.exited}; log: ${logFile}`,
      );
      failReady(error);
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    });
    this.child.on("error", (error) => failReady(error));
  }

  get alive() {
    return this.exited === null;
  }

  get pid() {
    return this.child.pid ?? null;
  }

  request<T = Record<string, unknown>>(
    op: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    if (this.exited)
      return Promise.reject(new Error(`backend ${this.name} ${this.exited}`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: Record<string, unknown>) => void,
        reject,
        op,
        startedAt: Date.now(),
      });
      this.child.stdin.write(`${JSON.stringify({ op, id, ...payload })}\n`);
    });
  }

  stop() {
    if (this.exited) return;
    this.child.stdin.end();
    const child = this.child;
    setTimeout(() => {
      if (this.exited === null) child.kill("SIGKILL");
    }, 3000).unref();
  }
}
