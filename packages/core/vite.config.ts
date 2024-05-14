import path from "path";
import { externalizeDeps } from "vite-plugin-externalize-deps";

import { defineConfig } from "vite";
import { glslify } from "vite-plugin-glslify";

export default defineConfig({
  plugins: [glslify(), externalizeDeps()],
  define: {
    __buildVersion__: require("./package.json").version,
  },
  base: "./",
  build: {
    minify: false,
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "index",
      formats: ["es", "cjs"],
      fileName: "index",
    },
    rollupOptions: {},
  },
});
