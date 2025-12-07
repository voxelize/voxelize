import { decodeMessage } from "./decode-utils";

// @ts-ignore
onconnect = (e: MessageEvent) => {
  const port = e.ports[0];

  port.onmessage = (e: MessageEvent) => {
    let { data: buffers } = e;
    if (!Array.isArray(buffers)) {
      buffers = [buffers];
    }

    const transferables: ArrayBuffer[] = [];
    const messages = buffers.map((buffer: Uint8Array) =>
      decodeMessage(buffer, transferables)
    );

    queueMicrotask(() => {
      // @ts-ignore
      port.postMessage(messages, transferables);
    });
  };
};
