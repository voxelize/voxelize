/**
 * Passive watchers holding a session.
 *
 * A session's idle clock runs on commands, and a script that only reads the
 * page over DevTools (a heap watcher) sends none: the session looks idle and
 * a host may retire it under the watcher mid-probe. A watcher says it is
 * there instead, with heartbeats. Each accepted beat counts as activity, for
 * a hold the watcher declares on its first beat and that cannot exceed the
 * maximum. A watcher that stops beating lapses, and beats past the declared
 * hold are refused, so a dead or forgotten watcher cannot keep a session; a
 * DevTools attachment by itself never counts. The hold is remembered until
 * the watcher ends its watch: a watcher that lapsed picks up under the hold
 * it declared, and one whose hold ran out stays refused, so beating on
 * never buys a new hold.
 */

export const DEFAULT_WATCH_HOLD_MS = 30 * 60_000;
export const MAX_WATCH_HOLD_MS = 2 * 60 * 60_000;
/** Silence after which a watcher is taken for gone. Beat well inside it. */
export const WATCH_BEAT_TIMEOUT_MS = 2 * 60_000;
const WATCHER_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;
const PURPOSE_MAX_LENGTH = 256;

export type WatchBeat = {
  watcher: string;
  purpose?: string;
  /** The whole hold, declared on the first beat; later beats cannot move it. */
  holdMs?: number;
  pid?: number;
};

export type SessionWatch = {
  watcher: string;
  purpose: string | null;
  pid: number | null;
  startedAt: number;
  lastBeatAt: number;
  holdUntil: number;
  beats: number;
};

export type WatchEnding = {
  watch: SessionWatch;
  /** Why it stopped counting, for the line the session logs. */
  reason: string;
};

export type WatchBeatResult =
  | { isAccepted: true; isNew: boolean; watch: SessionWatch }
  | { isAccepted: false; reason: string; watch: SessionWatch | null };

export class WatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchError";
  }
}

function minutes(ms: number): string {
  const total = Math.round(ms / 60_000);
  return total >= 60 && total % 60 === 0
    ? `${total / 60}h`
    : `${Math.round((ms / 60_000) * 10) / 10}m`;
}

export class WatchLedger {
  /**
   * Every watch until its watcher ends it, with the reason it stopped
   * holding the session once a sweep has said so.
   */
  private readonly watches = new Map<
    string,
    { watch: SessionWatch; endedFor: string | null }
  >();
  private readonly beatTimeoutMs: number;
  private readonly maxHoldMs: number;
  private readonly now: () => number;

  constructor({
    beatTimeoutMs = WATCH_BEAT_TIMEOUT_MS,
    maxHoldMs = MAX_WATCH_HOLD_MS,
    now = Date.now,
  }: {
    beatTimeoutMs?: number;
    maxHoldMs?: number;
    now?: () => number;
  } = {}) {
    this.beatTimeoutMs = beatTimeoutMs;
    this.maxHoldMs = maxHoldMs;
    this.now = now;
  }

  /** Validates a beat's shape; a malformed one is the watcher's bug. */
  static parse(input: unknown): WatchBeat {
    const body = (input ?? {}) as Record<string, unknown>;
    const { watcher, purpose, holdMs, pid } = body;
    if (typeof watcher !== "string" || !WATCHER_PATTERN.test(watcher)) {
      throw new WatchError(
        "a watch needs a `watcher` name: 1-64 letters, digits, dots, colons, underscores or dashes",
      );
    }
    if (
      purpose !== undefined &&
      (typeof purpose !== "string" || purpose.length > PURPOSE_MAX_LENGTH)
    ) {
      throw new WatchError(
        `\`purpose\` must be a string of at most ${PURPOSE_MAX_LENGTH} characters`,
      );
    }
    if (
      holdMs !== undefined &&
      (typeof holdMs !== "number" || !Number.isFinite(holdMs) || holdMs <= 0)
    ) {
      throw new WatchError(
        "`holdMs` must be a positive number of milliseconds",
      );
    }
    if (pid !== undefined && (!Number.isInteger(pid) || (pid as number) <= 0)) {
      throw new WatchError("`pid` must be a positive integer");
    }
    return {
      watcher,
      purpose: purpose as string | undefined,
      holdMs: holdMs as number | undefined,
      pid: pid as number | undefined,
    };
  }

