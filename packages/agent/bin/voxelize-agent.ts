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
      "chrome-path": { type: "string" },
      headed: { type: "boolean" },
      "experimental-webgpu": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const url = values.url ?? "http://127.0.0.1:3000";
  const world = values.world ?? "test";
  const port = values.port ? Number(values.port) : 4099;
  const name = values.name ?? "agent";
  const isHeadless = !values.headed;
  const isExperimentalWebGpuEnabled = values["experimental-webgpu"] === true;
  const browserExecutablePath = values["chrome-path"];

  console.log(
    `[voxelize-agent] launching agent world=${world} url=${url} port=${port} headless=${isHeadless} experimentalWebGPU=${isExperimentalWebGpuEnabled} chromePath=${browserExecutablePath ?? "auto"}`,
  );

  const agent = await Agent.launch({
    url,
    world,
    name,
    isHeadless,
    isExperimentalWebGpuEnabled,
    browserExecutablePath,
  });

  console.log("[voxelize-agent] browser launched, awaiting ready...");
  await agent.ready();
  console.log("[voxelize-agent] agent ready");

  const daemon = new AgentDaemon({ agent, port });
  await daemon.start(port);
  console.log(`[voxelize-agent] daemon listening on http://127.0.0.1:${port}`);

  const shutdown = async () => {
    console.log("[voxelize-agent] shutting down...");
    try {
      await daemon.stop();
    } catch (e) {
      console.error(e);
    }
    await agent.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function printHelp(): void {
  console.log(`voxelize-agent - headless browser agent for Voxelize worlds

Usage:
  voxelize-agent [options]

Options:
  -u, --url <url>      Client base URL (default: http://127.0.0.1:3000)
  -w, --world <name>   World to join (default: test)
  -p, --port <port>    HTTP daemon port (default: 4099)
  -n, --name <name>    Agent display name (default: agent)
      --chrome-path <path>
                       Browser executable path (defaults to Chrome Canary, then Chrome, in experimental WebGPU mode)
      --headed         Launch a visible browser window (default: headless)
      --experimental-webgpu
                       Enable Chrome's unsafe WebGPU flag and use native GPU path
  -h, --help           Show this help
`);
}

main().catch((err) => {
  console.error("[voxelize-agent] fatal:", err);
  process.exit(1);
});
