import { decodeMessage } from "./decode-utils";

onmessage = (e: MessageEvent) => {
  let { data: buffers } = e;
  if (!Array.isArray(buffers)) {
    buffers = [buffers];
  }

  const transferables: ArrayBuffer[] = [];
  const messages = buffers.map((buffer: Uint8Array) =>
    decodeMessage(buffer, transferables)
  );

  queueMicrotask(() => {
    postMessage(messages, { transfer: transferables });
  });
};
