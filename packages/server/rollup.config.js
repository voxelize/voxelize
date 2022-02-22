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
      file: packageJson.main,
      format: "cjs",
      sourcemap: true,
    },
  ],
  onwarn: (warning, next) => {
    if (!(warning.importer || warning.id).includes("depd")) {
      next(warning);
    }
  },
  plugins: [
    json(),
    workerLoader({
      targetPlatform: "node",
    }),
    resolve({ preferBuiltins: true, exportConditions: ["node"] }),
    commonjs(),
    peerDepsExternal(),
    swc({
      sourceMaps: true,
      tsconfig: "./tsconfig.build.json",
    }),
    ...(process.env.ROLLUP_WATCH ? [] : [terser()]),
  ],
  external: Object.keys(globals),
};
