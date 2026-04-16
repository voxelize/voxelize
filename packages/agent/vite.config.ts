import path from "path";

import { defineConfig } from "vite";
import { externalizeDeps } from "vite-plugin-externalize-deps";

export default defineConfig({
  plugins: [externalizeDeps()],
  base: "./",
  build: {
    minify: false,
    lib: {
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        bridge: path.resolve(__dirname, "src/bridge.ts"),
        scenario: path.resolve(__dirname, "src/scenario.ts"),
        "bin/voxelize-agent": path.resolve(__dirname, "bin/voxelize-agent.ts"),
      },
      formats: ["es", "cjs"],
    },
    rollupOptions: {},
    emptyOutDir: process.env.NODE_ENV === "production",
  },
});
