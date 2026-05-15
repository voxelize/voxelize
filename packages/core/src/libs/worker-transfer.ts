import { ChunkSharedPool } from "./chunk-shared-pool";

export type WorkerTransferStrategy = "transfer" | "shared";

export type WorkerTransferMode = "auto" | WorkerTransferStrategy;

export type MeshWorkerTransferSample = {
  strategy: WorkerTransferStrategy;
  serializeMs: number;
  workerMs: number;
  totalMs: number;
  inputBytes: number;
  outputBytes: number;
  at: number;
};

export type MeshWorkerTransferStats = {
  strategy: WorkerTransferStrategy;
  jobCount: number;
  totalSerializeMs: number;
  totalWorkerMs: number;
  totalInputBytes: number;
  totalOutputBytes: number;
  recentSamples: MeshWorkerTransferSample[];
};

export type MeshTransferBenchmarkIteration = {
  serializeMs: number;
  workerMs: number;
  totalMs: number;
  inputBytes: number;
  outputBytes: number;
};

export type MeshTransferBenchmarkModeResult = {
  strategy: WorkerTransferStrategy;
  isSharedArrayBufferAvailable: boolean;
  warmupIterations: number;
  measuredIterations: number;
  iterations: MeshTransferBenchmarkIteration[];
  avgSerializeMs: number;
  avgWorkerMs: number;
  avgTotalMs: number;
  p50TotalMs: number;
  p95TotalMs: number;
  totalInputBytes: number;
  totalOutputBytes: number;
};

export type MeshTransferBenchmarkResult = {
  cx: number;
  cz: number;
  level: number;
  transfer: MeshTransferBenchmarkModeResult;
  shared: MeshTransferBenchmarkModeResult;
  speedup: number;
  serializeSpeedup: number;
};

export type WorkerTransferConfig = {
  mode: WorkerTransferMode;
  maxRecentSamples: number;
};

const defaultConfig: WorkerTransferConfig = {
  mode: "auto",
  maxRecentSamples: 64,
};

export class WorkerTransfer {
  private static config: WorkerTransferConfig = { ...defaultConfig };
  private static forcedStrategy: WorkerTransferStrategy | null = null;
  private static statsByStrategy = new Map<
    WorkerTransferStrategy,
    MeshWorkerTransferStats
  >([
    ["transfer", WorkerTransfer.emptyStats("transfer")],
    ["shared", WorkerTransfer.emptyStats("shared")],
  ]);

  static configure(config: Partial<WorkerTransferConfig>): void {
    WorkerTransfer.config = { ...WorkerTransfer.config, ...config };
    if (config.mode === "transfer" || config.mode === "shared") {
      WorkerTransfer.forcedStrategy = config.mode;
    } else if (config.mode === "auto") {
      WorkerTransfer.forcedStrategy = null;
    }
  }

  static getMode(): WorkerTransferMode {
    return WorkerTransfer.config.mode;
  }

  static isSharedArrayBufferAvailable(): boolean {
    return ChunkSharedPool.isSharedArrayBufferAvailable();
  }

  static getStrategy(): WorkerTransferStrategy {
    if (WorkerTransfer.forcedStrategy) {
      return WorkerTransfer.forcedStrategy;
    }
    return WorkerTransfer.isSharedArrayBufferAvailable()
      ? "shared"
      : "transfer";
  }

  static setStrategy(strategy: WorkerTransferStrategy): void {
    WorkerTransfer.forcedStrategy = strategy;
    WorkerTransfer.config.mode = strategy;
  }

  static getStats(
    strategy?: WorkerTransferStrategy,
  ):
    | MeshWorkerTransferStats
    | Record<WorkerTransferStrategy, MeshWorkerTransferStats> {
    if (strategy) {
      const stats = WorkerTransfer.statsByStrategy.get(strategy);
      if (!stats) {
        return WorkerTransfer.emptyStats(strategy);
      }
      return stats;
    }
    return {
      transfer:
        WorkerTransfer.statsByStrategy.get("transfer") ??
        WorkerTransfer.emptyStats("transfer"),
      shared:
        WorkerTransfer.statsByStrategy.get("shared") ??
        WorkerTransfer.emptyStats("shared"),
    };
  }

