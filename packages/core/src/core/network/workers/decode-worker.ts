import { decodeMessage } from "./decode-utils";

onmessage = (e: MessageEvent) => {
  let { data: buffers } = e;
  if (!Array.isArray(buffers)) {
    buffers = [buffers];
  }

  const transferables: ArrayBuffer[] = [];
  const messages = buffers.map((buffer: ArrayBuffer | Uint8Array) => {
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return decodeMessage(view, transferables);
  });

  queueMicrotask(() => {
    postMessage(messages, { transfer: transferables });
  });
};
