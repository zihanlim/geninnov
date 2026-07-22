import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests only. The Playwright e2e suite lives in tests/e2e and is run
// separately via `npx playwright test` — excluded here so the two runners
// never try to claim each other's files.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
