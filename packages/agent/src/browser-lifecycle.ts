import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_FOR_TESTING_MARKER = "Google Chrome for Testing";

export function agentPidFile(port: number): string {
  return path.join(os.tmpdir(), `voxelize-agent-browser-${port}.pid`);
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
