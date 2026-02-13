import { decodeMessage } from "./decode-utils";

type DecodeWorkerBuffer = ArrayBuffer | Uint8Array;
type DecodeWorkerInput = DecodeWorkerBuffer | DecodeWorkerBuffer[];

const reusableTransferables: ArrayBuffer[] = [];
const reusableSingleBufferList: DecodeWorkerBuffer[] = [new Uint8Array(0)];

onmessage = (e: MessageEvent<DecodeWorkerInput>) => {
  let { data: buffers } = e;
  if (!Array.isArray(buffers)) {
    reusableSingleBufferList[0] = buffers;
    buffers = reusableSingleBufferList;
  }

  const transferables = reusableTransferables;
  transferables.length = 0;
  const messages = new Array<ReturnType<typeof decodeMessage>>(buffers.length);
  for (let index = 0; index < buffers.length; index++) {
    const buffer = buffers[index];
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    messages[index] = decodeMessage(view, transferables);
  }

  postMessage(messages, { transfer: transferables });
};
