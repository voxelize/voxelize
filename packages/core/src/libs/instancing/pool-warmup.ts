/// Painting a variant's texture is the expensive half of building an
/// instanced pool, and it cannot be split or moved off the main thread
/// without an entity appearing untextured. So the whole roster is baked
/// during the load phase, a slice per frame under a budget, and the player is
/// not released into the world until it is done: loading is allowed to cost
/// seconds, gameplay is not allowed to cost a frame.
///
/// Building a variant on first use survives only as a correctness fallback,
/// for a variant that warming never reached. It should never fire on a
/// normal join, so it says so when it does rather than quietly costing a
/// frame mid-play.
export interface WarmablePool {
  /// Bakes one variant that has not been built yet, reporting whether there
  /// was anything left to bake.
  warmNextVariant(): boolean;
  /// Every variant the roster drain will visit for this pool, adults and
  /// babies counted separately when the family has them.
  warmableVariantCount(): number;
  /// The cache key of the variant the next `warmNextVariant` would bake, or
  /// null when it has nothing left. Lets a drain whose bakes wait on work
  /// done elsewhere (a texture painted off the main thread) ask whether the
  /// next unit is ready before paying for it.
  peekNextVariantKey?(): string | null;
}

export function warmableRosterCount<TType extends string>(
  types: readonly TType[],
  hasBabies: boolean,
): number {
  return types.length * (hasBabies ? 2 : 1);
}

export function isWarmablePool(child: object): child is WarmablePool {
  return (
    "warmNextVariant" in child &&
    typeof child.warmNextVariant === "function" &&
    "warmableVariantCount" in child &&
    typeof child.warmableVariantCount === "function"
  );
}

export function warmNextRosterEntry<TType extends string>(
  types: readonly TType[],
  hasBabies: boolean,
  isWarm: (type: TType, baby: boolean) => boolean,
  bake: (type: TType, baby: boolean) => void,
): boolean {
  for (const type of types) {
    if (!isWarm(type, false)) {
      bake(type, false);
      return true;
    }
    if (hasBabies && !isWarm(type, true)) {
      bake(type, true);
      return true;
    }
  }
  return false;
}

/// The entry `warmNextRosterEntry` would bake next, without baking it: the
/// same walk, so the two can never disagree about order.
export function peekNextRosterEntry<TType extends string>(
  types: readonly TType[],
  hasBabies: boolean,
  isWarm: (type: TType, baby: boolean) => boolean,
): { type: TType; baby: boolean } | null {
  let next: { type: TType; baby: boolean } | null = null;
  warmNextRosterEntry(types, hasBabies, isWarm, (type, baby) => {
    next = { type, baby };
  });
  return next;
}

/// The kind of one-time construction the load phase was supposed to have
/// finished: a pool variant, a texture, a mesh. Each kind is a different
/// subsystem's fallback path, and each is a dropped frame when it fires while
/// someone is playing. Consumers name their own kinds.
export type LazyWorkKind = string;

export interface LazyWorkEntry {
  kind: LazyWorkKind;
  label: string;
  /// Work the load phase reached late is merely slow; work that lands after
  /// the player has control is the defect the warm phases exist to prevent.
  isAfterInteractive: boolean;
}

let playInteractive = false;
const lazyWork: LazyWorkEntry[] = [];
const playInteractiveListeners = new Set<() => void>();

/// Whether the player has control yet. Before that the world is loading and
/// work may cost time; after it, any one-time work is a dropped frame.
export function isPlayInteractive(): boolean {
  return playInteractive;
}

/// Calls `listener` each time play goes from loading to interactive: once
/// per join, and again after a world reload resets the flag
/// (`resetLazyWorkLedger`). Listeners outlive that reset. Returns the
/// unsubscribe.
export function onPlayInteractive(listener: () => void): () => void {
  playInteractiveListeners.add(listener);
  return () => {
    playInteractiveListeners.delete(listener);
  };
}

export function markPlayInteractive(): void {
  if (playInteractive) return;
  playInteractive = true;
  for (const listener of [...playInteractiveListeners]) {
    try {
      listener();
    } catch (error) {
      console.error("[instancing] a play-interactive listener threw", error);
    }
  }
}

export function noteLazyWork(kind: LazyWorkKind, label: string): void {
  lazyWork.push({ kind, label, isAfterInteractive: playInteractive });
  if (playInteractive) {
    console.warn(
      `[instancing] ${kind} ${label} was built on demand after warmup: ` +
        "this costs a frame during play and means the warm phase missed it",
    );
  }
}

/// A pool built one of its variants on demand, outside the roster warmup.
export function noteLazyBake(pool: string, variant: string): void {
  noteLazyWork("instance-pool", `${pool}:${variant}`);
}

export function readLazyWork(): readonly LazyWorkEntry[] {
  return lazyWork;
}

export function readLazyWorkAfterInteractive(): readonly LazyWorkEntry[] {
  return lazyWork.filter((entry) => entry.isAfterInteractive);
}

/// Back to the loading state: the ledger and the interactive flag are module
/// state that outlives a single world, so a world loaded in the same page
/// (and a test suite running several scenarios in one process) starts here.
/// Play-interactive listeners stay subscribed.
export function resetLazyWorkLedger(): void {
  playInteractive = false;
  lazyWork.length = 0;
}
