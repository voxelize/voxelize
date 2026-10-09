/**
 * Whether the client page a launch opens can ever mount, judged from the
 * navigation itself instead of by waiting for a bridge it will never install.
 *
 * The daemon gives a page minutes to install its bridge, because a loaded
 * box can take that long to join a world. A document that came back 404 will
 * not install it however long the wait, and the session would hold its
 * browser (and its host's session slot) until the mount deadline ended it.
 * So the page's navigation is judged as it lands (the auth url before it has
 * its own check, auth-url.ts):
 *
 * - 2xx/3xx, or no response at all (a same-document navigation): loaded.
 * - 4xx other than 408/425/429: permanent. Nothing is served there, so it
 *   gives up at once, naming the url and the status.
 * - 5xx, 408/425/429, a refused, reset or empty connection, a navigation
 *   timeout: transient, the way a dev server compiling or restarting and a
 *   proxy mid-deploy answer. It navigates again with backoff until the retry
 *   budget (AGENT_NAVIGATION_RETRY_MS, default 60s, 0 = never retry) runs
 *   out, then gives up the same way.
 * - Any other load failure (a host that does not resolve, a bad
 *   certificate, an aborted navigation): permanent.
 *
 * Giving up throws PageUnavailableError, whose message is one log line
 * (formatPageUnavailable) a launcher can read back with
 * parsePageUnavailableLine.
 */

/** One navigation's answer: its document status, or null for no response. */
export type PageLoad = { status: number; statusText: string } | null;

export type PageUnavailable = {
  url: string;
  /** The last document status, or null when the load itself failed. */
  status: number | null;
  statusText: string;
  /** The last load failure (`net::ERR_…`, a timeout) when there was no status. */
  error: string | null;
  attempts: number;
  elapsedMs: number;
  /** The last failure could pass on its own; the retry budget ran out. */
  isTransient: boolean;
};

export type PageUnavailableLine = {
  url: string;
  status: number | null;
  outcome: string;
  advice: string;
};

export class PageUnavailableError extends Error {
  constructor(public readonly report: PageUnavailable) {
    super(formatPageUnavailable(report));
    this.name = "PageUnavailableError";
  }
}

export const DEFAULT_NAVIGATION_RETRY_MS = 60_000;
const FIRST_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 8_000;
const TRANSIENT_CLIENT_STATUSES = new Set([408, 425, 429]);
const TRANSIENT_LOAD_ERRORS = [
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_CONNECTION_CLOSED",
  "net::ERR_CONNECTION_ABORTED",
  "net::ERR_CONNECTION_TIMED_OUT",
  "net::ERR_EMPTY_RESPONSE",
  "net::ERR_TIMED_OUT",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_ADDRESS_UNREACHABLE",
];
const LINE_PATTERN = /page unavailable: (\S+) (.+?) — (.+)$/;
const STATUS_PATTERN = /^(?:answered|kept answering) (\d{3})\b/;

export function resolveNavigationRetryMs(
  env: Record<string, string | undefined>,
): number {
  const raw = env.AGENT_NAVIGATION_RETRY_MS;
  if (raw === undefined || raw === "") return DEFAULT_NAVIGATION_RETRY_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `AGENT_NAVIGATION_RETRY_MS must be a non-negative number of milliseconds (0 never retries), received \`${raw}\``,
    );
  }
  return value;
}

export function classifyDocumentStatus(
  status: number,
): "loaded" | "transient" | "permanent" {
  if (status < 400) return "loaded";
  if (status >= 500 || TRANSIENT_CLIENT_STATUSES.has(status)) {
    return "transient";
  }
  return "permanent";
}

export function describeLoadError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0].trim();
}

export function isTransientLoadError(error: unknown): boolean {
  // Puppeteer's navigation timeout: a dev server compiling a route on its
  // first request holds the response past the load's own deadline.
  if (error instanceof Error && error.name === "TimeoutError") return true;
  const message = describeLoadError(error);
  return TRANSIENT_LOAD_ERRORS.some((code) => message.includes(code));
}

/** Backoff before attempt `attempt + 1`: 1s, 2s, 4s, then 8s apart. */
export function retryDelayMs(attempt: number): number {
  return Math.min(
    MAX_RETRY_DELAY_MS,
    FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1),
  );
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}

