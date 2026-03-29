// @ts-check
/**
 * ESLint flat config for browser-extension (ESLint 10 + typescript-eslint 8).
 *
 * Scoped to semantic graph production source only:
 * src/content/semantic-graph-*.ts (M113-SEM D2 lint gate requirement).
 *
 * Test files are intentionally excluded — they have different linting needs
 * (e.g. @ts-expect-error, vitest globals) that would require a separate block.
 */
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/content/semantic-graph-*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Type safety — matches coding-guidelines.md §1.1
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],

      // Async safety
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // Code quality
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
    },
  },
];