  beat(input: WatchBeat): WatchBeatResult {
    const at = this.now();
    const record = this.watches.get(input.watcher);
    if (record) {
      const existing = record.watch;
      if (at > existing.holdUntil) {
        return {
          isAccepted: false,
          reason: `watch '${existing.watcher}' declared a ${minutes(existing.holdUntil - existing.startedAt)} hold, which ran out at ${new Date(existing.holdUntil).toISOString()}; its beats no longer keep the session. end it, or start a new watch if the work really goes on`,
          watch: { ...existing },
        };
      }
      // A watcher that lapsed and beats again picks up under its own hold.
      const isResumed =
        record.endedFor !== null ||
        at - existing.lastBeatAt > this.beatTimeoutMs;
      record.endedFor = null;
      existing.lastBeatAt = at;
      existing.beats += 1;
      if (input.pid !== undefined) existing.pid = input.pid;
      return { isAccepted: true, isNew: isResumed, watch: { ...existing } };
    }
    const holdMs = input.holdMs ?? DEFAULT_WATCH_HOLD_MS;
    if (holdMs > this.maxHoldMs) {
      return {
        isAccepted: false,
        reason: `a ${minutes(holdMs)} hold is over the ${minutes(this.maxHoldMs)} maximum a watch may declare`,
        watch: null,
      };
    }
    const watch: SessionWatch = {
      watcher: input.watcher,
      purpose: input.purpose ?? null,
      pid: input.pid ?? null,
      startedAt: at,
      lastBeatAt: at,
      holdUntil: at + holdMs,
      beats: 1,
    };
    this.watches.set(watch.watcher, { watch, endedFor: null });
    return { isAccepted: true, isNew: true, watch: { ...watch } };
  }

  /** Forgets a watch, so its watcher may start a new one. */
  end(watcher: string): SessionWatch | null {
    const record = this.watches.get(watcher) ?? null;
    this.watches.delete(watcher);
    return record ? { ...record.watch } : null;
  }

  /**
   * Says, once each, which watches stopped holding the session and why:
   * they lapsed or ran out their hold. Each stays on record, under its hold,
   * until its watcher ends it.
   */
  sweep(): WatchEnding[] {
    const at = this.now();
    const endings: WatchEnding[] = [];
    for (const record of this.watches.values()) {
      if (record.endedFor !== null) continue;
      const { watch } = record;
      if (at - watch.lastBeatAt > this.beatTimeoutMs) {
        record.endedFor = `no heartbeat for ${Math.round((at - watch.lastBeatAt) / 1000)}s (limit ${Math.round(this.beatTimeoutMs / 1000)}s): its watcher${watch.pid ? ` pid ${watch.pid}` : ""} is taken for gone`;
      } else if (at > watch.holdUntil) {
        record.endedFor = `its declared ${minutes(watch.holdUntil - watch.startedAt)} hold ran out`;
      } else {
        continue;
      }
      endings.push({ watch: { ...watch }, reason: record.endedFor });
    }
    return endings;
  }

  /** The watches still holding the session, latest hold first. */
  live(): SessionWatch[] {
    const at = this.now();
    return [...this.watches.values()]
      .map((record) => record.watch)
      .filter(
        (watch) =>
          at - watch.lastBeatAt <= this.beatTimeoutMs && at <= watch.holdUntil,
      )
      .sort((a, b) => b.holdUntil - a.holdUntil)
      .map((watch) => ({ ...watch }));
  }
}

export type SessionWatchHandle = {
  /** Ends the watch on the daemon, so the session's idle clock runs again. */
  stop(): Promise<void>;
  /** Why the last beat did not land, or null while they all do. */
  lastError(): string | null;
};

/**
 * Hold the session at `daemonUrl` from a passive script: beats now and every
 * `intervalMs` until `stop()`. A refused beat (the hold ran out) stops the
 * beating and says so; a daemon that cannot be reached is reported once and
 * tried again on the next beat.
 */
export function watchSession(
  daemonUrl: string,
  beat: WatchBeat,
  {
    intervalMs = WATCH_BEAT_TIMEOUT_MS / 4,
    log = (line: string) => console.error(line),
  }: { intervalMs?: number; log?: (line: string) => void } = {},
): SessionWatchHandle {
  const url = `${daemonUrl.replace(/\/+$/, "")}/watch`;
  let lastError: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const send = async (body: WatchBeat) => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        lastError = null;
        return;
      }
      const answer = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      const error = `${response.status}: ${answer?.error ?? response.statusText}`;
      if (error !== lastError) {
        log(`[watch] ${beat.watcher}: ${url} refused the beat (${error})`);
      }
      lastError = error;
      if (response.status === 409 || response.status === 400) {
        if (timer !== null) clearInterval(timer);
        timer = null;
      }
    } catch (failure) {
      const error =
        failure instanceof Error ? failure.message : String(failure);
      if (error !== lastError) {
        log(
          `[watch] ${beat.watcher}: could not reach ${url} (${error}); trying again on the next beat`,
        );
      }
      lastError = error;
    }
  };
  void send(beat);
  timer = setInterval(() => {
    void send({ watcher: beat.watcher, pid: beat.pid });
  }, intervalMs);
  timer.unref?.();
  return {
    lastError: () => lastError,
    stop: async () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      await fetch(`${url}?watcher=${encodeURIComponent(beat.watcher)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    },
  };
}
