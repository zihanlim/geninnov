import { test, expect } from "@playwright/test";

test("trades shows signed weights and status badges", async ({ page }) => {
  await page.goto("/trades");
  // Direction pill (Long or Short) renders on the first row
  await expect(page.getByText(/Long|Short/).first()).toBeVisible();
  // Per-row StatusBadge (exact / estimated / stale / unavailable)
  await expect(page.getByTestId("status-badge").first()).toBeVisible();
  // Signed weight cell is present (shows ± or —)
  await expect(page.getByTestId("cell-signed-weight").first()).toBeVisible();
  // Asset return and contribution cells (may render "—" when unavailable)
  await expect(page.getByTestId("cell-asset-return").first()).toBeVisible();
  await expect(page.getByTestId("cell-contribution").first()).toBeVisible();
});
