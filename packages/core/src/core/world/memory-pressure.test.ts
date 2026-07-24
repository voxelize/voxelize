import { describe, expect, it } from "vitest";

import {
  HeapSample,
  MemoryPressureMonitor,
  MemoryPressureOptions,
} from "./memory-pressure";

const options: Partial<MemoryPressureOptions> = {
  sheddingHeapRatio: 0.8,
  recoveryHeapRatio: 0.6,
  sheddingSampleCount: 2,
  shedCooldownMs: 1000,
};

const limitBytes = 1000;

const monitorReading = (usedRatios: number[]) => {
  let index = 0;
  const monitor = new MemoryPressureMonitor(options, () => {
    const ratio = usedRatios[Math.min(index, usedRatios.length - 1)];
    index++;
    return { usedBytes: ratio * limitBytes, limitBytes };
  });
  return monitor;
};

describe("MemoryPressureMonitor heap availability", () => {
  it("stays steady forever when the engine exposes no heap numbers", () => {
    const monitor = new MemoryPressureMonitor(options, () => null);

    for (let now = 0; now < 10_000; now += 1000) {
      expect(monitor.sample(now)).toBe("steady");
    }

    const status = monitor.getStatus();
    expect(status.isHeapReadable).toBe(false);
    expect(status.isUnderPressure).toBe(false);
    expect(status.shedCount).toBe(0);
  });

  it("stays steady when the reported limit is zero", () => {
    const sample: HeapSample = { usedBytes: 500, limitBytes: 0 };
    const monitor = new MemoryPressureMonitor(options, () => sample);

    expect(monitor.sample(0)).toBe("steady");
    expect(monitor.getStatus().isHeapReadable).toBe(false);
  });
});

describe("MemoryPressureMonitor shedding", () => {
  it("requires consecutive over-threshold samples before shedding", () => {
    const monitor = monitorReading([0.85, 0.85]);

    expect(monitor.sample(0)).toBe("steady");
    expect(monitor.sample(1000)).toBe("shed");
    expect(monitor.getStatus().isUnderPressure).toBe(true);
    expect(monitor.getStatus().shedCount).toBe(1);
  });

  it("resets the streak when a sample drops back under the threshold", () => {
    const monitor = monitorReading([0.85, 0.5, 0.85, 0.85]);

    expect(monitor.sample(0)).toBe("steady");
    expect(monitor.sample(1000)).toBe("steady");
    expect(monitor.sample(2000)).toBe("steady");
    expect(monitor.sample(3000)).toBe("shed");
  });

  it("rate-limits repeat shedding while pressure persists", () => {
    const monitor = monitorReading([0.85]);

    expect(monitor.sample(0)).toBe("steady");
    expect(monitor.sample(1000)).toBe("shed");
    expect(monitor.sample(1500)).toBe("steady");
    expect(monitor.sample(2000)).toBe("shed");
    expect(monitor.getStatus().shedCount).toBe(2);
  });

  it("reports the heap it sampled", () => {
    const monitor = monitorReading([0.85]);
    monitor.sample(0);

    const status = monitor.getStatus();
    expect(status.isHeapReadable).toBe(true);
    expect(status.heapRatio).toBeCloseTo(0.85);
    expect(status.heapUsedBytes).toBe(850);
    expect(status.heapLimitBytes).toBe(limitBytes);
  });
});

describe("MemoryPressureMonitor hysteresis", () => {
  it("holds pressure between the recovery and shedding ratios", () => {
    const monitor = monitorReading([0.85, 0.85, 0.7, 0.7]);

    monitor.sample(0);
    expect(monitor.sample(1000)).toBe("shed");
    // 0.7 is under the shedding ratio but over recovery: still shedding.
    expect(monitor.sample(3000)).toBe("shed");
    expect(monitor.getStatus().isUnderPressure).toBe(true);
  });

  it("relieves at or below the recovery ratio and can trip again", () => {
    const monitor = monitorReading([0.85, 0.85, 0.5, 0.85, 0.85]);

    monitor.sample(0);
    expect(monitor.sample(1000)).toBe("shed");
    expect(monitor.sample(2000)).toBe("relieved");
    expect(monitor.getStatus().isUnderPressure).toBe(false);

    expect(monitor.sample(3000)).toBe("steady");
    expect(monitor.sample(4000)).toBe("shed");
  });

  it("never starts an interval when sampling is disabled", () => {
    const monitor = new MemoryPressureMonitor(
      { ...options, sampleIntervalMs: 0 },
      () => ({ usedBytes: limitBytes, limitBytes }),
    );

    let verdictCount = 0;
    monitor.start(() => verdictCount++);
    monitor.stop();

    expect(verdictCount).toBe(0);
  });

  it("clamps an inverted ratio pair so it cannot shed and relieve at once", () => {
    const monitor = new MemoryPressureMonitor(
      { ...options, sheddingHeapRatio: 0.6, recoveryHeapRatio: 0.9 },
      () => ({ usedBytes: 0.7 * limitBytes, limitBytes }),
    );

    expect(monitor.options.recoveryHeapRatio).toBe(0.6);
    monitor.sample(0);
    expect(monitor.sample(1000)).toBe("shed");
    expect(monitor.sample(5000)).toBe("shed");
  });
});
