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

  /**
   * Jobs allowed to wait for a free worker before the oldest are shed
   * (resolved `null`, exactly like a dead worker). Left undefined the queue
   * is unbounded, which is only safe when the caller gates dispatch on
   * {@link WorkerPool.availableCount}: every queued job holds its serialized
   * payload alive, so a caller that enqueues faster than workers drain turns
   * the queue into an unbounded allocation. Opt in only from callers that
   * treat a `null` result as a retryable failure.
   */
  maxQueuedJobs?: number;

  /**
   * The `type` of the message a worker posts once its start-up has finished,
   * for workers whose start-up is asynchronous (a wasm module instantiating
   * on `init`). Until a worker has posted it the pool hands it no job, a
   * replacement included, and a job's reply is never mistaken for it.
   * Without it a worker takes jobs as soon as it exists.
   */
  readyMessageType?: string;
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
   * The list of available workers' indices, the one released last first.
   */
  private available: number[] = [];

  /**
   * Whether each slot's worker has finished starting (see
   * {@link WorkerPoolOptions.readyMessageType}); one still starting is in
   * neither `available` nor flight.
   */
  private isReady: boolean[] = [];

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
      if (options.readyMessageType === undefined) {
        this.isReady.push(true);
        this.available.push(i);
      } else {
        this.isReady.push(false);
        this.joinWhenReady(i, worker);
      }
    }
  }

  /**
   * Puts a slot's worker into `available` once it posts the ready message.
   * The slot is out of flight by then: a replacement is swapped in by a job's
   * own settling, whose cleanup leaves a starting worker's slot alone.
   */
  private joinWhenReady = (index: number, worker: Worker) => {
    const { readyMessageType } = this.options;
    const onMessage = ({ data }: MessageEvent) => {
      if (data?.type !== readyMessageType) return;
      worker.removeEventListener("message", onMessage);
      if (this.workers[index] !== worker) return;
      this.isReady[index] = true;
      this.available.unshift(index);
      this.process();
    };
    worker.addEventListener("message", onMessage);
  };

  /**
   * Append a new job to be executed by a worker.
   *
   * @param job The job to queue.
   */
  addJob = (job: WorkerPoolJob) => {
    this.queue.push(job);

    const { maxQueuedJobs } = this.options;
    if (maxQueuedJobs !== undefined) {
      const excess = this.queue.length - Math.max(1, maxQueuedJobs);
      if (excess > 0) {
        this.shedJobs(this.queue.splice(0, excess));
      }
    }

    this.process();
  };

  /**
   * Drop every job still waiting for a worker, resolving each `null`. Used to
   * release the serialized payloads parked in the queue when the renderer is
   * under memory pressure; in-flight jobs are left alone.
   *
   * @returns The number of jobs dropped.
   */
  drainQueue = (): number => {
    const dropped = this.queue.splice(0);
    this.shedJobs(dropped);
    return dropped.length;
  };

  private shedJobs = (jobs: WorkerPoolJob[]) => {
    for (const job of jobs) {
      job.resolve(null);
    }
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
    this.isReady = [];
  };

  /**
   * Process the queue of jobs. This is called when a worker becomes available or
   * when a new job is added to the queue.
   */
  private process = () => {
    if (this.queue.length !== 0 && this.available.length > 0) {
      // The worker released last takes the job, so a light load keeps one
      // worker warm and leaves the rest at the small heaps they started
      // with: every worker is an isolate drawing on the renderer's one
      // shared heap cage, and rotating through every idle worker grew all of
      // their heaps for a load one could carry.
      const index = this.available.shift() as number;
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
        // A replacement still starting rejoins when it reports ready.
        if (this.isReady[index]) this.available.unshift(index);
        if (this.queue.length > 0) {
          queueMicrotask(this.process);
        }
      };

      const workerCallback = ({ data }: any) => {
        // A worker re-running `init` (a registry update) reports ready
        // again; that is not this job's answer.
        if (
          this.options.readyMessageType !== undefined &&
          data?.type === this.options.readyMessageType
        ) {
          return;
        }
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
    // The replayed `init` has not run yet; a job handed over now would reach
    // a worker that cannot serve it (the mesh worker answers with nothing).
    if (this.options.readyMessageType !== undefined) {
      this.isReady[index] = false;
      this.joinWhenReady(index, worker);
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
    let starting = 0;
    for (let i = 0; i < this.workers.length; i++) {
      if (!this.isReady[i]) starting++;
    }
    return this.workers.length - this.available.length - starting;
  }

  /**
   * The number of workers that are available to take jobs.
   */
  get availableCount() {
    return this.available.length;
  }
}
