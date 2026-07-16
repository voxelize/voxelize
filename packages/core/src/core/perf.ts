import { ChatProtocol, MessageProtocol } from "@voxelize/protocol";

type PerfField = string | number | boolean | null;

const CHAT_PREVIEW_LENGTH = 40;
const PERF_PREFIX = "[PERF] ";

let isPerfLoggingEnabled = false;
let perfSequence = 0;
let perfWorld = "";
const chatTimings = new Map<
  string,
  { sendMs: number; wireMs?: number; recvMs?: number }
>();

export function configurePerfLogging(isEnabled: boolean): void {
  isPerfLoggingEnabled = isEnabled;
}

export function setPerfWorld(world: string): void {
  if (!isPerfLoggingEnabled) return;
  perfWorld = world;
}

export function isPerfLogging(): boolean {
  return isPerfLoggingEnabled;
}

export function createPerfTraceId(): string {
  return crypto.randomUUID();
}

export function logPerf(
  event: string,
  fields: Record<string, PerfField> = {},
): void {
  if (!isPerfLoggingEnabled) return;

  perfSequence += 1;
  console.info(
    PERF_PREFIX +
      JSON.stringify({
        component: "client",
        event,
        monotonicMs: performance.now(),
        // Wall-clock epoch ms, correlatable with the server's perf stream
        // (which stamps the same field) on a shared clock.
        epochMs: Date.now(),
        world: perfWorld,
        seq: perfSequence,
        ...fields,
      }),
  );
}

export function stampChatPerf(chat: ChatProtocol): void {
  if (!isPerfLoggingEnabled || chat.traceId) return;

  chat.traceId = createPerfTraceId();
  chat.tSendMs = performance.now();
  chatTimings.set(chat.traceId, { sendMs: chat.tSendMs });
  logPerf("chat_send", {
    traceId: chat.traceId,
    tSendMs: chat.tSendMs,
    bodyPreview: chat.body.slice(0, CHAT_PREVIEW_LENGTH),
  });
}

export function logChatWireSend(
  message: MessageProtocol,
  byteSize: number,
): void {
  if (!isPerfLoggingEnabled) return;

  const traceId = message.chat?.traceId;
  if (!traceId) return;
  const wireMs = performance.now();
  const timing = chatTimings.get(traceId);
  if (timing) timing.wireMs = wireMs;
  logPerf("chat_send_on_wire", {
    traceId,
    byteSize,
    sinceSendMs: timing ? wireMs - timing.sendMs : null,
  });
}

export function annotateIncomingMessages(
  messages: MessageProtocol[],
  byteSizes: number[],
): void {
  if (!isPerfLoggingEnabled) return;

  messages.forEach((message, index) => {
    message.perfByteSize = byteSizes[index] ?? 0;
    const json = message.json as { townPerfTraceId?: string } | undefined;
    if (json?.townPerfTraceId) {
      message.perfTraceId = json.townPerfTraceId;
    }
  });
}

export function logIncomingMessage(message: MessageProtocol): void {
  if (!isPerfLoggingEnabled) return;

  if (message.type === "CHAT" && message.chat?.traceId) {
    const recvMs = performance.now();
    const timing = chatTimings.get(message.chat.traceId);
    if (timing) timing.recvMs = recvMs;
    logPerf("chat_recv", {
      traceId: message.chat.traceId,
      byteSize: message.perfByteSize ?? 0,
      sinceSendMs: timing ? recvMs - timing.sendMs : null,
    });
  }

  if (message.entities?.length) {
    logPerf("entity_stream_recv", {
      traceId: message.perfTraceId ?? "",
      itemCount: message.entities.length,
      byteSize: message.perfByteSize ?? 0,
    });
  }
}

export function logChatRendered(chat: ChatProtocol): void {
  if (!isPerfLoggingEnabled || !chat.traceId) return;
  const renderMs = performance.now();
  const timing = chatTimings.get(chat.traceId);
  logPerf("chat_render", {
    traceId: chat.traceId,
    sinceSendMs: timing ? renderMs - timing.sendMs : null,
    sinceRecvMs: timing?.recvMs ? renderMs - timing.recvMs : null,
  });
  chatTimings.delete(chat.traceId);
}
