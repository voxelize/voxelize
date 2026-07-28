export type WaitOp = "eq" | "ne" | "gt" | "lt" | "contains";

export type WaitValue = string | number | boolean | null;

export type WaitPredicate = {
  /** Dot path resolved from the snapshot root, e.g. `metadata.swimComp.state.type`. */
  path: string;
  op: WaitOp;
  value: WaitValue;
};

/**
 * Resolve a dot path against a snapshot object. Numeric segments index into
 * arrays. Returns undefined when any segment is missing, which never
 * satisfies a predicate: a value that is not there is not a match, whatever
 * the operator (fail-closed, with the caller reporting what it last saw).
 */
export function resolvePath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function matchesPredicate(
  resolved: unknown,
  predicate: WaitPredicate,
): boolean {
  if (resolved === undefined) return false;
  const { op, value } = predicate;
  switch (op) {
    case "eq":
      return resolved === value;
    case "ne":
      return resolved !== value;
    case "gt":
      return (
        typeof resolved === "number" &&
        typeof value === "number" &&
        Number.isFinite(resolved) &&
        resolved > value
      );
    case "lt":
      return (
        typeof resolved === "number" &&
        typeof value === "number" &&
        Number.isFinite(resolved) &&
        resolved < value
      );
    case "contains":
      if (typeof resolved === "string") {
        return resolved.includes(String(value));
      }
      if (Array.isArray(resolved)) {
        return resolved.some((element) => element === value);
      }
      return false;
  }
}

export type WaitEntityCandidate = {
  id: string;
  kind: string;
  position?: { x: number; y: number; z: number };
  distance?: number;
};

export function filterWaitCandidates<T extends WaitEntityCandidate>(
  entities: T[],
  filter: { kind?: string; entityId?: string },
): T[] {
  return entities.filter((entity) => {
    if (filter.entityId !== undefined && entity.id !== filter.entityId) {
      return false;
    }
    if (
      filter.kind !== undefined &&
      !entity.kind.toLowerCase().includes(filter.kind.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

/**
 * The observed value of each candidate at the moment a wait gave up: the
 * failure evidence a timeout reports instead of a bare "timed out".
 */
export function describeLastSeen<T extends WaitEntityCandidate>(
  candidates: T[],
  path: string,
  limit: number,
): Array<{ id: string; kind: string; value: unknown; distance?: number }> {
  return candidates.slice(0, limit).map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    value: resolvePath(entity, path),
    distance: entity.distance,
  }));
}
