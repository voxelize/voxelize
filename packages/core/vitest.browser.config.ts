import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      name: "chromium",
      provider: "playwright",
      headless: true,
      providerOptions: {
        launch: {
          args: [
            "--enable-webgl",
            "--enable-unsafe-swiftshader",
            "--use-gl=swiftshader",
          ],
        },
      },
    },
    include: ["src/shaders/**/*.test.ts"],
    testTimeout: 30000,
  },
});
