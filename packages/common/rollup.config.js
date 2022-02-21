import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import swc from "rollup-plugin-swc3";

const packageJson = require("./package.json");

const globals = {
  ...packageJson.devDependencies,
};

export default {
  input: "src/index.ts",
  output: {
    file: packageJson.main,
    format: "cjs",
  },
  onwarn: (warning, next) => {
    if (!(warning.importer || warning.id).includes("protobufjs")) {
      next(warning);
    }
  },
  plugins: [
    resolve(),
    commonjs(),
    swc({
      jsc: {
        parser: {
          syntax: "typescript",
        },
        target: "es2015",
        transform: {},
      },
      tsconfig: "./tsconfig.build.json",
    }),
  ],
  external: Object.keys(globals),
};
