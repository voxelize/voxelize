import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The engine-boundary gate's own tests are `node:test` files: CI and
    // `pnpm test` run them with `node --test`.
    exclude: [...configDefaults.exclude, "scripts/engine-boundary/**"],
  },
});
