declare module "shared-worker:*" {
  const SharedWorkerFactory: new () => SharedWorker;
  export default SharedWorkerFactory;
}

declare module "web-worker:*" {
  const WebWorkerFactory: new () => Worker;
  export default WebWorkerFactory;
}

declare module "*.glsl" {
  const value: string;
  export default value;
}

declare module "postprocessing";
