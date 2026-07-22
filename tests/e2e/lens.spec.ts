// tests/e2e/lens.spec.ts
import { test, expect } from "@playwright/test";

test("credit lens is consistent across dashboard, trades, research, portfolio", async ({ page }) => {
  for (const path of ["/", "/trades", "/research", "/portfolio"]) {
    await page.goto(`${path}?lens=credit`);
    await expect(page.getByTestId("lens-active")).toHaveText(/credit/i);
  }
});