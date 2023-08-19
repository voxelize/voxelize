import { resolve } from "path";
import workerLoader from "rollup-plugin-web-worker-loader";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "voxelize-protocol",
      fileName(format) {
        if (format === "es") {
          return "index.js";
        }

        return "voxelize-protocol.umd.cjs";
      },
      formats: ["es", "umd"],
    },
    emptyOutDir: false,
    rollupOptions: {
      onwarn: (warning, next) => {
        if (
          !warning.message.includes("Use of eval is strongly discouraged") &&
          // @ts-ignore
          !(warning.importer || warning.id || []).includes("protobufjs")
        ) {
          next(warning);
        }
      },
    },
  },
  plugins: [
    dts(),
    workerLoader({
      extensions: [".ts"],
    } as any),
  ],
});
