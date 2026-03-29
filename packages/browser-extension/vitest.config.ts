import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "https://localhost/test-page",
      },
    },
    setupFiles: ["../../test-setup.ts", "./tests/setup/chrome-mock.ts", "./tests/setup/dom-setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["tests/**"],
    },
  },
});
