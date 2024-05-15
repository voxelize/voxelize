declare module "*?sharedworker" {
  const SharedWorkerFactory: new () => SharedWorker;
  export default SharedWorkerFactory;
}

declare module "*?worker" {
  const WebWorkerFactory: new () => Worker;
  export default WebWorkerFactory;
}

declare module "*.glsl" {
  const value: string;
  export default value;
}

declare module "postprocessing";
