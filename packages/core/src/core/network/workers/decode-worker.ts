import { answerRegistryRead, isRegistryReadRequest } from "../registry-cache";

import { decodeMessages } from "./decode-utils";

const DECODE_ERROR_REPORT_INTERVAL_MS = 5000;

let lastDecodeErrorReportAt = Number.NEGATIVE_INFINITY;
let unreportedDecodeErrors = 0;

/** What the page needs to tell a garbled packet's origin, once per interval. */
const reportDecodeError = (error: unknown, buffer: Uint8Array) => {
  unreportedDecodeErrors += 1;
  const now = performance.now();
  if (now - lastDecodeErrorReportAt < DECODE_ERROR_REPORT_INTERVAL_MS) return;
  const head = Array.from(buffer.subarray(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(" ");
  console.error(
    `[NETWORK] ${unreportedDecodeErrors} packet(s) would not decode and were dropped; ` +
      `latest: ${buffer.byteLength} bytes starting ${head}`,
    error,
  );
  unreportedDecodeErrors = 0;
  lastDecodeErrorReportAt = now;
};

onmessage = (e: MessageEvent) => {
  // The page reads its kept block registry through an idle decode worker,
  // off its own busy main thread (see `../registry-cache`).
  if (isRegistryReadRequest(e.data)) {
    void answerRegistryRead((reply) => postMessage(reply));
    return;
  }

  let { data: buffers } = e;
  if (!Array.isArray(buffers)) {
    buffers = [buffers];
  }

  const transferables: ArrayBuffer[] = [];
  const messages = decodeMessages(buffers, transferables, reportDecodeError);

  queueMicrotask(() => {
    postMessage(messages, { transfer: transferables });
  });
};
