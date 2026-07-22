// tests/e2e/research.spec.ts
// T15 — strict unavailable policy for the Q1 thesis body.
//
// Verifies the research page never shows the heuristic fallback dressed up
// as model-generated output. Either the page shows an explicit "Thesis
// unavailable" message (when display_status is unavailable / unverified, or
// fallback_used is true), or it shows the verified/partial body with a
// "Verified" badge. It never shows the body in any other state.

import { test, expect } from "@playwright/test";

test("research never shows heuristic fallback as model-generated", async ({ page }) => {
  await page.goto("/research");

  // If thesis is unavailable, the page must say so explicitly.
  const unavailable = page.getByText(/Thesis unavailable/i);
  // If thesis is verified or partial, a verified badge must be visible.
  const verified = page.getByText(/Verified/i).first();

  await expect(unavailable.or(verified)).toBeVisible();
});

test("research thesis body never renders when display_status is unavailable", async ({ page }) => {
  await page.goto("/research");

  // If the unavailable panel is shown, the LLM body (Book View header) must
  // not be present. The unavailable message and the Book View title are
  // mutually exclusive — the ThesisBlock gates the body strictly.
  const unavailablePanel = page.getByText(/Thesis unavailable/i);
  const bookViewHeader = page.getByRole("heading", { name: /^Thesis$/i }).first();

  const isUnavailable = await unavailablePanel.isVisible().catch(() => false);
  if (isUnavailable) {
    await expect(bookViewHeader).toHaveCount(0);
  } else {
    // Verified/partial path: at least one of the headings is visible.
    await expect(bookViewHeader).toBeVisible();
  }
});