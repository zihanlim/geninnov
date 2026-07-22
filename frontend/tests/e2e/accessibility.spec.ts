// tests/e2e/accessibility.spec.ts
// T23: accessibility coverage using axe-core.
// Loads axe-core in the page context via addScriptTag, runs `axe.run()` against
// the current DOM, and fails the test if any CRITICAL violations are found.
//
// Note: the brief assumes a frontend-side Playwright config that can resolve
// `axe-core` via `require.resolve`. Both frontend/package.json and the root
// package.json (if any) are valid resolution roots. We read the axe source at
// require-time and inject it inline so the test works regardless of where
// `tests/e2e` is mounted.
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// Resolve axe-core relative to the frontend directory (where devDeps live).
function loadAxeSource(): string {
  const candidates = [
    path.resolve(__dirname, "../../node_modules/axe-core/axe.min.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8");
    }
  }
  throw new Error(
    "axe-core not found. Install with `cd frontend && npm install --save-dev axe-core @types/axe-core`."
  );
}

const axeSource = loadAxeSource();

for (const path of ["/", "/trades", "/research", "/portfolio"]) {
  test(`a11y: ${path} has no critical axe violations`, async ({ page }) => {
    await page.goto(path);
    // Inject axe-core into the page context.
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async () => {
      // @ts-ignore axe is injected via addScriptTag
      const r = await axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      });
      return {
        critical: r.violations
          .filter((v: any) => v.impact === "critical")
          .map((v: any) => ({ id: v.id, help: v.help, nodes: v.nodes.length })),
        summary: r.violations.map((v: any) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
        })),
      };
    });

    if (results.critical.length > 0) {
      // eslint-disable-next-line no-console
      console.log("Non-critical violations (informational):", JSON.stringify(results.summary, null, 2));
    }
    expect(results.critical, JSON.stringify(results.critical, null, 2)).toEqual([]);
  });
}
