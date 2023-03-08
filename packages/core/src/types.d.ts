declare module "web-worker:*" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module "*.glsl" {
  const value: string;
  export default value;
}
