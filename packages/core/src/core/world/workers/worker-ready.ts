/**
 * What a worker with an asynchronous start-up posts once it can take jobs;
 * the pools that run it pass this as `readyMessageType`.
 */
export const WORKER_READY_MESSAGE_TYPE = "worker-ready";
