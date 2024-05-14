import { glslify } from "vite-plugin-glslify";

/** @type {import('vite').UserConfig} */
export default {
  optimizeDeps: {
    force: true,
  },
  plugins: [glslify()],
};
