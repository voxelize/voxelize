import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wasmMesherEntry = path.resolve(
  __dirname,
  "../../../crates/wasm-mesher/pkg/voxelize_wasm_mesher.js"
);

if (!fs.existsSync(wasmMesherEntry)) {
  console.error(
    "Missing crates/wasm-mesher/pkg/voxelize_wasm_mesher.js. Run `pnpm build:wasm:dev` from the repository root first."
  );
  process.exit(1);
}
