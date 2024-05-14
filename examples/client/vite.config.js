import glsl from "vite-plugin-glslify";

/** @type {import('vite').UserConfig} */
export default {
  optimizeDeps: {
    force: true,
  },
  plugins: [glsl()],
};
