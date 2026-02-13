/**
 * A worker pool job is queued to a worker pool and is executed by a worker.
 */
export type WorkerPoolJob<TMessage extends object = object> = {
  /**
   * A JSON serializable object that is passed to the worker.
   */
  message: TMessage;

  /**
   * Any array buffers (transferable) that are passed to the worker.
   */
  buffers?: ArrayBufferLike[];

  /**
   * A callback that is called when the worker has finished executing the job.
   *
   * @param value The result of the job.
   */
  resolve: (value: MessageEvent["data"]) => void;
};

type QueuedWorkerPoolJob = WorkerPoolJob<object>;

/**
 * Parameters to create a worker pool.
 */
export type WorkerPoolOptions = {
  /**
   * The maximum number of workers to create. Defaults to `8`.
   */
  maxWorker: number;

  /**
   * The name prefix for workers in this pool. Workers will be named
   * `{name}-0`, `{name}-1`, etc. Shows up in DevTools for debugging.
   */
  name?: string;
};

const defaultOptions: WorkerPoolOptions = {
  maxWorker: 8,
};

/**
 * A pool of web workers that can be used to execute jobs. The pool will create
 * workers up to the maximum number of workers specified in the options.
 * When a job is queued, the pool will find the first available worker and
 * execute the job. If no workers are available, the job will be queued until
 * a worker becomes available.
 */
export class WorkerPool {
  /**
   * The queue of jobs that are waiting to be executed.
   */
  public queue: QueuedWorkerPoolJob[] = [];
  private queueHead = 0;
  private processScheduled = false;

  /**
   * A static count of working web workers across all worker pools.
   */
  static WORKING_COUNT = 0;

  /**
   * The list of workers in the pool.
   */
  private workers: Worker[] = [];

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
    public Proto: new (options?: WorkerOptions) => Worker,
    public options: WorkerPoolOptions = defaultOptions
  ) {
    const { maxWorker, name } = options;

    for (let i = 0; i < maxWorker; i++) {
      const workerOptions: WorkerOptions | undefined = name
        ? { name: `${name}-${i}` }
        : undefined;
      const worker = new Proto(workerOptions);
      this.workers.push(worker);
      this.available.push(i);
    }
  }

  /**
   * Append a new job to be executed by a worker.
   *
   * @param job The job to queue.
   */
  addJob = <TMessage extends object>(job: WorkerPoolJob<TMessage>) => {
    this.queue.push(job as QueuedWorkerPoolJob);
    this.process();
  };

  postMessage = (message: object, buffers?: ArrayBufferLike[]) => {
    if (!buffers || buffers.length === 0) {
      for (const worker of this.workers) {
        worker.postMessage(message);
      }
      return;
    }

    if (this.workers.length === 1) {
      this.workers[0].postMessage(message, buffers);
      return;
    }

    for (const worker of this.workers) {
      const transferBuffers = new Array<ArrayBufferLike>(buffers.length);
      for (let index = 0; index < buffers.length; index++) {
        const buffer = buffers[index];
        transferBuffers[index] =
          buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer;
      }
      worker.postMessage(message, transferBuffers);
    }
  };

  private hasQueuedJobs = () => this.queueHead < this.queue.length;

  private normalizeQueue = () => {
    if (this.queueHead === 0) {
      return;
    }

    if (this.queueHead >= this.queue.length) {
      this.queue.length = 0;
      this.queueHead = 0;
      return;
    }

    if (this.queueHead >= 1024 && this.queueHead * 2 >= this.queue.length) {
      this.queue.copyWithin(0, this.queueHead);
      this.queue.length -= this.queueHead;
      this.queueHead = 0;
    }
  };

  private scheduleProcess = () => {
    if (this.processScheduled) {
      return;
    }

    this.processScheduled = true;
    queueMicrotask(() => {
      this.processScheduled = false;
      this.process();
    });
  };

  /**
   * Process the queue of jobs. This is called when a worker becomes available or
   * when a new job is added to the queue.
   */
  private process = () => {
    while (this.hasQueuedJobs() && this.available.length > 0) {
      const index = this.available.pop() as number;
      const worker = this.workers[index];

      const job = this.queue[this.queueHead] as WorkerPoolJob;
      const { message, buffers, resolve } = job;

      const workerCallback = (event: MessageEvent<object>) => {
        const { data } = event;
        WorkerPool.WORKING_COUNT--;
        worker.removeEventListener("message", workerCallback);
        this.available.push(index);
        try {
          resolve(data);
        } finally {
          if (this.hasQueuedJobs()) {
            this.scheduleProcess();
          }
        }
      };

      worker.addEventListener("message", workerCallback);
      try {
        if (buffers) {
          worker.postMessage(message, buffers);
        } else {
          worker.postMessage(message);
        }
        this.queueHead++;
        this.normalizeQueue();
        WorkerPool.WORKING_COUNT++;
      } catch (error) {
        worker.removeEventListener("message", workerCallback);
        this.available.push(index);
        throw error;
      }
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

  /**
   * The number of workers that are available to take jobs.
   */
  get availableCount() {
    return this.available.length;
  }
}
