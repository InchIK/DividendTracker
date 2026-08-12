import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Global ignores
    ignores: [
      "dist/**",
      ".wrangler/**",
      "node_modules/**",
      "reports/**",
      "playwright-report/**",
      "test-results/**",
      "**/*.d.ts",
      "worker/env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.mjs",
            "playwright.config.ts",
            "scripts/*.mjs",
            "scripts/*.ts",
            "tests/unit/*.ts",
            "tests/integration/*.ts",
            "tests/helpers/*.ts",
            "e2e/*.ts",
          ],
          defaultProject: "tsconfig.eslint.json",
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 128,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      // Runtime JSON is validated before use; Node setup scripts do not ship to Workers.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // Web (React) project files
    files: ["web/**/*.{ts,tsx}"],
    settings: {
      react: { version: "detect" },
    },
  },
  {
    // Vitest spec files
    files: ["**/*.spec.ts", "**/*.test.ts", "tests/helpers/**/*.ts"],
    rules: {
      // D1 integration tests use deliberately minimal structural fakes.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // E2E playwright tests
    files: ["e2e/**/*.{ts,tsx}"],
  },
);
