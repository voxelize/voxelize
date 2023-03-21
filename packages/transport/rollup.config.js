import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
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
    },
    {
      file: packageJson.module,
      format: "esm",
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
    swc({
      sourceMaps: true,
      tsconfig: "./tsconfig.json",
    }),
    ...(process.env.ROLLUP_WATCH ? [] : [terser()]),
  ],
  external: Object.keys(globals),
  watch: { clearScreen: false },
};
