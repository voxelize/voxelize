import { AUTH_FAILED_LOG_MARKER } from "./browser-lifecycle";

/** What the sign-in check reads of a navigation response (puppeteer's `HTTPResponse`). */
export type AuthResponse = {
  status(): number;
  statusText(): string;
  text(): Promise<string>;
};

/** What the sign-in visit needs of a page (puppeteer's `Page`). */
export type AuthPage = {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded" },
  ): Promise<AuthResponse | null>;
};

/**
 * Enough of a failure body to say what went wrong: a sign-in endpoint answers
 * with a short JSON or text line, and a whole HTML error page would bury the
 * status in the session log.
 */
export const AUTH_BODY_PREVIEW_CHARS = 300;

/**
 * The session was told to sign in first and could not. Its message is the
 * one log line host tooling looks for: it starts with AUTH_FAILED_LOG_MARKER
 * and names the URL, the status and the body.
 */
export class AuthUrlError extends Error {
  readonly url: string;
  /** `null` when nothing answered: a refused connection, or no response. */
  readonly status: number | null;
  readonly body: string;

  constructor(url: string, status: number | null, outcome: string, body = "") {
    super(`${AUTH_FAILED_LOG_MARKER} GET ${url} ${outcome}`);
    this.name = "AuthUrlError";
    this.url = url;
    this.status = status;
    this.body = body;
  }
}

function previewBody(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  if (line.length === 0) return "(empty body)";
  return line.length > AUTH_BODY_PREVIEW_CHARS
    ? `${line.slice(0, AUTH_BODY_PREVIEW_CHARS)}…`
    : line;
}

// 304: the browser revalidated a sign-in it already holds, which the server
// still answers with its cookies.
function isSignedInStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 304;
}

/**
 * Visits `url` so its response can plant the session's cookies, resolving
 * with the status once it answered like a sign-in. Any other answer rejects
 * with an AuthUrlError: a navigation does not fail on an HTTP error, so the
 * status is the only sign that the sign-in was refused.
 */
export async function signInThrough(
  page: AuthPage,
  url: string,
): Promise<number> {
  let response: AuthResponse | null;
  try {
    response = await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AuthUrlError(url, null, `failed: ${reason}`);
  }
  if (response === null) {
    throw new AuthUrlError(url, null, "returned no HTTP response");
  }
  const status = response.status();
  if (isSignedInStatus(status)) return status;
  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    body = `(body unreadable: ${error instanceof Error ? error.message : String(error)})`;
  }
  const statusLine = [String(status), response.statusText()]
    .filter((part) => part.length > 0)
    .join(" ");
  throw new AuthUrlError(
    url,
    status,
    `answered ${statusLine}: ${previewBody(body)}`,
    body,
  );
}
