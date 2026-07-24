/**
 * A worker pool job is queued to a worker pool and is executed by a worker.
 */
export type WorkerPoolJob = {
  /**
   * A JSON serializable object that is passed to the worker.
   */
  message: any;

  /**
   * Any array buffers (transferable) that are passed to the worker.
   */
  buffers?: Transferable[];

  /**
   * A callback that is called when the worker has finished executing the job.
   *
   * @param value The result of the job.
   */
  resolve: (value: any) => void;

  /**
   * Milliseconds this job may run before its worker is presumed dead. A
   * worker that OOMs mid-job dies without any error event, which used to
   * leave the slot occupied and the job unresolved forever (frozen
   * lighting/meshing). On timeout the worker is replaced and the job
   * resolves `null`.
   */
  timeoutMs?: number;
};

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
  public queue: WorkerPoolJob[] = [];

  /**
   * Total bytes of transferable payloads sitting in the queue, waiting for
   * a free worker. A sustained climb here means jobs are being enqueued
   * (with their serialized copies) faster than workers drain them.
   */
  get queuedBytes(): number {
    let bytes = 0;
    for (const job of this.queue) {
      if (!job.buffers) continue;
      for (const buffer of job.buffers) {
        if (buffer instanceof ArrayBuffer) bytes += buffer.byteLength;
      }
    }
    return bytes;
  }

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
   * Broadcast messages (worker init/registry state), replayed onto
   * replacement workers so a swapped-in worker is indistinguishable from
   * the original.
   */
  private broadcastMessages: WorkerPoolJob["message"][] = [];

  /**
   * Create a new worker pool.
   *
   * @param Proto The worker class to create.
   * @param options The options to create the worker pool.
   */
  constructor(
    public Proto: new (options?: WorkerOptions) => Worker,
    public options: WorkerPoolOptions = defaultOptions,
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
  addJob = (job: WorkerPoolJob) => {
    this.queue.push(job);
    this.process();
  };

  postMessage = (message: any, buffers?: Transferable[]) => {
    // Transferred buffers are consumed by the first worker and cannot be
    // replayed; only plain broadcasts are remembered for replacements.
    if (!buffers || buffers.length === 0) {
      this.broadcastMessages.push(message);
    }
    for (const worker of this.workers) {
      if (buffers) {
        worker.postMessage(message, { transfer: buffers });
      } else {
        worker.postMessage(message);
      }
    }
  };

  terminate = () => {
    const activeWorkers = this.workingCount;

    for (const worker of this.workers) {
      worker.terminate();
    }

    WorkerPool.WORKING_COUNT = Math.max(
      0,
      WorkerPool.WORKING_COUNT - activeWorkers,
    );
    this.queue = [];
    this.workers = [];
    this.available = [];
  };

  /**
   * Process the queue of jobs. This is called when a worker becomes available or
   * when a new job is added to the queue.
   */
  private process = () => {
    if (this.queue.length !== 0 && this.available.length > 0) {
      const index = this.available.pop() as number;
      const worker = this.workers[index];

      const { message, buffers, resolve, timeoutMs } =
        this.queue.shift() as WorkerPoolJob;

      let isSettled = false;
      let watchdog: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        WorkerPool.WORKING_COUNT--;
        if (watchdog !== null) clearTimeout(watchdog);
        worker.removeEventListener("message", workerCallback);
        worker.removeEventListener("error", workerError);
        worker.removeEventListener("messageerror", workerError);
        this.available.unshift(index);
        if (this.queue.length > 0) {
          queueMicrotask(this.process);
        }
      };

      const workerCallback = ({ data }: any) => {
        if (isSettled) return;
        isSettled = true;
        // A wasm trap poisons the worker's module state permanently (see
        // mesh-worker). Swap in a fresh worker before releasing the slot so
        // the next job never lands on the corpse.
        if (data && data.isWorkerPoisoned) {
          this.replaceWorker(index);
        }
        cleanup();
        resolve(data);
      };

      // Without an error path, a failed light/mesh worker permanently
      // occupies the slot and never resolves the job — which previously
      // also blocked remesh when callers waited on light completion.
      const workerError = (event: ErrorEvent | MessageEvent) => {
        if (isSettled) return;
        isSettled = true;
        console.error("[worker-pool] worker job failed", event);
        cleanup();
        resolve(null);
      };

      if (timeoutMs !== undefined && timeoutMs > 0) {
        watchdog = setTimeout(() => {
          if (isSettled) return;
          isSettled = true;
          // A worker that OOMed died without any event; replace the corpse
          // so the slot comes back, and resolve null so the caller's
          // pipeline keeps moving.
          console.error(
            `[worker-pool] job timed out after ${timeoutMs}ms; replacing worker`,
            this.options.name ?? "",
          );
          this.replaceWorker(index);
          cleanup();
          resolve(null);
        }, timeoutMs);
      }

      worker.addEventListener("message", workerCallback);
      worker.addEventListener("error", workerError);
      worker.addEventListener("messageerror", workerError);
      const transferBuffers = buffers?.filter(
        (buffer): buffer is ArrayBuffer =>
          buffer instanceof ArrayBuffer &&
          (typeof SharedArrayBuffer === "undefined" ||
            !(buffer instanceof SharedArrayBuffer)),
      );
      if (transferBuffers && transferBuffers.length > 0) {
        worker.postMessage(message, { transfer: transferBuffers });
      } else {
        worker.postMessage(message);
      }
      WorkerPool.WORKING_COUNT++;
    }
  };

  private replaceWorker = (index: number) => {
    const dead = this.workers[index];
    if (!dead) return;
    dead.terminate();

    const { name } = this.options;
    const workerOptions: WorkerOptions | undefined = name
      ? { name: `${name}-${index}` }
      : undefined;
    const worker = new this.Proto(workerOptions);
    for (const message of this.broadcastMessages) {
      worker.postMessage(message);
    }
    this.workers[index] = worker;
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
