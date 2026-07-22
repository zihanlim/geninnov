import { test, expect } from "@playwright/test";

test("dashboard shows market bar with freshness", async ({ page }) => {
  await page.goto("/");
  // Top-1 theme header (or market-bar-unavailable pill if 010 missing)
  const healthyBar = page.getByTestId("market-bar");
  const unavailableBar = page.getByTestId("market-bar-unavailable");
  await expect(healthyBar.or(unavailableBar)).toBeVisible();

  // At least one of the indices in the brief is visible (or an explicit
  // "unavailable" notice, which is the graceful 404 contract).
  await expect(
    page
      .getByText(/S&P|Nasdaq|Dow|unavailable/i)
      .first()
  ).toBeVisible();

  // RUN DATE pill carries "Updated" freshness string when run_date is present
  await expect(page.getByTestId("updated-label").or(page.getByText(/Next refresh/i))).toBeVisible();
});

test("dashboard exposes a global data-status badge", async ({ page }) => {
  await page.goto("/");
  // A StatusBadge (any status) is present in the global header
  // (theme_derivations would render a badge too, but the top header
  // is guaranteed.)
  await expect(page.locator("body").getByText(/Exact|Estimated|Stale|Unavailable|Unverified/).first()).toBeVisible();
});
