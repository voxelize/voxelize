import { BlobWorker } from "threads";

import HeightMapWorkerText, { HeightMapperType } from "./height-map.worker";
import LightWorkerText, { LighterType } from "./lights.worker";
import MeshWorkerText, { MesherType } from "./mesh.worker";
import TestWorkerText, { TesterType } from "./test.worker";

export const TestWorker = () => BlobWorker.fromText(TestWorkerText);
export const LightWorker = () => BlobWorker.fromText(LightWorkerText);
export const HeightMapWorker = () => BlobWorker.fromText(HeightMapWorkerText);
export const MeshWorker = () => BlobWorker.fromText(MeshWorkerText);

export type { LighterType };
export type { TesterType };
export type { HeightMapperType };
export type { MesherType };
