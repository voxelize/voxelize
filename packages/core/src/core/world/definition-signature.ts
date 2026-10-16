/** Marks a signature that names the block registry by the server's digest. */
const DIGEST_FORM = "registry:";

/** Captured before initialization mutates faces and UVs. Only runs on INIT.
 * Rust maps can arrive in any order; geometry array order remains meaningful.
 * Keep two independent 32-bit accumulators instead of retaining the large
 * serialized registry for the lifetime of every world.
 *
 * A server that names its block registry by digest (`registryDigest`, a
 * digest of the exact registry text, stable across restarts of an unchanged
 * registry) stands in for the blocks: hashing every block definition again
 * cost the main thread ~170 ms per INIT, for an answer the server already
 * gave. Items and the chunk shape are hashed either way.
 *
 * The two forms never compare equal, so pass the signature this one will be
 * compared with as `previous`: the digest form is used only when `previous`
 * is of the digest form too (or there is none). Against a block hash (the
 * server before had no digest) the blocks are hashed, so a core that starts
 * sending the digest with the same blocks is not a definition change; the
 * network puts a left-out registry back before anything reads the INIT, so
 * the blocks are there. The reverse (a digest before, none now) cannot be
 * compared: the earlier blocks were never hashed.
 */
export function worldDefinitionSignature(
  data: {
    blocks?: Record<string, unknown>;
    items?: unknown;
    options: { chunkSize?: number; maxHeight?: number; subChunks?: number };
    registryDigest?: unknown;
  },
  previous: string | null = null,
): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  const append = (value: unknown) => {
    const text =
      JSON.stringify(value, (_key, child) => {
        if (!child || typeof child !== "object" || Array.isArray(child))
          return child;
        return Object.fromEntries(
          Object.keys(child)
            .sort()
            .map((key) => [key, child[key]]),
        );
      }) ?? "null";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      a = Math.imul(a ^ code, 0x01000193);
      b = Math.imul(b ^ code, 0x85ebca6b);
    }
    a = Math.imul(a ^ 0xff, 0x01000193);
  };
  const isByDigest =
    typeof data.registryDigest === "string" &&
    data.registryDigest.length > 0 &&
    (previous === null || previous.startsWith(DIGEST_FORM));
  if (isByDigest) {
    append({ registryDigest: data.registryDigest });
  } else {
    const blocks = data.blocks ?? {};
    for (const name of Object.keys(blocks).sort()) {
      append(name);
      append(blocks[name]);
    }
  }
  append(data.items);
  append([
    data.options.chunkSize,
    data.options.maxHeight,
    data.options.subChunks,
  ]);
  return `${isByDigest ? DIGEST_FORM : ""}${a >>> 0}:${b >>> 0}`;
}
