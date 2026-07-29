import fs from "node:fs";
import path from "node:path";

// Captures default under <cwd>/screenshots/dev/<yyyy-mm-dd>/ so they survive
// reboots (/tmp does not). The daemon and the scenario runner both run with
// the repo as their working directory (agent-session.mjs spawns the daemon
// with cwd = repo root; scenarios run via `pnpm tsx tests/<name>.ts`).
// Mirrored by resolveCaptureDir() in town's scripts/agent.mjs for the
// CLI-side sc/screenshot writes.
export const CAPTURE_DIR_ENV_VAR = "AGENT_CAPTURE_DIR";

export const DEFAULT_CAPTURE_BASE_SEGMENTS = ["screenshots", "dev"] as const;

// The pre-persistence capture home, and the fallback when the preferred base
// cannot be created: a capture degrades to /tmp with a loud warning instead
// of failing, because captures are how agents see anything at all.
export const LEGACY_CAPTURE_ROOT = "/tmp";

export type CaptureDirContext = {
  env?: Record<string, string | undefined>;
  cwd?: string;
  now?: Date;
};

export function resolveCaptureBase(ctx: CaptureDirContext = {}): string {
  const env = ctx.env ?? process.env;
  const override = env[CAPTURE_DIR_ENV_VAR];
  if (override !== undefined && override !== "") {
    return path.resolve(override);
  }
  return path.join(ctx.cwd ?? process.cwd(), ...DEFAULT_CAPTURE_BASE_SEGMENTS);
}

export function captureDateStamp(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function ensureCaptureDir(
  segments: string[] = [],
  ctx: CaptureDirContext = {},
): string {
  const preferred = path.join(
    resolveCaptureBase(ctx),
    captureDateStamp(ctx.now),
    ...segments,
  );
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const fallback = path.join(LEGACY_CAPTURE_ROOT, ...segments);
    console.warn(
      `[voxelize-agent] cannot create capture dir ${preferred} (${reason}); ` +
        `falling back to ${fallback} — captures there will not survive a reboot`,
    );
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}
