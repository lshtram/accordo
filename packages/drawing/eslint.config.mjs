// ESLint flat config for accordo-drawing (ESLint 10 + typescript-eslint 8).
// Scope: production source only — tests and seams are ignored via .eslintignore.
import eslintPluginTs from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default [
  {
    // Exclude build artifacts. ESLint 10 flat config evaluates ignores BEFORE files
    // selection, so any .js file (including dist/) is excluded before files is
    // even considered.
    ignores: ["dist/**", "*.js"],
  },
  {
    // Only lint production source files
    files: [
      "src/extension.ts",
      "src/index.ts",
      "src/core/types.ts",
      "src/tools/drawing-tools.ts",
      "src/host/create-handler.ts",
      "src/host/merge-handler.ts",
      "src/host/query-handler.ts",
      "src/host/patch-handler.ts",
      "src/host/render-handler.ts",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": eslintPluginTs,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unnecessary-type-constraint": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "always"],
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];