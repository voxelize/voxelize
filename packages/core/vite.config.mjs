import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "vite";
import { copy } from "vite-plugin-copy";
import { externalizeDeps } from "vite-plugin-externalize-deps";
import glsl from "vite-plugin-glsl";
import stringReplace from "vite-plugin-string-replace";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { version } = require("./package.json");

const isProduction = process.env.NODE_ENV === "production";
// Watch builds keep one worker filename per worker. A content hash renames
// the worker on every rebuild, which changes the module graph of every app
// bundling this dist: Turbopack treats the new name as a new module and
// re-chunks the whole app, and the stale names pile up in dist/assets.
const workerFileNames = isProduction
  ? "assets/[name]-[hash].js"
  : "assets/[name].js";

export default defineConfig({
  plugins: [
    {
      name: "watch-mesher-worker-assets",
      buildStart() {
        // Worker dependencies are built by a nested Rollup instance. Vite's
        // library watcher otherwise misses wasm-pack output and keeps serving
        // an older embedded mesher until an unrelated client source edit.
        for (const file of [
          "voxelize_wasm_mesher.js",
          "voxelize_wasm_mesher_bg.wasm",
        ]) {
          this.addWatchFile(
            path.resolve(__dirname, "../../crates/wasm-mesher/pkg", file),
          );
        }
      },
    },
    wasm(),
    topLevelAwait(),
    glsl(),
    externalizeDeps({
      except: [/three\/examples\//, /@voxelize\/wasm-mesher/],
    }),
    stringReplace([
      {
        search: "__VOXELIZE_VERSION__",
        replace: version,
      },
    ]),
    copy([
      {
        src: path.resolve(__dirname, "./src/styles.css"),
        dest: path.resolve(__dirname, "./dist"),
      },
    ]),
  ],
  base: "./",
  build: {
    minify: false,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "index",
      formats: ["es", "cjs"],
      fileName: (format) => {
        return format === "es" ? "index.mjs" : "index.js";
      },
    },
    rollupOptions: {},
    emptyOutDir: isProduction,
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
    rollupOptions: {
      output: {
        entryFileNames: workerFileNames,
        chunkFileNames: workerFileNames,
      },
    },
  },
});
