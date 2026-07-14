#!/usr/bin/env node
import { parseArgs } from "node:util";

import { Agent } from "../src/agent";
import { AgentDaemon } from "../src/daemon";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      world: { type: "string", short: "w" },
      port: { type: "string", short: "p" },
      name: { type: "string", short: "n" },
      authUrl: { type: "string" },
      headed: { type: "boolean" },
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

  console.log(
    `[voxelize-agent] launching agent world=${world} url=${url} port=${port} headless=${isHeadless}`,
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

  const daemon = new AgentDaemon({ agent, port });

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

  console.log("[voxelize-agent] browser launched, awaiting ready...");
  await agent.ready();
  console.log("[voxelize-agent] agent ready");

  await daemon.start(port);
  console.log(`[voxelize-agent] daemon listening on http://127.0.0.1:${port}`);
}

function printHelp(): void {
  console.log(`voxelize-agent - headless browser agent for Voxelize worlds

Usage:
  voxelize-agent [options]

Options:
  -u, --url <url>      Client base URL (default: http://localhost:3000)
  -w, --world <name>   World to join (default: test)
  -p, --port <port>    HTTP daemon port (default: 4099)
  -n, --name <name>    Agent display name (default: agent)
      --authUrl <url>  Visit this URL first to pick up session cookies
      --headed         Launch a visible browser window (default: headless)
  -h, --help           Show this help
`);
}

main().catch((err) => {
  console.error("[voxelize-agent] fatal:", err);
  process.exit(1);
});
