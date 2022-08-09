export type WorkerPoolJob = {
  message: any;
  buffers?: ArrayBufferLike[];
  resolve: (value: any) => void;
};

export type WorkerPoolParams = {
  maxWorker: number;
};

const defaultParams: WorkerPoolParams = {
  maxWorker: 8,
};

export class WorkerPool {
  public queue: WorkerPoolJob[] = [];

  static WORKING_COUNT = 0;

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
      WorkerPool.WORKING_COUNT++;

      const workerCallback = ({ data }: any) => {
        WorkerPool.WORKING_COUNT--;
        worker.removeEventListener("message", workerCallback);
        this.available.push(index);
        resolve(data);
        requestAnimationFrame(this.process);
      };

      worker.addEventListener("message", workerCallback);
    }
  };

  get isBusy() {
    return this.available.length <= 0;
  }

  get workingCount() {
    return this.workers.length - this.available.length;
  }
}
