import path from "path";
import { externalizeDeps } from "vite-plugin-externalize-deps";

import { defineConfig } from "vite";
import { glslify } from "vite-plugin-glslify";

export default defineConfig({
  plugins: [
    glslify(),
    externalizeDeps({
      except: [/three\/examples\//],
    }),
  ],
  define: {
    __buildVersion__: require("./package.json").version,
  },
  base: "./", // needed to make web workers work: https://github.com/vitejs/vite/discussions/15547#discussioncomment-8950765
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
