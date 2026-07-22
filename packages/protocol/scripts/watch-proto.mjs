// Regenerate the protobuf codegen (src/protocol.*) whenever messages.proto
// changes, so a submodule bump or a proto edit can never leave a dev client
// running a stale decoder (e.g. missing a newly added field). Dep-free: the
// parent directory is watched non-recursively so editor rename-on-save and
// submodule checkouts are both caught.
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROTO_FILE = "messages.proto";
const DEBOUNCE_MS = 120;

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protoDir = resolve(packageDir, "../..");

let debounceTimer = null;
let isRunning = false;
let isPending = false;

const regenerate = () => {
  if (isRunning) {
    isPending = true;
    return;
  }
  isRunning = true;
  const child = spawn("pnpm", ["run", "proto"], {
    cwd: packageDir,
    stdio: "inherit",
  });
  child.on("exit", () => {
    isRunning = false;
    if (isPending) {
      isPending = false;
      regenerate();
    }
  });
};

watch(protoDir, { recursive: false }, (_event, filename) => {
  if (filename !== PROTO_FILE) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(regenerate, DEBOUNCE_MS);
});

console.log(`[proto-watch] watching ${resolve(protoDir, PROTO_FILE)}`);
