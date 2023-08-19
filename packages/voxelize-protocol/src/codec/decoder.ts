import { WorkerPool } from "@voxelize/utilities";
import * as DecodeWorker from "web-worker:./workers/decode-worker.ts";
import { Message } from "..";

export class Decoder {
  private pool: WorkerPool;

  public onMessage?: (message: Message) => void = () => {};

  constructor() {
    const { default: Worker } = DecodeWorker;
    this.pool = new WorkerPool(Worker, {
      maxWorker: window.navigator.hardwareConcurrency || 4,
    });
  }

  public async decode(data: Uint8Array[]) {
    return new Promise<any>((resolve) => {
      this.pool.addJob({
        message: data,
        buffers: data.map((d) => d.buffer),
        resolve: (message) => {
          this.onMessage?.(message);
          resolve(message);
        },
      });
    });
  }
}
