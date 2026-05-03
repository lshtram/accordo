import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const base = defineConfig({
  globals: true,
  setupFiles: ["../../test-setup.ts"],
  pool: "vmForks",
  resolve: {
    alias: {
      vscode: resolve(__dirname, "src/__tests__/mocks/vscode.ts"),
    },
  },
});

export default defineConfig({
  test: {
    ...base.test,
    name: "drawing",
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
