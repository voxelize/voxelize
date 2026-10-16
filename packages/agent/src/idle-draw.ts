/**
 * How slowly an idle session's page draws.
 *
 * A headless tab rendering a full scene at 60fps costs about a core plus the
 * GPU process whether or not anyone is looking (two idle sessions measured
 * 45% and 42% CPU on their renderer and GPU processes alone), and five of
 * them idling was most of a saturated box. After a short idle the daemon
 * caps the page at a few frames a second; after a long one, at a frame every
 * few seconds (at the first cap three idle sessions still measured about 0.55
 * core each, 24 Sep). The client slows its world update along with the draw
 * cap. The next command lifts the cap before it runs, so what it reads or
 * captures is current.
 */

export const DEFAULT_IDLE_DRAW_AFTER_MS = 20_000;
export const IDLE_DRAW_INTERVAL_MS = 500;
export const DEFAULT_IDLE_DEEP_AFTER_MS = 120_000;
export const IDLE_DEEP_DRAW_INTERVAL_MS = 5_000;

function resolveMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** `AGENT_IDLE_DRAW_AFTER_MS`; 0 turns every idle cap off. */
export function resolveIdleDrawAfterMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveMs(env.AGENT_IDLE_DRAW_AFTER_MS, DEFAULT_IDLE_DRAW_AFTER_MS);
}

/** `AGENT_IDLE_DEEP_AFTER_MS`; 0 keeps the first cap however long idle. */
export function resolveIdleDeepAfterMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveMs(env.AGENT_IDLE_DEEP_AFTER_MS, DEFAULT_IDLE_DEEP_AFTER_MS);
}

/** The draw interval an idle page should run at, or null for every frame. */
export function idleDrawIntervalFor(
  idleMs: number,
  {
    drawAfterMs = resolveIdleDrawAfterMs(),
    deepAfterMs = resolveIdleDeepAfterMs(),
  }: { drawAfterMs?: number; deepAfterMs?: number } = {},
): number | null {
  if (drawAfterMs === 0 || idleMs < drawAfterMs) return null;
  if (deepAfterMs > 0 && idleMs >= Math.max(deepAfterMs, drawAfterMs)) {
    return IDLE_DEEP_DRAW_INTERVAL_MS;
  }
  return IDLE_DRAW_INTERVAL_MS;
}

export function describeDrawInterval(intervalMs: number | null): string {
  if (intervalMs === null) return "every frame";
  const fps = 1000 / intervalMs;
  return `${fps >= 1 ? fps.toFixed(0) : fps.toFixed(1)}fps`;
}

/**
 * The page join an idle cap was put on: the document, and the bridge inside
 * it (`Snapshot.joinSerial`). The cap lives in the frame loop the bridge was
 * installed with, so a reload, or a world switched in place (same document,
 * a new world's loop), starts drawing every frame again whatever the daemon
 * asked of the last one.
 */
export type DrawThrottleTarget = {
  documentId: number | null;
  joinSerial: number | null;
};

/** Whether a cap put on `applied` still holds on the page join `current`. */
export function isDrawCapStillOn(
  applied: DrawThrottleTarget | null,
  current: DrawThrottleTarget,
): boolean {
  return (
    applied !== null &&
    applied.documentId === current.documentId &&
    applied.joinSerial === current.joinSerial
  );
}
