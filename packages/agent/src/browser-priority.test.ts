import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  describeLaunchError,
  browserPriorityExec,
  isBrowserPriorityLowered,
  lowPriorityBrowser,
} from "./browser-priority";

const scratchDirs: string[] = [];
function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-priority-test-"));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("isBrowserPriorityLowered", () => {
  it("lowers by default and honours either opt-out", () => {
    expect(isBrowserPriorityLowered({})).toBe(true);
    expect(isBrowserPriorityLowered({ AGENT_BROWSER_PRIORITY: "normal" })).toBe(
      false,
    );
    expect(isBrowserPriorityLowered({ TOWN_DEV_PRIORITY: " Normal " })).toBe(
      false,
    );
    expect(
      isBrowserPriorityLowered({
        AGENT_BROWSER_PRIORITY: "low",
        TOWN_DEV_PRIORITY: "normal",
      }),
    ).toBe(true);
  });
});

describe("browserPriorityExec", () => {
  it("clamps to utility QoS on macOS and nices on Linux", () => {
    const browser = "/Applications/Chrome Test's.app/chrome";
    expect(
      browserPriorityExec(browser, { platform: "darwin", exists: () => true }),
    ).toEqual({
      line: `exec /usr/sbin/taskpolicy -c utility '/Applications/Chrome Test'\\''s.app/chrome' "$@"`,
      tier: "qos utility",
    });
    expect(browserPriorityExec(browser, { platform: "linux" })?.tier).toBe(
      "nice 10",
    );
    expect(browserPriorityExec(browser, { platform: "win32" })).toBeNull();
    expect(
      browserPriorityExec(browser, { platform: "darwin", exists: () => false }),
    ).toBeNull();
  });
});

describe("lowPriorityBrowser", () => {
  it("returns null when switched off, without writing anything", () => {
    const dir = scratchDir();
    expect(
      lowPriorityBrowser("/bin/echo", {
        env: { AGENT_BROWSER_PRIORITY: "normal" },
        wrapperDir: dir,
      }),
    ).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it.runIf(process.platform === "darwin" || process.platform === "linux")(
    "writes an executable wrapper that runs the program with its arguments",
    () => {
      const dir = scratchDir();
      const priority = lowPriorityBrowser("/bin/echo", {
        env: {},
        wrapperDir: dir,
      });
      if (!priority) throw new Error("expected a low-priority wrapper");
      const stat = fs.statSync(priority.executablePath);
      expect(stat.mode & 0o111).not.toBe(0);
      const run = spawnSync(priority.executablePath, ["hello", "a b"], {
        encoding: "utf8",
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toBe("hello a b\n");
      // Rewriting the same wrapper is a no-op, not a new file.
      expect(
        lowPriorityBrowser("/bin/echo", { env: {}, wrapperDir: dir }),
      ).toEqual(priority);
      expect(fs.readdirSync(dir)).toHaveLength(1);
    },
  );

  it.runIf(process.platform === "darwin")(
    "execs the program in place at utility QoS on macOS",
    () => {
      const dir = scratchDir();
      const priority = lowPriorityBrowser("/bin/sh", {
        env: {},
        wrapperDir: dir,
      });
      // The wrapped shell reports its own pid and scheduling priority: the
      // pid must be the one spawnSync started (exec in place, no parent
      // left behind) and the priority the utility band (20, default is 31).
      if (!priority) throw new Error("expected a low-priority wrapper");
      const run = spawnSync(
        priority.executablePath,
        ["-c", 'echo "$$ $(ps -o pri= -p $$)"'],
        { encoding: "utf8" },
      );
      expect(run.status).toBe(0);
      const [pid, pri] = run.stdout.trim().split(/\s+/).map(Number);
      expect(pid).toBe(run.pid);
      expect(pri).toBe(20);
    },
  );
});

describe("describeLaunchError", () => {
  it("keeps an Error's first line and code", () => {
    const error = Object.assign(new Error("spawn EACCES\nstack"), {
      code: "EACCES",
    });
    expect(describeLaunchError(error)).toBe("spawn EACCES (code EACCES)");
  });

  it("reads a plain object instead of printing [object Object]", () => {
    expect(describeLaunchError({ message: "socket hang up", code: 1 })).toBe(
      "socket hang up (code 1)",
    );
    expect(describeLaunchError({ type: "error", target: "ws" })).toBe(
      '{"type":"error","target":"ws"}',
    );
  });

  it("survives an object that cannot be serialized", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(describeLaunchError(loop)).toBe("unserializable Object");
  });
});
