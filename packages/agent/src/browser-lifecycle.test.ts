import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_BROWSER_FLAG,
  DEFAULT_IDLE_TTL_MS,
  IDLE_TTL_EXIT_CODE,
  agentBrowserFlag,
  agentBrowserPattern,
  isAgentBrowserCommand,
  killOwnAgentBrowserSync,
  reapStaleAgentBrowser,
  resolveIdleTtlMs,
  spawnBrowserWatchdog,
  watchdogLogFile,
} from "./browser-lifecycle";

// Command lines as `ps -ww -o command=` prints them.
const SYSTEM_CHROME = `/usr/bin/google-chrome-stable ${agentBrowserFlag(4100)} --no-sandbox --headless=new --user-data-dir=/home/me/.cache/voxelize-agent/profiles/port-4100 about:blank`;
const CHROME_FOR_TESTING = `/home/me/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome ${agentBrowserFlag(4101)} --headless=new about:blank`;
const LEGACY_PROFILE =
  "/opt/google/chrome/chrome --headless=new --user-data-dir=/home/me/.cache/voxelize-agent/profiles/port-4102 about:blank";
const PERSONAL_CHROME =
  "/opt/google/chrome/chrome --user-data-dir=/home/me/.config/google-chrome --restore-last-session";

describe("an agent browser's identity", () => {
  it("is the agent's own mark, whichever Chrome runs", () => {
    expect(agentBrowserFlag(4100)).toBe(`${AGENT_BROWSER_FLAG}=4100`);
    expect(isAgentBrowserCommand(SYSTEM_CHROME, 4100)).toBe(true);
    expect(isAgentBrowserCommand(CHROME_FOR_TESTING, 4101)).toBe(true);
    expect(isAgentBrowserCommand(SYSTEM_CHROME)).toBe(true);
  });

  it("knows a browser launched before the mark by its persistent profile", () => {
    expect(isAgentBrowserCommand(LEGACY_PROFILE, 4102)).toBe(true);
    expect(isAgentBrowserCommand(LEGACY_PROFILE)).toBe(true);
  });

  it("is one port's browser only, and never someone's own Chrome", () => {
    expect(isAgentBrowserCommand(SYSTEM_CHROME, 410)).toBe(false);
    expect(isAgentBrowserCommand(SYSTEM_CHROME, 41001)).toBe(false);
    expect(isAgentBrowserCommand(CHROME_FOR_TESTING, 4100)).toBe(false);
    expect(isAgentBrowserCommand(PERSONAL_CHROME)).toBe(false);
    expect(isAgentBrowserCommand(null)).toBe(false);
  });

  it("is a pattern grep -E reads the way JavaScript does", () => {
    const fixtures = [
      SYSTEM_CHROME,
      CHROME_FOR_TESTING,
      LEGACY_PROFILE,
      PERSONAL_CHROME,
    ];
    const grep = spawn("grep", ["-E", "--", agentBrowserPattern(4100)]);
    const matched = new Promise<string>((resolve) => {
      let out = "";
      grep.stdout.on("data", (chunk) => (out += chunk));
      grep.on("close", () => resolve(out));
    });
    grep.stdin.end(`${fixtures.join("\n")}\n`);
    return matched.then((out) => {
      expect(out.trim().split("\n")).toEqual(
        fixtures.filter((command) => isAgentBrowserCommand(command, 4100)),
      );
    });
  });
});

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});

/** A process whose `ps` command line ends in `argv`, as a stand-in. */
function standIn(argv: string[], { detached = false } = {}): ChildProcess {
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1 << 30)", "--", ...argv],
    { detached, stdio: "ignore" },
  );
  children.push(child);
  return child;
}

function pidOf(child: ChildProcess): number {
  if (child.pid === undefined) throw new Error("the stand-in never started");
  return child.pid;
}

/** A stand-in daemon that launches a marked browser itself, as its parent. */
async function daemonWithBrowser(port: number, daemonArgv: string[] = []) {
  const daemon = spawn(
    process.execPath,
    [
      "-e",
      `const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)", "--", "${agentBrowserFlag(port)}"], { stdio: "ignore" }); console.log(c.pid); setInterval(() => {}, 1 << 30);`,
      ...daemonArgv,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  children.push(daemon);
  const { stdout } = daemon;
  if (stdout === null) throw new Error("the stand-in daemon has no stdout");
  const browserPid = await new Promise<number>((resolve) =>
    stdout.once("data", (chunk) => resolve(Number(String(chunk).trim()))),
  );
  expect(
    await waitFor(
      () => commandOf(browserPid).includes(agentBrowserFlag(port)),
      5_000,
    ),
  ).toBe(true);
  return { daemon, browserPid };
}

function commandOf(pid: number): string {
  const ps = spawnSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
    encoding: "utf8",
  });
  return ps.stdout.trim();
}

