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

let isPlayInteractive = false;
const lazyWork: LazyWorkEntry[] = [];

export function markPlayInteractive(): void {
  isPlayInteractive = true;
}

export function noteLazyWork(kind: LazyWorkKind, label: string): void {
  lazyWork.push({ kind, label, isAfterInteractive: isPlayInteractive });
  if (isPlayInteractive) {
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

/// Test seam: the ledger and the interactive flag are module state that
/// outlives a single world, which is what makes them useful in the client
/// and useless in a test suite that runs several scenarios in one process.
export function resetLazyWorkLedger(): void {
  isPlayInteractive = false;
  lazyWork.length = 0;
}
