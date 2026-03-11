import path from "path";

import glsl from "vite-plugin-glsl";
import { replaceCodePlugin } from "vite-plugin-replace";

/** @type {import('vite').UserConfig} */
export default {
  optimizeDeps: {
    force: true,
  },
  server: {
    proxy: {
      "/ws/": {
        target: "http://localhost:4000",
        ws: true,
      },
      "/info": {
        target: "http://localhost:4000",
      },
    },
  },
  plugins: [
    glsl(),
    replaceCodePlugin({
      replacements: [
        {
          from: "__VOXELIZE_VERSION__",
          to: "(dev)",
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      // hacky way to point to styles.css
      "@voxelize/core/styles.css": path.resolve(
        __dirname,
        "../../packages/core/src/styles.css",
      ),
      "@voxelize/core": path.resolve(
        __dirname,
        "../../packages/core/src/index.ts",
      ),
    },
  },
};
