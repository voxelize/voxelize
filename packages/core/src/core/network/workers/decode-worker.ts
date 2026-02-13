import { decodeMessage } from "./decode-utils";

onmessage = (e: MessageEvent) => {
  let { data: buffers } = e;
  if (!Array.isArray(buffers)) {
    buffers = [buffers];
  }

  const transferables: ArrayBuffer[] = [];
  const messages = new Array<ReturnType<typeof decodeMessage>>(buffers.length);
  for (let index = 0; index < buffers.length; index++) {
    const buffer = buffers[index] as ArrayBuffer | Uint8Array;
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    messages[index] = decodeMessage(view, transferables);
  }

  queueMicrotask(() => {
    postMessage(messages, { transfer: transferables });
  });
};
