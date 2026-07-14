import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type PerfField = string | number | boolean | null;

const PERF_PREFIX = "[PERF] ";
const isPerfEnabled =
  process.env.TOWN_PERF_LOG === "true" || process.env.TOWN_PERF_LOG === "1";
const perfDirectory =
  process.env.TOWN_PERF_DIR ?? path.resolve(process.cwd(), ".staging", "perf");

let agentSequence = 0;
let agentStream: fs.WriteStream | null = null;
let clientStream: fs.WriteStream | null = null;

function streamFor(
  current: fs.WriteStream | null,
  filename: string,
): fs.WriteStream {
  if (current) return current;
  fs.mkdirSync(perfDirectory, { recursive: true, mode: 0o700 });
  return fs.createWriteStream(path.join(perfDirectory, filename), {
    flags: "a",
    mode: 0o600,
  });
}

export function isAgentPerfLogging(): boolean {
  return isPerfEnabled;
}

export function createAgentPerfTraceId(): string {
  return randomUUID();
}

export function logAgentPerf(
  event: string,
  world: string,
  fields: Record<string, PerfField> = {},
): void {
  if (!isPerfEnabled) return;

  agentSequence += 1;
  const line =
    PERF_PREFIX +
    JSON.stringify({
      component: "agent",
      event,
      monotonicMs: performance.now(),
      world,
      seq: agentSequence,
      ...fields,
    });
  agentStream = streamFor(agentStream, "agent.jsonl");
  agentStream.write(`${line}\n`);
  console.log(line);
}

export function writeClientPerfLine(line: string): void {
  if (!isPerfEnabled || !line.startsWith(PERF_PREFIX)) return;
  clientStream = streamFor(clientStream, "client.jsonl");
  clientStream.write(`${line}\n`);
}
