import { WorkerPool } from "@voxelize/utilities";
import * as fflate from "fflate";
import * as DecodeWorker from "web-worker:./workers/decode-worker.ts";
import { Message } from "..";
import { protocol } from "../generated/protocol";
import { unpackagePacket } from "./unpackage-packet";

const { Message } = protocol;

export class Decoder {
  private pool: WorkerPool;

  public onMessages?: (message: Message[]) => void = () => {};

  constructor() {
    const { default: Worker } = DecodeWorker;
    this.pool = new WorkerPool(Worker, {
      maxWorker: window.navigator.hardwareConcurrency || 4,
    });
  }

  public decodeSync(data: Uint8Array[]) {
    const messages = data.map((buffer) => {
      if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
        buffer = fflate.unzlibSync(buffer);
      }

      const message = Message.toObject(Message.decode(buffer), {
        defaults: true,
      });

      message.packets = message.packets.map((packet: any) => {
        return unpackagePacket(packet);
      });

      return message as Message;
    });

    this.onMessages?.(messages);

    return messages;
  }

  public async decode(data: Uint8Array[]) {
    return new Promise<Message[]>((resolve) => {
      this.pool.addJob({
        message: data,
        buffers: data.map((d) => d.buffer),
        resolve: (messages) => {
          this.onMessages?.(messages);
          resolve(messages);
        },
      });
    });
  }
}
