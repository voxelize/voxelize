import path from "path";

import { defineConfig } from "vite";
import { externalizeDeps } from "vite-plugin-externalize-deps";

export default defineConfig({
  plugins: [
    externalizeDeps({}),
    // copy([
    //   {
    //     src: path.resolve(__dirname, "./src/protocol.*"),
    //     dest: path.resolve(__dirname, "./dist/protocol.*"),
    //   },
    // ]),
  ],
  base: "./",
  build: {
    minify: false,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "index",
      formats: ["es", "cjs"],
      fileName: "index",
    },
    rollupOptions: {
      output: {
        exports: "named",
      },
    },
    emptyOutDir: process.env.NODE_ENV === "production",
  },
});