function describeAnswer(report: PageUnavailable): string {
  const answer =
    report.status === null
      ? null
      : `${report.status}${report.statusText ? ` ${report.statusText}` : ""}`;
  const isRetried = report.isTransient && report.attempts > 1;
  const span = `for ${formatSeconds(report.elapsedMs)} (${report.attempts} attempts)`;
  const onAttempt = report.attempts > 1 ? ` on attempt ${report.attempts}` : "";
  if (answer !== null) {
    return isRetried
      ? `kept answering ${answer} ${span}`
      : `answered ${answer}${onAttempt}`;
  }
  return isRetried
    ? `kept failing to load ${span}: ${report.error}`
    : `failed to load${onAttempt}: ${report.error}`;
}

function adviceFor(report: PageUnavailable): string {
  const { status } = report;
  if (status === null) {
    return report.isTransient
      ? "nothing answered there; is the client running?"
      : "check the client url";
  }
  if (status === 404 || status === 410) {
    return "the client serves no page there; check the world name, or pass a --url that names the page";
  }
  if (status === 401 || status === 403) {
    return "the client refused the page; sign in first (--authUrl) or check who may open it";
  }
  if (status >= 500) {
    return "the client kept failing to render the page; read its server log";
  }
  return report.isTransient
    ? "the client kept turning the request away"
    : "the client rejected the request";
}

/** The one log line a give-up prints; parsePageUnavailableLine reads it back. */
export function formatPageUnavailable(report: PageUnavailable): string {
  return `page unavailable: ${report.url} ${describeAnswer(report)} — ${adviceFor(report)}`;
}

export function parsePageUnavailableLine(
  line: string,
): PageUnavailableLine | null {
  const match = line.match(LINE_PATTERN);
  if (!match) return null;
  const status = match[2].match(STATUS_PATTERN);
  return {
    url: match[1],
    status: status ? Number(status[1]) : null,
    outcome: match[2],
    advice: match[3],
  };
}

/** The last give-up line in a stretch of log, if there is one. */
export function findPageUnavailableLine(
  text: string,
): PageUnavailableLine | null {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const found = parsePageUnavailableLine(lines[index]);
    if (found) return found;
  }
  return null;
}

/**
 * Run `load` (one navigation) until it lands, retrying transient failures
 * within `retryMs`, and throw PageUnavailableError once it cannot.
 */
export async function openPage(
  load: () => Promise<PageLoad>,
  options: {
    url: string;
    retryMs: number;
    log?: (line: string) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<PageLoad> {
  const {
    url,
    retryMs,
    log = console.log,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;
  const startedAt = now();
  for (let attempt = 1; ; attempt++) {
    let report: PageUnavailable;
    try {
      const loaded = await load();
      if (
        loaded === null ||
        classifyDocumentStatus(loaded.status) === "loaded"
      ) {
        if (attempt > 1) {
          log(
            `[voxelize-agent] ${url} loaded on attempt ${attempt}, ${formatSeconds(now() - startedAt)} after the first`,
          );
        }
        return loaded;
      }
      report = {
        url,
        status: loaded.status,
        statusText: loaded.statusText,
        error: null,
        attempts: attempt,
        elapsedMs: now() - startedAt,
        isTransient: classifyDocumentStatus(loaded.status) === "transient",
      };
    } catch (error) {
      report = {
        url,
        status: null,
        statusText: "",
        error: describeLoadError(error),
        attempts: attempt,
        elapsedMs: now() - startedAt,
        isTransient: isTransientLoadError(error),
      };
    }
    const delayMs = retryDelayMs(attempt);
    if (!report.isTransient || report.elapsedMs + delayMs > retryMs) {
      throw new PageUnavailableError(report);
    }
    const answer =
      report.status === null
        ? `failed to load (${report.error})`
        : `answered ${report.status}${report.statusText ? ` ${report.statusText}` : ""}`;
    log(
      `[voxelize-agent] ${url} ${answer} on attempt ${attempt}; retrying in ${formatSeconds(delayMs)} ` +
        `(a dev server compiling or restarting answers like this for a moment; gives up after ${formatSeconds(retryMs)})`,
    );
    await sleep(delayMs);
  }
}
