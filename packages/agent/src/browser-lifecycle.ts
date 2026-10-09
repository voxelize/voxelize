import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The switch every agent browser is launched with, naming its daemon's
 * port. Identity is the agent's own mark, never the Chrome build: a system
 * Chrome launched through PUPPETEER_EXECUTABLE_PATH matched none of the
 * old "Chrome for Testing" markers, so the watchdog called it "not an agent
 * browser" and left it running after its daemon died, and host reapers did
 * not see it at all. Chromium ignores a switch it does not know.
 */
export const AGENT_BROWSER_FLAG = "--voxelize-agent-port";

export function agentBrowserFlag(port: number): string {
  return `${AGENT_BROWSER_FLAG}=${port}`;
}

/**
 * The one test of whether a command line belongs to an agent browser (that
 * port's, when `port` is given), as an extended regular expression that
 * JavaScript and the watchdog's `grep -E` read alike: the agent's flag, or
 * the persistent profile (`--user-data-dir=…/profiles/port-N`, see
 * agentProfileDir) of a browser launched before the flag existed. A host
 * reaper must use the same test: mirror this pattern and assert the two
 * agree, as with the exit codes.
 */
export function agentBrowserPattern(port?: number): string {
  const portPattern = port === undefined ? "[0-9]+" : String(port);
  return [
    `(^| )${AGENT_BROWSER_FLAG}=${portPattern}( |$)`,
    `(^| )--user-data-dir=[^ ]*/profiles/port-${portPattern}( |$)`,
  ].join("|");
}

export function isAgentBrowserCommand(
  command: string | null | undefined,
  port?: number,
): boolean {
  return (
    typeof command === "string" &&
    new RegExp(agentBrowserPattern(port)).test(command)
  );
}

/**
 * Exit code the daemon uses when it shuts itself down because its idle TTL
 * expired. PM2 sessions are started with `--stop-exit-codes` set to this value
 * so the app lands in "stopped" (a visible tombstone) instead of being
 * restarted into a fresh idle browser. A host repo's reaper tooling that
 * inspects exit codes must mirror this value (import it from the `lifecycle`
 * entry rather than restating it); a session-port smoke on the host side
 * should assert the two agree end to end.
 */
export const IDLE_TTL_EXIT_CODE = 66;

/**
 * Exit code of a daemon whose page never mounted (see
 * DEFAULT_MOUNT_TIMEOUT_MS): a session with no page holds a browser and
 * gives nothing back, so it ends itself and says why. Host tooling mirrors
 * this value the same way as IDLE_TTL_EXIT_CODE.
 */
export const MOUNT_FAILED_EXIT_CODE = 67;

/**
 * Exit code of a daemon told to sign in first (`--authUrl`) whose sign-in
 * failed: the URL answered anything but 2xx (or 304), or nothing at all.
 * Joining anyway would hand back a session that looks healthy without the
 * account it was started for, so the daemon stops before its page loads and
 * logs one line, starting with AUTH_FAILED_LOG_MARKER, that names the status
 * and the body. Host tooling mirrors both values.
 */
export const AUTH_FAILED_EXIT_CODE = 68;
export const AUTH_FAILED_LOG_MARKER = "auth url failed:";

/**
 * Exit code of a daemon whose client page cannot load (page-availability.ts:
 * a 404, or a 5xx that outlasted the retry budget). Unlike a page that never
 * mounted, waiting or relaunching cannot fix it, so a launcher must not
 * re-queue it. Host tooling mirrors this value the same way as the others.
 */
export const PAGE_UNAVAILABLE_EXIT_CODE = 69;

export {
  DEFAULT_NAVIGATION_RETRY_MS,
  findPageUnavailableLine,
  formatPageUnavailable,
  parsePageUnavailableLine,
  resolveNavigationRetryMs,
} from "./page-availability";
export type { PageUnavailable, PageUnavailableLine } from "./page-availability";

/**
 * How long a freshly launched page may take to mount (its client renders
 * the element AGENT_MOUNT_SELECTOR names, or installs the bridge) before the
 * daemon gives up on it. Separate from the bridge wait, which a loaded box
 * legitimately stretches: this only catches a page whose code never runs.
 * AGENT_MOUNT_TIMEOUT_MS overrides it; 0 disables.
 */
