import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/next-env.d.ts", "playwright-report/**", "test-results/**", "**/.data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.tsx"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...nextPlugin.configs.recommended.rules,
    },
  },
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: { globals: { self: "readonly", caches: "readonly", fetch: "readonly", URL: "readonly", Response: "readonly" } },
  },
  {
    files: ["scripts/**/*.mjs", "tests/tools/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", setTimeout: "readonly", fetch: "readonly", AbortSignal: "readonly", URL: "readonly" } },
  },
);
