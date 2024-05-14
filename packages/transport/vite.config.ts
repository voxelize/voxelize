import path from "path";

import { defineConfig } from "vite";
import glsl from "vite-plugin-glslify";

export default defineConfig({
  plugins: [glsl() as any],

  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "index",
      formats: ["es", "cjs", "umd"],
      fileName: "index",
    },
    rollupOptions: {},
  },
});
