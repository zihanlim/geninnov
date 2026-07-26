import { test, expect } from "@playwright/test";

// /ask, with the API stubbed.
//
// The route is stubbed rather than exercised on purpose: a live run costs two
// MiniMax completions from the quota the nightly L5 book depends on, and a test
// suite that spends it would eventually regress the published book to its
// deterministic fallback. What is being tested here is the PAGE's contract —
// that a reader can see what was read, and that an untraceable figure is visibly
// untraceable — which does not need a real model to be true.

const RESPONSE = {
  answer: "UNH is 8.8% of the book as published on 2026-07-25. Gross exposure is 210.0%.",
  runDate: "2026-07-25",
  verified: false,
  unverified: ["210.0%"],
  citations: [
    { key: "position.UNH.weight", label: "UNH weight", value: 0.088, unit: "pct", source: "research_recommendations.picks[].weight" },
  ],
  verdicts: [
    { token: "8.8%", index: 7, grounding: "cited", fact: { key: "position.UNH.weight", label: "UNH weight", value: 0.088, unit: "pct", source: "research_recommendations.picks[].weight" } },
    { token: "2026-07-25", index: 47, grounding: "cited" },
    { token: "210.0%", index: 78, grounding: "unverified" },
  ],
  steps: [
    {
      tool: "book_summary",
      args: {},
      because: "to see the whole book",
      result: {
        tool: "book_summary",
        args: {},
        ms: 42,
        facts: [
          { key: "position.UNH.weight", label: "UNH weight", value: 0.088, unit: "pct", source: "research_recommendations.picks[].weight" },
        ],
        notes: { book_view: "Late-cycle, risk-on." },
      },
    },
  ],
};

async function stub(page: import("@playwright/test").Page, body: unknown, status = 200) {
  await page.route("**/api/chat", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test("shows what it read, with the source column for every value", async ({ page }) => {
  await stub(page, RESPONSE);
  await page.goto("/ask");

  await page.getByLabel("Ask a question about the published book").fill("how big is UNH?");
  await page.getByRole("button", { name: "Ask" }).click();

  const step = page.locator("details", { hasText: "book_summary" });
  await expect(step).toBeVisible();
  // Collapsed by default — goal 7: the answer is the fact, the ledger is
  // optional detail.
  await expect(step.getByText("research_recommendations.picks[].weight")).toBeHidden();

  await step.locator("summary").click();
  await expect(step.getByText("research_recommendations.picks[].weight")).toBeVisible();
  await expect(step.getByText("8.80%")).toBeVisible();
});

test("marks an untraceable figure in the prose and names it in the footer", async ({ page }) => {
  await stub(page, RESPONSE);
  await page.goto("/ask");
  await page.getByLabel("Ask a question about the published book").fill("how levered is it?");
  await page.getByRole("button", { name: "Ask" }).click();

  // The marked numeral carries a screen-reader explanation, so the warning is
  // not carried by colour alone.
  await expect(page.getByText("(unverified — traces to no fetched value)")).toBeAttached();
  await expect(page.getByText(/untraceable/)).toBeVisible();
  await expect(page.getByText("1 figure traced to a source")).toBeVisible();
});

test("states the reason when the agent could not answer", async ({ page }) => {
  await stub(page, { ...RESPONSE, answer: "", steps: [], verdicts: [], citations: [], error: "MiniMax quota is exhausted." });
  await page.goto("/ask");
  await page.getByLabel("Ask a question about the published book").fill("why?");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.getByTestId("empty-state")).toContainText("quota is exhausted");
});

test("surfaces the rate limit as prose rather than a dead form", async ({ page }) => {
  await stub(page, { error: "You have asked 15 questions today, which is the daily limit of 15 per visitor." }, 429);
  await page.goto("/ask");
  await page.getByLabel("Ask a question about the published book").fill("one more");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.getByTestId("empty-state")).toContainText("daily limit");
});

test("the Ask control is reachable from every page and is not a nav destination", async ({ page }) => {
  await page.goto("/book");
  const ask = page.getByRole("link", { name: "Ask" });
  await expect(ask).toBeVisible();
  // Four destinations, still. The chat is a tool for reading the book, not a
  // fifth thing the product is (design-goals.md non-goals).
  const primary = page.getByRole("navigation", { name: "Primary" });
  if (await primary.isVisible()) {
    await expect(primary.getByRole("link")).toHaveCount(4);
  }
});
