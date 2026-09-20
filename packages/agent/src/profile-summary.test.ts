import { describe, expect, it } from "vitest";

import {
  CpuProfile,
  SamplingHeapProfile,
  formatProfileSummary,
  summarizeProfile,
} from "./profile-summary";

const frame = (functionName: string, url = "", lineNumber = 0) => ({
  functionName,
  url,
  lineNumber,
  columnNumber: 0,
});

/**
 * root -> animate -> update -> measureWaterColumn -> getBlockAt
 *                 -> render
 *      -> (idle), (garbage collector), (program)
 */
const cpu: CpuProfile = {
  nodes: [
    { id: 1, callFrame: frame("(root)"), children: [2, 7, 8, 9] },
    {
      id: 2,
      callFrame: frame("animate", "http://x/app.js?v=1", 9),
      children: [3, 6],
    },
    { id: 3, callFrame: frame("update", "http://x/app.js", 19), children: [4] },
    {
      id: 4,
      callFrame: frame("measureWaterColumn", "http://x/core.js", 99),
      children: [5],
    },
    { id: 5, callFrame: frame("getBlockAt", "http://x/core.js", 199) },
    { id: 6, callFrame: frame("render", "http://x/three.js", 29) },
    { id: 7, callFrame: frame("(idle)") },
    { id: 8, callFrame: frame("(garbage collector)") },
    { id: 9, callFrame: frame("(program)") },
  ],
  // 10 samples of 1000us each: 3 getBlockAt, 1 measureWaterColumn, 2 render,
  // 2 idle, 1 gc, 1 program.
  samples: [5, 5, 5, 4, 6, 6, 7, 7, 8, 9],
  timeDeltas: new Array(10).fill(1000),
};

const heap: SamplingHeapProfile = {
  head: {
    callFrame: frame("(root)"),
    selfSize: 0,
    children: [
      {
        callFrame: frame("animate", "http://x/app.js", 9),
        selfSize: 0,
        children: [
          {
            callFrame: frame("getBlockAt", "http://x/core.js", 199),
            selfSize: 3 * 1048576,
            children: [],
          },
        ],
      },
      {
        callFrame: frame("render", "http://x/three.js", 29),
        selfSize: 1048576,
        children: [],
      },
    ],
  },
};

describe("summarizeProfile", () => {
  it("attributes self and inclusive time per rendered frame, idle excluded", () => {
    const summary = summarizeProfile(cpu, null, {
      durationMs: 1000,
      frames: 4,
      watch: /water|getblockat/i,
    });

    // 8ms busy of 10ms sampled, over 4 frames.
    expect(summary.busyMsPerFrame).toBeCloseTo(2);
    expect(summary.busyShare).toBeCloseTo(0.8);
    expect(summary.gcMsPerFrame).toBeCloseTo(0.25);
    expect(summary.programMsPerFrame).toBeCloseTo(0.25);
    expect(summary.fps).toBeCloseTo(4);

    const byLabel = new Map(summary.topInclusive.map((c) => [c.label, c]));
    const getBlockAt = byLabel.get("getBlockAt core.js:200");
    expect(getBlockAt?.selfMsPerFrame).toBeCloseTo(0.75);
    expect(getBlockAt?.inclusiveMsPerFrame).toBeCloseTo(0.75);
    const column = byLabel.get("measureWaterColumn core.js:100");
    expect(column?.selfMsPerFrame).toBeCloseTo(0.25);
    expect(column?.inclusiveMsPerFrame).toBeCloseTo(1);
    expect(column?.inclusiveShare).toBeCloseTo(0.5);
    // The query string is stripped from the file label.
    expect(byLabel.get("animate app.js:10")?.inclusiveMsPerFrame).toBeCloseTo(
      1.5,
    );

    expect(summary.watch.map((c) => c.label)).toEqual([
      "measureWaterColumn core.js:100",
      "getBlockAt core.js:200",
    ]);
    expect(summary.topSelf[0].label).toBe("getBlockAt core.js:200");
    expect(summary.allocation).toBeNull();
  });

  it("reports sampled allocation per second, self and inclusive", () => {
    const summary = summarizeProfile(cpu, heap, {
      durationMs: 2000,
      frames: 120,
      watch: /getblockat/i,
    });
    const allocation = summary.allocation;
    expect(allocation).not.toBeNull();
    expect(allocation?.totalMBPerSecond).toBeCloseTo(2);
    expect(allocation?.topSelf[0]).toMatchObject({
      label: "getBlockAt core.js:200",
      selfMBPerSecond: 1.5,
      inclusiveMBPerSecond: 1.5,
    });
    const animate = allocation?.topInclusive.find(
      (c) => c.label === "animate app.js:10",
    );
    expect(animate?.selfMBPerSecond).toBe(0);
    expect(animate?.inclusiveMBPerSecond).toBeCloseTo(1.5);
    expect(allocation?.watch.map((c) => c.label)).toEqual([
      "getBlockAt core.js:200",
    ]);
  });

  it("never divides by a zero frame count", () => {
    const summary = summarizeProfile(cpu, null, {
      durationMs: 1000,
      frames: 0,
    });
    expect(Number.isFinite(summary.busyMsPerFrame)).toBe(true);
    expect(summary.frames).toBe(1);
  });

  it("formats a readable report with the watch list first", () => {
    const lines = formatProfileSummary(
      summarizeProfile(cpu, heap, {
        durationMs: 1000,
        frames: 4,
        watch: /water/i,
      }),
    );
    expect(lines[0]).toContain("busy 2.00 ms/frame");
    expect(lines[1]).toBe("watch (self / inclusive, per frame):");
    expect(lines[2]).toContain("measureWaterColumn core.js:100");
    expect(lines.some((l) => l.startsWith("allocation: "))).toBe(true);
  });
});
