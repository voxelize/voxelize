import { defineConfig } from "vite";

// A page that builds Voxelize's TSL materials with WebGPURenderer and
// reports what the GPU said: the fast loop for shading work, no game needed.
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  server: { port: 5199, strictPort: true },
  logLevel: "warn",
});
