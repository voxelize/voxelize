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

  console.log("[voxelize-agent] browser launched, awaiting ready...");
  await agent.ready();
  console.log("[voxelize-agent] agent ready");

  const daemon = new AgentDaemon({ agent, port });
  await daemon.start(port);
  console.log(`[voxelize-agent] daemon listening on http://127.0.0.1:${port}`);

  let isShuttingDown = false;
  const shutdown = async (reason: string) => {
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
    process.exit(0);
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => void shutdown(signal));
  }
  process.on("uncaughtException", (err) => {
    console.error("[voxelize-agent] uncaught exception:", err);
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[voxelize-agent] unhandled rejection:", reason);
    void shutdown("unhandledRejection");
  });
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
