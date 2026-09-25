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
        // Puppeteer-free lifecycle constants/helpers, importable by a host
        // repo's node --test suites without pulling the whole agent SDK.
        lifecycle: path.resolve(__dirname, "src/browser-lifecycle.ts"),
        // Same idea for session labels/provenance: the host CLI validates
        // meta before spawning a daemon with the exact rules the daemon
        // enforces, without importing puppeteer to do it.
        "session-meta": path.resolve(__dirname, "src/session-meta.ts"),
        // The CPU/allocation profile summariser and its report formatter,
        // so the host CLI prints exactly what the daemon computed.
        profile: path.resolve(__dirname, "src/profile-summary.ts"),
        // The hot-update guard and the pose-restore rules, so the host
        // repo's tests exercise the exact code agent pages run.
        "client-updates": path.resolve(__dirname, "src/client-updates.ts"),
        "pose-memory": path.resolve(__dirname, "src/pose-memory.ts"),
        "bin/voxelize-agent": path.resolve(__dirname, "bin/voxelize-agent.ts"),
      },
      formats: ["es", "cjs"],
    },
    rollupOptions: {},
    emptyOutDir: process.env.NODE_ENV === "production",
  },
});
