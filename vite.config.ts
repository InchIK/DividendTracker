import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";
import { existsSync } from "node:fs";

export default defineConfig(({ mode }) => {
  const cloudflareConfig = mode === "personal" && existsSync("./wrangler.generated.jsonc")
    ? "./wrangler.generated.jsonc"
    : "./wrangler.jsonc";
  return ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      configPath: cloudflareConfig,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./web"),
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
  });
});
