// tests/e2e/derivation-drawer.spec.ts
import { test, expect } from "@playwright/test";

test("theme derivation drawer shows absolute correlation with selection method", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("theme-derivation-trigger").first().click();
  await expect(page.getByText(/abs\(corr\)/i)).toBeVisible();
  await expect(page.getByText(/selection method/i)).toBeVisible();
});
