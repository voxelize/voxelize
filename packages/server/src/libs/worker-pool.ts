import { Worker } from "worker_threads";

type WorkerPoolJob = {
  message: any;
  buffers?: ArrayBufferLike[];
  resolve?: (data: any) => void;
};

type WorkerPoolParams = {
  maxWorker: number;
};

const defaultParams: WorkerPoolParams = {
  maxWorker: 1,
};

class WorkerPool {
  public queue: WorkerPoolJob[] = [];

  private workers: Worker[] = [];
  private available: number[] = [];

  static workingCount = 0;

  constructor(
    public Proto: new () => Worker,
    public params: WorkerPoolParams = defaultParams
  ) {
    const { maxWorker } = params;

    for (let i = 0; i < maxWorker; i++) {
      const worker = new Proto();
      this.workers.push(worker);
      this.available.push(i);
    }
  }

  addJob = (job: WorkerPoolJob) => {
    this.queue.push(job);
    this.process();
  };

  process = () => {
    if (this.queue.length <= 0 || this.available.length <= 0) return;
    const index = this.available.shift() as number;
    const worker = this.workers[index];

    const { message, buffers, resolve } = this.queue.shift() as WorkerPoolJob;

    worker.postMessage(message, buffers || []);

    const workerCallback = (data: any) => {
      worker.removeListener("message", workerCallback);
      this.available.push(index);
      resolve(data);
      this.process();
    };

    worker.addListener("message", workerCallback);

    WorkerPool.workingCount++;
  };

  get isBusy() {
    return this.available.length <= 0;
  }
}

export type { WorkerPoolParams, WorkerPoolJob };

export { WorkerPool };
