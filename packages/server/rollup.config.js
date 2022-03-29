import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import swc from "rollup-plugin-swc3";
import { terser } from "rollup-plugin-terser";
import threads from "rollup-plugin-threads";

const packageJson = require("./package.json");

const globals = {
  ...packageJson.devDependencies,
};

const SKIPPED_CODES = ["PREFER_NAMED_EXPORTS", "THIS_IS_UNDEFINED", "EVAL"];

const onwarn = (warning, next) => {
  if (SKIPPED_CODES.includes(warning.code)) {
    return;
  }

  next(warning);
};

const commonPlugins = [
  json(),
  resolve({ preferBuiltins: true, exportConditions: ["node"] }),
  commonjs(),
  peerDepsExternal(),
  swc({
    sourceMaps: true,
    tsconfig: "./tsconfig.build.json",
  }),
];

const external = Object.keys(globals);

export default {
  input: "src/index.ts",
  output: [
    {
      dir: "./dist",
      format: "cjs",
      sourcemap: true,
      exports: "auto",
    },
  ],
  onwarn,
  plugins: [
    // building workers into their own bundles
    threads({
      include: ["**/*.worker.ts", "**/*.worker", "**/*.worker.js"],
      plugins: commonPlugins,
      onwarn,
      external,
      output: {
        format: "cjs",
        name: "WorkerThread",
      },
      watch: {
        include: "./src/**",
      },
    }),
    ...commonPlugins,
    ...(process.env.ROLLUP_WATCH ? [] : [terser()]),
  ],
  external,
  watch: { clearScreen: false },
};
