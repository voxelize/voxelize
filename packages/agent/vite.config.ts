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
        // Puppeteer-free lifecycle constants/helpers, importable by town's
        // node --test suites without pulling the whole agent SDK.
        lifecycle: path.resolve(__dirname, "src/browser-lifecycle.ts"),
        "bin/voxelize-agent": path.resolve(__dirname, "bin/voxelize-agent.ts"),
      },
      formats: ["es", "cjs"],
    },
    rollupOptions: {},
    emptyOutDir: process.env.NODE_ENV === "production",
  },
});
