/**
 * What the server did with a call the bridge sent and confirmed, read from
 * the replies a voxelize server sends about calls that did nothing
 * (`vox-builtin:unhandled-method`, `vox-builtin:method-rejected`) and a ping
 * barrier behind the call. Mirrors `MethodOutcome` in `@voxelize/core`.
 *
 * - `ran`: a handler ran it and did not turn it down.
 * - `unhandled`: the world has no handler under that name; `handledBy` lists
 *   the worlds on the same server that do, or is `null` when the server
 *   keeps no index of them.
 * - `rejected`: the world's guard refused it, or its handler turned it down
 *   or panicked.
 * - `unanswered`: no answer within the wait; the call may or may not have run.
 */
export type MethodOutcome =
  | { kind: "ran" }
  | { kind: "unhandled"; world: string; handledBy: string[] | null }
  | { kind: "rejected"; world: string; reason: string }
  | { kind: "unanswered"; waitedMs: number };

/** A call the server answered as having done nothing. */
export class MethodOutcomeError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly outcome: MethodOutcome,
  ) {
    super(message);
    this.name = "MethodOutcomeError";
  }
}

const OUTCOME_KINDS = new Set(["ran", "unhandled", "rejected", "unanswered"]);

/** The outcome a bridge call's result carries, or null when it has none. */
export function outcomeOf(result: unknown): MethodOutcome | null {
  if (typeof result !== "object" || result === null) return null;
  const outcome = (result as { outcome?: unknown }).outcome;
  if (typeof outcome !== "object" || outcome === null) return null;
  const kind = (outcome as { kind?: unknown }).kind;
  return typeof kind === "string" && OUTCOME_KINDS.has(kind)
    ? (outcome as MethodOutcome)
    : null;
}

/** Why `method` did nothing, or null when it ran or nobody can tell. */
export function describeMethodFailure(
  method: string,
  outcome: MethodOutcome,
): string | null {
  if (outcome.kind === "unhandled") {
    const where =
      outcome.handledBy === null
        ? "the server does not say which worlds do"
        : outcome.handledBy.length === 0
          ? "no world on this server handles it"
          : `worlds that handle it: ${outcome.handledBy.join(", ")}`;
    return `${method} did nothing: world '${outcome.world}' has no handler for it (${where})`;
  }
  if (outcome.kind === "rejected") {
    return `${method} did nothing in world '${outcome.world}': ${outcome.reason}`;
  }
  return null;
}

/**
 * Throws a {@link MethodOutcomeError} when the server answered `method` as
 * having done nothing. A result without an outcome (a bridge that does not
 * confirm calls, a call performed locally) passes.
 */
export function assertMethodRan(method: string, result: unknown): void {
  const outcome = outcomeOf(result);
  if (!outcome) return;
  const failure = describeMethodFailure(method, outcome);
  if (failure) throw new MethodOutcomeError(failure, method, outcome);
}
