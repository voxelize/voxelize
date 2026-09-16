export type DeferBlockEntityUpdateOptions = {
  chunkName: string;
  /**
   * When to first re-check whether the chunk became ready without its init
   * listener firing. Not a deadline: an update whose chunk is still on its
   * way keeps waiting for it.
   */
  timeoutMs: number;
  /**
   * The hard bound. An update whose chunk never became ready by then is
   * dropped — and `onDrop` is told, so the loss is never silent.
   */
  maxWaitMs?: number;
  shouldApplyOnTimeout: () => boolean;
  onApply: () => void;
  onDrop?: (waitedMs: number) => void;
  bindChunkInit: (listener: () => void) => () => void;
};

type DeferredEntry = {
  chunkName: string;
  cancel: () => void;
};

export const DEFAULT_DEFERRED_UPDATE_MAX_WAIT_MS = 120_000;

/**
 * Holds block-entity updates for chunks that have not meshed yet and
 * releases them when the chunk lands. A far chunk can take well over the
 * soft timeout to arrive (a teleport across the map, a slow wire), so the
 * soft timeout only re-checks readiness; the chunk-init binding stays live
 * until the chunk arrives, the chunk is unloaded (`cancelChunk`), or the
 * hard bound passes.
 */
export class DeferredBlockEntityUpdateController {
  private pendingByChunk = new Map<string, Set<DeferredEntry>>();

  defer(options: DeferBlockEntityUpdateOptions) {
    const {
      chunkName,
      timeoutMs,
      maxWaitMs = DEFAULT_DEFERRED_UPDATE_MAX_WAIT_MS,
      shouldApplyOnTimeout,
      onApply,
      onDrop,
      bindChunkInit,
    } = options;

    let isResolved = false;
    let unbind = () => {};
    let softTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let hardTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const cleanup = () => {
      const pending = this.pendingByChunk.get(chunkName);
      if (!pending) return;
      pending.delete(entry);
      if (pending.size === 0) this.pendingByChunk.delete(chunkName);
    };

    const resolve = (allowApply: boolean) => {
      if (isResolved) return;
      isResolved = true;

      if (softTimeoutId !== null) clearTimeout(softTimeoutId);
      if (hardTimeoutId !== null) clearTimeout(hardTimeoutId);
      unbind();
      cleanup();

      if (allowApply) {
        onApply();
      }
    };

    const entry: DeferredEntry = {
      chunkName,
      cancel: () => resolve(false),
    };

    softTimeoutId = setTimeout(() => {
      softTimeoutId = null;
      // Ready without the init listener having fired (it was already
      // initialized when we bound): apply now. Otherwise keep waiting.
      if (shouldApplyOnTimeout()) resolve(true);
    }, timeoutMs);

    hardTimeoutId = setTimeout(() => {
      hardTimeoutId = null;
      const allowApply = shouldApplyOnTimeout();
      if (!allowApply) onDrop?.(Date.now() - startedAt);
      resolve(allowApply);
    }, maxWaitMs);

    unbind = bindChunkInit(() => resolve(true));

    const pending =
      this.pendingByChunk.get(chunkName) ?? new Set<DeferredEntry>();
    pending.add(entry);
    this.pendingByChunk.set(chunkName, pending);

    return entry.cancel;
  }

  cancelChunk(chunkName: string) {
    const pending = this.pendingByChunk.get(chunkName);
    if (!pending) return;

    [...pending].forEach((entry) => entry.cancel());
  }

  /** Updates still waiting on a chunk; for tests and diagnostics. */
  pendingCount(chunkName?: string): number {
    if (chunkName !== undefined) {
      return this.pendingByChunk.get(chunkName)?.size ?? 0;
    }
    let total = 0;
    for (const pending of this.pendingByChunk.values()) total += pending.size;
    return total;
  }
}
