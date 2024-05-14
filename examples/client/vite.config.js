import glsl from "vite-plugin-glsl";

/** @type {import('vite').UserConfig} */
export default {
  optimizeDeps: {
    force: true,
  },
  plugins: [glsl()],
};
