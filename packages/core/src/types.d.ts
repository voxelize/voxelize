declare module "*?sharedworker" {
  const SharedWorkerFactory: new () => SharedWorker;
  export default SharedWorkerFactory;
}

declare module "*?sharedworker&inline" {
  const SharedWorkerFactory: new () => SharedWorker;
  export default SharedWorkerFactory;
}

declare module "*?worker" {
  const WebWorkerFactory: new (options?: WorkerOptions) => Worker;
  export default WebWorkerFactory;
}

declare module "*?worker&url" {
  const WebWorkerFactory: new () => Worker;
  export default WebWorkerFactory;
}

declare module "*?worker&inline" {
  const WebWorkerFactory: new (options?: WorkerOptions) => Worker;
  export default WebWorkerFactory;
}

declare module "*.glsl" {
  const value: string;
  export default value;
}

declare module "*.glsl?raw" {
  const value: string;
  export default value;
}

declare module "postprocessing";
