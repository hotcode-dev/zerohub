import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import { defineConfig } from "eslint/config";

export default defineConfig(
  // Apply to all files
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
  },

  // Ignore patterns
  {
    ignores: [
      "dist/",
      "node_modules/",
      "docs/",
      "*.config.js",
      "*.config.ts",
      "rollup.config.js",
    ],
  },

  // Base ESLint recommended rules
  js.configs.recommended,

  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Prettier config (disables conflicting rules)
  prettier,

  // Custom configuration
  {
    files: ["**/*.{ts,js}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Browser globals
        console: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        WebSocket: "readonly",
        RTCPeerConnection: "readonly",
        RTCSessionDescription: "readonly",
        RTCOfferOptions: "readonly",
        RTCConfiguration: "readonly",
        MessageEvent: "readonly",
        Event: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        Request: "readonly",
        RequestInit: "readonly",
        URL: "readonly",

        // Node.js globals
        global: "readonly",
        process: "readonly",
        Buffer: "readonly",
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      // Prettier integration
      "prettier/prettier": "error",

      // TypeScript specific rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-var-requires": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",

      // General JavaScript/TypeScript rules
      "no-console": "error",
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-unused-expressions": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
    },
  }
);
