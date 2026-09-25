#!/usr/bin/env node
import { parseArgs } from "node:util";

import { Agent } from "../src/agent";
import {
  IDLE_TTL_EXIT_CODE,
  MOUNT_FAILED_EXIT_CODE,
  resolveIdleTtlMs,
  resolveMountTimeoutMs,
} from "../src/browser-lifecycle";
import { AgentDaemon } from "../src/daemon";
import {
  SESSION_META_ENV,
  SESSION_ORIGIN_ENV,
  applySessionMetaPatch,
  parseSessionMetaAssignments,
  parseSessionMetaEnv,
  parseSessionOriginEnv,
} from "../src/session-meta";

const IDLE_CHECK_MIN_MS = 250;
const IDLE_CHECK_MAX_MS = 30_000;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      world: { type: "string", short: "w" },
      port: { type: "string", short: "p" },
      name: { type: "string", short: "n" },
      authUrl: { type: "string" },
      headed: { type: "boolean" },
      "idle-ttl-ms": { type: "string" },
      "lease-minutes": { type: "string" },
      meta: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const url = values.url ?? "http://localhost:3000";
  const world = values.world ?? "test";
  const port = values.port ? Number(values.port) : 4099;
  const name = values.name ?? "agent";
  const isHeadless = !values.headed;
  // Invalid TTL input fails here, before a browser exists: an explicit but
  // unparseable value silently defaulting would be a plausible lie.
  const idleTtlMs = resolveIdleTtlMs(values["idle-ttl-ms"], process.env);
  const leaseMinutes = resolveLeaseMinutes(
    values["lease-minutes"],
    process.env,
  );
  // Labels and provenance are validated here too, before a browser exists:
  // a malformed note is a launcher bug worth a loud exit, not a session that
  // boots with half of what it was told.
  const meta = applySessionMetaPatch(
    parseSessionMetaEnv(process.env[SESSION_META_ENV]),
    { set: parseSessionMetaAssignments(values.meta ?? []) },
  );
  const origin = parseSessionOriginEnv(process.env[SESSION_ORIGIN_ENV]);

  console.log(
    `[voxelize-agent] launching agent world=${world} name=${name} url=${url} port=${port} headless=${isHeadless} ${
      idleTtlMs === 0
        ? "idle-ttl=disabled"
        : `idle-ttl=${Math.round(idleTtlMs / 1000)}s`
    }${leaseMinutes > 0 ? ` lease=${leaseMinutes}m` : ""}${
      Object.keys(meta).length > 0 ? ` meta=${JSON.stringify(meta)}` : ""
    }${origin?.cursor?.conversationId ? ` cursor=${origin.cursor.conversationId}` : ""}`,
  );

  const agent = await Agent.launch({
    url,
    world,
    name,
    isHeadless,
    port,
    authUrl: values.authUrl,
  });

  process.on("exit", () => {
    agent.killBrowserSync();
  });

  const daemon = new AgentDaemon({
    agent,
    port,
    idleTtlMs,
    leaseMinutes,
    meta,
    origin,
    mountTimeoutMs: resolveMountTimeoutMs(process.env),
    onMountFailed: (reason) => void shutdown(reason, MOUNT_FAILED_EXIT_CODE),
  });

  let isShuttingDown = false;
  const shutdown = async (reason: string, exitCode: number) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[voxelize-agent] shutting down (${reason})...`);
    try {
      await daemon.stop();
    } catch (e) {
      console.error(e);
    }
    try {
      await agent.close();
    } catch (e) {
      console.error(e);
    }
    process.exit(exitCode);
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => void shutdown(signal, 0));
  }
  process.on("uncaughtException", (err) => {
    console.error("[voxelize-agent] uncaught exception:", err);
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[voxelize-agent] unhandled rejection:", reason);
    void shutdown("unhandledRejection", 1);
  });

  // A browser that dies underneath us leaves the HTTP listener alive but
  // useless; exit nonzero so PM2/systemd restart the whole wrapper. Graceful
  // close() suppresses this, so signal-driven shutdowns still exit 0.
  agent.onUnexpectedDisconnect((reason) => void shutdown(reason, 1));

  // Listen before the world join completes so /status and /healthz can
  // describe a still-booting (or boot-wedged) daemon; readiness is still
  // reported truthfully by the health payload itself.
  await daemon.start(port);
  console.log(`[voxelize-agent] daemon listening on http://127.0.0.1:${port}`);

  if (idleTtlMs > 0) {
    const checkMs = Math.min(
      IDLE_CHECK_MAX_MS,
      Math.max(IDLE_CHECK_MIN_MS, Math.floor(idleTtlMs / 4)),
    );
    const idleTimer = setInterval(() => {
      const idleMs = daemon.idleMs();
      if (idleMs <= idleTtlMs || daemon.isBusy()) {
        return;
      }
      // An unexpired lease is a worker's explicit claim on this session;
      // idle retirement resumes once the lease runs out.
      if (daemon.isLeaseActive()) {
        return;
      }
      clearInterval(idleTimer);
      console.log(
        `[voxelize-agent] idle ttl expired: no activity for ${Math.round(idleMs / 1000)}s ` +
          `(ttl ${Math.round(idleTtlMs / 1000)}s); closing browser pid=${agent.browserPid() ?? "?"} ` +
          `and exiting with code ${IDLE_TTL_EXIT_CODE}`,
      );
      void shutdown("idle ttl expired", IDLE_TTL_EXIT_CODE);
    }, checkMs);
    idleTimer.unref();
  }

  console.log("[voxelize-agent] browser launched, awaiting ready...");
  try {
    await agent.ready();
  } catch (error) {
    // A shutdown that lands mid-boot tears the page down under this await,
    // rejecting it with a target-closed error. The shutdown path owns the
    // exit code; surfacing that rejection here would turn every clean stop
    // of a booting daemon into a phantom exit 1.
    if (isShuttingDown) return;
    throw error;
  }
  // Finishing the world join counts as activity: the idle clock measures
  // silence after the session became usable, not time spent booting.
  daemon.noteActivity();
  console.log("[voxelize-agent] agent ready");
}

