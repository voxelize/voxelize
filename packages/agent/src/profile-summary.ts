/**
 * Turns a V8 CPU profile (and, optionally, a sampling heap profile) into the
 * per-function, per-frame numbers a perf claim needs: where the main thread's
 * time went, expressed in milliseconds per rendered frame, and which
 * functions allocated the garbage the collector had to chase.
 *
 * Pure: the daemon feeds it the raw `Profiler.stop` / `HeapProfiler.stopSampling`
 * payloads plus the frame count it counted in the page, and tests feed it
 * hand-built profiles.
 */

export type CpuProfileNode = {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount?: number;
  children?: number[];
};

export type CpuProfile = {
  nodes: CpuProfileNode[];
  samples: number[];
  timeDeltas: number[];
};

export type SamplingHeapProfileNode = {
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  selfSize: number;
  children: SamplingHeapProfileNode[];
};

export type SamplingHeapProfile = {
  head: SamplingHeapProfileNode;
};

export type ProfileFunctionCost = {
  /** `functionName file:line`, the same label the DevTools profiler shows. */
  label: string;
  /** Main-thread milliseconds spent in this function per rendered frame. */
  selfMsPerFrame: number;
  /** Including callees, per rendered frame. */
  inclusiveMsPerFrame: number;
  /** Share of the busy (non-idle) samples, inclusive. */
  inclusiveShare: number;
};

export type ProfileAllocationCost = {
  label: string;
  /** Sampled bytes allocated directly by this function, per second. */
  selfMBPerSecond: number;
  /** Including callees, per second. */
  inclusiveMBPerSecond: number;
};

export type ProfileSummary = {
  durationMs: number;
  /** rAF callbacks the page ran during the window. */
  frames: number;
  fps: number;
  /** Sampled main-thread time that was not `(idle)`, per frame. */
  busyMsPerFrame: number;
  busyShare: number;
  gcMsPerFrame: number;
  /** V8's `(program)` bucket: native work it cannot attribute to JS. */
  programMsPerFrame: number;
  topSelf: ProfileFunctionCost[];
  topInclusive: ProfileFunctionCost[];
  /** Every function whose label matches the requested pattern. */
  watch: ProfileFunctionCost[];
  allocation: {
    totalMBPerSecond: number;
    topSelf: ProfileAllocationCost[];
    topInclusive: ProfileAllocationCost[];
    watch: ProfileAllocationCost[];
  } | null;
};

export type SummarizeProfileOptions = {
  durationMs: number;
  frames: number;
  top?: number;
  /** Case-insensitive; matched against the function label. */
  watch?: RegExp | null;
};

function labelOf(callFrame: CpuProfileNode["callFrame"]): string {
  const file = callFrame.url
    ? (callFrame.url.split("/").pop() ?? "").split("?")[0]
    : "";
  return `${callFrame.functionName || "(anonymous)"} ${file}:${callFrame.lineNumber + 1}`;
}

function sortedTop<T>(
  entries: Map<string, T>,
  score: (value: T) => number,
  count: number,
  filter?: (label: string) => boolean,
): [string, T][] {
  return [...entries.entries()]
    .filter(([label]) => (filter ? filter(label) : true))
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, count);
}

