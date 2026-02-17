import path from "path";

import glsl from "vite-plugin-glsl";

/** @type {import('vite').UserConfig} */
export default {
  optimizeDeps: {
    force: true,
  },
  plugins: [glsl()],
  define: {
    __VOXELIZE_VERSION__: JSON.stringify("(dev)"),
  },
  resolve: {
    alias: {
      // hacky way to point to styles.css
      "@voxelize/core/styles.css": path.resolve(
        __dirname,
        "../../packages/core/src/styles.css"
      ),
      "@voxelize/core": path.resolve(
        __dirname,
        "../../packages/core/src/index.ts"
      ),
    },
  },
};
