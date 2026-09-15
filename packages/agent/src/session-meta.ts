/**
 * Session metadata: who a daemon session belongs to and what it is for.
 *
 * Two halves, deliberately kept apart:
 *
 * - `SessionMeta` is worker-declared and free-form: a flat string map any
 *   caller may set at start or patch later (`label`, `purpose`, `owner`,
 *   `tags`, or anything else). It lives only in the daemon's memory, so it
 *   dies with the session, which is the right lifetime for a note about an
 *   ephemeral process.
 * - `SessionOrigin` is captured once by whatever launched the daemon (cwd,
 *   user, terminal, parent process chain, the Cursor conversation when an
 *   agent started it) and is read-only afterwards: provenance that could be
 *   edited would stop being provenance.
 *
 * Both ride in `/status` and `/meta` so `session list`, the reaper, and the
 * local admin page all read the same facts.
 */

export type SessionMeta = Record<string, string>;

export type SessionOriginParent = {
  pid: number;
  command: string;
};

export type SessionOriginCursor = {
  isAgent: boolean;
  conversationId: string | null;
  workspaceLabel: string | null;
};

export type SessionOrigin = {
  /** Wall-clock ms when the launcher started the session. */
  startedAt: number;
  /**
   * Explicit launcher identity when the spawning program declares one
   * (e.g. `admin-page`); wins over every inferred signal because inherited
   * environments lie about who is acting (pm2 hands its starter's shell
   * variables to every app it runs).
   */
  launcher: string | null;
  /** The launcher invocation, e.g. `agent session start test --label x`. */
  command: string | null;
  cwd: string | null;
  user: string | null;
  hostname: string | null;
  /** `TERM_PROGRAM` of the launching shell when it names one. */
  terminal: string | null;
  launcherPid: number | null;
  /** Ancestors of the launcher, nearest first, stopping at pid 1. */
  parentChain: SessionOriginParent[];
  /** Present when the launching shell carried Cursor's environment. */
  cursor: SessionOriginCursor | null;
};

export type SessionMetaPatch = {
  set?: Record<string, string>;
  unset?: string[];
};

/** JSON object of initial meta, handed from launcher to daemon. */
export const SESSION_META_ENV = "AGENT_SESSION_META";
/** JSON `SessionOrigin`, handed from launcher to daemon. */
export const SESSION_ORIGIN_ENV = "AGENT_SESSION_ORIGIN";
/** Set by a spawning program to name itself as the launcher (see SessionOrigin.launcher). */
export const SESSION_LAUNCHER_ENV = "AGENT_SESSION_LAUNCHER";

export const SESSION_META_MAX_KEYS = 32;
export const SESSION_META_MAX_KEY_LENGTH = 32;
export const SESSION_META_MAX_VALUE_LENGTH = 512;
export const SESSION_META_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** Keys every consumer knows how to display; nothing restricts callers to them. */
export const SESSION_META_WELL_KNOWN_KEYS = [
  "label",
  "purpose",
  "owner",
  "tags",
] as const;

export class SessionMetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionMetaError";
  }
}

function normalizeKey(rawKey: unknown): string {
  if (typeof rawKey !== "string") {
    throw new SessionMetaError(
      `meta keys must be strings, received ${typeof rawKey}`,
    );
  }
  const key = rawKey.trim().toLowerCase();
  if (key.length === 0 || key.length > SESSION_META_MAX_KEY_LENGTH) {
    throw new SessionMetaError(
      `meta key \`${rawKey}\` must be 1-${SESSION_META_MAX_KEY_LENGTH} characters`,
    );
  }
  if (!SESSION_META_KEY_PATTERN.test(key)) {
    throw new SessionMetaError(
      `meta key \`${rawKey}\` must start with a letter and contain only letters, digits, \`_\` or \`-\``,
    );
  }
  return key;
}

function normalizeValue(key: string, rawValue: unknown): string {
  if (typeof rawValue !== "string") {
    throw new SessionMetaError(
      `meta value for \`${key}\` must be a string, received ${typeof rawValue}`,
    );
  }
  const value = rawValue.trim();
  if (value.length > SESSION_META_MAX_VALUE_LENGTH) {
    throw new SessionMetaError(
      `meta value for \`${key}\` is ${value.length} characters; the limit is ${SESSION_META_MAX_VALUE_LENGTH}`,
    );
  }
  return value;
}

