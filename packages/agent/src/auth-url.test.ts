import { describe, expect, it } from "vitest";

import {
  AUTH_BODY_PREVIEW_CHARS,
  AuthResponse,
  AuthUrlError,
  signInThrough,
} from "./auth-url";
import { AUTH_FAILED_LOG_MARKER } from "./browser-lifecycle";

const AUTH_URL = "http://localhost:8081/auth/dev-login?agent=4779";

function answering(status: number, statusText: string, body: string) {
  const response: AuthResponse = {
    status: () => status,
    statusText: () => statusText,
    text: async () => body,
  };
  return { goto: async () => response };
}

async function rejection(promise: Promise<unknown>): Promise<AuthUrlError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AuthUrlError);
  return error as AuthUrlError;
}

describe("signInThrough", () => {
  it("resolves with the status of a sign-in that answered", async () => {
    await expect(
      signInThrough(answering(200, "OK", '{"success":true}'), AUTH_URL),
    ).resolves.toBe(200);
    await expect(
      signInThrough(answering(304, "Not Modified", ""), AUTH_URL),
    ).resolves.toBe(304);
  });

  it("refuses a 500, naming the url, the status and the body", async () => {
    const error = await rejection(
      signInThrough(
        answering(500, "Internal Server Error", '{"error":"Login failed"}'),
        AUTH_URL,
      ),
    );
    expect(error.status).toBe(500);
    expect(error.body).toBe('{"error":"Login failed"}');
    expect(error.message).toBe(
      `${AUTH_FAILED_LOG_MARKER} GET ${AUTH_URL} answered 500 Internal Server Error: {"error":"Login failed"}`,
    );
  });

  it("keeps the failure on one bounded line", async () => {
    const page = `<html>\n  <body>${"x".repeat(2 * AUTH_BODY_PREVIEW_CHARS)}</body>\n</html>`;
    const error = await rejection(
      signInThrough(answering(404, "", page), AUTH_URL),
    );
    expect(error.message).not.toContain("\n");
    expect(error.message).toContain(`answered 404: <html> <body>xxx`);
    expect(error.message.endsWith("…")).toBe(true);
    expect(error.body).toBe(page);
  });

  it("says so when the body was empty", async () => {
    const error = await rejection(
      signInThrough(answering(403, "Forbidden", "  "), AUTH_URL),
    );
    expect(error.message).toContain("answered 403 Forbidden: (empty body)");
  });

  it("refuses a visit that got no response, or never connected", async () => {
    const silent = await rejection(
      signInThrough({ goto: async () => null }, AUTH_URL),
    );
    expect(silent.status).toBeNull();
    expect(silent.message).toBe(
      `${AUTH_FAILED_LOG_MARKER} GET ${AUTH_URL} returned no HTTP response`,
    );

    const refused = await rejection(
      signInThrough(
        {
          goto: async () => {
            throw new Error(`net::ERR_CONNECTION_REFUSED at ${AUTH_URL}`);
          },
        },
        AUTH_URL,
      ),
    );
    expect(refused.status).toBeNull();
    expect(refused.message).toContain("failed: net::ERR_CONNECTION_REFUSED");
  });
});
