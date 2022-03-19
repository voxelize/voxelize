declare module "*?worker" {
  const WorkerFactory: new () => import("worker_thread").Worker;
  export default WorkerFactory;
}

declare module "**/*.worker" {
  const WorkerText: string;
  export default WorkerText;
}
