import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import typescript from "rollup-plugin-typescript2";
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
  plugins: [
    workerLoader({
      targetPlatform: "node",
    }),
    peerDepsExternal(),
    resolve(),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.build.json",
      tsconfigOverride: {
        compilerOptions: { module: "es2015" },
      },
    }),
    commonjs({
      exclude: "node_modules",
      ignoreGlobal: true,
    }),
  ],
  external: Object.keys(globals),
};
