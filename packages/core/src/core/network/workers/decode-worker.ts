import { decodeMessage } from "./decode-utils";

type DecodeWorkerBuffer = ArrayBuffer | Uint8Array;

type DecodeWorkerRequest = DecodeWorkerBuffer | DecodeWorkerBuffer[];

onmessage = (e: MessageEvent) => {
  try {
    const request = e.data as DecodeWorkerRequest;
    const buffers = Array.isArray(request) ? request : [request];

    const transferables: ArrayBuffer[] = [];
    const messages = buffers.map((buffer) => {
      const view =
        buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      return decodeMessage(view, transferables);
    });

    queueMicrotask(() => {
      postMessage(messages, { transfer: transferables });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage([{ type: "ERROR", text: `Decode worker failed: ${message}` }]);
  }
};
