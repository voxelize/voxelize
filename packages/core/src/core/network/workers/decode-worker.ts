import { answerRegistryRead, isRegistryReadRequest } from "../registry-cache";

import { decodeMessage } from "./decode-utils";

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
  const messages = buffers.map((buffer: ArrayBuffer | Uint8Array) => {
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return decodeMessage(view, transferables);
  });

  queueMicrotask(() => {
    postMessage(messages, { transfer: transferables });
  });
};
