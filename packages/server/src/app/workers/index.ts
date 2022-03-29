import { BlobWorker } from "threads";

import HeightMapWorkerText, { HeightMapperType } from "./height-map.worker";
import LightMeshWorkerText, { LightMesherType } from "./light-mesh.worker";
import TestWorkerText, { TesterType } from "./test.worker";

export const TestWorker = () => BlobWorker.fromText(TestWorkerText);
export const HeightMapWorker = () => BlobWorker.fromText(HeightMapWorkerText);
export const LightMeshWorker = () => BlobWorker.fromText(LightMeshWorkerText);

export type { TesterType };
export type { HeightMapperType };
export type { LightMesherType };
