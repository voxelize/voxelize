import os from "node:os";
import path from "node:path";

/**
 * Parent directory of the agent's persistent state: per-port browser
 * profiles and the low-priority launch wrappers. `AGENT_CACHE_DIR` names it;
 * the default is `~/.cache/voxelize-agent`.
 */
export function agentCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AGENT_CACHE_DIR?.trim();
  return configured
    ? configured
    : path.join(os.homedir(), ".cache", "voxelize-agent");
}