function resolveLeaseMinutes(
  flagValue: string | undefined,
  env: Record<string, string | undefined>,
): number {
  const raw = flagValue ?? env.AGENT_LEASE_MINUTES;
  if (raw === undefined || raw === "") {
    return 0;
  }
  const origin =
    flagValue !== undefined ? "--lease-minutes" : "AGENT_LEASE_MINUTES";
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(
      `${origin} must be a non-negative number of minutes (0 = no lease), received \`${raw}\``,
    );
  }
  return minutes;
}

function printHelp(): void {
  console.log(`voxelize-agent - headless browser agent for Voxelize worlds

Usage:
  voxelize-agent [options]

Options:
  -u, --url <url>        Client base URL (default: http://localhost:3000)
  -w, --world <name>     World to join (default: test)
  -p, --port <port>      HTTP daemon port (default: 4099)
  -n, --name <name>      Agent display name (default: agent)
      --authUrl <url>    Visit this URL first to pick up session cookies
      --headed           Launch a visible browser window (default: headless)
      --idle-ttl-ms <n>  Shut down after n ms without commands (default: 30m;
                         0 disables; env AGENT_IDLE_TTL_MS). Exits code ${IDLE_TTL_EXIT_CODE}.
      --lease-minutes <n> Claim this session for n minutes from start
                         (env AGENT_LEASE_MINUTES). Reported in /status;
                         defers idle retirement while unexpired, and an
                         expired lease is reap evidence.
      --meta <key=value> Session note (repeatable): label=, purpose=, owner=,
                         tags=, or any key. Shown in /status and /meta;
                         patchable later via PATCH /meta.
  -h, --help             Show this help

Environment:
  AGENT_IDLE_TTL_MS        Same as --idle-ttl-ms (flag wins).
  AGENT_LEASE_MINUTES      Same as --lease-minutes (flag wins).
  ${SESSION_META_ENV}       JSON object of initial session notes (--meta merges over it).
  ${SESSION_ORIGIN_ENV}     JSON provenance captured by the launcher (cwd, user,
                           terminal, parent processes, Cursor conversation);
                           read-only once the daemon is up.
  AGENT_BROWSER_WATCHDOG   Set to 0 to skip the detached watchdog that kills
                           the browser if this process dies uncleanly. Only
                           for tests; disabling it re-enables orphan browsers.
`);
}

main().catch((err) => {
  console.error("[voxelize-agent] fatal:", err);
  process.exit(1);
});
