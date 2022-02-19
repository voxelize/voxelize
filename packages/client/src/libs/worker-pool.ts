type WorkerPoolJob = {
  message: any;
  buffers?: ArrayBufferLike[];
  resolve: (value: any) => void;
};

type PoolParams = {
  maxWorker: number;
};

const defaultParams: PoolParams = {
  maxWorker: 8,
};

class WorkerPool {
  private workers: Worker[] = [];
  private available: number[] = [];

  protected queue: WorkerPoolJob[] = [];
  protected initialized = false;

  constructor(src: string, public params: PoolParams = defaultParams) {
    const { maxWorker } = params;

    for (let i = 0; i < maxWorker; i++) {
      this.workers.push(new Worker(new URL(src), import.meta.url));
      this.available.push(i);
    }
  }

  addJob = (job: WorkerPoolJob) => {
    this.queue.push(job);
    this.process();
  };

  private process = () => {
    if (this.queue.length !== 0 && this.available.length > 0) {
      const index = this.available.shift() as number;
      const worker = this.workers[index];

      const { message, buffers, resolve } = this.queue.shift() as WorkerPoolJob;

      worker.postMessage(message, buffers || []);

      const workerCallback = ({ data }: any) => {
        worker.removeEventListener("message", workerCallback);
        this.available.push(index);
        resolve(data);
      };

      worker.addEventListener("message", workerCallback);
    }
  };
}

export type { WorkerPoolJob };

export { WorkerPool };
