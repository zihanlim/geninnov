import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests only. The Playwright e2e suite lives in tests/e2e and is run
// separately via `npx playwright test` — excluded here so the two runners
// never try to claim each other's files.
export default defineConfig({
  // tsconfig sets `jsx: "preserve"` for Next's compiler, which leaves JSX in the
  // transform output — so any .tsx a test imports fails to parse ("Unexpected JSX
  // expression"). This override applies to the test transform only; Next's build
  // still reads tsconfig. Needed so field-coverage tests can render the REAL
  // components instead of asserting against a copy of their markup, which would
  // drift from them and pass while the page regressed.
  //
  // It must be `oxc`, not `esbuild`: Vitest 4 transforms with oxc and logs
  // "esbuild options will be ignored" if you set the esbuild equivalent — which
  // looks like it is configured and silently is not.
  // Object form, not the bare "automatic" string: the string works at runtime but
  // is not in Vite's JsxOptions type, so tsc rejects it.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