/**
 * Until a fresh child has exec'd, `ps` shows its parent's command line:
 * the watchdog would take the stand-in daemon for dead on its first poll.
 */
async function waitForCommand(child: ChildProcess, text: string) {
  expect(
    await waitFor(() => commandOf(pidOf(child)).includes(text), 5_000),
  ).toBe(true);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
}

describe("the browser watchdog", () => {
  // It polls every 2s: a kill lands within two polls of the daemon's death.
  const POLL_MS = 2_000;
  const KILL_DEADLINE_MS = 8_000;

  /** A stand-in daemon and browser, both exec'd, with a watchdog on them. */
  async function guarded(port: number, browserArgv: string[]) {
    rmSync(watchdogLogFile(port), { force: true });
    const daemon = standIn(["voxelize-agent-stand-in"]);
    const browser = standIn(browserArgv, { detached: true });
    await waitForCommand(daemon, "voxelize-agent-stand-in");
    await waitForCommand(browser, browserArgv[0]);
    spawnBrowserWatchdog({
      daemonPid: pidOf(daemon),
      browserPid: browser.pid,
      port,
    });
    expect(await waitFor(() => existsSync(watchdogLogFile(port)), 3_000)).toBe(
      true,
    );
    return { daemon, browser };
  }

  it("kills the daemon's marked browser once the daemon dies, and says why", async () => {
    const port = 47_121;
    const { daemon, browser } = await guarded(port, [agentBrowserFlag(port)]);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS + 500));
    expect(
      isAlive(pidOf(browser)),
      "the browser of a live daemon is never shot",
    ).toBe(true);
    daemon.kill("SIGKILL");
    expect(
      await waitFor(() => !isAlive(pidOf(browser)), KILL_DEADLINE_MS),
    ).toBe(true);
    expect(readFileSync(watchdogLogFile(port), "utf8")).toMatch(
      new RegExp(
        `died with browser pid=${browser.pid} still alive \\(it carries port ${port}'s agent mark\\); killing orphaned browser group\\n.*killed orphaned browser pid=${browser.pid} \\(daemon port=${port}\\)`,
      ),
    );
  }, 20_000);

  it("leaves a pid that no longer carries the port's mark", async () => {
    const port = 47_122;
    const { daemon, browser: stranger } = await guarded(port, [
      agentBrowserFlag(port + 1),
    ]);
    daemon.kill("SIGKILL");
    expect(
      await waitFor(
        () =>
          readFileSync(watchdogLogFile(port), "utf8").includes(
            "nothing to kill",
          ),
        KILL_DEADLINE_MS,
      ),
    ).toBe(true);
    expect(isAlive(pidOf(stranger))).toBe(true);
  }, 15_000);
});

describe("the stale browser a new daemon finds", () => {
  const pidFile = path.join(
    os.tmpdir(),
    `voxelize-agent-reap-test-${process.pid}.pid`,
  );
  afterEach(() => rmSync(pidFile, { force: true }));

  it("is killed when no daemon owns it", async () => {
    const port = 47_131;
    const orphan = standIn([agentBrowserFlag(port)], { detached: true });
    await waitForCommand(orphan, agentBrowserFlag(port));
    writeFileSync(pidFile, String(orphan.pid));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    reapStaleAgentBrowser(pidFile, port);
    expect(await waitFor(() => !isAlive(pidOf(orphan)), 3_000)).toBe(true);
    expect(log.mock.calls.flat().join("\n")).toMatch(
      new RegExp(
        `reaped stale browser pid=${orphan.pid}: port ${port}'s agent browser`,
      ),
    );
    log.mockRestore();
  });

  it("is left alone while its daemon lives, and when its pid runs something else", async () => {
    const port = 47_132;
    const { daemon, browserPid } = await daemonWithBrowser(port, [
      "voxelize-agent-stand-in",
    ]);
    await waitForCommand(daemon, "voxelize-agent-stand-in");
    writeFileSync(pidFile, String(browserPid));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    reapStaleAgentBrowser(pidFile, port);
    expect(isAlive(browserPid)).toBe(true);
    expect(log.mock.calls.flat().join("\n")).toMatch(
      new RegExp(
        `left browser pid=${browserPid} alone: .*its daemon pid=${daemon.pid} is alive`,
      ),
    );
    log.mockRestore();
    const stranger = standIn(["--some-other-tool"]);
    await waitForCommand(stranger, "--some-other-tool");
    writeFileSync(pidFile, String(stranger.pid));
    reapStaleAgentBrowser(pidFile, port);
    expect(isAlive(pidOf(stranger))).toBe(true);
    process.kill(browserPid, "SIGKILL");
  });
});