  static resetStats(): void {
    WorkerTransfer.statsByStrategy.set(
      "transfer",
      WorkerTransfer.emptyStats("transfer"),
    );
    WorkerTransfer.statsByStrategy.set(
      "shared",
      WorkerTransfer.emptyStats("shared"),
    );
  }

  static recordSample(sample: MeshWorkerTransferSample): void {
    const stats =
      WorkerTransfer.statsByStrategy.get(sample.strategy) ??
      WorkerTransfer.emptyStats(sample.strategy);
    WorkerTransfer.statsByStrategy.set(sample.strategy, stats);
    stats.jobCount += 1;
    stats.totalSerializeMs += sample.serializeMs;
    stats.totalWorkerMs += sample.workerMs;
    stats.totalInputBytes += sample.inputBytes;
    stats.totalOutputBytes += sample.outputBytes;
    stats.recentSamples.push(sample);
    const overflow =
      stats.recentSamples.length - WorkerTransfer.config.maxRecentSamples;
    if (overflow > 0) {
      stats.recentSamples.splice(0, overflow);
    }
  }

  static summarizeIterations(
    strategy: WorkerTransferStrategy,
    warmupIterations: number,
    measuredIterations: MeshTransferBenchmarkIteration[],
  ): MeshTransferBenchmarkModeResult {
    const totals = measuredIterations.map((iteration) => iteration.totalMs);
    const sortedTotals = [...totals].sort((a, b) => a - b);
    const count = measuredIterations.length || 1;

    const sum = (values: number[]) =>
      values.reduce((acc, value) => acc + value, 0);

    return {
      strategy,
      isSharedArrayBufferAvailable:
        WorkerTransfer.isSharedArrayBufferAvailable(),
      warmupIterations,
      measuredIterations: measuredIterations.length,
      iterations: measuredIterations,
      avgSerializeMs:
        sum(measuredIterations.map((iteration) => iteration.serializeMs)) /
        count,
      avgWorkerMs:
        sum(measuredIterations.map((iteration) => iteration.workerMs)) / count,
      avgTotalMs: sum(totals) / count,
      p50TotalMs: WorkerTransfer.percentile(sortedTotals, 0.5),
      p95TotalMs: WorkerTransfer.percentile(sortedTotals, 0.95),
      totalInputBytes: sum(
        measuredIterations.map((iteration) => iteration.inputBytes),
      ),
      totalOutputBytes: sum(
        measuredIterations.map((iteration) => iteration.outputBytes),
      ),
    };
  }

  static buildComparison(
    cx: number,
    cz: number,
    level: number,
    transfer: MeshTransferBenchmarkModeResult,
    shared: MeshTransferBenchmarkModeResult,
  ): MeshTransferBenchmarkResult {
    const speedup =
      shared.avgTotalMs > 0 ? transfer.avgTotalMs / shared.avgTotalMs : 1;
    const serializeSpeedup =
      shared.avgSerializeMs > 0
        ? transfer.avgSerializeMs / shared.avgSerializeMs
        : 1;

    return {
      cx,
      cz,
      level,
      transfer,
      shared,
      speedup,
      serializeSpeedup,
    };
  }

  private static emptyStats(
    strategy: WorkerTransferStrategy,
  ): MeshWorkerTransferStats {
    return {
      strategy,
      jobCount: 0,
      totalSerializeMs: 0,
      totalWorkerMs: 0,
      totalInputBytes: 0,
      totalOutputBytes: 0,
      recentSamples: [],
    };
  }

  private static percentile(sortedValues: number[], quantile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.min(
      sortedValues.length - 1,
      Math.max(0, Math.ceil(sortedValues.length * quantile) - 1),
    );
    return sortedValues[index] ?? 0;
  }
}