export function summarizeProfile(
  cpu: CpuProfile,
  heap: SamplingHeapProfile | null,
  options: SummarizeProfileOptions,
): ProfileSummary {
  const { durationMs } = options;
  const frames = Math.max(1, options.frames);
  const top = options.top ?? 25;
  const watch = options.watch ?? null;
  const matches = (label: string): boolean =>
    watch !== null && watch.test(label);

  const nodes = new Map<number, CpuProfileNode>();
  const parent = new Map<number, number>();
  for (const node of cpu.nodes) {
    nodes.set(node.id, node);
    for (const child of node.children ?? []) parent.set(child, node.id);
  }
  const labels = new Map<number, string>();
  const labelFor = (id: number): string => {
    let label = labels.get(id);
    if (label === undefined) {
      const node = nodes.get(id);
      label = node ? labelOf(node.callFrame) : `(unknown ${id})`;
      labels.set(id, label);
    }
    return label;
  };

  const selfUs = new Map<string, number>();
  const inclusiveUs = new Map<string, number>();
  let totalUs = 0;
  let idleUs = 0;
  let gcUs = 0;
  let programUs = 0;
  const seen = new Set<string>();
  for (let i = 0; i < cpu.samples.length; i++) {
    const id = cpu.samples[i];
    const delta = cpu.timeDeltas[i] ?? 0;
    totalUs += delta;
    const node = nodes.get(id);
    const name = node?.callFrame.functionName ?? "";
    if (name === "(idle)") {
      idleUs += delta;
      continue;
    }
    if (name === "(garbage collector)") gcUs += delta;
    if (name === "(program)") programUs += delta;
    const label = labelFor(id);
    selfUs.set(label, (selfUs.get(label) ?? 0) + delta);
    seen.clear();
    let cursor: number | undefined = id;
    while (cursor !== undefined) {
      const ancestor = labelFor(cursor);
      if (!seen.has(ancestor)) {
        seen.add(ancestor);
        inclusiveUs.set(ancestor, (inclusiveUs.get(ancestor) ?? 0) + delta);
      }
      cursor = parent.get(cursor);
    }
  }
  const busyUs = totalUs - idleUs;
  const perFrame = (us: number): number => us / 1000 / frames;
  const cost = (label: string): ProfileFunctionCost => ({
    label,
    selfMsPerFrame: perFrame(selfUs.get(label) ?? 0),
    inclusiveMsPerFrame: perFrame(inclusiveUs.get(label) ?? 0),
    inclusiveShare: busyUs > 0 ? (inclusiveUs.get(label) ?? 0) / busyUs : 0,
  });

  const watchLabels = new Set<string>();
  if (watch) {
    for (const label of selfUs.keys())
      if (matches(label)) watchLabels.add(label);
    for (const label of inclusiveUs.keys()) {
      if (matches(label)) watchLabels.add(label);
    }
  }

  let allocation: ProfileSummary["allocation"] = null;
  if (heap) {
    const selfBytes = new Map<string, number>();
    const inclusiveBytes = new Map<string, number>();
    let totalBytes = 0;
    const walk = (node: SamplingHeapProfileNode, chain: string[]): void => {
      const label = labelOf(node.callFrame);
      totalBytes += node.selfSize;
      selfBytes.set(label, (selfBytes.get(label) ?? 0) + node.selfSize);
      const lineage = [...chain, label];
      const counted = new Set<string>();
      for (const ancestor of lineage) {
        if (counted.has(ancestor)) continue;
        counted.add(ancestor);
        inclusiveBytes.set(
          ancestor,
          (inclusiveBytes.get(ancestor) ?? 0) + node.selfSize,
        );
      }
      for (const child of node.children) walk(child, lineage);
    };
    walk(heap.head, []);
    const seconds = Math.max(durationMs / 1000, 1e-3);
    const perSecondMB = (bytes: number): number => bytes / 1048576 / seconds;
    const allocationCost = (label: string): ProfileAllocationCost => ({
      label,
      selfMBPerSecond: perSecondMB(selfBytes.get(label) ?? 0),
      inclusiveMBPerSecond: perSecondMB(inclusiveBytes.get(label) ?? 0),
    });
    const allocationWatch = new Set<string>();
    if (watch) {
      for (const label of inclusiveBytes.keys()) {
        if (matches(label)) allocationWatch.add(label);
      }
    }
    allocation = {
      totalMBPerSecond: perSecondMB(totalBytes),
      topSelf: sortedTop(selfBytes, (v) => v, top).map(([label]) =>
        allocationCost(label),
      ),
      topInclusive: sortedTop(inclusiveBytes, (v) => v, top).map(([label]) =>
        allocationCost(label),
      ),
      watch: [...allocationWatch]
        .map(allocationCost)
        .sort((a, b) => b.inclusiveMBPerSecond - a.inclusiveMBPerSecond),
    };
  }

  return {
    durationMs,
    frames,
    fps: durationMs > 0 ? frames / (durationMs / 1000) : 0,
    busyMsPerFrame: perFrame(busyUs),
    busyShare: totalUs > 0 ? busyUs / totalUs : 0,
    gcMsPerFrame: perFrame(gcUs),
    programMsPerFrame: perFrame(programUs),
    topSelf: sortedTop(selfUs, (v) => v, top).map(([label]) => cost(label)),
    topInclusive: sortedTop(inclusiveUs, (v) => v, top).map(([label]) =>
      cost(label),
    ),
    watch: [...watchLabels]
      .map(cost)
      .sort((a, b) => b.inclusiveMsPerFrame - a.inclusiveMsPerFrame),
    allocation,
  };
}

const fixed = (value: number, digits: number, width: number): string =>
  value.toFixed(digits).padStart(width);

/** The one-screen report the CLI prints. */
export function formatProfileSummary(summary: ProfileSummary): string[] {
  const lines: string[] = [];
  lines.push(
    `${summary.durationMs} ms, ${summary.frames} frames (${summary.fps.toFixed(1)} fps): ` +
      `main thread busy ${summary.busyMsPerFrame.toFixed(2)} ms/frame ` +
      `(${(summary.busyShare * 100).toFixed(0)}%), ` +
      `gc ${summary.gcMsPerFrame.toFixed(2)} ms/frame, ` +
      `(program) ${summary.programMsPerFrame.toFixed(2)} ms/frame`,
  );
  const functionRows = (rows: ProfileFunctionCost[]): void => {
    for (const row of rows) {
      lines.push(
        `  self ${fixed(row.selfMsPerFrame, 3, 7)}  incl ${fixed(row.inclusiveMsPerFrame, 3, 7)} ms/f ` +
          `${fixed(row.inclusiveShare * 100, 1, 5)}%  ${row.label}`,
      );
    }
  };
  if (summary.watch.length > 0) {
    lines.push("watch (self / inclusive, per frame):");
    functionRows(summary.watch);
  }
  lines.push("top self:");
  functionRows(summary.topSelf);
  lines.push("top inclusive:");
  functionRows(summary.topInclusive);
  if (summary.allocation) {
    const { allocation } = summary;
    lines.push(
      `allocation: ${allocation.totalMBPerSecond.toFixed(2)} MB/s sampled (live + collected)`,
    );
    const allocationRows = (rows: ProfileAllocationCost[]): void => {
      for (const row of rows) {
        lines.push(
          `  self ${fixed(row.selfMBPerSecond, 2, 7)}  incl ${fixed(row.inclusiveMBPerSecond, 2, 7)} MB/s  ${row.label}`,
        );
      }
    };
    if (allocation.watch.length > 0) {
      lines.push("allocation watch:");
      allocationRows(allocation.watch);
    }
    lines.push("allocation top self:");
    allocationRows(allocation.topSelf);
  }
  return lines;
}
