import path from "path";
import { externalizeDeps } from "vite-plugin-externalize-deps";

import { defineConfig } from "vite";
import { glslify } from "vite-plugin-glslify";

export default defineConfig({
  plugins: [glslify(), externalizeDeps()],
  base: "./",
  build: {
    minify: false,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "index",
      formats: ["es", "cjs"],
      fileName: "index",
    },
    rollupOptions: {},
  },
});
