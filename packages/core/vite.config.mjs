import path from "path";

import { defineConfig } from "vite";
import { copy } from "vite-plugin-copy";
import { externalizeDeps } from "vite-plugin-externalize-deps";
import glsl from "vite-plugin-glsl";
import stringReplace from "vite-plugin-string-replace";

import { version } from "./package.json";

export default defineConfig({
  plugins: [
    glsl(),
    externalizeDeps({
      except: [/three\/examples\//],
    }),
    stringReplace([
      {
        search: "__VOXELIZE_VERSION__",
        replace: version,
      },
    ]),
    copy([
      {
        src: path.resolve(__dirname, "./src/styles.css"),
        dest: path.resolve(__dirname, "./dist"),
      },
    ]),
  ],
  base: "./", // needed to make web workers work: https://github.com/vitejs/vite/discussions/15547#discussioncomment-8950765
  build: {
    minify: false,
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "index",
      formats: ["es", "cjs"],
      fileName: (format) => {
        return format === 'es' ? 'index.mjs' : 'index.js';
      },
    },
    rollupOptions: {},
    emptyOutDir: process.env.NODE_ENV === "production",
  },
});
