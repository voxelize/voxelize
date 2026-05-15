import type { Chunk } from "../core/world/chunk";

import { ChunkSharedPool } from "./chunk-shared-pool";
import {
  MeshTransferBenchmarkIteration,
  MeshTransferBenchmarkModeResult,
  MeshTransferBenchmarkResult,
  WorkerTransfer,
  WorkerTransferStrategy,
} from "./worker-transfer";

export type MeshTransferBenchmarkOptions = {
  cx: number;
  cz: number;
  level?: number;
  warmupIterations?: number;
  measuredIterations?: number;
};

export type MeshTransferDispatch = (
  cx: number,
  cz: number,
  level: number,
) => Promise<{
  geometries: object[];
  serializeMs: number;
  workerMs: number;
  inputBytes: number;
  outputBytes: number;
} | null>;

async function runModeBenchmark(
  strategy: WorkerTransferStrategy,
  dispatch: MeshTransferDispatch,
  cx: number,
  cz: number,
  level: number,
  warmupIterations: number,
  measuredIterations: number,
): Promise<MeshTransferBenchmarkModeResult> {
  const previousMode = WorkerTransfer.getMode();
  WorkerTransfer.setStrategy(strategy);

  const runIteration =
    async (): Promise<MeshTransferBenchmarkIteration | null> => {
      const result = await dispatch(cx, cz, level);
      if (!result) return null;
      return {
        serializeMs: result.serializeMs,
        workerMs: result.workerMs,
        totalMs: result.serializeMs + result.workerMs,
        inputBytes: result.inputBytes,
        outputBytes: result.outputBytes,
      };
    };

  for (let i = 0; i < warmupIterations; i++) {
    await runIteration();
  }

  const measured: MeshTransferBenchmarkIteration[] = [];
  for (let i = 0; i < measuredIterations; i++) {
    const iteration = await runIteration();
    if (iteration) {
      measured.push(iteration);
    }
  }

  WorkerTransfer.configure({ mode: previousMode });

  return WorkerTransfer.summarizeIterations(
    strategy,
    warmupIterations,
    measured,
  );
}

export async function runMeshTransferBenchmark(
  dispatch: MeshTransferDispatch,
  getChunk: (cx: number, cz: number) => Chunk | undefined,
  options: MeshTransferBenchmarkOptions,
): Promise<MeshTransferBenchmarkResult> {
  const {
    cx,
    cz,
    level = 0,
    warmupIterations = 2,
    measuredIterations = 8,
  } = options;

  const centerChunk = getChunk(cx, cz);
  if (!centerChunk?.isReady) {
    throw new Error(`chunk ${cx}|${cz} is not ready for mesh benchmarking`);
  }

  const transfer = await runModeBenchmark(
    "transfer",
    dispatch,
    cx,
    cz,
    level,
    warmupIterations,
    measuredIterations,
  );

  const shared = await runModeBenchmark(
    "shared",
    dispatch,
    cx,
    cz,
    level,
    warmupIterations,
    measuredIterations,
  );

  return WorkerTransfer.buildComparison(cx, cz, level, transfer, shared);
}

export function getMeshTransferStatus() {
  return {
    mode: WorkerTransfer.getMode(),
    strategy: WorkerTransfer.getStrategy(),
    isSharedArrayBufferAvailable: WorkerTransfer.isSharedArrayBufferAvailable(),
    isCrossOriginIsolated:
      typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
    pool: ChunkSharedPool.getInstance().getStats(),
    stats: WorkerTransfer.getStats(),
  };
}
