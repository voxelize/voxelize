import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@voxelize/aabb": path.resolve(__dirname, "packages/aabb/src/index.ts"),
      "@voxelize/ts-core": path.resolve(
        __dirname,
        "packages/ts-core/src/index.ts"
      ),
    },
  },
});
