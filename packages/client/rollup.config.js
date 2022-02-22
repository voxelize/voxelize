import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import swc from "rollup-plugin-swc3";
import { terser } from "rollup-plugin-terser";
import workerLoader from "rollup-plugin-web-worker-loader";

const packageJson = require("./package.json");

const globals = {
  ...packageJson.devDependencies,
};

export default {
  input: "src/index.ts",
  output: [
    {
      file: packageJson.module,
      format: "esm",
      sourcemap: true,
    },
    ...(process.env.ROLLUP_WATCH
      ? []
      : [
          {
            file: packageJson.umd,
            extend: true,
            format: "umd",
            indent: false,
            name: "Voxelize",
            globals: {
              three: "THREE",
              "three/examples/jsm/postprocessing/EffectComposer":
                "THREE.EffectComposer",
              "three/examples/jsm/postprocessing/RenderPass":
                "THREE.RenderPass",
              "three/examples/jsm/libs/stats.module": "Stats",
            },
          },
        ]),
  ],
  onwarn: (warning, next) => {
    if (!warning.message.includes("Use of eval is strongly discouraged")) {
      next(warning);
    }
  },
  plugins: [
    json(),
    workerLoader({
      targetPlatform: "browser",
    }),
    resolve({
      browser: true,
      preferBuiltins: false,
      dedupe: (i) => i === "three" || i.startsWith("three/"),
    }),
    commonjs(),
    peerDepsExternal(),
    swc({
      sourceMaps: true,
      tsconfig: "./tsconfig.build.json",
    }),
    ...(process.env.ROLLUP_WATCH ? [] : [terser()]),
  ],
  external: Object.keys(globals),
  watch: { clearScreen: false },
};
