import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAVIGATION_RETRY_MS,
  PageLoad,
  PageUnavailableError,
  classifyDocumentStatus,
  findPageUnavailableLine,
  formatPageUnavailable,
  isTransientLoadError,
  openPage,
  parsePageUnavailableLine,
  resolveNavigationRetryMs,
  retryDelayMs,
} from "./page-availability";

const URL = "http://localhost:3000/missing?agent=true&agentName=agent";

class FakeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/** A scripted page: each attempt answers the next entry; time only moves in sleeps. */
function scripted(answers: (PageLoad | Error)[]) {
  let clock = 0;
  const calls: number[] = [];
  const lines: string[] = [];
  const load = async (): Promise<PageLoad> => {
    calls.push(clock);
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return {
    load,
    calls,
    lines,
    options: {
      url: URL,
      log: (line: string) => lines.push(line),
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
    },
  };
}

async function giveUp(
  promise: Promise<unknown>,
): Promise<PageUnavailableError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PageUnavailableError) return error;
    throw error;
  }
  throw new Error("the page loaded");
}

describe("classifyDocumentStatus", () => {
  it("loads 2xx and 3xx, retries 5xx and 408/425/429, gives up on other 4xx", () => {
    expect(classifyDocumentStatus(200)).toBe("loaded");
    expect(classifyDocumentStatus(304)).toBe("loaded");
    for (const status of [500, 502, 503, 504, 408, 425, 429]) {
      expect(classifyDocumentStatus(status)).toBe("transient");
    }
    for (const status of [400, 401, 403, 404, 410, 451]) {
      expect(classifyDocumentStatus(status)).toBe("permanent");
    }
  });
});

describe("isTransientLoadError", () => {
  it("retries a refused or reset connection and a navigation timeout", () => {
    expect(
      isTransientLoadError(
        new Error("net::ERR_CONNECTION_REFUSED at http://localhost:3000/x"),
      ),
    ).toBe(true);
    expect(
      isTransientLoadError(new Error("net::ERR_EMPTY_RESPONSE at http://x")),
    ).toBe(true);
    expect(
      isTransientLoadError(
        new FakeTimeoutError("Navigation timeout of 30000 ms exceeded"),
      ),
    ).toBe(true);
  });

  it("does not retry what waiting cannot fix", () => {
    expect(
      isTransientLoadError(
        new Error("net::ERR_NAME_NOT_RESOLVED at http://localhst:3000/x"),
      ),
    ).toBe(false);
    expect(
      isTransientLoadError(new Error("net::ERR_ABORTED at http://x")),
    ).toBe(false);
    expect(
      isTransientLoadError(new Error("Navigating frame was detached")),
    ).toBe(false);
  });
});

describe("resolveNavigationRetryMs", () => {
  it("defaults to a minute and takes an explicit budget, 0 included", () => {
    expect(resolveNavigationRetryMs({})).toBe(DEFAULT_NAVIGATION_RETRY_MS);
    expect(DEFAULT_NAVIGATION_RETRY_MS).toBe(60_000);
    expect(
      resolveNavigationRetryMs({ AGENT_NAVIGATION_RETRY_MS: "5000" }),
    ).toBe(5000);
    expect(resolveNavigationRetryMs({ AGENT_NAVIGATION_RETRY_MS: "0" })).toBe(
      0,
    );
  });

  it("refuses a value it cannot read instead of defaulting past it", () => {
    expect(() =>
      resolveNavigationRetryMs({ AGENT_NAVIGATION_RETRY_MS: "soon" }),
    ).toThrow(/AGENT_NAVIGATION_RETRY_MS/);
    expect(() =>
      resolveNavigationRetryMs({ AGENT_NAVIGATION_RETRY_MS: "-1" }),
    ).toThrow(/AGENT_NAVIGATION_RETRY_MS/);
  });
});

