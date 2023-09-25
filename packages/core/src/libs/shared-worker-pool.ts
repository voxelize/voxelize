/**
 * A worker pool job is queued to a worker pool and is executed by a worker.
 */
export type SharedWorkerPoolJob = {
  /**
   * A JSON serializable object that is passed to the worker.
   */
  message: any;

  /**
   * Any array buffers (transferable) that are passed to the worker.
   */
  buffers?: ArrayBufferLike[];

  /**
   * A callback that is called when the worker has finished executing the job.
   *
   * @param value The result of the job.
   */
  resolve: (value: any) => void;
};

/**
 * Parameters to create a worker pool.
 */
export type SharedWorkerPoolOptions = {
  /**
   * The maximum number of workers to create. Defaults to `8`.
   */
  maxWorker: number;
};

const defaultOptions: SharedWorkerPoolOptions = {
  maxWorker: 8,
};

/**
 * A pool of web workers that can be used to execute jobs. The pool will create
 * workers up to the maximum number of workers specified in the options.
 * When a job is queued, the pool will find the first available worker and
 * execute the job. If no workers are available, the job will be queued until
 * a worker becomes available.
 */
export class SharedWorkerPool {
  /**
   * The queue of jobs that are waiting to be executed.
   */
  public queue: SharedWorkerPoolJob[] = [];

  /**
   * A static count of working web workers across all worker pools.
   */
  static WORKING_COUNT = 0;

  /**
   * The list of workers in the pool.
   */
  private workers: SharedWorker[] = [];

  /**
   * The list of available workers' indices.
   */
  private available: number[] = [];

  /**
   * Create a new worker pool.
   *
   * @param Proto The worker class to create.
   * @param options The options to create the worker pool.
   */
  constructor(
    public Proto: new () => SharedWorker,
    public options: SharedWorkerPoolOptions = defaultOptions
  ) {
    const { maxWorker } = options;

    for (let i = 0; i < maxWorker; i++) {
      const worker = new Proto();
      worker.port.start();
      this.workers.push(worker);
      this.available.push(i);
    }
  }

  /**
   * Append a new job to be executed by a worker.
   *
   * @param job The job to queue.
   */
  addJob = (job: SharedWorkerPoolJob) => {
    this.queue.push(job);
    this.process();
  };

  /**
   * Process the queue of jobs. This is called when a worker becomes available or
   * when a new job is added to the queue.
   */
  private process = () => {
    if (this.queue.length !== 0 && this.available.length > 0) {
      const index = this.available.shift() as number;
      const worker = this.workers[index];

      const { message, buffers, resolve } =
        this.queue.shift() as SharedWorkerPoolJob;

      worker.port.postMessage(message, buffers || []);
      SharedWorkerPool.WORKING_COUNT++;

      const workerCallback = ({ data }: any) => {
        SharedWorkerPool.WORKING_COUNT--;
        worker.port.removeEventListener("message", workerCallback);
        this.available.push(index);
        resolve(data);
        if (this.queue.length !== 0 && this.available.length > 0) {
          setTimeout(this.process, 0);
        }
      };

      worker.port.addEventListener("message", workerCallback);
    }
  };

  /**
   * Whether or not are there no available workers.
   */
  get isBusy() {
    return this.available.length <= 0;
  }

  /**
   * The number of workers that are simultaneously working.
   */
  get workingCount() {
    return this.workers.length - this.available.length;
  }
}
