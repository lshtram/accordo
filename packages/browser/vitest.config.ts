import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "https://localhost/test-page",
      },
    },
    setupFiles: ["../../test-setup.ts", "./src/__tests__/setup/dom-setup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, "src/__tests__/mocks/vscode.ts"),
    },
  },
});
