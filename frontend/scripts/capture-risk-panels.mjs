// UI/UX pass over the two new /risk panels, scripted rather than via the Playwright MCP.
// Captures each panel, checks the design-goal invariants that are mechanically checkable,
// and reports console errors. Throwaway harness — see docs/captures/2026-07-27/.

import { chromium } from "@playwright/test";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3004";
const OUT = path.resolve(process.cwd(), "../docs/captures/2026-07-27");

const browser = await chromium.launch();
const errors = [];

async function pass(label, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));

  await page.goto(`${BASE}/risk`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  // Goal 7: the page must never be trapped in an inner scroller, and the body must
  // never scroll horizontally.
  const overflow = await page.evaluate(() => ({
    bodyScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));

  const panels = {};
  for (const [name, heading] of [
    ["sanctions", "risk-sanctions-heading"],
    ["positioning", "risk-positioning-heading"],
  ]) {
    const sec = page.locator(`section[aria-labelledby="${heading}"]`);
    const count = await sec.count();
    panels[name] = { mounted: count > 0 };
    if (count === 0) continue;
    await sec.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await sec.screenshot({ path: path.join(OUT, `risk-${name}-${label}.png`) });
    panels[name].text = (await sec.innerText()).replace(/\s+/g, " ").slice(0, 400);
    panels[name].box = await sec.boundingBox();
  }

  // Expand the "positions COT cannot see" disclosure and re-capture.
  if (label === "desktop") {
    const det = page.locator('section[aria-labelledby="risk-positioning-heading"] details');
    if (await det.count()) {
      await det.locator("summary").click();
      await page.waitForTimeout(400);
      await page.locator('section[aria-labelledby="risk-positioning-heading"]')
        .screenshot({ path: path.join(OUT, "risk-positioning-expanded.png") });
      panels.positioning.detailsExpandedHeight =
        (await page.locator('section[aria-labelledby="risk-positioning-heading"]').boundingBox())?.height;
    }
  }

  await ctx.close();
  return { overflow, panels };
}

const desktop = await pass("desktop", 1440, 1000);
const mobile = await pass("mobile", 390, 844);

await browser.close();
console.log(JSON.stringify({ desktop, mobile, errors }, null, 2));
