import fs from "node:fs";
import path from "node:path";

import { agentCacheDir } from "./cache-dir";

/**
 * The agent's browser runs below the game it observes. A headless tab costs
 * one to two cores, and a few sessions at the default priority took the CPU
 * from the running server and from the browser someone was playing in.
 *
 * macOS: QoS clamp `utility` (`taskpolicy -c utility`), which still uses any
 * idle core; Linux: nice 10. Both exec the browser in place, so the pid
 * puppeteer records (and the lifecycle watchdog kills) is the browser's own,
 * and its helpers (renderer, GPU, network) inherit the priority as children.
 *
 * `AGENT_BROWSER_PRIORITY=normal` launches at the default priority, for A/B
 * timing on the same machine.
 */

const TASKPOLICY = "/usr/sbin/taskpolicy";
const MAC_QOS_CLAMP = "utility";
const LINUX_NICE = 10;

export type BrowserPriority = {
  /** Script that execs the browser at the lowered priority. */
  executablePath: string;
  tier: string;
};

export type BrowserPriorityOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  wrapperDir?: string;
  exists?: (file: string) => boolean;
};

export function isBrowserPriorityLowered(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.AGENT_BROWSER_PRIORITY ?? "";
  return raw.trim().toLowerCase() !== "normal";
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The exec line of the wrapper, or null where no lowering is available. */
export function browserPriorityExec(
  browserPath: string,
  {
    platform = process.platform,
    exists = fs.existsSync,
  }: BrowserPriorityOptions = {},
): { line: string; tier: string } | null {
  if (platform === "darwin" && exists(TASKPOLICY)) {
    return {
      line: `exec ${TASKPOLICY} -c ${MAC_QOS_CLAMP} ${shellQuote(browserPath)} "$@"`,
      tier: `qos ${MAC_QOS_CLAMP}`,
    };
  }
  if (platform === "linux") {
    return {
      line: `exec nice -n ${LINUX_NICE} ${shellQuote(browserPath)} "$@"`,
      tier: `nice ${LINUX_NICE}`,
    };
  }
  return null;
}

/**
 * Writes (or reuses) the wrapper that launches `browserPath` at dev priority.
 * Null when lowering is switched off, unavailable on this platform, or the
 * wrapper cannot be written; the caller then launches the browser directly.
 */
export function lowPriorityBrowser(
  browserPath: string,
  options: BrowserPriorityOptions = {},
): BrowserPriority | null {
  const env = options.env ?? process.env;
  if (!isBrowserPriorityLowered(env)) return null;
  const exec = browserPriorityExec(browserPath, options);
  if (!exec) return null;
  const dir =
    options.wrapperDir ?? path.join(agentCacheDir(env), "browser-priority");
  const name = `${path.basename(browserPath).replace(/[^A-Za-z0-9._-]/g, "_")}-${hashOf(browserPath)}.sh`;
  const executablePath = path.join(dir, name);
  const script = `#!/bin/sh\n${exec.line}\n`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const current = fs.existsSync(executablePath)
      ? fs.readFileSync(executablePath, "utf8")
      : null;
    if (current !== script) {
      fs.writeFileSync(executablePath, script, { mode: 0o755 });
    }
    fs.chmodSync(executablePath, 0o755);
  } catch (error) {
    console.error(
      `[voxelize-agent] could not write the low-priority browser wrapper at ${executablePath} (${describeLaunchError(
        error,
      )}); launching at default priority`,
    );
    return null;
  }
  return { executablePath, tier: exec.tier };
}

/**
 * One readable line for whatever a failed launch threw. Puppeteer can reject
 * with a plain object (a socket error event) rather than an `Error`, which
 * `String()` turns into "[object Object]".
 */
export function describeLaunchError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const message = error.message.split("\n")[0];
    return code !== undefined ? `${message} (code ${String(code)})` : message;
  }
  if (typeof error === "object" && error !== null) {
    const { message, code } = error as { message?: unknown; code?: unknown };
    if (typeof message === "string" && message !== "") {
      const line = message.split("\n")[0];
      return code !== undefined ? `${line} (code ${String(code)})` : line;
    }
    try {
      return JSON.stringify(error) ?? String(error);
    } catch {
      return `unserializable ${error.constructor?.name ?? "object"}`;
    }
  }
  return String(error);
}

function hashOf(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
