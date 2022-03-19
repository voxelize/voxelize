import { BlobWorker } from "threads";

import WorkerText, { Runner } from "./test.worker";
// import WorkerText2, { Runner } from "./test2.worker";

export const TestWorker = () => BlobWorker.fromText(WorkerText);
export type { Runner };

// export const Test2Worker = () => BlobWorker.fromText(WorkerText2);
// export type { Runner };
