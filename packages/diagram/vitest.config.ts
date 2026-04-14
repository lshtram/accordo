import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Base config — shared settings for both projects
const base = defineConfig({
  globals: true,
  setupFiles: ["../../test-setup.ts"],
  pool: "vmForks",
  coverage: {
    provider: "v8",
    include: ["src/**/*.ts"],
    exclude: ["src/__tests__/**"],
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, "src/__tests__/mocks/vscode.ts"),
    },
  },
});

export default defineConfig({
  test: {
    // Project 1: node environment — tests that don't use browser DOM APIs
    // This includes types.test.ts which requires import.meta.url = file://
    projects: [
      {
        ...base,
        test: {
          ...base.test,
          name: "diagram-node",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: [
            // These test files call computeInitialLayoutAsync with engine='excalidraw',
            // which internally requires @excalidraw/mermaid-to-excalidraw (uses document.createElement)
            "src/__tests__/excalidraw-engine.test.ts",
            "src/__tests__/auto-layout.test.ts",
            // diagram-modularity.test.ts: Phase-B failing tests for host module stubs.
            // These tests are run separately during Phase B2 review.
            "src/__tests__/diagram-modularity.test.ts",
          ],
          environment: "node",
        },
      },
      // Project 2: happy-dom environment — tests that require browser DOM APIs
      // @excalidraw/mermaid-to-excalidraw calls document.createElement('div') internally
      {
        ...base,
        test: {
          ...base.test,
          name: "diagram-happy-dom",
          include: [
            "src/__tests__/excalidraw-engine.test.ts",
            "src/__tests__/auto-layout.test.ts",
          ],
          environment: "happy-dom",
        },
      },
    ],
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, "src/__tests__/mocks/vscode.ts"),
    },
  },
});
