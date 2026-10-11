import type {
  CommandDispatch,
  ConnectionSnapshot,
  Vec3,
  VoxelCensus,
  VoxelCensusBox,
} from "./bridge";

export type Vec3Tuple = [number, number, number];

/**
 * One box of a fill request: what the host's fill method writes, plus
 * whatever else its payload carries (rotation, stage), passed through.
 */
export type FillBox = {
  min: Vec3Tuple;
  max: Vec3Tuple;
  block: string;
  [field: string]: unknown;
};

export type FillLandingOptions = {
  /** How long the boxes may take to read back before the fill is failed. */
  timeoutMs: number;
  /** Sends per box, the first included. */
  maxSends: number;
  /** A box that read back no new voxel this long after its last send, its
   * last progress, or the session coming back, is sent again. */
  resendAfterMs: number;
  /** A send still on the connection it went out on this long after, with
   * the session live, reached the server: the core drops a page that stops
   * reading well inside it, and that drop is the loss. Under load the
   * server's answer to a call trails behind chunk data and often misses
   * its own wait, so this is what vouches for a box the page cannot see. */
  arrivalGraceMs: number;
  pollMs: number;
};

export type FillLandingDeps = {
  /** Hands one box to the host's fill method. Throws a refusal as it is
   * (an answer, not a loss) and `FillPageUnavailableError` when the page
   * could not take the call now. */
  send(box: FillBox): Promise<CommandDispatch>;
  /** Reads the boxes back through the page in one call. Throws
   * `FillPageUnavailableError` when the page cannot answer now. */
  census(boxes: VoxelCensusBox[]): Promise<VoxelCensus[]>;
  /** The connection as last observed, or null before the first look. */
  connection(): ConnectionSnapshot | null;
  now(): number;
  sleep(ms: number): Promise<void>;
};

export type FillSendReason = "first" | "rejoined" | "no-progress" | "unsent";

export type FillSend = {
  atMs: number;
  /** The session's join generation when the send was handed over. */
  joinGeneration: number;
  reason: FillSendReason;
  /** What the page did with it; null when the page could not take it. */
  dispatch: CommandDispatch | null;
  error?: string;
};

export type BoxLanding = {
  box: FillBox;
  volume: number;
  /** Voxels a later box in the same request writes another block over:
   * not this box's to land. */
  overwritten: number;
  /** Voxels that read back as the block on some reading. One that held it
   * once and changed after (leaves decaying, water flowing back into a
   * wipe) landed. */
  landed: number;
  /** On the last reading, voxels in chunks the page has not loaded. */
  unloaded: number;
  /** On the last reading, air asked and a fluid there (counted landed). */
  refilled: number;
  sends: FillSend[];
  /** What says the server has the box: it answered that it ran a send
   * (`ran`), or a send's connection held past `arrivalGraceMs` (`held`). */
  arrival: FillArrival | null;
  /** Loaded voxels that never read back as the block, as last seen. */
  missing: { pos: Vec3; name: string }[];
};

export type FillArrival = "ran" | "held";

/**
 * - `landed`: every voxel read back as its block.
 * - `unverified`: every voxel the page can see landed and the fill reached
 *   the server, but some voxels are in chunks the page has not loaded.
 * - `missing`: voxels the page can see never landed, or nothing confirmed
 *   the fill reached the server at all.
 */
export type FillLandingStatus = "landed" | "unverified" | "missing";

export type FillLandingReport = {
  status: FillLandingStatus;
  message: string;
  elapsedMs: number;
  boxes: BoxLanding[];
  /** Rejoins the page went through while the fill was landing. */
  rejoins: number;
  /** Readings the page could not answer. */
  failedReadings: number;
};

export const DEFAULT_FILL_LANDING: FillLandingOptions = {
  timeoutMs: 180_000,
  maxSends: 4,
  resendAfterMs: 30_000,
  arrivalGraceMs: 20_000,
  pollMs: 1_000,
};

/** Most voxels one fill request reads back; a box past it is refused
 * before anything is sent rather than written unverified. */
