import adapter from "@sveltejs/adapter-auto";
import { resolve } from "path";
import preprocess from "svelte-preprocess";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: preprocess(),
  kit: {
    adapter: adapter(),
    vite: {
      resolve: {
        alias: {
          "@voxelize/client": resolve("../..", "dist"),
        },
      },
    },
  },
};

export default config;
