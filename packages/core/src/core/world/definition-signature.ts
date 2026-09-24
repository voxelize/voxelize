/** Captured before initialization mutates faces and UVs. Only runs on INIT.
 * Rust maps can arrive in any order; geometry array order remains meaningful.
 * Keep two independent 32-bit accumulators instead of retaining the large
 * serialized registry for the lifetime of every world.
 */
export function worldDefinitionSignature(data: {
  blocks: Record<string, unknown>;
  items?: unknown;
  options: { chunkSize?: number; maxHeight?: number; subChunks?: number };
}): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  const append = (value: unknown) => {
    const text = JSON.stringify(value, (_key, child) => {
      if (!child || typeof child !== "object" || Array.isArray(child)) return child;
      return Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]));
    }) ?? "null";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      a = Math.imul(a ^ code, 0x01000193);
      b = Math.imul(b ^ code, 0x85ebca6b);
    }
    a = Math.imul(a ^ 0xff, 0x01000193);
  };
  for (const name of Object.keys(data.blocks).sort()) {
    append(name);
    append(data.blocks[name]);
  }
  append(data.items);
  append([data.options.chunkSize, data.options.maxHeight, data.options.subChunks]);
  return `${a >>> 0}:${b >>> 0}`;
}
