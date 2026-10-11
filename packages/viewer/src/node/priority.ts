/**
 * The viewer runs below everything else on the machine. A capture generates
 * and meshes on every core, and the game it looks at, running beside it,
 * needs its cores for every frame.
 *
 * macOS: QoS clamp `utility` (`taskpolicy -c utility`), which still uses any
 * idle core; Linux: nice 10. Both exec the program in place, so the pid the
 * spawner records (and kills) is the program's own, and its children (a
 * browser's renderer and GPU helpers) inherit the priority.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { SpawnSpec } from "./backend";

const TASKPOLICY = "/usr/sbin/taskpolicy";
const MAC_QOS_CLAMP = "utility";
const LINUX_NICE = 10;

export type PriorityPlatform = {
  platform?: NodeJS.Platform;
  exists?: (file: string) => boolean;
};

/** The command line that execs a program lowered, or null where there is none. */
export function lowPriorityPrefix({
  platform = process.platform,
  exists = fs.existsSync,
}: PriorityPlatform = {}): string[] | null {
  if (platform === "darwin" && exists(TASKPOLICY)) {
    return [TASKPOLICY, "-c", MAC_QOS_CLAMP];
  }
  if (platform === "linux") return ["nice", "-n", String(LINUX_NICE)];
  return null;
}

/** `spec`, spawned through the lowering prefix. */
export function lowerSpawn(
  spec: SpawnSpec,
  platform: PriorityPlatform = {},
): SpawnSpec {
  const prefix = lowPriorityPrefix(platform);
  if (!prefix) return spec;
  const [command, ...args] = prefix;
  return {
    ...spec,
    command,
    args: [...args, spec.command, ...(spec.args ?? [])],
  };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Writes (or reuses) a script in `dir` that execs `executable` lowered, for
 * a launcher that takes only an executable path (puppeteer). Null where
 * this platform has no lowering; throws when the script cannot be written.
 */
export function lowPriorityExecutable(
  executable: string,
  dir: string,
  platform: PriorityPlatform = {},
): string | null {
  const prefix = lowPriorityPrefix(platform);
  if (!prefix) return null;
  const hash = crypto
    .createHash("sha256")
    .update(executable)
    .digest("hex")
    .slice(0, 8);
  const name = `${path.basename(executable).replace(/[^A-Za-z0-9._-]/g, "_")}-${hash}.sh`;
  const file = path.join(dir, name);
  const script = `#!/bin/sh\nexec ${[...prefix, executable].map(shellQuote).join(" ")} "$@"\n`;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== script) {
    fs.writeFileSync(file, script, { mode: 0o755 });
  }
  fs.chmodSync(file, 0o755);
  return file;
}
