import { decodeMessage } from "./decode-utils";

type WorkerScope = {
  onmessage: ((e: MessageEvent<Uint8Array[] | Uint8Array>) => void) | null;
  postMessage: (message: object, transfer: ArrayBuffer[]) => void;
};

const workerScope = self as WorkerScope;

workerScope.onmessage = (e: MessageEvent<Uint8Array[] | Uint8Array>) => {
  const buffers = Array.isArray(e.data) ? e.data : [e.data];

  const transferables: ArrayBuffer[] = [];
  const messages = buffers.map((buffer) =>
    decodeMessage(buffer, transferables)
  );

  queueMicrotask(() => {
    workerScope.postMessage(messages, transferables);
  });
};
