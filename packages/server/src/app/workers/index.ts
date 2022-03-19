import { BlobWorker } from "threads";

import WorkerText from "./test2.worker";

export const Test2Worker = BlobWorker.fromText(WorkerText);
