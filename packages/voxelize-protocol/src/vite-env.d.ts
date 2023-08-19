/// <reference types="vite/client" />

declare module "web-worker:*" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
