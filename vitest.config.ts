import { defineConfig } from "vitest/config";
import { workspaceVitestAliases } from "./vitest.aliases";

export default defineConfig({
  resolve: {
    alias: workspaceVitestAliases,
  },
});