describe("the browser a daemon stopped while booting kills itself", () => {
  const pidFile = path.join(
    os.tmpdir(),
    `voxelize-agent-own-test-${process.pid}.pid`,
  );
  afterEach(() => rmSync(pidFile, { force: true }));

  it("is the one this process launched and recorded, killed and forgotten", async () => {
    const port = 47_141;
    const browser = standIn([agentBrowserFlag(port)], { detached: true });
    await waitForCommand(browser, agentBrowserFlag(port));
    writeFileSync(pidFile, String(browser.pid));
    expect(killOwnAgentBrowserSync(pidFile, port)).toBe(browser.pid);
    expect(await waitFor(() => browser.signalCode === "SIGKILL", 3_000)).toBe(
      true,
    );
    expect(existsSync(pidFile)).toBe(false);
  });

  it("is never another process's browser, another port's, or one not recorded yet", async () => {
    const port = 47_142;
    expect(killOwnAgentBrowserSync(pidFile, port)).toBe(null);
    const otherPort = standIn([agentBrowserFlag(port + 1)], { detached: true });
    await waitForCommand(otherPort, agentBrowserFlag(port + 1));
    writeFileSync(pidFile, String(otherPort.pid));
    expect(killOwnAgentBrowserSync(pidFile, port)).toBe(null);
    expect(isAlive(pidOf(otherPort))).toBe(true);
    // A browser some other daemon launched: its parent is not this process.
    const { browserPid: theirs } = await daemonWithBrowser(port);
    writeFileSync(pidFile, String(theirs));
    expect(killOwnAgentBrowserSync(pidFile, port)).toBe(null);
    expect(isAlive(theirs)).toBe(true);
    process.kill(theirs, "SIGKILL");
  });
});

describe("resolveIdleTtlMs", () => {
  it("defaults to a bounded, nonzero ttl", () => {
    expect(resolveIdleTtlMs(undefined, {})).toBe(DEFAULT_IDLE_TTL_MS);
    expect(DEFAULT_IDLE_TTL_MS).toBe(30 * 60_000);
  });

  it("lets the flag beat the environment", () => {
    expect(resolveIdleTtlMs("5000", { AGENT_IDLE_TTL_MS: "9000" })).toBe(5000);
    expect(resolveIdleTtlMs(undefined, { AGENT_IDLE_TTL_MS: "9000" })).toBe(
      9000,
    );
  });

  it("treats zero as the deliberate long-lived escape hatch", () => {
    expect(resolveIdleTtlMs("0", {})).toBe(0);
    expect(resolveIdleTtlMs(undefined, { AGENT_IDLE_TTL_MS: "0" })).toBe(0);
  });

  it("falls back past an empty environment value", () => {
    expect(resolveIdleTtlMs(undefined, { AGENT_IDLE_TTL_MS: "" })).toBe(
      DEFAULT_IDLE_TTL_MS,
    );
  });

  it("rejects explicit invalid values instead of defaulting past them", () => {
    expect(() => resolveIdleTtlMs("soon", {})).toThrow(/--idle-ttl-ms/);
    expect(() => resolveIdleTtlMs("-1", {})).toThrow(/--idle-ttl-ms/);
    expect(() => resolveIdleTtlMs("1.5", {})).toThrow(/--idle-ttl-ms/);
    expect(() =>
      resolveIdleTtlMs(undefined, { AGENT_IDLE_TTL_MS: "later" }),
    ).toThrow(/AGENT_IDLE_TTL_MS/);
  });

  it("pins the idle exit code the pm2 session wiring depends on", () => {
    // A host's reaper mirrors this value for its supervisor's stop-exit-codes,
    // and its session smoke asserts the end-to-end behavior.
    expect(IDLE_TTL_EXIT_CODE).toBe(66);
  });
});
