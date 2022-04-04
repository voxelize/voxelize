import { BlobWorker } from "threads";

import EncodeWorkerText, { EncoderType } from "./encoder.worker";
import HeightMapWorkerText, { HeightMapperType } from "./height-map.worker";
import LightMeshWorkerText, { LightMesherType } from "./light-mesh.worker";
import TestWorkerText, { TesterType } from "./test.worker";

export const TestWorker = () => BlobWorker.fromText(TestWorkerText);
export const HeightMapWorker = () => BlobWorker.fromText(HeightMapWorkerText);
export const LightMeshWorker = () => BlobWorker.fromText(LightMeshWorkerText);
export const EncodeWorker = () => BlobWorker.fromText(EncodeWorkerText);

export type { TesterType };
export type { HeightMapperType };
export type { LightMesherType };
export type { EncoderType };
