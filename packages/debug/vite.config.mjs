import path from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "vite";
import { externalizeDeps } from "vite-plugin-externalize-deps";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [externalizeDeps()],
  base: "./",
  build: {
    minify: false,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "index",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.mjs" : "index.js"),
    },
    rollupOptions: {},
    emptyOutDir: process.env.NODE_ENV === "production",
  },
});
