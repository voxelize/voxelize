import path from "path";

import alias from "@rollup/plugin-alias";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import copy from "rollup-plugin-copy-watch";
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
      sourcemap: !!process.env.ROLLUP_WATCH,
    },
    ...(process.env.ROLLUP_WATCH
      ? []
      : [
          {
            file: packageJson.main,
            format: "cjs",
          },
          {
            file: packageJson.umd,
            extend: true,
            format: "umd",
            indent: false,
            name: "Voxelize",
            globals: {
              three: "THREE",
              "three/examples/jsm/libs/stats.module.js": "Stats",
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
      skipPlugins: ["liveServer", "serve", "livereload", "copy+watch"],
    }),
    alias({
      customResolver: resolve({
        extensions: [".ts", ".js"],
      }),
      entries: [
        { find: "utils", replacement: path.resolve(__dirname, "./src/utils") },
        {
          find: "@voxelize/transport",
          replacement: path.resolve(__dirname, "../transport"),
        },
      ],
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
    copy({
      watch: process.env.ROLLUP_WATCH
        ? path.resolve(__dirname, "src/**/*")
        : false,
      copyOnce: true,
      targets: [
        {
          src: path.resolve(__dirname, "src/styles.css"),
          dest: path.resolve(__dirname, "dist"),
        },
      ],
    }),
    ...(process.env.ROLLUP_WATCH ? [] : [terser()]),
  ],
  external: Object.keys(globals),
  watch: { clearScreen: false, include: "src/**/*" },
};