export const DEFAULT_MOUNT_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_MOUNT_SELECTOR = "canvas";

export function resolveMountTimeoutMs(
  env: Record<string, string | undefined>,
): number {
  const raw = env.AGENT_MOUNT_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_MOUNT_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_MOUNT_TIMEOUT_MS;
}

/**
 * A daemon that has received no commands for this long shuts itself down,
 * browser included. Long enough that a worker pausing between tasks keeps its
 * session, short enough that a forgotten session cannot hold a browser
 * overnight. Override per daemon with --idle-ttl-ms or AGENT_IDLE_TTL_MS;
 * 0 disables expiry for deliberately long-lived managed daemons.
 */
export const DEFAULT_IDLE_TTL_MS = 30 * 60_000;

export function resolveIdleTtlMs(
  flagValue: string | undefined,
  env: Record<string, string | undefined>,
): number {
  const raw = flagValue ?? env.AGENT_IDLE_TTL_MS;
  if (raw === undefined || raw === "") {
    return DEFAULT_IDLE_TTL_MS;
  }
  const origin =
    flagValue !== undefined ? "--idle-ttl-ms" : "AGENT_IDLE_TTL_MS";
  const ttlMs = Number(raw);
  if (!Number.isInteger(ttlMs) || ttlMs < 0) {
    throw new Error(
      `${origin} must be a non-negative integer of milliseconds (0 disables idle expiry), received \`${raw}\``,
    );
  }
  return ttlMs;
}

export function agentPidFile(port: number): string {
  return path.join(os.tmpdir(), `voxelize-agent-browser-${port}.pid`);
}

