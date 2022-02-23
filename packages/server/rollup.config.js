import path from "path";

import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import { pathExists } from "fs-extra";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import swc from "rollup-plugin-swc3";
import { terser } from "rollup-plugin-terser";

const packageJson = require("./package.json");

const globals = {
  ...packageJson.devDependencies,
};

const SKIPPED_CODES = ["THIS_IS_UNDEFINED", "EVAL"];

function workerThreads() {
  const chunkMap = new Map();

  return {
    name: "worker_threads",
    load(id) {
      if (!id.endsWith("?worker")) {
        return;
      }
      return id;
    },
    resolveId(id, importer) {
      if (!id.endsWith("?worker")) {
        return;
      }
      return path.resolve(path.dirname(importer), id);
    },
    renderChunk(code, chunk) {
      let workerChunkName = chunkMap.get(chunk.facadeModuleId);
      if (workerChunkName) {
        if (workerChunkName.endsWith(".ts")) {
          workerChunkName = `${workerChunkName.substr(
            0,
            workerChunkName.length - 3
          )}.js`;
        }
        chunk.fileName = workerChunkName;
      }
      return;
    },
    async transform(code, id) {
      if (!id.endsWith("?worker")) {
        return;
      }
      const filePath = id.substr(0, id.length - 7);
      const ext = (await pathExists(`${filePath}.ts`)) ? ".ts" : ".js";
      const chunk = `./${path.basename(filePath)}-${this.emitFile({
        type: "chunk",
        id: filePath + ext,
      })}.js`;
      chunkMap.set(filePath + ext, chunk);

      return {
        code: `import { Worker } from 'worker_threads'
        import path from 'path'
        export default function WorkerWrapper() {
          return new Worker(path.resolve(__dirname, ${JSON.stringify(chunk)}))
        }`,
        map: { mappings: "" },
      };
    },
  };
}

export default {
  input: "src/index.ts",
  output: [
    {
      dir: "./dist",
      // file: packageJson.main,
      format: "cjs",
      sourcemap: true,
    },
  ],
  onwarn: (warning, next) => {
    if (SKIPPED_CODES.includes(warning.code)) {
      return;
    }

    next(warning);
  },
  plugins: [
    json(),
    resolve({ preferBuiltins: true, exportConditions: ["node"] }),
    commonjs(),
    peerDepsExternal(),
    swc({
      sourceMaps: true,
      tsconfig: "./tsconfig.build.json",
    }),
    workerThreads(),
    ...(process.env.ROLLUP_WATCH ? [] : [terser()]),
  ],
  external: Object.keys(globals),
  watch: { clearScreen: false },
};
