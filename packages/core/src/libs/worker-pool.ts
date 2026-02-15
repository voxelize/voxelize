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
  buffers?: ArrayBuffer[];

  /**
   * A callback that is called when the worker has finished executing the job.
   *
   * @param value The result of the job.
   */
  resolve: (value: MessageEvent["data"]) => void;

  /**
   * A callback that is called when the worker fails to execute the job.
   *
   * @param reason The failure reason.
   */
  reject?: (reason: Error) => void;
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
const MAX_WORKER_POOL_SIZE = 256;
const normalizeMaxWorker = (maxWorker: number): number => {
  if (maxWorker === Number.POSITIVE_INFINITY) {
    return MAX_WORKER_POOL_SIZE;
  }
  if (Number.isSafeInteger(maxWorker)) {
    if (maxWorker <= 0) {
      return defaultOptions.maxWorker;
    }
    return maxWorker > MAX_WORKER_POOL_SIZE
      ? MAX_WORKER_POOL_SIZE
      : maxWorker;
  }
  if (!Number.isFinite(maxWorker)) {
    return defaultOptions.maxWorker;
  }
  const normalized = Math.floor(maxWorker);
  if (normalized <= 0) {
    return defaultOptions.maxWorker;
  }
  return normalized > MAX_WORKER_POOL_SIZE
    ? MAX_WORKER_POOL_SIZE
    : normalized;
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
  private singleTransferBufferList: ArrayBuffer[] = [];
  private reusableTransferBufferList: ArrayBuffer[] = [];

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
    const { name } = options;
    const maxWorker = normalizeMaxWorker(options.maxWorker);
    this.options = {
      ...options,
      maxWorker,
    };

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

  postMessage = (message: object, buffers?: ArrayBuffer[]) => {
    const workers = this.workers;
    const workerCount = workers.length;
    if (!buffers || buffers.length === 0) {
      for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
        workers[workerIndex].postMessage(message);
      }
      return;
    }

    if (workerCount === 1) {
      workers[0].postMessage(message, buffers);
      return;
    }

    const bufferCount = buffers.length;
    if (bufferCount === 1) {
      const sourceBuffer = buffers[0];
      const transferBufferList = this.singleTransferBufferList;
      for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
        transferBufferList[0] = sourceBuffer.slice(0);
        workers[workerIndex].postMessage(message, transferBufferList);
      }
      return;
    }

    const transferBuffers = this.reusableTransferBufferList;
    transferBuffers.length = bufferCount;
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
      for (let index = 0; index < bufferCount; index++) {
        transferBuffers[index] = buffers[index].slice(0);
      }
      workers[workerIndex].postMessage(message, transferBuffers);
    }
  };

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
    const available = this.available;
    const workers = this.workers;
    const queue = this.queue;
    while (this.queueHead < queue.length && available.length > 0) {
      const job = queue[this.queueHead];
      if (!job || typeof job !== "object") {
        this.queueHead++;
        this.normalizeQueue();
        continue;
      }
      const { message, buffers, resolve, reject } = job;
      if (!message || typeof message !== "object" || typeof resolve !== "function") {
        this.queueHead++;
        this.normalizeQueue();
        continue;
      }
      const rejectCallback = typeof reject === "function" ? reject : undefined;
      const index = available.pop();
      if (index === undefined) {
        break;
      }
      const worker = workers[index];

      const rejectJob = (reason: Error) => {
        if (rejectCallback) {
          rejectCallback(reason);
        } else {
          console.error(reason);
        }
      };

      const workerCallback = (event: MessageEvent<object>) => {
        const { data } = event;
        WorkerPool.WORKING_COUNT--;
        worker.removeEventListener("message", workerCallback);
        worker.removeEventListener("error", workerErrorCallback);
        worker.removeEventListener("messageerror", workerMessageErrorCallback);
        available.push(index);
        try {
          resolve(data);
        } finally {
          if (this.queueHead < queue.length) {
            this.scheduleProcess();
          }
        }
      };

      const workerErrorCallback = (event: ErrorEvent) => {
        event.preventDefault();
        WorkerPool.WORKING_COUNT--;
        worker.removeEventListener("message", workerCallback);
        worker.removeEventListener("error", workerErrorCallback);
        worker.removeEventListener("messageerror", workerMessageErrorCallback);
        available.push(index);
        try {
          rejectJob(
            new Error(
              event.message || "Worker pool job failed while executing."
            )
          );
        } finally {
          if (this.queueHead < queue.length) {
            this.scheduleProcess();
          }
        }
      };

      const workerMessageErrorCallback = () => {
        WorkerPool.WORKING_COUNT--;
        worker.removeEventListener("message", workerCallback);
        worker.removeEventListener("error", workerErrorCallback);
        worker.removeEventListener("messageerror", workerMessageErrorCallback);
        available.push(index);
        try {
          rejectJob(
            new Error("Worker pool job failed due to response serialization.")
          );
        } finally {
          if (this.queueHead < queue.length) {
            this.scheduleProcess();
          }
        }
      };

      worker.addEventListener("message", workerCallback);
      worker.addEventListener("error", workerErrorCallback);
      worker.addEventListener("messageerror", workerMessageErrorCallback);
      try {
        if (buffers && buffers.length > 0) {
          worker.postMessage(message, buffers);
        } else {
          worker.postMessage(message);
        }
        this.queueHead++;
        this.normalizeQueue();
        WorkerPool.WORKING_COUNT++;
      } catch (error) {
        worker.removeEventListener("message", workerCallback);
        worker.removeEventListener("error", workerErrorCallback);
        worker.removeEventListener("messageerror", workerMessageErrorCallback);
        available.push(index);
        this.queueHead++;
        this.normalizeQueue();
        try {
          rejectJob(
            error instanceof Error
              ? error
              : new Error("Worker pool job failed while dispatching.")
          );
        } finally {
          if (this.queueHead < queue.length) {
            this.scheduleProcess();
          }
        }
      }
    }
  };

  /**
   * Whether or not are there no available workers.
   */
  get isBusy() {
    return this.available.length === 0;
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