export function watchdogLogFile(port: number): string {
  return path.join(os.tmpdir(), `voxelize-agent-watchdog-${port}.log`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// -ww: the whole command line. A browser's runs to kilobytes, and the
// agent's mark is wherever puppeteer puts it.
function processField(pid: number, field: string): string | null {
  try {
    return execFileSync("ps", ["-ww", "-o", `${field}=`, "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Kills the browser a previous daemon on `port` recorded, once it is proven
 * to be that port's agent browser and no live daemon owns it: killing the
 * browser of a live daemon is never correct (it reads as a crash).
 */
export function reapStaleAgentBrowser(pidFile: string, port: number): void {
  if (!existsSync(pidFile)) return;

  const pid = Number(readFileSync(pidFile, "utf8").trim());
  rmSync(pidFile, { force: true });

  if (!Number.isInteger(pid) || pid <= 0) return;
  if (!isProcessAlive(pid)) return;

  if (!isAgentBrowserCommand(processField(pid, "command"), port)) return;
  const parentPid = Number(processField(pid, "ppid"));
  if (
    parentPid > 1 &&
    parentPid !== process.pid &&
    processField(parentPid, "command")?.includes("voxelize-agent")
  ) {
    console.log(
      `[voxelize-agent] left browser pid=${pid} alone: port ${port}'s agent browser, but its daemon pid=${parentPid} is alive`,
    );
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // not a process group leader, or gone already
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone between the alive check and the kill
  }
  console.log(
    `[voxelize-agent] reaped stale browser pid=${pid}: port ${port}'s agent browser, left by a daemon that is gone`,
  );
}

export function recordAgentBrowser(
  pidFile: string,
  pid: number | undefined,
): void {
  if (!pid) return;
  try {
    writeFileSync(pidFile, String(pid), "utf8");
  } catch (err) {
    console.error("[voxelize-agent] failed to record browser pid:", err);
  }
}

export function clearAgentPidFile(pidFile: string): void {
  rmSync(pidFile, { force: true });
}

const WATCHDOG_POLL_SECONDS = 2;
const WATCHDOG_LOG_MAX_BYTES = 1024 * 1024;

// The watchdog is the only mechanism that survives a SIGKILL of the daemon:
// signal handlers and process.on("exit") never run, and puppeteer launches
// Chrome detached into its own process group (deliberately, so a Ctrl-C on the
// daemon does not SIGINT the browser), which means killing the daemon's group
// cannot reach the browser either. A detached /bin/sh loop polls both pids and
// SIGKILLs the browser's group within seconds of the daemon dying for any
// reason. It verifies process identity before every kill, by the agent's own
// mark for its port (agentBrowserPattern), so a recycled pid is never shot,
// and it exits on its own as soon as the browser is gone, so a clean shutdown
// leaves nothing behind.
const WATCHDOG_SCRIPT = `
exec >> "$WATCHDOG_LOG" 2>&1
echo "$(date +%FT%T) [watchdog] watching daemon pid=$DAEMON_PID browser pid=$BROWSER_PID port=$AGENT_PORT"
while :; do
  if ! kill -0 "$BROWSER_PID" 2>/dev/null; then
    echo "$(date +%FT%T) [watchdog] browser pid=$BROWSER_PID exited; nothing to guard"
    exit 0
  fi
  if ! ps -ww -o command= -p "$DAEMON_PID" 2>/dev/null | grep -q "voxelize-agent"; then
    break
  fi
  sleep ${WATCHDOG_POLL_SECONDS}
done
if ps -ww -o command= -p "$BROWSER_PID" 2>/dev/null | grep -Eq -- "$BROWSER_PATTERN"; then
  echo "$(date +%FT%T) [watchdog] daemon pid=$DAEMON_PID died with browser pid=$BROWSER_PID still alive (it carries port $AGENT_PORT's agent mark); killing orphaned browser group"
  kill -9 -- "-$BROWSER_PID" 2>/dev/null
  kill -9 "$BROWSER_PID" 2>/dev/null
  echo "$(date +%FT%T) [watchdog] killed orphaned browser pid=$BROWSER_PID (daemon port=$AGENT_PORT)"
else
  echo "$(date +%FT%T) [watchdog] daemon pid=$DAEMON_PID died; browser pid=$BROWSER_PID is gone, or its pid now runs something without port $AGENT_PORT's agent mark; nothing to kill"
fi
`;

export function spawnBrowserWatchdog(options: {
  daemonPid: number;
  browserPid: number | undefined;
  port: number;
}): number | undefined {
  const { daemonPid, browserPid, port } = options;
  if (process.env.AGENT_BROWSER_WATCHDOG === "0") {
    console.warn(
      `[voxelize-agent] browser watchdog disabled (AGENT_BROWSER_WATCHDOG=0); a kill -9 of this daemon WILL orphan browser pid=${browserPid ?? "?"}`,
    );
    return undefined;
  }
  if (!browserPid) {
    console.error(
      "[voxelize-agent] browser watchdog not started: puppeteer reported no browser pid; a dead daemon cannot reap this browser",
    );
    return undefined;
  }

  const logPath = watchdogLogFile(port);
  try {
    if (
      existsSync(logPath) &&
      statSync(logPath).size > WATCHDOG_LOG_MAX_BYTES
    ) {
      rmSync(logPath, { force: true });
    }
  } catch {
    // log rotation is best-effort; the watchdog itself recreates the file
  }

  try {
    const child = spawn("/bin/sh", ["-c", WATCHDOG_SCRIPT], {
      detached: true,
      stdio: "ignore",
      env: {
        WATCHDOG_LOG: logPath,
        DAEMON_PID: String(daemonPid),
        BROWSER_PID: String(browserPid),
        AGENT_PORT: String(port),
        BROWSER_PATTERN: agentBrowserPattern(port),
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
    });
    child.unref();
    console.log(
      `[voxelize-agent] browser watchdog pid=${child.pid} guarding browser pid=${browserPid} (log: ${logPath})`,
    );
    return child.pid;
  } catch (err) {
    // Per the hardening rule a nonessential failure must never block the
    // bridge: the daemon still runs, but the operator must know the SIGKILL
    // safety net is missing.
    console.error(
      "[voxelize-agent] failed to spawn browser watchdog; a kill -9 of this daemon will orphan the browser:",
      err,
    );
    return undefined;
  }
}
