type WorkerPoolJob = {
  message: any;
  buffers?: ArrayBufferLike[];
  resolve: (value: any) => void;
};

type WorkerPoolParams = {
  maxWorker: number;
};

const defaultParams: WorkerPoolParams = {
  maxWorker: 8,
};

class WorkerPool {
  public queue: WorkerPoolJob[] = [];

  private workers: Worker[] = [];
  private available: number[] = [];

  constructor(
    public Proto: new () => Worker,
    public params: WorkerPoolParams = defaultParams
  ) {
    const { maxWorker } = params;

    for (let i = 0; i < maxWorker; i++) {
      this.workers.push(new Proto());
      this.available.push(i);
    }
  }

  addJob = (job: WorkerPoolJob) => {
    this.queue.push(job);
    this.process();
  };

  process = () => {
    if (this.queue.length !== 0 && this.available.length > 0) {
      const index = this.available.shift() as number;
      const worker = this.workers[index];

      const { message, buffers, resolve } = this.queue.shift() as WorkerPoolJob;

      worker.postMessage(message, buffers || []);

      const workerCallback = ({ data }: any) => {
        worker.removeEventListener("message", workerCallback);
        this.available.push(index);
        resolve(data);
        this.process();
      };

      worker.addEventListener("message", workerCallback);
    }
  };

  get isBusy() {
    return this.available.length <= 0;
  }
}

export type { WorkerPoolParams, WorkerPoolJob };

export { WorkerPool };
