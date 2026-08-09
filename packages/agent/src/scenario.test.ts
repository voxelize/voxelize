import { createServer } from "node:http";
import type { Server } from "node:http";

import { describe, expect, it } from "vitest";

import { runScenario } from "./scenario";
import type { ScenarioOptions } from "./scenario";

type AgentRequest = {
  body: string;
  url: string;
};

async function runWithAgentServer(
  scenarioOptions: Pick<ScenarioOptions, "isWipingArena"> = {},
): Promise<AgentRequest[]> {
  const requests: AgentRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        body: Buffer.concat(chunks).toString("utf8"),
        url: request.url ?? "",
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Agent test server did not bind to a TCP port");
    }

    const result = await runScenario({
      name: "teardown-policy",
      arena: {
        agentUrl: `http://127.0.0.1:${address.port}`,
        scenarioId: "teardown-policy",
      },
      ...scenarioOptions,
      body: async () => {},
    });

    expect(result.passed).toBe(true);
    return requests;
  } finally {
    await closeServer(server);
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function callsFor(requests: AgentRequest[], method: string): AgentRequest[] {
  return requests.filter(
    (request) =>
      request.url === "/act" && request.body.includes(`"method":"${method}"`),
  );
}

describe("runScenario teardown", () => {
  it("wipes the arena by default and despawns entities", async () => {
    const requests = await runWithAgentServer();

    expect(callsFor(requests, "test:despawn")).toHaveLength(2);
    expect(callsFor(requests, "test:fill")).toHaveLength(2);
  });

  it("skips arena wipes when disabled and still despawns entities", async () => {
    const requests = await runWithAgentServer({ isWipingArena: false });

    expect(callsFor(requests, "test:despawn")).toHaveLength(2);
    expect(callsFor(requests, "test:fill")).toHaveLength(0);
  });
});