export const MAX_FILL_LANDING_VOLUME = 4_000_000;

/** A loaded software-GL page commits a large box over many ticks and shows
 * it later still, so the wait grows with the voxels it must read back. */
export function fillLandingTimeoutMs(volume: number): number {
  return Math.min(
    900_000,
    Math.ceil(DEFAULT_FILL_LANDING.timeoutMs + volume * 0.5),
  );
}

/** Errors a later attempt may not hit again: the page is stalled,
 * reloading or rejoining. Anything else ends the fill. */
export class FillPageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FillPageUnavailableError";
  }
}

/** A fill that did not land, with the report that says what is missing. */
export class FillLandingError extends Error {
  constructor(readonly report: FillLandingReport) {
    super(report.message);
    this.name = "FillLandingError";
  }
}

type Range = { lo: Vec3Tuple; hi: Vec3Tuple };

function ordered(box: FillBox): Range {
  const lo = box.min.map((v, i) => Math.min(v, box.max[i])) as Vec3Tuple;
  const hi = box.min.map((v, i) => Math.max(v, box.max[i])) as Vec3Tuple;
  return { lo, hi };
}

function rangeVolume({ lo, hi }: Range): number {
  return (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
}

export function boxVolume(box: FillBox): number {
  return rangeVolume(ordered(box));
}

/** The voxel behind a census bit: x outermost, then y, then z (see
 * `VoxelCensus.matched`). */
export function censusVoxel(box: FillBox, index: number): Vec3 {
  const { lo, hi } = ordered(box);
  const sy = hi[1] - lo[1] + 1;
  const sz = hi[2] - lo[2] + 1;
  return {
    x: lo[0] + Math.floor(index / (sy * sz)),
    y: lo[1] + (Math.floor(index / sz) % sy),
    z: lo[2] + (index % sz),
  };
}

function censusIndex(range: Range, { x, y, z }: Vec3): number | null {
  const { lo, hi } = range;
  if (
    x < lo[0] ||
    x > hi[0] ||
    y < lo[1] ||
    y > hi[1] ||
    z < lo[2] ||
    z > hi[2]
  ) {
    return null;
  }
  const sy = hi[1] - lo[1] + 1;
  const sz = hi[2] - lo[2] + 1;
  return ((x - lo[0]) * sy + (y - lo[1])) * sz + (z - lo[2]);
}

function overlaps(a: FillBox, b: FillBox): boolean {
  const ra = ordered(a);
  const rb = ordered(b);
  return [0, 1, 2].every((i) => ra.lo[i] <= rb.hi[i] && rb.lo[i] <= ra.hi[i]);
}

const sameBlock = (a: FillBox, b: FillBox) =>
  a.block.toLowerCase() === b.block.toLowerCase();

function decodeBits(base64: string, volume: number): Uint8Array {
  const bits = Uint8Array.from(Buffer.from(base64, "base64"));
  if (bits.length !== Math.ceil(volume / 8)) {
    throw new Error(
      `a reading of ${volume} voxels came back with ${bits.length} bytes of bits`,
    );
  }
  return bits;
}

const hasBit = (bits: Uint8Array, index: number) =>
  (bits[index >> 3] & (1 << (index & 7))) !== 0;

function isLive(connection: ConnectionSnapshot | null): boolean {
  return (
    connection !== null &&
    connection.isConnected &&
    connection.isJoined &&
    !connection.isJoinPending
  );
}

class BoxState {
  readonly range: Range;
  readonly volume: number;
  readonly overwritten: number;
  /** Set for the voxels this box answers for (no later box overwrites). */
  private readonly owned: Uint8Array;
  private readonly landedBits: Uint8Array;
  landed = 0;
  unloaded = 0;
  refilled = 0;
  missing: { pos: Vec3; name: string }[] = [];
  hasReading = false;
  sends: FillSend[] = [];
  lastProgressAtMs = 0;
  arrival: FillArrival | null = null;

  constructor(
    readonly box: FillBox,
    later: FillBox[],
  ) {
    this.range = ordered(box);
    this.volume = rangeVolume(this.range);
    this.owned = new Uint8Array(Math.ceil(this.volume / 8));
    this.landedBits = new Uint8Array(this.owned.length);
    const covering = later
      .filter((b) => !sameBlock(b, box) && overlaps(b, box))
      .map(ordered);
    let overwritten = 0;
    for (let i = 0; i < this.volume; i++) {
      const voxel = censusVoxel(box, i);
      if (covering.some((range) => censusIndex(range, voxel) !== null)) {
        overwritten++;
      } else {
        this.owned[i >> 3] |= 1 << (i & 7);
      }
    }
    this.overwritten = overwritten;
  }

  get owes(): number {
    return this.volume - this.overwritten;
  }

  get isLanded(): boolean {
    return this.landed === this.owes;
  }

  /** Every voxel the page can see landed; the rest are in unloaded chunks. */
  get isLandedWherever(): boolean {
    return this.hasReading && this.landed + this.unloaded >= this.owes;
  }

  /** What says the server has this box now, if anything. */
  noteArrival(
    connection: ConnectionSnapshot | null,
    nowMs: number,
    liveSinceMs: number,
    options: FillLandingOptions,
  ): void {
    if (this.arrival !== null) return;
    if (this.sends.some((send) => send.dispatch?.outcome?.kind === "ran")) {
      this.arrival = "ran";
      return;
    }
    if (connection === null || !isLive(connection)) return;
    const isHeld = this.sends.some((send) => {
      if (send.dispatch === null) return false;
      // A queued send goes out when the session rejoins.
      const isQueued = send.dispatch.isQueued;
      const generation = send.joinGeneration + (isQueued ? 1 : 0);
      const outAtMs = isQueued ? liveSinceMs : send.atMs;
      return (
        connection.joinGeneration === generation &&
        nowMs - outAtMs >= options.arrivalGraceMs
      );
    });
    if (isHeld) this.arrival = "held";
  }

  /** Sends the page took: one it could not take never left, and does not
   * use up the box's sends. */
  get takenSends(): number {
    return this.sends.filter((send) => send.dispatch !== null).length;
  }

  absorb(census: VoxelCensus, nowMs: number): void {
    if (census.volume !== this.volume) {
      throw new Error(
        `a reading of ${census.volume} voxels came back for a box of ${this.volume}`,
      );
    }
    const bits = decodeBits(census.matched, this.volume);
    for (let i = 0; i < this.landedBits.length; i++) {
      this.landedBits[i] |= bits[i] & this.owned[i];
    }
    let landed = 0;
    for (let i = 0; i < this.volume; i++) {
      if (hasBit(this.landedBits, i)) landed++;
    }
    if (landed > this.landed) this.lastProgressAtMs = nowMs;
    this.landed = landed;
    this.unloaded = census.unloaded;
    this.refilled = census.refilled;
    this.hasReading = true;
    this.missing = census.mismatches.filter((m) => {
      const index = censusIndex(this.range, m.pos);
      return (
        index !== null &&
        hasBit(this.owned, index) &&
        !hasBit(this.landedBits, index)
      );
    });
  }

  /** Why this box should go out again now, or null. */
  resendReason(
    connection: ConnectionSnapshot | null,
    nowMs: number,
    liveSinceMs: number,
    options: FillLandingOptions,
  ): FillSendReason | null {
    const last = this.sends[this.sends.length - 1];
    if (!isLive(connection)) return null;
    const quietSince = Math.max(last.atMs, this.lastProgressAtMs, liveSinceMs);
    if (last.dispatch === null) {
      // The page could not take it, so nothing went out: try again, at a
      // pace a stalled page is not hammered at.
      const retryMs = Math.min(options.resendAfterMs, 5 * options.pollMs);
      return nowMs - quietSince >= retryMs ? "unsent" : null;
    }
    // A queued send goes out by itself when the session rejoins, one
    // rejoin past the send; only a later one can have lost it. A send the
    // server said it ran is past the connection, whatever drops after.
    const isRun = last.dispatch.outcome?.kind === "ran";
    const expectedRejoins = last.dispatch.isQueued ? 1 : 0;
    const generation = connection?.joinGeneration ?? last.joinGeneration;
    if (!isRun && generation > last.joinGeneration + expectedRejoins) {
      return "rejoined";
    }
    return nowMs - quietSince >= options.resendAfterMs ? "no-progress" : null;
  }

  report(): BoxLanding {
    return {
      box: this.box,
      volume: this.volume,
      overwritten: this.overwritten,
      landed: this.landed,
      unloaded: this.unloaded,
      refilled: this.refilled,
      sends: this.sends,
      arrival: this.arrival,
      missing: this.missing,
    };
  }
}

function describeBox(state: BoxState): string {
  const { lo, hi } = state.range;
  return `${state.box.block} ${lo.join(",")}..${hi.join(",")}`;
}

/** Each send's fate, a run of sends the page would not take said once. */
function describeSends(sends: FillSend[]): string {
  const lines: string[] = [];
  for (let i = 0; i < sends.length; i++) {
    const send = sends[i];
    const dispatch = send.dispatch;
    if (dispatch === null) {
      let end = i;
      while (sends[end + 1]?.dispatch === null) end++;
      const count = end - i + 1;
      lines.push(
        `${send.reason} not taken${count > 1 ? ` (and ${count - 1} retries)` : ""}: ${send.error ?? "page unavailable"}`,
      );
      i = end;
      continue;
    }
    const fate = dispatch.isQueued
      ? `queued (${dispatch.queuedReason ?? "waiting"})`
      : dispatch.outcome?.kind === "unanswered"
        ? `unanswered after ${dispatch.outcome.waitedMs}ms`
        : dispatch.outcome?.kind ?? "sent";
    lines.push(`${send.reason} ${fate}`);
  }
  return lines.join(", ");
}

function summarize(
  states: BoxState[],
  elapsedMs: number,
  rejoins: number,
  options: FillLandingOptions,
): { status: FillLandingStatus; message: string } {
  const seconds = (elapsedMs / 1000).toFixed(1);
  const sends = states.reduce((sum, s) => sum + s.sends.length, 0);
  const owed = states.reduce((sum, s) => sum + s.owes, 0);
  const landed = states.reduce((sum, s) => sum + s.landed, 0);
  const rejoined =
    rejoins > 0 ? `; the page rejoined ${rejoins} time(s) meanwhile` : "";
  if (states.every((s) => s.isLanded)) {
    const refilled = states.reduce((sum, s) => sum + s.refilled, 0);
    const fluid =
      refilled > 0 ? ` (${refilled} wiped voxels hold a fluid again)` : "";
    return {
      status: "landed",
      message: `all ${owed} voxels landed in ${seconds}s, ${sends} send(s)${fluid}${rejoined}`,
    };
  }
  const short = states.filter((s) => !s.isLanded);
  if (short.every((s) => s.isLandedWherever && s.arrival !== null)) {
    const unloaded = short.reduce((sum, s) => sum + s.unloaded, 0);
    const why = short.every((s) => s.arrival === "ran")
      ? "the server said it ran it"
      : `its connection held ${Math.round(options.arrivalGraceMs / 1000)}s past the send`;
    const seen =
      unloaded >= owed
        ? `the fill reached the server (${why}), but all ${owed} voxels are in chunks this page has not loaded, so none were read back`
        : `every voxel this page can see landed (${landed} of ${owed}) and the fill reached the server (${why}), ` +
          `but ${unloaded} are in chunks this page has not loaded and were not read back`;
    return { status: "unverified", message: `${seen}${rejoined}` };
  }
  const lines = short.map((s) => {
    const examples = s.missing
      .slice(0, 4)
      .map((m) => `(${m.pos.x},${m.pos.y},${m.pos.z}) holds ${m.name}`)
      .join("; ");
    const unread = !s.hasReading
      ? "the page never answered a reading"
      : `${Math.max(0, s.owes - s.landed - s.unloaded)} never read back as ${s.box.block}${
          s.unloaded > 0
            ? `, ${s.unloaded} in chunks this page has not loaded`
            : ""
        }${examples ? ` (${examples})` : ""}`;
    return `${describeBox(s)}: ${s.landed} of ${s.owes} landed, ${unread}; sends: ${describeSends(s.sends)}`;
  });
  return {
    status: "missing",
    message: `fill did not land in ${seconds}s${rejoined}: ${lines.join(" | ")}`,
  };
}

/**
 * Sends a fill and reads it back until every voxel holds its block. A send
 * the connection may have lost (a rejoin since it went out that the server
 * had not answered, or a box that stopped reading back new voxels) goes out
 * again, up to `maxSends`: a fill is idempotent, so a repeat over voxels
 * that landed writes nothing. What never lands is named, never dropped in
 * silence.
 *
 * Boxes go out in order and later ones win where they overlap with another
 * block; resending one resends every later box over it, so the order holds.
 */
export async function landFill(
  boxes: FillBox[],
  deps: FillLandingDeps,
  options: FillLandingOptions = DEFAULT_FILL_LANDING,
): Promise<FillLandingReport> {
  const startedAtMs = deps.now();
  const states = boxes.map((box, i) => new BoxState(box, boxes.slice(i + 1)));
  const firstGeneration = deps.connection()?.joinGeneration ?? 0;
  let failedReadings = 0;
  let wasLive = isLive(deps.connection());
  let liveSinceMs = startedAtMs;

  const send = async (state: BoxState, reason: FillSendReason) => {
    const atMs = deps.now();
    const joinGeneration = deps.connection()?.joinGeneration ?? 0;
    try {
      const dispatch = await deps.send(state.box);
      state.sends.push({ atMs, joinGeneration, reason, dispatch });
    } catch (error) {
      if (!(error instanceof FillPageUnavailableError)) throw error;
      state.sends.push({
        atMs,
        joinGeneration,
        reason,
        dispatch: null,
        error: error.message,
      });
    }
  };

  for (const state of states) await send(state, "first");

  for (;;) {
    const unread = states.filter((s) => !s.isLanded);
    try {
      const readings = await deps.census(
        unread.map((s) => ({
          min: s.box.min,
          max: s.box.max,
          block: s.box.block,
        })),
      );
      unread.forEach((s, i) => s.absorb(readings[i], deps.now()));
    } catch (error) {
      if (!(error instanceof FillPageUnavailableError)) throw error;
      failedReadings++;
    }
    const nowMs = deps.now();
    const connection = deps.connection();
    const isLiveNow = isLive(connection);
    if (isLiveNow && !wasLive) liveSinceMs = nowMs;
    wasLive = isLiveNow;
    for (const state of states) {
      state.noteArrival(connection, nowMs, liveSinceMs, options);
    }
    if (states.every((s) => s.isLanded)) break;
    if (
      states.every(
        (s) => s.isLanded || (s.isLandedWherever && s.arrival !== null),
      )
    ) {
      break;
    }
    if (nowMs - startedAtMs >= options.timeoutMs) break;

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      if (state.isLanded || state.takenSends >= options.maxSends) continue;
      const reason = state.resendReason(
        connection,
        nowMs,
        liveSinceMs,
        options,
      );
      if (reason === null) continue;
      await send(state, reason);
      for (const later of states.slice(i + 1)) {
        if (
          !sameBlock(later.box, state.box) &&
          overlaps(later.box, state.box)
        ) {
          await send(later, reason);
        }
      }
    }
    await deps.sleep(options.pollMs);
  }

  const elapsedMs = deps.now() - startedAtMs;
  const rejoins = Math.max(
    0,
    (deps.connection()?.joinGeneration ?? firstGeneration) - firstGeneration,
  );
  const { status, message } = summarize(states, elapsedMs, rejoins, options);
  return {
    status,
    message,
    elapsedMs,
    boxes: states.map((s) => s.report()),
    rejoins,
    failedReadings,
  };
}