describe("openPage", () => {
  it("returns the first load that lands, without a word", async () => {
    const page = scripted([{ status: 200, statusText: "OK" }]);
    await expect(
      openPage(page.load, { ...page.options, retryMs: 60_000 }),
    ).resolves.toEqual({ status: 200, statusText: "OK" });
    expect(page.calls).toEqual([0]);
    expect(page.lines).toEqual([]);
  });

  it("treats a navigation with no response as loaded", async () => {
    const page = scripted([null]);
    await expect(
      openPage(page.load, { ...page.options, retryMs: 60_000 }),
    ).resolves.toBeNull();
  });

  it("gives up on a 404 at once: one attempt, no retry, no wait", async () => {
    const page = scripted([{ status: 404, statusText: "Not Found" }]);
    const error = await giveUp(
      openPage(page.load, { ...page.options, retryMs: 60_000 }),
    );
    expect(page.calls).toEqual([0]);
    expect(error.report).toMatchObject({
      url: URL,
      status: 404,
      attempts: 1,
      elapsedMs: 0,
      isTransient: false,
    });
    expect(error.message).toBe(
      `page unavailable: ${URL} answered 404 Not Found — the client serves no page there; check the world name, or pass a --url that names the page`,
    );
  });

  it("rides out a dev server compiling: 503, refused, then 200", async () => {
    const page = scripted([
      { status: 503, statusText: "Service Unavailable" },
      new Error(`net::ERR_CONNECTION_REFUSED at ${URL}`),
      { status: 200, statusText: "OK" },
    ]);
    await expect(
      openPage(page.load, { ...page.options, retryMs: 60_000 }),
    ).resolves.toEqual({ status: 200, statusText: "OK" });
    expect(page.calls).toEqual([0, 1_000, 3_000]);
    expect(page.lines).toHaveLength(3);
    expect(page.lines[0]).toContain(
      "answered 503 Service Unavailable on attempt 1; retrying in 1s",
    );
    expect(page.lines[1]).toContain(
      "failed to load (net::ERR_CONNECTION_REFUSED",
    );
    expect(page.lines[2]).toContain("loaded on attempt 3, 3s after the first");
  });

  it("gives up on a page that keeps failing once the budget runs out", async () => {
    const page = scripted([{ status: 502, statusText: "Bad Gateway" }]);
    const error = await giveUp(
      openPage(page.load, { ...page.options, retryMs: 20_000 }),
    );
    // 1 + 2 + 4 + 8 = 15s of waits; the next 8s wait would pass 20s.
    expect(page.calls).toEqual([0, 1_000, 3_000, 7_000, 15_000]);
    expect(error.report).toMatchObject({
      status: 502,
      attempts: 5,
      elapsedMs: 15_000,
      isTransient: true,
    });
    expect(error.message).toBe(
      `page unavailable: ${URL} kept answering 502 Bad Gateway for 15s (5 attempts) — the client kept failing to render the page; read its server log`,
    );
  });

  it("stops at a permanent answer that follows transient ones", async () => {
    const page = scripted([
      { status: 503, statusText: "Service Unavailable" },
      { status: 404, statusText: "Not Found" },
    ]);
    const error = await giveUp(
      openPage(page.load, { ...page.options, retryMs: 60_000 }),
    );
    expect(page.calls).toEqual([0, 1_000]);
    expect(error.message).toContain("answered 404 Not Found on attempt 2");
  });

  it("never retries with a zero budget", async () => {
    const page = scripted([{ status: 503, statusText: "Service Unavailable" }]);
    const error = await giveUp(
      openPage(page.load, { ...page.options, retryMs: 0 }),
    );
    expect(page.calls).toEqual([0]);
    expect(error.message).toContain("answered 503 Service Unavailable —");
  });

  it("gives up on an unresolvable host at once, and on a dead client after the budget", async () => {
    const typo = scripted([
      new Error("net::ERR_NAME_NOT_RESOLVED at http://localhst:3000/x"),
    ]);
    const typoError = await giveUp(
      openPage(typo.load, { ...typo.options, retryMs: 60_000 }),
    );
    expect(typo.calls).toEqual([0]);
    expect(typoError.message).toContain(
      "failed to load: net::ERR_NAME_NOT_RESOLVED at http://localhst:3000/x — check the client url",
    );

    const down = scripted([
      new FakeTimeoutError("Navigation timeout of 30000 ms exceeded"),
    ]);
    const downError = await giveUp(
      openPage(down.load, { ...down.options, retryMs: 4_000 }),
    );
    expect(down.calls).toEqual([0, 1_000, 3_000]);
    expect(downError.message).toContain(
      "kept failing to load for 3s (3 attempts): Navigation timeout of 30000 ms exceeded — nothing answered there; is the client running?",
    );
  });

  it("points a refused page at signing in first", async () => {
    const page = scripted([{ status: 403, statusText: "Forbidden" }]);
    const error = await giveUp(
      openPage(page.load, { ...page.options, retryMs: 60_000 }),
    );
    expect(error.message).toBe(
      `page unavailable: ${URL} answered 403 Forbidden — the client refused the page; sign in first (--authUrl) or check who may open it`,
    );
  });
});

describe("retryDelayMs", () => {
  it("backs off 1s, 2s, 4s, then holds at 8s", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
  });
});

describe("the give-up line", () => {
  it("reads back what formatPageUnavailable wrote, status included", () => {
    const line = `[voxelize-agent] ${formatPageUnavailable({
      url: URL,
      status: 404,
      statusText: "Not Found",
      error: null,
      attempts: 1,
      elapsedMs: 40,
      isTransient: false,
    })}`;
    expect(parsePageUnavailableLine(line)).toEqual({
      url: URL,
      status: 404,
      outcome: "answered 404 Not Found",
      advice:
        "the client serves no page there; check the world name, or pass a --url that names the page",
    });
  });

  it("reads a retried status and a load failure", () => {
    const retried = parsePageUnavailableLine(
      formatPageUnavailable({
        url: URL,
        status: 503,
        statusText: "",
        error: null,
        attempts: 7,
        elapsedMs: 61_000,
        isTransient: true,
      }),
    );
    expect(retried?.status).toBe(503);
    expect(retried?.outcome).toBe("kept answering 503 for 61s (7 attempts)");

    const failed = parsePageUnavailableLine(
      formatPageUnavailable({
        url: URL,
        status: null,
        statusText: "",
        error: `net::ERR_CONNECTION_REFUSED at ${URL}`,
        attempts: 1,
        elapsedMs: 0,
        isTransient: true,
      }),
    );
    expect(failed).toEqual({
      url: URL,
      status: null,
      outcome: `failed to load: net::ERR_CONNECTION_REFUSED at ${URL}`,
      advice: "nothing answered there; is the client running?",
    });
  });

  it("finds the last give-up in a stretch of log and nothing in a clean one", () => {
    const log = [
      "[voxelize-agent] launching agent world=missing",
      `[agent-page] error: Failed to load resource: the server responded with a status of 404 (Not Found)`,
      `[voxelize-agent] page unavailable: ${URL} answered 404 Not Found — the client serves no page there; check the world name, or pass a --url that names the page`,
      "[voxelize-agent] closing browser",
    ].join("\n");
    expect(findPageUnavailableLine(log)?.url).toBe(URL);
    expect(
      findPageUnavailableLine("[voxelize-agent] agent ready\nnothing here"),
    ).toBeNull();
  });
});
