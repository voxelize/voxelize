import { defineConfig } from "vite";

// In development the API (php artisan serve, :8000) and the game server
// (:4000) are proxied so the client talks to one origin, exactly as it does
// behind Nginx in the Docker stack.
const API = process.env.PLATFORM_API_URL ?? "http://127.0.0.1:8000";
const GAME = process.env.PLATFORM_GAME_URL ?? "http://127.0.0.1:4000";

export default defineConfig({
  server: {
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/platform": { target: GAME, changeOrigin: true },
      "/ws": { target: GAME.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      // The game, and the admin panel (/admin.html).
      input: { main: "index.html", admin: "admin.html" },
    },
  },
});
