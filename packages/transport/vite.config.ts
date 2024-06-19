import path from "path";

import { defineConfig } from "vite";
import { externalizeDeps } from "vite-plugin-externalize-deps";

export default defineConfig({
  plugins: [externalizeDeps()],
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
    emptyOutDir: process.env.NODE_ENV === "production",
  },
});
