import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "vite";
import { copy } from "vite-plugin-copy";
import { externalizeDeps } from "vite-plugin-externalize-deps";
import glsl from "vite-plugin-glsl";
import stringReplace from "vite-plugin-string-replace";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "./package.json"), "utf-8"));
const version = pkg.version;

export default defineConfig({
  plugins: [
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
        return format === 'es' ? 'index.mjs' : 'index.js';
      },
    },
    rollupOptions: {},
    emptyOutDir: process.env.NODE_ENV === "production",
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },
});
