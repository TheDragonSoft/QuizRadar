/**
 * Shared ESLint flat config for the monorepo.
 * React-recommended + strict TypeScript for apps/web; keep in sync when new
 * packages appear (web style rules key off `apps/web/src`).
 */
import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const reactRecommended = reactPlugin.configs.flat.recommended;

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/target/**",
      "**/gen/**",
      "apps/web/public/**",
      "apps/web/src/generated/**",
      ".agents/**",
      "apps/mobile-android/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactRecommended,
  {
    settings: {
      react: { version: "detect" },
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // React 19 + Automatic Runtime (vite `react-jsx`): no React import required.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": "warn",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
