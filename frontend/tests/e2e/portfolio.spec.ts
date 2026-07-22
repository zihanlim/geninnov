import { test, expect } from "@playwright/test";

test("portfolio shows status badges, gross/net exposure, and cumulative return", async ({ page }) => {
  await page.goto("/portfolio");
  await expect(page.getByText("Gross exposure")).toBeVisible();
  await expect(page.getByText("Net exposure")).toBeVisible();
  await expect(page.getByText("Since inception")).toBeVisible();
  await expect(page.getByTestId("status-badge").first()).toBeVisible();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
