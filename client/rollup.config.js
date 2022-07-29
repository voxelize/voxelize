import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import glslify from "rollup-plugin-glslify";
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
              "three/examples/jsm/loaders/GLTFLoader": "THREE.GLTFLoader",
            },
          },
        ]),
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
    workerLoader({
      targetPlatform: "browser",
      extensions: [".ts"],
    }),
    resolve({
      browser: true,
      preferBuiltins: false,
      dedupe: (i) => i === "three" || i.startsWith("three/"),
    }),
    commonjs(),
    peerDepsExternal(),
    replace({
      preventAssignment: true,
      values: { __buildVersion__: `${packageJson.version}` },
    }),
    swc({
      sourceMaps: true,
      tsconfig: "./tsconfig.json",
    }),
    glslify(),
    ...(process.env.ROLLUP_WATCH ? [] : [terser()]),
  ],
  external: Object.keys(globals),
  watch: { clearScreen: false },
};
