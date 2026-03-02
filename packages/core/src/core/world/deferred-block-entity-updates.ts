export type DeferBlockEntityUpdateOptions = {
  chunkName: string;
  timeoutMs: number;
  shouldApplyOnTimeout: () => boolean;
  onApply: () => void;
  bindChunkInit: (listener: () => void) => () => void;
};

type DeferredEntry = {
  chunkName: string;
  cancel: () => void;
};

export class DeferredBlockEntityUpdateController {
  private pendingByChunk = new Map<string, Set<DeferredEntry>>();

  defer(options: DeferBlockEntityUpdateOptions) {
    const { chunkName, timeoutMs, shouldApplyOnTimeout, onApply, bindChunkInit } =
      options;

    let isResolved = false;
    let unbind = () => {};
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      const pending = this.pendingByChunk.get(chunkName);
      if (!pending) return;
      pending.delete(entry);
      if (pending.size === 0) this.pendingByChunk.delete(chunkName);
    };

    const resolve = (allowApply: boolean) => {
      if (isResolved) return;
      isResolved = true;

      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
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

    timeoutId = setTimeout(() => {
      const allowApply = shouldApplyOnTimeout();
      resolve(allowApply);
    }, timeoutMs);

    unbind = bindChunkInit(() => resolve(true));

    const pending = this.pendingByChunk.get(chunkName) ?? new Set<DeferredEntry>();
    pending.add(entry);
    this.pendingByChunk.set(chunkName, pending);

    return entry.cancel;
  }

  cancelChunk(chunkName: string) {
    const pending = this.pendingByChunk.get(chunkName);
    if (!pending) return;

    [...pending].forEach((entry) => entry.cancel());
  }
}
