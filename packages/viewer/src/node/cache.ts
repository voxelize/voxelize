import fs from "node:fs";
import path from "node:path";

/**
 * Keeps `dir` under `maxBytes` by deleting its least recently modified
 * files first; anything written within `keepRecentMs` stays (another
 * request may be reading it).
 */
export function pruneDirectory(
  dir: string,
  maxBytes: number,
  keepRecentMs: number,
) {
  if (!fs.existsSync(dir)) return { evicted: 0, bytes: 0 };
  const files: { file: string; size: number; mtime: number }[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const stat = fs.statSync(full);
        files.push({ file: full, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  };
  walk(dir);
  let bytes = files.reduce((sum, f) => sum + f.size, 0);
  if (bytes <= maxBytes) return { evicted: 0, bytes };
  files.sort((a, b) => a.mtime - b.mtime);
  const now = Date.now();
  let evicted = 0;
  for (const f of files) {
    if (bytes <= maxBytes) break;
    if (now - f.mtime < keepRecentMs) break;
    fs.rmSync(f.file, { force: true });
    bytes -= f.size;
    evicted += 1;
  }
  return { evicted, bytes };
}
