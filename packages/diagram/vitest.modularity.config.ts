/**
 * vitest.modularity.config.ts
 * Standalone config for running diagram-modularity.test.ts in isolation.
 * Uses node environment (matching the diagram-node project).
 * Run via: pnpm test:modularity
 */
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["../../test-setup.ts"],
    pool: "vmForks",
    include: ["src/__tests__/diagram-modularity.test.ts"],
    environment: "node",
    dangerouslyIgnoreUnhandledErrors: true,
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, "src/__tests__/mocks/vscode.ts"),
    },
  },
});
