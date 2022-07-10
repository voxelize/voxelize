import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import swc from "rollup-plugin-swc3";
import { terser } from "rollup-plugin-terser";

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
    {
      file: packageJson.module,
      format: "esm",
      sourcemap: true,
    },
  ],
  onwarn: (warning, next) => {
    if (
      !warning.message.includes("Use of eval is strongly discouraged") &&
      !(warning.importer || warning.id || []).includes("protobufjs")
    ) {
      next(warning);
    }
  },
  plugins: [
    json(),
    resolve({
      preferBuiltins: true,
    }),
    commonjs(),
    peerDepsExternal(),
    swc({
      sourceMaps: true,
      tsconfig: "./tsconfig.json",
    }),
    ...(process.env.ROLLUP_WATCH ? [] : [terser()]),
  ],
  external: Object.keys(globals),
  watch: { clearScreen: false },
};
