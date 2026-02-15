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

declare module "noisejs" {
  export class Noise {
    constructor(seed?: number);
    seed(seed: number): void;
    simplex2(x: number, y: number): number;
    simplex3(x: number, y: number, z: number): number;
    perlin2(x: number, y: number): number;
    perlin3(x: number, y: number, z: number): number;
  }
}
