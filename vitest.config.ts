import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker/index.ts",
      miniflare: {
        compatibilityDate: "2026-08-04",
        d1Databases: {
          DB: "etf-dividend-db",
        },
      },
    }),
  ],
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", "scripts/*.test.mjs"],
  },
});