/**
 * Validate a caller-supplied map into canonical meta: lower-cased keys,
 * trimmed values, empty values dropped (an empty string means "no value",
 * never a value that happens to be blank). Rejects loudly instead of
 * silently truncating or skipping — a note that was quietly cut in half
 * would still look like a note.
 */
export function normalizeSessionMeta(input: unknown): SessionMeta {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new SessionMetaError("meta must be a JSON object of strings");
  }
  const meta: SessionMeta = {};
  for (const [rawKey, rawValue] of Object.entries(
    input as Record<string, unknown>,
  )) {
    const key = normalizeKey(rawKey);
    const value = normalizeValue(key, rawValue);
    if (value.length === 0) continue;
    meta[key] = value;
  }
  assertKeyBudget(meta);
  return meta;
}

function assertKeyBudget(meta: SessionMeta): void {
  const count = Object.keys(meta).length;
  if (count > SESSION_META_MAX_KEYS) {
    throw new SessionMetaError(
      `meta holds ${count} keys; the limit is ${SESSION_META_MAX_KEYS}`,
    );
  }
}

/** Merge a patch into current meta; `unset` wins over `set` for the same key. */
export function applySessionMetaPatch(
  current: SessionMeta,
  patch: SessionMetaPatch,
): SessionMeta {
  const next: SessionMeta = { ...current };
  const additions = normalizeSessionMeta(patch.set ?? {});
  // Keys present in `set` with an empty value were dropped by normalize;
  // they still mean "clear this key" on a patch.
  for (const rawKey of Object.keys(patch.set ?? {})) {
    const key = normalizeKey(rawKey);
    if (!(key in additions)) delete next[key];
  }
  Object.assign(next, additions);
  for (const rawKey of patch.unset ?? []) {
    delete next[normalizeKey(rawKey)];
  }
  assertKeyBudget(next);
  return next;
}

/** Parse `key=value` tokens (CLI form) into a map; `key=` clears the key. */
export function parseSessionMetaAssignments(
  tokens: readonly string[],
): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator <= 0) {
      throw new SessionMetaError(
        `expected key=value, received \`${token}\` (use key= to clear a key)`,
      );
    }
    assignments[token.slice(0, separator)] = token.slice(separator + 1);
  }
  return assignments;
}

export function parseSessionMetaEnv(raw: string | undefined): SessionMeta {
  if (raw === undefined || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SessionMetaError(`${SESSION_META_ENV} must be a JSON object`);
  }
  return normalizeSessionMeta(parsed);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Parse the launcher's provenance blob. Shape errors are reported, not
 * papered over: a session whose origin cannot be read must say so rather
 * than boot with a plausible-looking empty one.
 */
export function parseSessionOriginEnv(
  raw: string | undefined,
): SessionOrigin | null {
  if (raw === undefined || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SessionMetaError(`${SESSION_ORIGIN_ENV} must be a JSON object`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SessionMetaError(`${SESSION_ORIGIN_ENV} must be a JSON object`);
  }
  const value = parsed as Record<string, unknown>;
  const startedAt = optionalInteger(value.startedAt);
  if (startedAt === null) {
    throw new SessionMetaError(
      `${SESSION_ORIGIN_ENV} is missing an integer startedAt`,
    );
  }
  const parentChain: SessionOriginParent[] = Array.isArray(value.parentChain)
    ? value.parentChain
        .map((entry) => {
          const row = entry as Record<string, unknown>;
          const pid = optionalInteger(row?.pid);
          const command = optionalString(row?.command);
          return pid !== null && command !== null ? { pid, command } : null;
        })
        .filter((entry): entry is SessionOriginParent => entry !== null)
    : [];
  const cursorRaw =
    typeof value.cursor === "object" && value.cursor !== null
      ? (value.cursor as Record<string, unknown>)
      : null;
  return {
    startedAt,
    launcher: optionalString(value.launcher),
    command: optionalString(value.command),
    cwd: optionalString(value.cwd),
    user: optionalString(value.user),
    hostname: optionalString(value.hostname),
    terminal: optionalString(value.terminal),
    launcherPid: optionalInteger(value.launcherPid),
    parentChain,
    cursor: cursorRaw
      ? {
          isAgent: cursorRaw.isAgent === true,
          conversationId: optionalString(cursorRaw.conversationId),
          workspaceLabel: optionalString(cursorRaw.workspaceLabel),
        }
      : null,
  };
}
