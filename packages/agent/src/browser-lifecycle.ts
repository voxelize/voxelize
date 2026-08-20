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

const CHROME_FOR_TESTING_MARKER = "Google Chrome for Testing";

/**
 * Exit code the daemon uses when it shuts itself down because its idle TTL
 * expired. PM2 sessions are started with `--stop-exit-codes` set to this value
 * so the app lands in "stopped" (a visible tombstone) instead of being
 * restarted into a fresh idle browser. Mirrored as IDLE_TTL_EXIT_CODE in
 * town's scripts/agent-reap.mjs; the session-port smoke asserts the two agree
 * end to end.
 */
export const IDLE_TTL_EXIT_CODE = 66;

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

function processCommand(pid: number): string | null {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

export function reapStaleAgentBrowser(pidFile: string): void {
  if (!existsSync(pidFile)) return;

  const pid = Number(readFileSync(pidFile, "utf8").trim());
  rmSync(pidFile, { force: true });

  if (!Number.isInteger(pid) || pid <= 0) return;
  if (!isProcessAlive(pid)) return;

  const command = processCommand(pid);
  if (!command || !command.includes(CHROME_FOR_TESTING_MARKER)) return;

  try {
    process.kill(pid, "SIGKILL");
    console.log(`[voxelize-agent] reaped stale browser pid=${pid}`);
  } catch {
    // already gone between the alive check and the kill
  }
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
// reason. It verifies process identity (command string) before every kill so a
// recycled pid is never shot, and it exits on its own as soon as the browser
// is gone, so a clean shutdown leaves nothing behind.
const WATCHDOG_SCRIPT = `
exec >> "$WATCHDOG_LOG" 2>&1
echo "$(date +%FT%T) [watchdog] watching daemon pid=$DAEMON_PID browser pid=$BROWSER_PID port=$AGENT_PORT"
while :; do
  if ! kill -0 "$BROWSER_PID" 2>/dev/null; then
    echo "$(date +%FT%T) [watchdog] browser pid=$BROWSER_PID exited; nothing to guard"
    exit 0
  fi
  if ! ps -o command= -p "$DAEMON_PID" 2>/dev/null | grep -q "voxelize-agent"; then
    break
  fi
  sleep ${WATCHDOG_POLL_SECONDS}
done
if ps -o command= -p "$BROWSER_PID" 2>/dev/null | grep -Eq "Google Chrome for Testing|[.]cache/puppeteer"; then
  echo "$(date +%FT%T) [watchdog] daemon pid=$DAEMON_PID died with browser pid=$BROWSER_PID still alive; killing orphaned browser group"
  kill -9 -- "-$BROWSER_PID" 2>/dev/null
  kill -9 "$BROWSER_PID" 2>/dev/null
  echo "$(date +%FT%T) [watchdog] killed orphaned browser pid=$BROWSER_PID (daemon port=$AGENT_PORT)"
else
  echo "$(date +%FT%T) [watchdog] daemon pid=$DAEMON_PID died; browser pid=$BROWSER_PID already gone or not an agent browser; nothing to kill"
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
