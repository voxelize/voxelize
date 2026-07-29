import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CAPTURE_DIR_ENV_VAR,
  LEGACY_CAPTURE_ROOT,
  captureDateStamp,
  ensureCaptureDir,
  resolveCaptureBase,
} from "./capture-dir";

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "capture-dir-test-"));
}

describe("resolveCaptureBase", () => {
  it("defaults to screenshots/dev under the working directory", () => {
    expect(resolveCaptureBase({ env: {}, cwd: "/repo" })).toBe(
      path.join("/repo", "screenshots", "dev"),
    );
  });

  it("lets the environment override the base", () => {
    expect(
      resolveCaptureBase({
        env: { [CAPTURE_DIR_ENV_VAR]: "/elsewhere/captures" },
        cwd: "/repo",
      }),
    ).toBe("/elsewhere/captures");
  });

  it("falls back past an empty environment value", () => {
    expect(
      resolveCaptureBase({ env: { [CAPTURE_DIR_ENV_VAR]: "" }, cwd: "/repo" }),
    ).toBe(path.join("/repo", "screenshots", "dev"));
  });
});

describe("captureDateStamp", () => {
  it("formats a local yyyy-mm-dd stamp", () => {
    expect(captureDateStamp(new Date(2026, 6, 28, 23, 59))).toBe("2026-07-28");
    expect(captureDateStamp(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});

describe("ensureCaptureDir", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates and returns the dated capture dir", () => {
    const cwd = scratchDir();
    const now = new Date(2026, 6, 29);
    const dir = ensureCaptureDir(["agent-frames"], { env: {}, cwd, now });
    expect(dir).toBe(
      path.join(cwd, "screenshots", "dev", "2026-07-29", "agent-frames"),
    );
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("falls back to /tmp with a warning when the base is uncreatable", () => {
    const blocker = path.join(scratchDir(), "not-a-dir");
    fs.writeFileSync(blocker, "a file where the capture base should go");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = ensureCaptureDir(["agent-frames"], {
      env: { [CAPTURE_DIR_ENV_VAR]: blocker },
      now: new Date(2026, 6, 29),
    });
    expect(dir).toBe(path.join(LEGACY_CAPTURE_ROOT, "agent-frames"));
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("falling back to");
    fs.rmSync(path.dirname(blocker), { recursive: true, force: true });
  });
});
